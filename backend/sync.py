"""Scheduled sync entry point.

Run every 30 minutes (via Task Scheduler / run.ps1). Loads the saved session,
scans Zoom notes, downloads transcripts not already in the index, and records
results. Expired sessions trigger interactive re-login in a separate browser
lifecycle, then a fresh sync session continues.

By default Playwright work runs in an isolated child process so hung Edge
teardown cannot pin the lock forever.

Exit codes:
  0 success
  1 hard failure
  2 degraded (partial failures / selector issues)
  3 skipped (lock held by healthy peer)

    python sync.py
    python sync.py --worker   # internal: browser phase only (no lock)
"""

from __future__ import annotations

import logging
import os
import re
import subprocess
import sys
import time
import uuid
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

import config
import lockfile
import login as login_module
import procs
import security
import zoom_notes
from index_store import (
    STATUS_DOWNLOADED,
    STATUS_NO_TRANSCRIPT,
    STATUS_RETRYABLE,
    IndexCorruptError,
    IndexStore,
)
from zoom_notes import DownloadOutcome, OpenMismatchError

log = logging.getLogger("zoom_sync")

EXIT_OK = 0
EXIT_HARD = 1
EXIT_DEGRADED = 2
EXIT_LOCKED = 3


@dataclass
class RunStats:
    scanned: int = 0
    opened: int = 0
    downloaded: int = 0
    absent: int = 0
    retryable: int = 0
    failed: int = 0
    skipped_known: int = 0
    selector_broken: int = 0
    orphans: int = 0

    def summary(self, index_size: int, code: int) -> str:
        return (
            f"scanned={self.scanned} opened={self.opened} downloaded={self.downloaded} "
            f"absent={self.absent} retryable={self.retryable} selector_broken={self.selector_broken} "
            f"failed={self.failed} skipped_known={self.skipped_known} orphans={self.orphans} "
            f"index={index_size} exit={code}"
        )


def setup_logging() -> None:
    config.ensure_dirs()
    logfile = config.LOGS_DIR / f"sync-{datetime.now():%Y%m%d}.log"
    handlers = [logging.FileHandler(logfile, encoding="utf-8"), logging.StreamHandler(sys.stdout)]
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        handlers=handlers,
        force=True,
    )


_MONTH_ABBR = {
    "jan": 1,
    "feb": 2,
    "mar": 3,
    "apr": 4,
    "may": 5,
    "jun": 6,
    "jul": 7,
    "aug": 8,
    "sep": 9,
    "oct": 10,
    "nov": 11,
    "dec": 12,
}


def _parse_meeting_date(
    note: zoom_notes.NoteRef, *, today: datetime | None = None
) -> datetime:
    """Best-effort calendar day for path/filename (date part only; time ignored).

    Prefer ISO yyyy-mm-dd in the title (Zoom often embeds it), then the list-row
    date text (e.g. 'Monday Jul 20, 13:58-14:51'), else today.
    """
    now = (today or datetime.now()).date()
    for text in (note.title or "", note.date or ""):
        m = re.search(r"(20\d{2})-(\d{2})-(\d{2})", text)
        if m:
            try:
                return datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)))
            except ValueError:
                pass

    raw = note.date or ""
    m = re.search(
        r"\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\s+"
        r"(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+"
        r"(\d{1,2})\b",
        raw,
        re.IGNORECASE,
    )
    if m:
        month = _MONTH_ABBR[m.group(1)[:3].lower()]
        day = int(m.group(2))
        year = now.year
        try:
            candidate = datetime(year, month, day).date()
        except ValueError:
            candidate = None
        if candidate is not None:
            # UI omits year; if the day is far in the future, it was last year.
            if (candidate - now).days > 180:
                try:
                    candidate = datetime(year - 1, month, day).date()
                except ValueError:
                    candidate = None
            if candidate is not None:
                return datetime(candidate.year, candidate.month, candidate.day)

    m = re.search(
        r"\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|"
        r"Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|"
        r"Dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?"
        r"(?:,?\s*)?(20\d{2})?\b",
        note.title or "",
        re.IGNORECASE,
    )
    if m:
        month = _MONTH_ABBR[m.group(1)[:3].lower()]
        day = int(m.group(2))
        year = int(m.group(3)) if m.group(3) else now.year
        try:
            return datetime(year, month, day)
        except ValueError:
            pass

    return datetime(now.year, now.month, now.day)


def _safe_name(note: zoom_notes.NoteRef, meeting_day: datetime | None = None) -> str:
    day = meeting_day or _parse_meeting_date(note)
    prefix = f"{day:%Y-%m-%d}"
    note_id = note.stable_id()
    if config.PRIVACY_FILENAMES:
        return f"{prefix}-{note_id}.md"
    slug = re.sub(r"[^A-Za-z0-9._-]+", "_", note.title).strip("_")[:80] or "note"
    return f"{prefix}-{slug}__{note_id}.md"


def _transcript_dest(note: zoom_notes.NoteRef) -> Path:
    """Month folder under TRANSCRIPTS_DIR: {yyyy-mm}/{yyyy-mm-dd}-{name}.md"""
    day = _parse_meeting_date(note)
    return config.TRANSCRIPTS_DIR / f"{day:%Y-%m}" / _safe_name(note, day)


def _note_ids(note: zoom_notes.NoteRef) -> list[str]:
    ids = [note.metadata_id()]
    if note.note_id:
        ids.append(note.note_id)
    sid = note.stable_id()
    if sid not in ids:
        ids.append(sid)
    return ids


def _is_due(note: zoom_notes.NoteRef, index: IndexStore) -> bool:
    return any(index.should_process(i) for i in _note_ids(note))


def _order_notes_for_processing(
    notes: list[zoom_notes.NoteRef], index: IndexStore
) -> list[zoom_notes.NoteRef]:
    """Process every due note first (newest-first), then optional backfill candidates.

    Never bury new top-of-list notes behind known ones — that interacted badly with
    STOP_AFTER_KNOWN and skipped fresh meetings.
    """
    due: list[zoom_notes.NoteRef] = []
    known: list[zoom_notes.NoteRef] = []
    for note in notes:
        if _is_due(note, index):
            due.append(note)
        else:
            known.append(note)

    # Among known-only tail, optionally rotate from watermark for future backfill
    # discovery logging; we do not open known notes unless should_process says so.
    marks = set(index.watermark_ids())
    if marks and known:
        cut = None
        for i, note in enumerate(known):
            if note.metadata_id() in marks or note.stable_id() in marks:
                cut = i
                break
        if cut is not None and cut > 0:
            known = known[cut:] + known[:cut]
    return due + known


def process_notes(page, index: IndexStore, lock: lockfile.LockHandle | None, stats: RunStats) -> int:
    """Scan and download. Returns EXIT_OK or EXIT_DEGRADED."""
    notes = zoom_notes.collect_notes(page, config.MAX_ITEMS, config.MAX_SCROLL_STEPS)
    notes = _order_notes_for_processing(notes, index)
    stats.scanned = len(notes)
    due_count = sum(1 for n in notes if _is_due(n, index))
    log.info("Found %d note(s) after scan/scroll (%d due).", len(notes), due_count)
    if not notes:
        if zoom_notes.is_logged_in(page):
            log.warning(
                "No meeting notes parsed while authenticated. "
                "Selectors may need updating (see zoom_notes.SELECTORS)."
            )
            zoom_notes.save_diagnostics(page, f"empty-list-{datetime.now():%H%M%S}")
            return EXIT_DEGRADED
        log.error("Not authenticated and no notes found.")
        return EXIT_HARD

    consecutive_known = 0
    work_budget = config.MAX_ITEMS
    degraded = False
    last_processed_ids: list[str] = []
    reached_end = True
    due_remaining = due_count

    for note in notes:
        if work_budget <= 0:
            log.info("Work budget (%d) exhausted; remaining notes deferred.", config.MAX_ITEMS)
            reached_end = False
            break

        if lock is not None:
            try:
                lock.heartbeat()
            except Exception:
                pass

        pre_ids = _note_ids(note)
        if not _is_due(note, index):
            consecutive_known += 1
            stats.skipped_known += 1
            last_processed_ids = pre_ids[:3]
            # Only stop early when no due notes remain later in the queue.
            if due_remaining <= 0 and consecutive_known >= config.STOP_AFTER_KNOWN:
                log.info("Hit %d consecutive known notes; stopping scan.", consecutive_known)
                break
            continue

        due_remaining = max(0, due_remaining - 1)
        label = config.note_label(note.metadata_id(), note.title)
        log.info("Processing due note %s", label)
        try:
            zoom_notes.open_note(page, note)
        except OpenMismatchError as exc:
            log.error("Open mismatch for %s: %s", label, exc)
            stats.failed += 1
            degraded = True
            consecutive_known = 0
            work_budget -= 1
            zoom_notes._dismiss_menu(page)
            zoom_notes.save_diagnostics(page, f"mismatch-{note.metadata_id()}")
            index.add(
                note.metadata_id(),
                title=note.title,
                status=STATUS_RETRYABLE,
                host=note.host,
                meeting_date=note.date,
                last_outcome="open_mismatch",
                last_error=str(exc)[:300],
            )
            continue
        except Exception as exc:  # noqa: BLE001
            log.error("Failed to open note %s: %s", label, exc)
            stats.failed += 1
            degraded = True
            consecutive_known = 0
            work_budget -= 1
            zoom_notes._dismiss_menu(page)
            index.add(
                note.metadata_id(),
                title=note.title,
                status=STATUS_RETRYABLE,
                host=note.host,
                meeting_date=note.date,
                last_outcome="open_error",
                last_error=str(exc)[:300],
            )
            continue

        stats.opened += 1
        work_budget -= 1
        note_id = note.stable_id()
        meta_id = note.metadata_id()
        aliases = [a for a in _note_ids(note) if a != note_id]
        last_processed_ids = _note_ids(note)[:3]

        if not index.should_process(note_id) and not index.should_process(meta_id):
            log.info("Already have %s (resolved). Skipping.", label)
            consecutive_known += 1
            stats.skipped_known += 1
            if consecutive_known >= config.STOP_AFTER_KNOWN:
                break
            continue

        consecutive_known = 0
        dest = _transcript_dest(note)
        try:
            result = zoom_notes.download_transcript(page, dest)
        except Exception as exc:  # noqa: BLE001
            log.error("Download error for %s: %s", label, exc)
            stats.failed += 1
            degraded = True
            index.add(
                note_id,
                title=note.title,
                status=STATUS_RETRYABLE,
                source_url=note.url,
                host=note.host,
                meeting_date=note.date,
                aliases=aliases,
                last_outcome="error",
                last_error=str(exc)[:300],
            )
            continue

        if result.outcome == DownloadOutcome.DOWNLOADED:
            try:
                rel = str(dest.relative_to(config.BASE_DIR))
            except ValueError:
                rel = str(dest)
            index.add(
                note_id,
                title=note.title,
                status=STATUS_DOWNLOADED,
                source_url=note.url,
                host=note.host,
                meeting_date=note.date,
                file=rel,
                aliases=aliases,
                size=result.size,
                sha256=result.sha256,
                last_outcome="downloaded",
            )
            stats.downloaded += 1
            try:
                shown = str(dest.relative_to(config.TRANSCRIPTS_DIR))
            except ValueError:
                shown = str(dest)
            log.info("Downloaded transcript: %s -> %s", label, shown)
        elif result.outcome == DownloadOutcome.ABSENT:
            index.add(
                note_id,
                title=note.title,
                status=STATUS_NO_TRANSCRIPT,
                source_url=note.url,
                host=note.host,
                meeting_date=note.date,
                aliases=aliases,
                last_outcome="absent",
                last_error=result.error,
            )
            stats.absent += 1
            log.info("No transcript for %s; backoff scheduled.", label)
        elif result.outcome == DownloadOutcome.SELECTOR_BROKEN:
            index.add(
                note_id,
                title=note.title,
                status=STATUS_RETRYABLE,
                source_url=note.url,
                host=note.host,
                meeting_date=note.date,
                aliases=aliases,
                last_outcome="selector_broken",
                last_error=result.error,
            )
            stats.selector_broken += 1
            degraded = True
            log.warning("Selector issue for %s: %s", label, result.error)
            zoom_notes.save_diagnostics(page, f"selector-{note.metadata_id()}")
        else:
            index.add(
                note_id,
                title=note.title,
                status=STATUS_RETRYABLE,
                source_url=note.url,
                host=note.host,
                meeting_date=note.date,
                aliases=aliases,
                last_outcome="retryable",
                last_error=result.error,
            )
            stats.retryable += 1
            degraded = True
            log.warning("Retryable download issue for %s: %s", label, result.error)

    # Persist watermark so the next run can continue deeper into history.
    top_ids = [n.metadata_id() for n in notes[:5]]
    index.mark_scan(
        last_run_at=datetime.now().isoformat(timespec="seconds"),
        watermark_ids=last_processed_ids or top_ids,
        last_top_ids=top_ids,
        reached_end=reached_end and consecutive_known >= config.STOP_AFTER_KNOWN,
        last_scanned_count=stats.scanned,
        last_downloaded=stats.downloaded,
    )
    return EXIT_DEGRADED if degraded else EXIT_OK


def ensure_authenticated(session: procs.BrowserSession) -> procs.BrowserSession:
    """Ensure session is authenticated. May stop and replace the session."""
    page = session.page
    page.goto(config.NOTES_URL, wait_until="domcontentloaded")
    page.wait_for_timeout(3000)
    if zoom_notes.is_logged_in(page):
        return session

    log.warning("Session expired or missing. Launching interactive login...")
    session.stop()

    if not login_module.interactive_login():
        raise RuntimeError("Interactive login failed or timed out.")

    run_token = f"zoom-sync-{uuid.uuid4().hex}"
    session = procs.BrowserSession(
        headless=config.HEADLESS,
        run_token=run_token,
        process_names=config.browser_process_names(),
        launch_kwargs=config.launch_kwargs(headless=config.HEADLESS),
        new_context_fn=config.new_context,
        use_saved_state=True,
    )
    session.start()
    page = session.page
    page.goto(config.NOTES_URL, wait_until="domcontentloaded")
    page.wait_for_timeout(3000)
    if not zoom_notes.is_logged_in(page):
        raise RuntimeError("Still not authenticated after interactive login.")
    return session


def run_browser_phase(lock: lockfile.LockHandle | None = None) -> int:
    """Browser + index work. Used in-process or as an isolated worker child."""
    stats = RunStats()
    code = EXIT_OK
    session = None

    try:
        index = IndexStore.load(config.INDEX_FILE, backoff_hours=config.absent_backoff_hours())
    except IndexCorruptError as exc:
        log.error("%s", exc)
        return EXIT_HARD

    missing = index.reconcile_files(config.BASE_DIR)
    if missing:
        log.warning("Reconcile: %d downloaded record(s) missing files; will retry.", len(missing))

    orphans = index.find_orphan_files(config.TRANSCRIPTS_DIR, config.BASE_DIR)
    stats.orphans = len(orphans)
    if orphans:
        preview = ", ".join(orphans[:5])
        more = f" (+{len(orphans) - 5} more)" if len(orphans) > 5 else ""
        log.warning("Orphan transcript file(s) not in index: %s%s", preview, more)

    try:
        run_token = f"zoom-sync-{uuid.uuid4().hex}"
        session = procs.BrowserSession(
            headless=config.HEADLESS,
            run_token=run_token,
            process_names=config.browser_process_names(),
            launch_kwargs=config.launch_kwargs(headless=config.HEADLESS),
            new_context_fn=config.new_context,
            use_saved_state=True,
        )
        session.start()
        session = ensure_authenticated(session)
        code = process_notes(session.page, index, lock, stats)

        try:
            if session.context is not None:
                config.save_storage_state(session.context)
                log.info("Session state refreshed.")
        except Exception as exc:  # noqa: BLE001
            log.warning("Could not refresh storage state: %s", exc)

    except Exception as exc:  # noqa: BLE001
        log.exception("Sync failed: %s", exc)
        code = EXIT_HARD
    finally:
        if session is not None:
            try:
                session.stop()
            except Exception:
                pass
        try:
            idx_count = IndexStore.load(config.INDEX_FILE).count if config.INDEX_FILE.exists() else 0
        except Exception:
            idx_count = -1
        log.info("Run summary: %s", stats.summary(idx_count, code))
        _touch_sync_stamp(code, stats)

    return code


def _touch_sync_stamp(code: int, stats: RunStats) -> None:
    """Write a root-level stamp so IDE/OpenCode file trees notice external writes.

    data/ is gitignored and often poorly watched; a small root file change is a
    reliable FS event for UIs that cache the tree until restart.
    """
    try:
        stamp = config.BASE_DIR / ".last-sync"
        stamp.write_text(
            f"{datetime.now().isoformat(timespec='seconds')} exit={code} "
            f"downloaded={stats.downloaded} scanned={stats.scanned}\n",
            encoding="utf-8",
        )
    except OSError:
        pass


def _run_isolated_worker(lock: lockfile.LockHandle) -> int:
    """Spawn a child process for Playwright work; kill the tree on timeout."""
    cmd = [sys.executable, str(Path(__file__).resolve()), "--worker"]
    log.info("Starting isolated browser worker: %s", " ".join(cmd))
    creationflags = 0
    if os.name == "nt":
        # New process group so we can kill the tree.
        creationflags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0x00000200)

    env = os.environ.copy()
    env["ZOOM_SYNC_WORKER"] = "1"
    # Child must not re-enter isolation.
    env["ZOOM_WORKER_ISOLATION"] = "0"

    proc = subprocess.Popen(
        cmd,
        cwd=str(config.BASE_DIR),
        env=env,
        creationflags=creationflags,
    )
    deadline = time.time() + config.WORKER_TIMEOUT_SECONDS
    try:
        while True:
            try:
                lock.heartbeat()
            except Exception:
                pass
            rc = proc.poll()
            if rc is not None:
                log.info("Browser worker exited with code %s", rc)
                return int(rc)
            if time.time() >= deadline:
                log.error(
                    "Browser worker timed out after %ss; killing process tree.",
                    config.WORKER_TIMEOUT_SECONDS,
                )
                procs.kill_process_tree(proc.pid)
                try:
                    proc.wait(timeout=15)
                except Exception:
                    pass
                return EXIT_HARD
            time.sleep(2)
    except Exception:
        procs.kill_process_tree(proc.pid)
        raise


def run(*, worker: bool = False) -> int:
    setup_logging()
    log.info("=== Zoom notes sync starting%s ===", " (worker)" if worker else "")

    try:
        config.validate_config()
        config.ensure_dirs()
        config.prune_old_logs()
        if config.APPLY_ACLS:
            acl_paths = [
                config.STORAGE_STATE,
                config.DATA_DIR,
                config.LOGS_DIR,
                config.DIAGNOSTICS_DIR,
            ]
            # Do not lock down an external vault/share (e.g. Obsidian under OneDrive).
            try:
                config.TRANSCRIPTS_DIR.resolve().relative_to(config.DATA_DIR.resolve())
                acl_paths.append(config.TRANSCRIPTS_DIR)
            except ValueError:
                pass
            security.apply_user_only_acls(acl_paths)
    except ValueError as exc:
        log.error("Configuration error: %s", exc)
        return EXIT_HARD

    # Worker child: parent already holds the lock.
    if worker:
        code = run_browser_phase(lock=None)
        log.info("=== Zoom notes sync finished (exit %d) ===", code)
        return code

    lock = lockfile.acquire(config.LOCK_FILE, stale_minutes=config.LOCK_STALE_MINUTES)
    if lock is None:
        log.warning("Another healthy run holds the lock; exiting.")
        return EXIT_LOCKED

    code = EXIT_OK
    try:
        if config.WORKER_ISOLATION:
            code = _run_isolated_worker(lock)
        else:
            code = run_browser_phase(lock)
    except Exception as exc:  # noqa: BLE001
        log.exception("Sync failed: %s", exc)
        code = EXIT_HARD
    finally:
        lock.release()
        log.info("=== Zoom notes sync finished (exit %d) ===", code)

    return code


if __name__ == "__main__":
    is_worker = "--worker" in sys.argv[1:]
    sys.exit(run(worker=is_worker))
