var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => ZoomMyNotesSyncPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var path7 = __toESM(require("path"));

// src/deploy.ts
var fs5 = __toESM(require("fs"));
var path6 = __toESM(require("path"));

// src/platform.ts
var path = __toESM(require("path"));
function hostPlatform() {
  if (process.platform === "win32") return "win32";
  if (process.platform === "darwin") return "darwin";
  if (process.platform === "linux") return "linux";
  return "other";
}
function defaultBrowserChannel() {
  if (hostPlatform() === "win32") return "msedge";
  if (hostPlatform() === "darwin") return "chrome";
  return "";
}
function platformLabel() {
  switch (hostPlatform()) {
    case "win32":
      return "Windows";
    case "darwin":
      return "macOS";
    case "linux":
      return "Linux";
    default:
      return process.platform;
  }
}
function schedulerLabel() {
  switch (hostPlatform()) {
    case "win32":
      return "Task Scheduler";
    case "darwin":
      return "launchd (LaunchAgent)";
    case "linux":
      return "cron";
    default:
      return "background scheduler";
  }
}
function shellQuotePosix(value) {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}
function shellQuotePowerShell(value) {
  return `'${value.replace(/'/g, "''")}'`;
}
function venvPythonCandidates(root) {
  return [
    path.join(root, ".venv", "Scripts", "python.exe"),
    path.join(root, ".venv", "bin", "python3"),
    path.join(root, ".venv", "bin", "python")
  ];
}
function sanitizeJobName(name) {
  const cleaned = (name || "ZoomNotesSync").replace(/[^A-Za-z0-9._-]+/g, "-");
  return cleaned || "ZoomNotesSync";
}

// src/paths.ts
var fs = __toESM(require("fs"));
var path2 = __toESM(require("path"));
function expandPath(raw) {
  if (!raw) return "";
  return path2.normalize(raw.trim());
}
function pathExists(p) {
  try {
    return !!p && fs.existsSync(p);
  } catch {
    return false;
  }
}
function isDir(p) {
  try {
    return pathExists(p) && fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}
function isFile(p) {
  try {
    return pathExists(p) && fs.statSync(p).isFile();
  } catch {
    return false;
  }
}
function resolveSyncRoot(settings) {
  return expandPath(settings.syncRoot);
}
function resolvePython(settings) {
  const explicit = expandPath(settings.pythonPath);
  if (explicit && (isFile(explicit) || pathExists(explicit))) return explicit;
  const root = resolveSyncRoot(settings);
  if (root) {
    for (const c of venvPythonCandidates(root)) {
      if (isFile(c) || pathExists(c)) return c;
    }
  }
  return process.platform === "win32" ? "python" : "python3";
}
function resolveTranscriptsDir(settings, vaultPath) {
  const folder = (settings.outputFolder || "mynotes").replace(/^[\\/]+/, "");
  return path2.normalize(path2.join(vaultPath, folder));
}
function looksLikeSyncRoot(root) {
  if (!isDir(root)) return false;
  return isFile(path2.join(root, "sync.py")) && isFile(path2.join(root, "config.py")) && isFile(path2.join(root, "requirements.txt"));
}
function latestLogPath(root) {
  const logs = path2.join(root, "logs");
  if (!isDir(logs)) return null;
  let best = null;
  for (const name of fs.readdirSync(logs)) {
    if (!/^sync-\d{8}\.log$/i.test(name)) continue;
    const full = path2.join(logs, name);
    try {
      const st = fs.statSync(full);
      if (!best || st.mtimeMs > best.mtime) {
        best = { name: full, mtime: st.mtimeMs };
      }
    } catch {
    }
  }
  return best?.name ?? null;
}
function readTail(filePath, maxBytes = 6e3) {
  try {
    const buf = fs.readFileSync(filePath);
    if (buf.length <= maxBytes) return buf.toString("utf8");
    return buf.subarray(buf.length - maxBytes).toString("utf8");
  } catch (e) {
    return `Could not read log: ${e instanceof Error ? e.message : String(e)}`;
  }
}

// src/provision.ts
var fs3 = __toESM(require("fs"));
var http = __toESM(require("http"));
var https = __toESM(require("https"));
var path4 = __toESM(require("path"));

// src/backendBundle.generated.ts
var BACKEND_FILES = {
  "sync.py": `"""Scheduled sync entry point.

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
        m = re.search(r"(20\\d{2})-(\\d{2})-(\\d{2})", text)
        if m:
            try:
                return datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)))
            except ValueError:
                pass

    raw = note.date or ""
    m = re.search(
        r"\\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\\s+"
        r"(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\\s+"
        r"(\\d{1,2})\\b",
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
        r"\\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|"
        r"Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|"
        r"Dec(?:ember)?)\\s+(\\d{1,2})(?:st|nd|rd|th)?"
        r"(?:,?\\s*)?(20\\d{2})?\\b",
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

    Never bury new top-of-list notes behind known ones \u2014 that interacted badly with
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
            log.info(
                "No transcript for %s; backoff scheduled. (%s)",
                label,
                (result.error or "")[:200],
            )
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

    requeued = index.requeue_false_absents()
    if requeued:
        log.info(
            "Re-queued %d note(s) previously marked no-transcript (likely menu/UI miss).",
            requeued,
        )

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
            f"downloaded={stats.downloaded} scanned={stats.scanned}\\n",
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
`,
  "login.py": '"""Interactive login for Zoom Notes.\n\nRun this once (or whenever the session expires) to open a real browser window,\nlog in manually, and persist the authenticated session to `storage_state.json`.\n\n    python login.py\n\nIt is also imported by `sync.py` to drive the auto re-auth flow when a\nscheduled run detects an expired session.\n"""\n\nfrom __future__ import annotations\n\nimport sys\nimport time\nimport uuid\n\nfrom playwright.sync_api import Error as PWError\n\nimport config\nimport procs\nimport zoom_notes\n\n\ndef _logged_in_page(context):\n    """Return the first open page/tab that looks authenticated, else None."""\n    for pg in list(context.pages):\n        try:\n            if zoom_notes.is_logged_in(pg):\n                return pg\n        except PWError:\n            continue\n    return None\n\n\ndef interactive_login(wait_seconds: int = None) -> bool:\n    """Open a visible browser, let the user sign in, and save the session.\n\n    Returns True if login succeeded and the session was saved. Owns its browser\n    lifecycle completely; callers must not hold another Playwright Edge session\n    open while this runs.\n    """\n    wait_seconds = wait_seconds if wait_seconds is not None else config.LOGIN_WAIT_SECONDS\n    config.ensure_dirs()\n    config.validate_config()\n\n    run_token = f"zoom-login-{uuid.uuid4().hex}"\n    session = procs.BrowserSession(\n        headless=False,\n        run_token=run_token,\n        process_names=config.browser_process_names(),\n        launch_kwargs=config.launch_kwargs(headless=False),\n        new_context_fn=config.new_context,\n        use_saved_state=True,\n    )\n\n    try:\n        session.start()\n        context = session.context\n        page = session.page\n\n        print(f"Opening {config.redact_url(config.NOTES_URL)} ...", flush=True)\n        try:\n            page.goto(config.NOTES_URL, wait_until="domcontentloaded")\n        except PWError as exc:\n            print(f"Initial navigation warning: {exc}", flush=True)\n\n        print("Please complete the sign-in in the browser window.", flush=True)\n        print(f"Waiting up to {wait_seconds}s for the notes list to appear...", flush=True)\n\n        # Let redirects settle before auth checks.\n        time.sleep(5)\n\n        deadline = time.time() + wait_seconds\n        authed_page = None\n        last_report = 0.0\n        while time.time() < deadline:\n            if not context.pages:\n                print("  [info] no tabs open; reopening notes page...", flush=True)\n                try:\n                    newp = context.new_page()\n                    newp.goto(config.NOTES_URL, wait_until="domcontentloaded")\n                except PWError as exc:\n                    print(f"  [info] reopen failed: {exc}", flush=True)\n                    time.sleep(2)\n                    continue\n\n            authed_page = _logged_in_page(context)\n            if authed_page is not None:\n                break\n\n            now = time.time()\n            if now - last_report > 10:\n                urls = []\n                for pg in list(context.pages):\n                    try:\n                        urls.append(config.redact_url(pg.url))\n                    except PWError:\n                        pass\n                print(f"  [waiting] open tabs: {urls}", flush=True)\n                last_report = now\n            time.sleep(2)\n\n        logged_in = authed_page is not None\n        if logged_in:\n            time.sleep(2)\n            try:\n                config.save_storage_state(context)\n                print(\n                    f"Login successful (url: {config.redact_url(authed_page.url)}). "\n                    f"Session saved to {config.STORAGE_STATE}",\n                    flush=True,\n                )\n            except PWError as exc:\n                logged_in = False\n                print(f"Session save failed: {exc}", flush=True)\n        else:\n            print("Timed out / no authenticated tab. Session NOT saved.", flush=True)\n\n        return logged_in\n    finally:\n        session.stop()\n\n\nif __name__ == "__main__":\n    try:\n        ok = interactive_login()\n    except Exception as exc:  # noqa: BLE001\n        print(f"Login failed: {exc}", flush=True)\n        ok = False\n    sys.exit(0 if ok else 1)\n',
  "config.py": `"""Central configuration for the Zoom Notes transcript sync.

All tunables live here so the rest of the code stays declarative. Paths are
resolved relative to this file so the scripts work regardless of the current
working directory (important when launched from Task Scheduler).
"""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path
from typing import List
from urllib.parse import urlparse

BASE_DIR = Path(__file__).resolve().parent

# --- Target ---------------------------------------------------------------
_DEFAULT_NOTES_URL = "https://docs.zoom.us/notes?from=client"
NOTES_URL = os.environ.get("ZOOM_NOTES_URL", _DEFAULT_NOTES_URL)

# Hostnames allowed for automated navigation (authenticated browser).
_DEFAULT_ALLOWED_HOSTS = ("docs.zoom.us",)
ALLOWED_HOSTS = tuple(
    h.strip().lower()
    for h in os.environ.get("ZOOM_ALLOWED_HOSTS", ",".join(_DEFAULT_ALLOWED_HOSTS)).split(",")
    if h.strip()
)

# Substring that indicates we were bounced to a sign-in page (not logged in).
SIGNIN_URL_MARKERS = ("/signin", "zoom.us/signin", "/oauth", "/saml")

# --- Filesystem -----------------------------------------------------------
STORAGE_STATE = BASE_DIR / "storage_state.json"
DATA_DIR = Path(os.environ.get("ZOOM_DATA_DIR", str(BASE_DIR / "data")))
# Transcript destination (may live outside the repo, e.g. an Obsidian vault).
# Override with ZOOM_TRANSCRIPTS_DIR. Index/backoff stay under DATA_DIR.
_DEFAULT_TRANSCRIPTS_DIR = str(BASE_DIR / "mynotes")
TRANSCRIPTS_DIR = Path(
    os.environ.get("ZOOM_TRANSCRIPTS_DIR", _DEFAULT_TRANSCRIPTS_DIR)
)
INDEX_FILE = DATA_DIR / "index.json"
LOGS_DIR = Path(os.environ.get("ZOOM_LOGS_DIR", str(BASE_DIR / "logs")))
DIAGNOSTICS_DIR = LOGS_DIR / "diagnostics"
LOCK_FILE = BASE_DIR / "sync.lock"

# --- Browser --------------------------------------------------------------
# Use an installed, IT-approved browser instead of Playwright's bundled
# Chromium (which may be blocked by security policy). Valid channels:
# "msedge", "chrome", "chrome-beta", "msedge-beta", etc. Set to "" (empty)
# to fall back to Playwright's bundled Chromium (requires \`playwright install\`).
# Prefer real desktop browsers: Edge (Windows), Chrome (macOS), Chromium (Linux).
if os.name == "nt":
    _DEFAULT_CHANNEL = "msedge"
elif sys.platform == "darwin":
    _DEFAULT_CHANNEL = "chrome"
else:
    _DEFAULT_CHANNEL = ""
# Empty env var must fall through to default (os.environ.get("", default) returns "").
_raw_channel = os.environ.get("ZOOM_BROWSER_CHANNEL")
BROWSER_CHANNEL = _DEFAULT_CHANNEL if _raw_channel is None or _raw_channel.strip() == "" else _raw_channel.strip()


def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "t", "yes", "y", "on")


def _env_int(name: str, default: int, *, minimum: int | None = None, maximum: int | None = None) -> int:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        value = default
    else:
        try:
            value = int(raw.strip())
        except ValueError as exc:
            raise ValueError(f"{name} must be an integer, got {raw!r}") from exc
    if minimum is not None and value < minimum:
        raise ValueError(f"{name} must be >= {minimum}, got {value}")
    if maximum is not None and value > maximum:
        raise ValueError(f"{name} must be <= {maximum}, got {value}")
    return value


def launch_kwargs(headless: bool) -> dict:
    """Build chromium.launch kwargs, honoring the configured browser channel."""
    kwargs: dict = {"headless": headless}
    if BROWSER_CHANNEL:
        kwargs["channel"] = BROWSER_CHANNEL
    args = [
        "--disable-dev-shm-usage",
        "--no-default-browser-check",
        "--disable-blink-features=AutomationControlled",
    ]
    # macOS: avoid background throttling that stalls Zoom\u2019s SPA in automation.
    if sys.platform == "darwin":
        args.extend(
            [
                "--disable-background-timer-throttling",
                "--disable-backgrounding-occluded-windows",
                "--disable-renderer-backgrounding",
            ]
        )
    kwargs["args"] = args
    return kwargs


def new_context(browser, use_saved_state: bool = True):
    """Create a non-persistent context, loading the saved session if present.

    Non-persistent contexts use a throwaway profile, avoiding the profile-lock
    problems that plague persistent contexts on Windows. The authenticated
    session is carried via STORAGE_STATE instead.
    """
    downloads = TRANSCRIPTS_DIR / ".playwright-downloads"
    downloads.mkdir(parents=True, exist_ok=True)
    kwargs: dict = {
        "accept_downloads": True,
        "downloads_path": str(downloads),
        "viewport": {"width": 1400, "height": 900},
        "locale": "en-US",
    }
    if use_saved_state and STORAGE_STATE.exists():
        kwargs["storage_state"] = str(STORAGE_STATE)
    ctx = browser.new_context(**kwargs)
    ctx.set_default_navigation_timeout(NAV_TIMEOUT_MS)
    ctx.set_default_timeout(ACTION_TIMEOUT_MS)
    return ctx


def save_storage_state(context) -> None:
    """Atomically persist the browser storage state."""
    STORAGE_STATE.parent.mkdir(parents=True, exist_ok=True)
    tmp = STORAGE_STATE.with_suffix(STORAGE_STATE.suffix + ".tmp")
    bak = STORAGE_STATE.with_suffix(STORAGE_STATE.suffix + ".bak")
    context.storage_state(path=str(tmp))
    if STORAGE_STATE.exists():
        try:
            if bak.exists():
                bak.unlink()
            STORAGE_STATE.replace(bak)
        except OSError:
            pass
    tmp.replace(STORAGE_STATE)


def validate_notes_url(url: str = None) -> str:
    """Validate NOTES_URL is https and on an allowed Zoom host. Returns the URL."""
    candidate = (url if url is not None else NOTES_URL).strip()
    parsed = urlparse(candidate)
    if parsed.scheme.lower() != "https":
        raise ValueError(f"ZOOM_NOTES_URL must be https, got scheme={parsed.scheme!r}")
    host = (parsed.hostname or "").lower()
    if host not in ALLOWED_HOSTS:
        raise ValueError(
            f"ZOOM_NOTES_URL host {host!r} is not allowed; allowed={list(ALLOWED_HOSTS)}"
        )
    return candidate


def browser_process_names() -> List[str]:
    """Process image names used by the configured channel (for scoped cleanup)."""
    channel = (BROWSER_CHANNEL or "").lower()
    if os.name == "nt":
        if channel.startswith("msedge"):
            return ["msedge.exe"]
        if channel.startswith("chrome"):
            return ["chrome.exe"]
        return ["chrome.exe", "chromium.exe"]
    # macOS / Linux process names (for pgrep/pkill token cleanup)
    if channel.startswith("msedge") or channel.startswith("edge"):
        return ["Microsoft Edge", "msedge"]
    if channel.startswith("chrome"):
        return ["Google Chrome", "chrome"]
    return ["Chromium", "chrome", "chromium"]


# --- Behaviour ------------------------------------------------------------
# Run headless during scheduled syncs. Re-auth temporarily forces a headed
# window regardless of this value.
HEADLESS = _env_bool("ZOOM_HEADLESS", True)

# Max note open/download attempts per run (work budget, not visibility ceiling).
MAX_ITEMS = _env_int("ZOOM_MAX_ITEMS", 25, minimum=1, maximum=500)

# Stop scanning after this many consecutive already-known notes once the list
# end has been reached (or scroll produces no new rows).
STOP_AFTER_KNOWN = _env_int("ZOOM_STOP_AFTER_KNOWN", 3, minimum=1, maximum=100)

# Max scroll steps while collecting/scanning the notes list.
MAX_SCROLL_STEPS = _env_int("ZOOM_MAX_SCROLL_STEPS", 30, minimum=0, maximum=200)

# Timeouts (milliseconds).
NAV_TIMEOUT_MS = _env_int("ZOOM_NAV_TIMEOUT_MS", 45000, minimum=1000)
ACTION_TIMEOUT_MS = _env_int("ZOOM_ACTION_TIMEOUT_MS", 20000, minimum=1000)
DOWNLOAD_TIMEOUT_MS = _env_int("ZOOM_DOWNLOAD_TIMEOUT_MS", 60000, minimum=1000)

# How long (seconds) to wait for the human to finish logging in during the
# interactive re-auth flow.
LOGIN_WAIT_SECONDS = _env_int("ZOOM_LOGIN_WAIT_SECONDS", 300, minimum=30, maximum=3600)

# Treat a lock file older than this many minutes (by heartbeat) as stale.
LOCK_STALE_MINUTES = _env_int("ZOOM_LOCK_STALE_MINUTES", 25, minimum=1, maximum=240)

# Log retention and privacy.
LOG_RETENTION_DAYS = _env_int("ZOOM_LOG_RETENTION_DAYS", 30, minimum=1, maximum=3650)
LOG_TITLES = _env_bool("ZOOM_LOG_TITLES", False)
APPLY_ACLS = _env_bool("ZOOM_APPLY_ACLS", True)
# New downloads only: omit title from filename (date prefix + id only; existing untouched).
PRIVACY_FILENAMES = _env_bool("ZOOM_PRIVACY_FILENAMES", False)
# Require opened-note title to match before downloading (hard fail on clear mismatch).
STRICT_OPEN_VERIFY = _env_bool("ZOOM_STRICT_OPEN_VERIFY", True)
# Run Playwright work in a child process so hung Edge can be killed as a tree.
WORKER_ISOLATION = _env_bool("ZOOM_WORKER_ISOLATION", True)
# Max seconds the parent waits for the browser worker (includes login wait headroom).
WORKER_TIMEOUT_SECONDS = _env_int("ZOOM_WORKER_TIMEOUT_SECONDS", 1200, minimum=60, maximum=7200)

# Absent-transcript backoff schedule in hours (comma-separated).
_DEFAULT_BACKOFF_HOURS = "6,24,72,168"


def absent_backoff_hours() -> List[int]:
    raw = os.environ.get("ZOOM_ABSENT_BACKOFF_HOURS", _DEFAULT_BACKOFF_HOURS)
    hours: List[int] = []
    for part in raw.split(","):
        part = part.strip()
        if not part:
            continue
        value = int(part)
        if value < 1:
            raise ValueError("ZOOM_ABSENT_BACKOFF_HOURS values must be >= 1")
        hours.append(value)
    if not hours:
        hours = [6, 24, 72, 168]
    return hours


def ensure_dirs() -> None:
    """Create the runtime directories if they don't exist yet."""
    TRANSCRIPTS_DIR.mkdir(parents=True, exist_ok=True)
    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    DIAGNOSTICS_DIR.mkdir(parents=True, exist_ok=True)


def redact_url(url: str) -> str:
    """Strip query string and fragment from a URL for safe logging."""
    if not url:
        return ""
    try:
        parsed = urlparse(url)
        host = parsed.netloc or ""
        path = parsed.path or ""
        return f"{parsed.scheme}://{host}{path}" if parsed.scheme else f"{host}{path}"
    except Exception:
        return re.sub(r"[?#].*$", "", url)


def note_label(note_id: str, title: str = "") -> str:
    """Human-readable log label; titles are opt-in via ZOOM_LOG_TITLES."""
    if LOG_TITLES and title:
        return f"{note_id} ({title})"
    return note_id


def validate_config() -> None:
    """Validate configuration early; raise ValueError on bad values."""
    validate_notes_url(NOTES_URL)
    # Touch validated ints already parsed at import; re-check backoff.
    absent_backoff_hours()
    if not ALLOWED_HOSTS:
        raise ValueError("ZOOM_ALLOWED_HOSTS must list at least one host")


def prune_old_logs(directory: Path = None, retention_days: int = None) -> int:
    """Delete dated log files older than retention. Returns number removed."""
    import time

    directory = directory or LOGS_DIR
    retention_days = LOG_RETENTION_DAYS if retention_days is None else retention_days
    if not directory.exists():
        return 0
    cutoff = time.time() - (retention_days * 86400)
    removed = 0
    patterns = ("sync-*.log", "run-*.log")
    for pattern in patterns:
        for path in directory.glob(pattern):
            try:
                if path.is_file() and path.stat().st_mtime < cutoff:
                    path.unlink(missing_ok=True)
                    removed += 1
            except OSError:
                continue
    # Cap diagnostics to newest 20 files.
    try:
        diags = sorted(
            DIAGNOSTICS_DIR.glob("*"),
            key=lambda p: p.stat().st_mtime if p.exists() else 0,
            reverse=True,
        )
        for stale in diags[20:]:
            try:
                stale.unlink(missing_ok=True)
            except OSError:
                pass
    except OSError:
        pass
    return removed
`,
  "zoom_notes.py": `"""Playwright page helpers for the Zoom Notes (docs.zoom.us/notes) UI.

Selectors are centralized and role/text based where possible. Extraction returns
structured outcomes so transient failures are not permanently classified as
"no transcript".
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import List, Optional, Sequence, Set
from urllib.parse import urlparse

from playwright.sync_api import (
    Error as PWError,
    Locator,
    Page,
    TimeoutError as PWTimeoutError,
)

import config

# --- Tunable selectors ----------------------------------------------------
SELECTORS = {
    "app_ready": [
        'text=My Notes',
        'button:has-text("Import")',
        'text=Shared folders',
    ],
    "notes_pane_hints": [
        'text=My Notes',
    ],
    "note_items": [
        '[role="listitem"]',
        '[data-testid="note-list-item"]',
    ],
    "kebab": [
        'button[aria-label="More"]',
        'button[aria-label*="More" i]',
        'button[aria-label*="more" i]',
        'button[aria-label*="options" i]',
        'button[aria-label*="Page options" i]',
        'button[aria-haspopup="menu"]',
        'button[data-testid*="more" i]',
        'button[data-testid*="menu" i]',
    ],
    "download_transcript": [
        '[role="menuitem"]:has-text("Download transcript")',
        '[role="menuitem"]:has-text("Download Transcript")',
        '[role="menuitem"]:has-text("Export transcript")',
        '[role="menuitem"]:has-text("Export Transcript")',
        '[role="menuitem"]:has-text("Download as")',
        '[role="menuitem"]:has-text("transcript")',
        'text="Download transcript"',
        'text="Download Transcript"',
        'text=/download\\\\s+transcript/i',
        'text=/export\\\\s+transcript/i',
        'button:has-text("Download transcript")',
        'a:has-text("Download transcript")',
    ],
    "transcript_tab": [
        '[role="tab"]:has-text("Transcript")',
        'button:has-text("Transcript")',
        'text=Transcript',
    ],
    "opened_title": [
        '[data-testid="note-title"]',
        '[class*="note-title" i]',
        'main h1',
        '[role="main"] h1',
        'h1',
    ],
}

# Sidebar / chrome labels that must never be treated as meeting notes.
NAV_DENYLIST = {
    "home",
    "search",
    "help me write",
    "starred",
    "notifications",
    "my docs",
    "my notes",
    "meetings",
    "shared folders",
    "import",
    "shared with me",
    "trash",
    "settings",
}

# Opened-view chrome that is NOT the meeting title (strict verify must ignore these).
OPENED_TITLE_DENYLIST = {
    "page options",
    "more",
    "more options",
    "options",
    "download transcript",
    "manual notes",
    "transcript",
    "workflow",
    "share",
    "import",
    "my notes",
}

_ID_FROM_URL = re.compile(
    r"/notes/([A-Za-z0-9_\\-]{6,})|[?&](?:doc|docId|noteId|id)=([A-Za-z0-9_\\-]{6,})"
)


class DownloadOutcome(str, Enum):
    DOWNLOADED = "downloaded"
    ABSENT = "absent"
    RETRYABLE = "retryable"
    SELECTOR_BROKEN = "selector_broken"


@dataclass
class DownloadResult:
    outcome: DownloadOutcome
    path: Optional[Path] = None
    size: int = 0
    sha256: str = ""
    error: str = ""


class OpenMismatchError(RuntimeError):
    """Opened note title does not match the intended list row."""


@dataclass
class NoteRef:
    index: int
    title: str
    host: str = ""
    date: str = ""
    note_id: str = ""
    url: str = ""
    raw_text: str = ""

    def stable_id(self) -> str:
        """Stable dedup key: prefer real note id, else hash of metadata."""
        if self.note_id:
            return self.note_id
        seed = f"{self.title}|{self.host}|{self.date}".encode("utf-8")
        return "h_" + hashlib.sha1(seed).hexdigest()[:16]

    def metadata_id(self) -> str:
        seed = f"{self.title}|{self.host}|{self.date}".encode("utf-8")
        return "h_" + hashlib.sha1(seed).hexdigest()[:16]


def _first_usable(page: Page, candidates: Sequence[str], *, root: Locator = None) -> Optional[Locator]:
    base = root if root is not None else page
    for sel in candidates:
        try:
            loc = base.locator(sel)
            count = loc.count()
        except PWError:
            continue
        for i in range(min(count, 25)):
            item = loc.nth(i)
            try:
                if item.is_visible():
                    return item
            except PWError:
                continue
        # Fall back to first match even if visibility check failed.
        try:
            if count > 0:
                return loc.first
        except PWError:
            continue
    return None


def _all_visible(page: Page, candidates: Sequence[str], *, root: Locator = None) -> List[Locator]:
    base = root if root is not None else page
    for sel in candidates:
        try:
            loc = base.locator(sel)
            count = loc.count()
        except PWError:
            continue
        if count <= 0:
            continue
        items: List[Locator] = []
        for i in range(count):
            item = loc.nth(i)
            try:
                if item.is_visible():
                    items.append(item)
            except PWError:
                continue
        if items:
            return items
    return []


def is_logged_in(page: Page) -> bool:
    """DOM-first auth check against the notes app shell."""
    for sel in SELECTORS["app_ready"]:
        try:
            loc = page.locator(sel)
            if loc.count() > 0 and loc.first.is_visible():
                return True
        except PWError:
            continue

    url = (page.url or "").lower()
    if any(marker in url for marker in config.SIGNIN_URL_MARKERS):
        return False
    try:
        host = (urlparse(page.url or "").hostname or "").lower()
    except Exception:
        host = ""
    if host in config.ALLOWED_HOSTS and "/notes" in url:
        # URL alone is weak; require at least one app_ready attempt already failed.
        return False
    return False


def _note_id_from_url(url: str) -> str:
    m = _ID_FROM_URL.search(url or "")
    if not m:
        return ""
    return m.group(1) or m.group(2) or ""


def _clean(text: str) -> str:
    return re.sub(r"\\s+", " ", (text or "")).strip()


def _is_nav_title(title: str) -> bool:
    return _clean(title).lower() in NAV_DENYLIST


def _looks_like_note_row(title: str, host: str, date: str, lines: Sequence[str]) -> bool:
    if _is_nav_title(title):
        return False
    if host:
        return True
    if date and len(lines) >= 2:
        return True
    # Single-line chrome labels are not notes.
    if len(lines) <= 1:
        return False
    return True


def wait_for_notes(page: Page, timeout_ms: int = None) -> bool:
    """Wait until note rows render. Returns False on timeout."""
    timeout_ms = timeout_ms or config.ACTION_TIMEOUT_MS
    for sel in SELECTORS["note_items"]:
        try:
            page.wait_for_selector(sel, timeout=timeout_ms, state="visible")
            return True
        except (PWTimeoutError, PWError):
            continue
    return False


def _parse_row_text(raw: str) -> tuple[str, str, str, List[str]]:
    lines = [ln.strip() for ln in (raw or "").splitlines() if ln.strip()]
    if not lines:
        return "", "", "", []
    title = lines[0][:200]
    date = ""
    host = ""
    for ln in lines[1:]:
        if ln.lower().startswith("host:"):
            host = ln.split(":", 1)[1].strip()
        elif not date:
            date = ln
    return title, host, date, lines


def list_notes(page: Page, max_items: int) -> List[NoteRef]:
    """Return up to max_items meeting notes from the list (newest-first)."""
    wait_for_notes(page)
    items = _all_visible(page, SELECTORS["note_items"])
    notes: List[NoteRef] = []
    if not items:
        return notes

    for i, row in enumerate(items):
        if len(notes) >= max_items:
            break
        try:
            raw = row.inner_text(timeout=config.ACTION_TIMEOUT_MS)
        except PWTimeoutError:
            continue
        title, host, date, lines = _parse_row_text(raw)
        if not title:
            continue
        if not _looks_like_note_row(title, host, date, lines):
            continue
        notes.append(
            NoteRef(
                index=i,
                title=title,
                host=host,
                date=date,
                raw_text=raw,
            )
        )
    return notes


def scroll_notes_list(page: Page) -> bool:
    """Scroll the notes list to load more rows. Returns True if scroll ran."""
    items = _all_visible(page, SELECTORS["note_items"])
    if not items:
        return False
    try:
        items[-1].scroll_into_view_if_needed(timeout=config.ACTION_TIMEOUT_MS)
        page.wait_for_timeout(800)
        page.mouse.wheel(0, 1200)
        page.wait_for_timeout(800)
        return True
    except PWError:
        return False


def collect_notes(page: Page, max_items: int, max_scroll_steps: int = None) -> List[NoteRef]:
    """Collect notes with limited scrolling (dedupe by metadata id)."""
    max_scroll_steps = config.MAX_SCROLL_STEPS if max_scroll_steps is None else max_scroll_steps
    seen: Set[str] = set()
    collected: List[NoteRef] = []
    stagnant = 0

    for step in range(max_scroll_steps + 1):
        batch = list_notes(page, max_items=max(max_items * 3, 50))
        grew = 0
        for note in batch:
            mid = note.metadata_id()
            if mid in seen:
                continue
            seen.add(mid)
            collected.append(note)
            grew += 1
            if len(collected) >= max_items * 3:
                break
        if len(collected) >= max_items and grew == 0:
            stagnant += 1
        else:
            stagnant = 0 if grew else stagnant + 1
        if stagnant >= 2:
            break
        if step >= max_scroll_steps:
            break
        if not scroll_notes_list(page):
            break
    return collected[: max(max_items * 3, len(collected))]


def _normalize(s: str) -> str:
    return re.sub(r"\\s+", " ", (s or "")).strip().lower()


def open_note(page: Page, note: NoteRef) -> None:
    """Click the note row matching metadata and verify the note view loaded."""
    items = _all_visible(page, SELECTORS["note_items"])
    if not items:
        raise RuntimeError("Note list disappeared before opening a note")

    target: Optional[Locator] = None
    # Prefer exact raw-text / title match over stale positional index.
    want_title = _normalize(note.title)
    for row in items:
        try:
            raw = row.inner_text(timeout=3000)
        except PWError:
            continue
        title, host, date, _lines = _parse_row_text(raw)
        if _normalize(title) == want_title:
            if note.host and host and _normalize(host) != _normalize(note.host):
                continue
            target = row
            break
    if target is None and 0 <= note.index < len(items):
        target = items[note.index]
    if target is None:
        raise RuntimeError(f"Could not locate note row for {note.title!r}")

    target.click(timeout=config.ACTION_TIMEOUT_MS)
    # Client-side view swap; wait for note body/title (not just shell chrome).
    page.wait_for_timeout(2500)
    _wait_opened(page, note)
    note.url = page.url
    note.note_id = _note_id_from_url(page.url)


def _titles_compatible(want: str, shown: str) -> bool:
    """True if opened title reasonably matches the list-row title."""
    w = _normalize(want)
    s = _normalize(shown)
    if not w or not s:
        return True  # cannot verify
    if w == s:
        return True
    # UI may truncate, append date, or include extra whitespace/punctuation.
    w40, s40 = w[:40], s[:40]
    if w40 and (w40 in s or s40 in w):
        return True
    # Token overlap: at least half of significant tokens from want appear in shown.
    w_tokens = [t for t in re.split(r"[^a-z0-9]+", w) if len(t) > 2]
    if not w_tokens:
        return True
    hits = sum(1 for t in w_tokens if t in s)
    return hits >= max(1, (len(w_tokens) + 1) // 2)


def _is_chrome_title(text: str) -> bool:
    t = _normalize(text)
    if not t:
        return True
    if t in OPENED_TITLE_DENYLIST or t in NAV_DENYLIST:
        return True
    # Very short generic labels are almost never meeting titles.
    if len(t) < 4:
        return True
    return False


def _read_opened_title(page: Page) -> str:
    """Return the best candidate meeting title from the opened note view."""
    for sel in SELECTORS["opened_title"]:
        try:
            loc = page.locator(sel)
            count = min(loc.count(), 10)
        except PWError:
            continue
        for i in range(count):
            try:
                item = loc.nth(i)
                if not item.is_visible():
                    continue
                text = _clean(item.inner_text(timeout=1500))
            except PWError:
                continue
            if _is_chrome_title(text):
                continue
            return text
    return ""


def _page_shows_title(page: Page, title: str) -> bool:
    """True if the expected meeting title is visible somewhere on the page."""
    want = _clean(title)
    if not want:
        return False
    # Try progressively shorter prefixes (UI may truncate).
    candidates = [want, want[:80], want[:60], want[:40]]
    seen = set()
    for c in candidates:
        c = c.strip()
        if len(c) < 12 or c in seen:
            continue
        seen.add(c)
        try:
            loc = page.get_by_text(c, exact=False)
            n = min(loc.count(), 8)
            for i in range(n):
                try:
                    if loc.nth(i).is_visible():
                        return True
                except PWError:
                    continue
        except PWError:
            continue
    return False


def _wait_opened(page: Page, note: NoteRef) -> None:
    """Verify the note chrome rendered; hard-fail on clear title mismatch when enabled."""
    # Note body/title often paints after the shell; give it a moment.
    page.wait_for_timeout(800)

    # Strongest signal: expected title text is visible (matches live Zoom layout).
    if _page_shows_title(page, note.title):
        return

    kebab = _first_usable(page, SELECTORS["kebab"])
    if kebab is None:
        page.wait_for_timeout(1200)
        kebab = _first_usable(page, SELECTORS["kebab"])
        if _page_shows_title(page, note.title):
            return

    shown = _read_opened_title(page)

    # Only enforce mismatch when we found a real title candidate (not UI chrome).
    if shown and not _is_chrome_title(shown) and not _titles_compatible(note.title, shown):
        if config.STRICT_OPEN_VERIFY:
            raise OpenMismatchError(
                f"opened title {shown!r} does not match expected {note.title!r}"
            )

    if kebab is None and not shown and not _page_shows_title(page, note.title):
        # Still proceed; download_transcript will report selector_broken/retryable.
        page.wait_for_timeout(500)


def _menu_item_labels(page: Page) -> List[str]:
    """Collect visible menu/list item labels for diagnostics."""
    labels: List[str] = []
    try:
        loc = page.get_by_role("menuitem")
        count = min(loc.count(), 40)
        for i in range(count):
            try:
                item = loc.nth(i)
                if not item.is_visible():
                    continue
                text = _clean(item.inner_text(timeout=500))
            except PWError:
                continue
            if text and text not in labels and len(text) < 120:
                labels.append(text)
    except PWError:
        pass
    return labels


def _click_timeout_ms() -> int:
    return min(5000, int(config.ACTION_TIMEOUT_MS))


def _safe_click(locator: Locator, *, timeout_ms: int = None) -> Optional[str]:
    """Click a locator; return None on success or an error string."""
    timeout_ms = timeout_ms if timeout_ms is not None else _click_timeout_ms()
    try:
        locator.scroll_into_view_if_needed(timeout=timeout_ms)
    except PWError:
        pass
    try:
        locator.click(timeout=timeout_ms, force=False)
        return None
    except PWError:
        pass
    try:
        locator.click(timeout=timeout_ms, force=True)
        return None
    except PWError as exc:
        return str(exc)[:240]


def _menuitem_by_name(page: Page, pattern: re.Pattern[str]) -> Optional[Locator]:
    """Return a stable role=menuitem locator matched by accessible name."""
    try:
        loc = page.get_by_role("menuitem", name=pattern)
        if loc.count() <= 0:
            return None
        first = loc.first
        if first.is_visible():
            return first
    except PWError:
        return None
    return None


def _all_kebabs(page: Page) -> List[Locator]:
    """Return distinct visible kebab/more buttons (main content preferred)."""
    found: List[Locator] = []
    seen: Set[str] = set()
    for sel in SELECTORS["kebab"]:
        try:
            loc = page.locator(sel)
            count = min(loc.count(), 12)
        except PWError:
            continue
        for i in range(count):
            try:
                item = loc.nth(i)
                if not item.is_visible():
                    continue
                box = item.bounding_box()
                key = (
                    f"{int(box['x'])}:{int(box['y'])}"
                    if box
                    else f"{sel}:{i}"
                )
            except PWError:
                continue
            if key in seen:
                continue
            seen.add(key)
            found.append(item)

    def _sort_key(el: Locator) -> tuple:
        try:
            box = el.bounding_box() or {"x": 0, "y": 0}
            return (-float(box.get("x", 0)), float(box.get("y", 0)))
        except PWError:
            return (0.0, 0.0)

    found.sort(key=_sort_key)
    return found


def _write_text_download(dest: Path, text: str) -> DownloadResult:
    import hashlib

    body = (text or "").strip()
    if len(body) < 40:
        return DownloadResult(DownloadOutcome.ABSENT, error="extracted transcript too short")
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_suffix(dest.suffix + ".part")
    data = (body + "\\n").encode("utf-8")
    part.write_bytes(data)
    digest = hashlib.sha256(data).hexdigest()
    part.replace(dest)
    return DownloadResult(
        DownloadOutcome.DOWNLOADED,
        path=dest,
        size=len(data),
        sha256=digest,
    )


_SPEAKER_LINE = re.compile(
    r"^(?P<span>.{1,80}?)\\s*[:\\-\u2013\u2014]\\s+.+$|"
    r"^\\[[0-9:.]+\\]\\s*.+$|"
    r"^[0-9]{1,2}:[0-9]{2}(?::[0-9]{2})?\\s+.+$",
    re.M,
)


def _looks_like_transcript(text: str) -> bool:
    body = (text or "").strip()
    if len(body) < 80:
        return False
    lines = [ln.strip() for ln in body.splitlines() if ln.strip()]
    if len(lines) < 4:
        return False
    speaker_hits = len(_SPEAKER_LINE.findall(body))
    if speaker_hits >= 2:
        return True
    # Long multi-line body from an opened note is still useful.
    return len(lines) >= 8 and len(body) >= 300


def _extract_transcript_from_page(page: Page) -> str:
    """Best-effort scrape of an on-page Transcript / AI notes panel."""
    # Open Transcript tab if present.
    for sel in SELECTORS["transcript_tab"]:
        try:
            loc = page.locator(sel)
            count = min(loc.count(), 6)
        except PWError:
            continue
        for i in range(count):
            try:
                tab = loc.nth(i)
                if not tab.is_visible():
                    continue
                label = _clean(tab.inner_text(timeout=500)).lower()
                if "transcript" not in label and i > 0:
                    continue
                err = _safe_click(tab, timeout_ms=3000)
                if err is None:
                    page.wait_for_timeout(1200)
                    break
            except PWError:
                continue

    container_sels = [
        '[data-testid*="transcript" i]',
        '[class*="transcript" i]',
        '[aria-label*="transcript" i]',
        '[class*="Transcript" i]',
        'section:has-text("Transcript")',
        'article',
        '[role="article"]',
        'main',
        '[role="main"]',
        '[contenteditable="true"]',
    ]
    best = ""
    for sel in container_sels:
        try:
            loc = page.locator(sel)
            count = min(loc.count(), 10)
        except PWError:
            continue
        for i in range(count):
            try:
                item = loc.nth(i)
                if not item.is_visible():
                    continue
                text = item.inner_text(timeout=2500)
            except PWError:
                continue
            text = (text or "").strip()
            lines = [
                ln
                for ln in text.splitlines()
                if _clean(ln).lower() not in OPENED_TITLE_DENYLIST | NAV_DENYLIST
            ]
            candidate = "\\n".join(lines).strip()
            if not _looks_like_transcript(candidate):
                continue
            if len(candidate) > len(best):
                best = candidate
        if len(best) > 800:
            break

    if best:
        return best

    # Whole-page fallback (filtered).
    try:
        raw = page.locator("body").inner_text(timeout=3000)
    except PWError:
        return ""
    lines = [
        ln
        for ln in (raw or "").splitlines()
        if _clean(ln).lower() not in OPENED_TITLE_DENYLIST | NAV_DENYLIST
    ]
    candidate = "\\n".join(lines).strip()
    return candidate if _looks_like_transcript(candidate) else ""


def _try_menu_download(page: Page, dest: Path) -> DownloadResult:
    """Open kebabs / export menus and attempt a real file download."""
    import hashlib

    name_patterns = (
        re.compile(r"download\\s+transcript", re.I),
        re.compile(r"export\\s+transcript", re.I),
        re.compile(r"download\\s+.*\\.txt", re.I),
        re.compile(r"transcript\\s*\\(.*txt.*\\)", re.I),
        re.compile(r"^transcript$", re.I),
    )
    export_patterns = (
        re.compile(r"^export$", re.I),
        re.compile(r"^download$", re.I),
        re.compile(r"export\\s+as", re.I),
        re.compile(r"download\\s+as", re.I),
    )

    kebabs = _all_kebabs(page)
    if not kebabs:
        return DownloadResult(DownloadOutcome.SELECTOR_BROKEN, error="kebab not found")

    menu_labels_seen: List[str] = []
    last_error = "download menu item missing"

    for kebab in kebabs[:5]:
        _dismiss_menu(page)
        err = _safe_click(kebab)
        if err:
            last_error = f"kebab click: {err}"
            continue

        page.wait_for_timeout(700)
        for lab in _menu_item_labels(page):
            if lab not in menu_labels_seen:
                menu_labels_seen.append(lab)

        # Nested Export/Download menus first.
        for exp_pat in export_patterns:
            exp = _menuitem_by_name(page, exp_pat)
            if exp is None:
                continue
            exp_err = _safe_click(exp)
            if exp_err:
                continue
            page.wait_for_timeout(600)
            for lab in _menu_item_labels(page):
                if lab not in menu_labels_seen:
                    menu_labels_seen.append(lab)

        target: Optional[Locator] = None
        for pat in name_patterns:
            target = _menuitem_by_name(page, pat)
            if target is not None:
                break
        if target is None:
            # Fallback CSS selectors (stable .first, not nth index).
            target = _first_usable(page, SELECTORS["download_transcript"])
        if target is None:
            last_error = "download menu item missing"
            _dismiss_menu(page)
            continue

        part = dest.with_suffix(dest.suffix + ".part")
        if part.exists():
            try:
                part.unlink()
            except OSError:
                pass

        try:
            with page.expect_download(timeout=min(20000, config.DOWNLOAD_TIMEOUT_MS)) as dl_info:
                click_err = _safe_click(target, timeout_ms=4000)
                if click_err:
                    raise PWTimeoutError(click_err)
            download = dl_info.value
        except PWTimeoutError as exc:
            last_error = f"download/click timeout: {exc}"
            _dismiss_menu(page)
            continue
        except PWError as exc:
            last_error = f"download error: {exc}"
            _dismiss_menu(page)
            continue

        dest.parent.mkdir(parents=True, exist_ok=True)
        try:
            download.save_as(str(part))
            size = part.stat().st_size
            if size <= 0:
                part.unlink(missing_ok=True)
                last_error = "empty download"
                _dismiss_menu(page)
                continue
            data = part.read_bytes()
            if b"\\x00" in data[:2048]:
                part.unlink(missing_ok=True)
                last_error = "binary download"
                _dismiss_menu(page)
                continue
            digest = hashlib.sha256(data).hexdigest()
            part.replace(dest)
            _dismiss_menu(page)
            return DownloadResult(
                DownloadOutcome.DOWNLOADED, path=dest, size=size, sha256=digest
            )
        except OSError as exc:
            _dismiss_menu(page)
            return DownloadResult(DownloadOutcome.RETRYABLE, error=f"save failed: {exc}")

    detail = last_error
    if menu_labels_seen:
        detail = f"{last_error}; menu items: [{', '.join(menu_labels_seen[:12])}]"
    return DownloadResult(DownloadOutcome.RETRYABLE, error=detail)


def download_transcript(page: Page, dest: Path) -> DownloadResult:
    """Prefer on-page transcript scrape; fall back to menu file download."""
    # AI Companion notes usually render transcript/summary in the open view.
    scraped = _extract_transcript_from_page(page)
    if scraped:
        return _write_text_download(dest, scraped)

    menu_result = _try_menu_download(page, dest)
    if menu_result.outcome == DownloadOutcome.DOWNLOADED:
        return menu_result

    # Scrape again after menus may have revealed panels.
    scraped = _extract_transcript_from_page(page)
    if scraped:
        return _write_text_download(dest, scraped)

    # Keep retryable so backoff is short and next run tries again.
    if menu_result.outcome != DownloadOutcome.DOWNLOADED:
        save_diagnostics(page, f"no-transcript-{dest.stem[:40]}")
        return menu_result
    return DownloadResult(DownloadOutcome.ABSENT, error="no transcript content found")


def _dismiss_menu(page: Page) -> None:
    try:
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)
        # Second escape helps nested overlays.
        page.keyboard.press("Escape")
        page.wait_for_timeout(200)
    except PWError:
        pass


def save_diagnostics(page: Page, label: str) -> Optional[Path]:
    """Best-effort screenshot for selector failures."""
    try:
        config.DIAGNOSTICS_DIR.mkdir(parents=True, exist_ok=True)
        safe = re.sub(r"[^A-Za-z0-9._-]+", "_", label)[:60] or "diag"
        path = config.DIAGNOSTICS_DIR / f"{safe}.png"
        page.screenshot(path=str(path), full_page=False)
        return path
    except Exception:
        return None
`,
  "index_store.py": `"""Persistent index of downloaded transcripts, used for deduplication.

The index is a single JSON file mapping a stable note id to a record. Both
successfully downloaded notes and notes that have no transcript are recorded.
Absent transcripts use a backoff schedule so they are rechecked later.

Schema is additive: existing v1 records (no version field) remain readable.
Corrupt indexes are quarantined and never silently replaced with an empty file.
"""

from __future__ import annotations

import json
import shutil
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence

STATUS_DOWNLOADED = "downloaded"
STATUS_NO_TRANSCRIPT = "no_transcript"
STATUS_MISSING_FILE = "missing_file"
STATUS_RETRYABLE = "retryable"

INDEX_VERSION = 2


class IndexCorruptError(Exception):
    """Raised when the on-disk index cannot be loaded safely."""


def _now() -> datetime:
    return datetime.now(timezone.utc).astimezone()


def _now_iso() -> str:
    return _now().isoformat(timespec="seconds")


def _parse_iso(value: str) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


@dataclass
class IndexStore:
    path: Path
    _data: Dict[str, Any] = field(default_factory=dict)
    backoff_hours: Sequence[int] = field(default_factory=lambda: (6, 24, 72, 168))

    def __post_init__(self) -> None:
        if not self._data:
            self._data = self._empty()

    @staticmethod
    def _empty() -> Dict[str, Any]:
        return {
            "version": INDEX_VERSION,
            "transcripts": {},
            "scan": {},
            "meta": {},
        }

    @classmethod
    def load(cls, path: Path, *, backoff_hours: Sequence[int] = (6, 24, 72, 168)) -> "IndexStore":
        store = cls(path=path, backoff_hours=tuple(backoff_hours))
        if not path.exists():
            return store
        try:
            raw = path.read_text(encoding="utf-8")
            loaded = json.loads(raw)
        except (json.JSONDecodeError, OSError, UnicodeError) as exc:
            quarantine = path.with_name(
                f"{path.name}.corrupt-{_now().strftime('%Y%m%d%H%M%S')}"
            )
            try:
                shutil.copy2(path, quarantine)
            except OSError:
                quarantine = None
            detail = f"quarantined to {quarantine}" if quarantine else "could not quarantine"
            raise IndexCorruptError(f"Unreadable index at {path} ({detail}): {exc}") from exc

        if not isinstance(loaded, dict) or not isinstance(loaded.get("transcripts"), dict):
            quarantine = path.with_name(
                f"{path.name}.corrupt-{_now().strftime('%Y%m%d%H%M%S')}"
            )
            try:
                shutil.copy2(path, quarantine)
            except OSError:
                pass
            raise IndexCorruptError(f"Malformed index structure at {path}")

        # Preserve all existing fields; fill additive defaults.
        store._data = loaded
        store._data.setdefault("version", 1)
        store._data.setdefault("scan", {})
        store._data.setdefault("meta", {})
        if not isinstance(store._data["scan"], dict):
            store._data["scan"] = {}
        if not isinstance(store._data["meta"], dict):
            store._data["meta"] = {}
        return store

    @property
    def transcripts(self) -> Dict[str, Any]:
        return self._data["transcripts"]

    def has(self, note_id: str) -> bool:
        return self.resolve_id(note_id) is not None

    def resolve_id(self, note_id: str) -> Optional[str]:
        """Return the canonical key for note_id or one of its aliases."""
        if note_id in self.transcripts:
            return note_id
        for key, rec in self.transcripts.items():
            aliases = rec.get("aliases") or []
            if isinstance(aliases, list) and note_id in aliases:
                return key
        return None

    def get(self, note_id: str) -> Optional[Dict[str, Any]]:
        key = self.resolve_id(note_id)
        if key is None:
            return None
        return self.transcripts.get(key)

    def requeue_false_absents(self) -> int:
        """Re-open notes wrongly marked absent due to UI/menu selector misses."""
        markers = (
            "download menu item missing",
            "menu items:",
            "kebab not found",
            "download/click timeout",
            "download timeout",
            "locator.click",
            "requeued for selector",
        )
        count = 0
        for key, rec in list(self.transcripts.items()):
            if rec.get("status") != STATUS_NO_TRANSCRIPT:
                continue
            err = str(rec.get("last_error") or "").lower()
            if not any(m in err for m in markers):
                # Also requeue absents with empty error (older runs).
                if err.strip():
                    continue
            rec = dict(rec)
            rec["status"] = STATUS_RETRYABLE
            rec["next_retry"] = ""
            rec["last_outcome"] = "requeued_false_absent"
            rec["last_error"] = "requeued for selector refresh"
            self.transcripts[key] = rec
            count += 1
        if count:
            self.save()
        return count

    def should_process(self, note_id: str, *, now: datetime = None) -> bool:
        """True if this note should be opened/checked on this run."""
        now = now or _now()
        rec = self.get(note_id)
        if rec is None:
            return True
        status = rec.get("status")
        if status == STATUS_DOWNLOADED:
            file_rel = rec.get("file") or ""
            if file_rel:
                # Caller may still reconcile; treat as skip if marked downloaded.
                return False
            return True
        if status == STATUS_MISSING_FILE:
            return True
        if status == STATUS_RETRYABLE:
            return self._is_due(rec, now)
        if status == STATUS_NO_TRANSCRIPT:
            return self._is_due(rec, now)
        return True

    def _is_due(self, rec: Dict[str, Any], now: datetime) -> bool:
        nxt = _parse_iso(str(rec.get("next_retry") or ""))
        if nxt is None:
            return True
        # Compare timezone-aware when possible.
        if nxt.tzinfo is None:
            nxt = nxt.replace(tzinfo=now.tzinfo)
        return now >= nxt

    def _backoff_delta(self, attempts: int) -> timedelta:
        hours = list(self.backoff_hours) or [6, 24, 72, 168]
        idx = max(0, min(attempts - 1, len(hours) - 1))
        if attempts <= 0:
            idx = 0
        return timedelta(hours=int(hours[idx]))

    def add(
        self,
        note_id: str,
        *,
        title: str,
        status: str,
        source_url: str = "",
        host: str = "",
        meeting_date: str = "",
        file: str = "",
        aliases: Optional[Iterable[str]] = None,
        size: Optional[int] = None,
        sha256: str = "",
        last_outcome: str = "",
        last_error: str = "",
    ) -> None:
        existing_key = self.resolve_id(note_id)
        key = existing_key or note_id
        prev = dict(self.transcripts.get(key) or {})

        alias_set = set(prev.get("aliases") or [])
        if aliases:
            alias_set.update(a for a in aliases if a and a != key)
        if existing_key and note_id != existing_key:
            alias_set.add(note_id)
        # If we previously knew this under another hash only, keep it.

        attempts = int(prev.get("attempts") or 0)
        if status in (STATUS_NO_TRANSCRIPT, STATUS_RETRYABLE, STATUS_MISSING_FILE):
            attempts += 1
        elif status == STATUS_DOWNLOADED:
            attempts = int(prev.get("attempts") or 0)

        now = _now()
        next_retry = ""
        if status in (STATUS_NO_TRANSCRIPT, STATUS_RETRYABLE, STATUS_MISSING_FILE):
            next_retry = (now + self._backoff_delta(max(attempts, 1))).isoformat(timespec="seconds")

        if file:
            file_val = file
        elif status == STATUS_DOWNLOADED:
            file_val = prev.get("file") or ""
        else:
            file_val = ""

        rec = {
            "id": key,
            "title": title or prev.get("title") or "",
            "host": host if host != "" else prev.get("host") or "",
            "meeting_date": meeting_date if meeting_date != "" else prev.get("meeting_date") or "",
            "source_url": source_url if source_url != "" else prev.get("source_url") or "",
            "status": status,
            "file": file_val,
            "recorded_at": prev.get("recorded_at") or _now_iso(),
            "updated_at": _now_iso(),
            "attempts": attempts,
            "last_checked": _now_iso(),
            "next_retry": next_retry,
            "last_outcome": last_outcome or status,
            "last_error": last_error,
            "aliases": sorted(alias_set),
        }
        if size is not None:
            rec["size"] = size
        elif "size" in prev:
            rec["size"] = prev["size"]
        if sha256:
            rec["sha256"] = sha256
        elif prev.get("sha256"):
            rec["sha256"] = prev["sha256"]

        if status == STATUS_DOWNLOADED:
            rec["next_retry"] = ""
            if file:
                rec["file"] = file

        self.transcripts[key] = rec
        self.save()

    def add_alias(self, canonical_id: str, alias: str) -> None:
        if not alias or alias == canonical_id:
            return
        key = self.resolve_id(canonical_id) or canonical_id
        rec = self.transcripts.get(key)
        if not rec:
            return
        aliases = set(rec.get("aliases") or [])
        aliases.add(alias)
        rec["aliases"] = sorted(aliases)
        self.save()

    def mark_scan(self, **fields: Any) -> None:
        scan = self._data.setdefault("scan", {})
        if not isinstance(scan, dict):
            scan = {}
            self._data["scan"] = scan
        scan.update(fields)
        scan["updated_at"] = _now_iso()
        self.save()

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._data["version"] = max(int(self._data.get("version") or 1), INDEX_VERSION)
        # Rolling backup of previous good file.
        if self.path.exists():
            bak = self.path.with_suffix(self.path.suffix + ".bak")
            try:
                shutil.copy2(self.path, bak)
            except OSError:
                pass
        tmp = self.path.with_suffix(self.path.suffix + ".tmp")
        tmp.write_text(json.dumps(self._data, indent=2, ensure_ascii=False), encoding="utf-8")
        tmp.replace(self.path)

    def reconcile_files(self, base_dir: Path) -> List[str]:
        """Mark downloaded records whose files are missing/empty. Returns ids."""
        changed: List[str] = []
        for key, rec in list(self.transcripts.items()):
            if rec.get("status") != STATUS_DOWNLOADED:
                continue
            rel = rec.get("file") or ""
            if not rel:
                rec["status"] = STATUS_MISSING_FILE
                rec["next_retry"] = _now_iso()
                rec["last_outcome"] = "missing_file"
                rec["updated_at"] = _now_iso()
                changed.append(key)
                continue
            path = (base_dir / rel).resolve() if not Path(rel).is_absolute() else Path(rel)
            try:
                ok = path.is_file() and path.stat().st_size > 0
            except OSError:
                ok = False
            if not ok:
                rec["status"] = STATUS_MISSING_FILE
                rec["next_retry"] = _now_iso()
                rec["last_outcome"] = "missing_file"
                rec["updated_at"] = _now_iso()
                changed.append(key)
        if changed:
            self.save()
        return changed

    def find_orphan_files(self, transcripts_dir: Path, base_dir: Path) -> List[str]:
        """Return transcript paths on disk not referenced by any index record.

        Walks month subfolders under transcripts_dir. Returns paths relative to
        transcripts_dir when possible (e.g. '2026-07/foo.md'). Never deletes;
        caller logs only.
        """
        if not transcripts_dir.is_dir():
            return []
        referenced: set[str] = set()
        for rec in self.transcripts.values():
            rel = rec.get("file") or ""
            if not rel:
                continue
            try:
                path = (base_dir / rel).resolve() if not Path(rel).is_absolute() else Path(rel).resolve()
                referenced.add(path.name.lower())
            except OSError:
                referenced.add(Path(rel).name.lower())
        orphans: List[str] = []
        root = transcripts_dir.resolve()
        try:
            for pattern in ("*.md", "*.txt"):
                for path in transcripts_dir.rglob(pattern):
                    if not path.is_file():
                        continue
                    if path.name.endswith(".part"):
                        continue
                    if path.name.lower() in referenced:
                        continue
                    try:
                        orphans.append(str(path.resolve().relative_to(root)).replace("\\\\", "/"))
                    except ValueError:
                        orphans.append(path.name)
        except OSError:
            return []
        return sorted(set(orphans))

    def get_scan(self) -> Dict[str, Any]:
        scan = self._data.get("scan") or {}
        return scan if isinstance(scan, dict) else {}

    def watermark_ids(self) -> List[str]:
        scan = self.get_scan()
        ids = scan.get("watermark_ids") or []
        return [str(x) for x in ids] if isinstance(ids, list) else []

    @property
    def count(self) -> int:
        return len(self.transcripts)

    def status_counts(self) -> Dict[str, int]:
        counts: Dict[str, int] = {}
        for rec in self.transcripts.values():
            st = str(rec.get("status") or "unknown")
            counts[st] = counts.get(st, 0) + 1
        return counts
`,
  "lockfile.py": '"""Atomic process lock with ownership token and heartbeat.\n\nUses O_CREAT|O_EXCL so two processes cannot both create the lock. The lock\npayload stores a random token, PID, and heartbeat timestamp. Release only\nsucceeds when the token still matches. Stale locks are reclaimed only when the\nheartbeat is old AND the owning PID is not alive (or not the original process).\n"""\n\nfrom __future__ import annotations\n\nimport json\nimport os\nimport time\nimport uuid\nfrom dataclasses import dataclass\nfrom datetime import datetime, timezone\nfrom pathlib import Path\nfrom typing import Any, Dict, Optional  # noqa: F401 \u2014 Dict used in helpers\n\n\ndef _now_iso() -> str:\n    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")\n\n\ndef _pid_alive(pid: int) -> bool:\n    if pid <= 0:\n        return False\n    if os.name == "nt":\n        try:\n            import ctypes\n\n            PROCESS_QUERY_LIMITED_INFORMATION = 0x1000\n            STILL_ACTIVE = 259\n            handle = ctypes.windll.kernel32.OpenProcess(\n                PROCESS_QUERY_LIMITED_INFORMATION, False, pid\n            )\n            if not handle:\n                return False\n            try:\n                exit_code = ctypes.c_ulong()\n                if ctypes.windll.kernel32.GetExitCodeProcess(handle, ctypes.byref(exit_code)) == 0:\n                    return False\n                return exit_code.value == STILL_ACTIVE\n            finally:\n                ctypes.windll.kernel32.CloseHandle(handle)\n        except Exception:\n            return False\n    # POSIX\n    try:\n        os.kill(pid, 0)\n    except ProcessLookupError:\n        return False\n    except PermissionError:\n        return True\n    except OSError:\n        return False\n    return True\n\n\n@dataclass\nclass LockHandle:\n    path: Path\n    token: str\n    pid: int\n\n    def heartbeat(self) -> None:\n        data = _read(self.path)\n        if not data or data.get("token") != self.token:\n            return\n        data["heartbeat_at"] = _now_iso()\n        data["heartbeat_epoch"] = time.time()\n        _write_replace(self.path, data)\n\n    def release(self) -> bool:\n        data = _read(self.path)\n        if not data:\n            return False\n        if data.get("token") != self.token:\n            return False\n        try:\n            self.path.unlink(missing_ok=True)\n            return True\n        except OSError:\n            return False\n\n\ndef _read(path: Path) -> Optional[Dict[str, Any]]:\n    try:\n        if not path.exists():\n            return None\n        raw = path.read_text(encoding="utf-8")\n        data = json.loads(raw)\n        return data if isinstance(data, dict) else None\n    except (OSError, json.JSONDecodeError, UnicodeError):\n        return None\n\n\ndef _write_replace(path: Path, data: Dict[str, Any]) -> None:\n    tmp = path.with_suffix(path.suffix + ".tmp")\n    tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")\n    tmp.replace(path)\n\n\ndef acquire(path: Path, stale_minutes: float = 25.0) -> Optional[LockHandle]:\n    """Try to acquire the lock. Returns a handle or None if held by a healthy peer."""\n    path.parent.mkdir(parents=True, exist_ok=True)\n    token = uuid.uuid4().hex\n    pid = os.getpid()\n    payload = {\n        "token": token,\n        "pid": pid,\n        "started_at": _now_iso(),\n        "heartbeat_at": _now_iso(),\n        "heartbeat_epoch": time.time(),\n    }\n\n    # Fast path: exclusive create.\n    try:\n        fd = os.open(str(path), os.O_CREAT | os.O_EXCL | os.O_WRONLY)\n        try:\n            os.write(fd, json.dumps(payload, indent=2).encode("utf-8"))\n        finally:\n            os.close(fd)\n        return LockHandle(path=path, token=token, pid=pid)\n    except FileExistsError:\n        pass\n    except OSError:\n        return None\n\n    existing = _read(path)\n    if existing is None:\n        # Unreadable or empty; try reclaim by unlink + recreate.\n        try:\n            path.unlink(missing_ok=True)\n        except OSError:\n            return None\n        return acquire(path, stale_minutes=stale_minutes)\n\n    # Legacy plain-PID lock (old format was just a pid string).\n    if "token" not in existing:\n        try:\n            age_min = (time.time() - path.stat().st_mtime) / 60.0\n        except OSError:\n            age_min = stale_minutes + 1\n        legacy_pid = None\n        try:\n            legacy_pid = int(path.read_text(encoding="utf-8").strip())\n        except Exception:\n            legacy_pid = existing.get("pid")\n        if age_min < stale_minutes and legacy_pid and _pid_alive(int(legacy_pid)):\n            return None\n        try:\n            path.unlink(missing_ok=True)\n        except OSError:\n            return None\n        return acquire(path, stale_minutes=stale_minutes)\n\n    owner_pid = int(existing.get("pid") or 0)\n    heartbeat_epoch = existing.get("heartbeat_epoch")\n    if isinstance(heartbeat_epoch, (int, float)):\n        stale = (time.time() - float(heartbeat_epoch)) > (stale_minutes * 60.0)\n    else:\n        try:\n            stale = (time.time() - path.stat().st_mtime) > (stale_minutes * 60.0)\n        except OSError:\n            stale = True\n\n    if not stale and _pid_alive(owner_pid):\n        return None\n\n    # Stale or dead owner: reclaim.\n    try:\n        path.unlink(missing_ok=True)\n    except OSError:\n        return None\n    return acquire(path, stale_minutes=stale_minutes)\n',
  "procs.py": `"""Process helpers for Playwright browser lifecycle on Windows.

Headless Edge can hang on graceful close. Cleanup is scoped to a unique run
token embedded in the browser launch user-data-dir / env so unrelated Edge or
Playwright sessions are never killed.
"""

from __future__ import annotations

import os
import subprocess
import threading
from typing import Sequence

_CREATE_NO_WINDOW = 0x08000000


def kill_process_tree(pid: int, timeout: float = 30.0) -> None:
    """Force-kill a process and its descendants (Windows taskkill /F /T)."""
    if not pid or pid <= 0:
        return
    try:
        if os.name == "nt":
            subprocess.run(
                ["taskkill", "/PID", str(pid), "/T", "/F"],
                capture_output=True,
                timeout=timeout,
                creationflags=_CREATE_NO_WINDOW,
            )
        else:
            # Best-effort POSIX: kill process group if possible.
            try:
                os.killpg(pid, 9)
            except Exception:
                subprocess.run(["kill", "-9", str(pid)], capture_output=True, timeout=timeout)
    except Exception:
        pass


def kill_by_command_token(
    token: str,
    process_names: Sequence[str],
    timeout: float = 40.0,
) -> None:
    """Force-kill processes whose command line contains \`token\`.

    \`token\` must be unique to this run (e.g. a UUID path segment). Never pass a
    generic Playwright signature alone.
    """
    if not token or len(token) < 8:
        return
    names = [n for n in process_names if n]
    if not names:
        return

    if os.name == "nt":
        name_clauses = " -or ".join(f"$_.Name -eq '{n}'" for n in names)
        safe_token = token.replace("'", "''")
        ps = (
            f"Get-CimInstance Win32_Process | Where-Object {{ "
            f"({name_clauses}) -and ($_.CommandLine -like '*{safe_token}*') "
            f"}} | ForEach-Object {{ Stop-Process -Id $_.ProcessId -Force "
            f"-ErrorAction SilentlyContinue }}"
        )
        try:
            subprocess.run(
                ["powershell", "-NoProfile", "-Command", ps],
                capture_output=True,
                timeout=timeout,
                creationflags=_CREATE_NO_WINDOW,
            )
        except Exception:
            pass
        return

    # macOS / Linux: pkill by token in the full command line (scoped).
    try:
        subprocess.run(
            ["pkill", "-f", token],
            capture_output=True,
            timeout=timeout,
        )
    except Exception:
        pass


def stop_playwright(playwright, timeout: float = 10.0) -> None:
    """Call playwright.stop() on the same logical wait, bounded by timeout.

    Prefer calling this after browsers are already closed/killed. Uses a daemon
    thread only as a last-resort timeout gate; the stop call itself may still
    run in the background if it hangs.
    """
    if playwright is None:
        return
    done = threading.Event()

    def _stop():
        try:
            playwright.stop()
        except Exception:
            pass
        finally:
            done.set()

    threading.Thread(target=_stop, daemon=True).start()
    done.wait(timeout)


def close_context(context, timeout: float = 5.0) -> None:
    if context is None:
        return
    done = threading.Event()

    def _close():
        try:
            context.close()
        except Exception:
            pass
        finally:
            done.set()

    threading.Thread(target=_close, daemon=True).start()
    done.wait(timeout)


def close_browser(browser, timeout: float = 5.0) -> None:
    if browser is None:
        return
    done = threading.Event()

    def _close():
        try:
            browser.close()
        except Exception:
            pass
        finally:
            done.set()

    threading.Thread(target=_close, daemon=True).start()
    done.wait(timeout)


class BrowserSession:
    """Owns one Playwright driver + browser + context for a single run phase."""

    def __init__(
        self,
        *,
        headless: bool,
        run_token: str,
        process_names: Sequence[str],
        launch_kwargs: dict,
        new_context_fn,
        use_saved_state: bool = True,
    ):
        self.headless = headless
        self.run_token = run_token
        self.process_names = list(process_names)
        self._launch_kwargs = dict(launch_kwargs)
        self._new_context_fn = new_context_fn
        self.use_saved_state = use_saved_state
        self.playwright = None
        self.browser = None
        self.context = None
        self.page = None

    def start(self):
        from playwright.sync_api import sync_playwright

        # Unique marker so cleanup only targets this session's processes.
        # Playwright puts the user data dir on the command line for the channel.
        os.environ["ZOOM_SYNC_RUN_TOKEN"] = self.run_token
        self.playwright = sync_playwright().start()
        kwargs = dict(self._launch_kwargs)
        # args marker appears on the process command line for scoped kill.
        args = list(kwargs.get("args") or [])
        args.append(f"--zoom-sync-run-token={self.run_token}")
        kwargs["args"] = args
        try:
            self.browser = self.playwright.chromium.launch(**kwargs)
        except Exception:
            # macOS without Chrome installed: fall back to bundled Chromium.
            if kwargs.get("channel"):
                fallback = dict(kwargs)
                fallback.pop("channel", None)
                self.browser = self.playwright.chromium.launch(**fallback)
            else:
                raise
        self.context = self._new_context_fn(self.browser, use_saved_state=self.use_saved_state)
        self.page = self.context.pages[0] if self.context.pages else self.context.new_page()
        return self

    def stop(self) -> None:
        close_context(self.context, timeout=4.0)
        close_browser(self.browser, timeout=4.0)
        # Scoped force-kill for hung Edge/Chrome children from this run only.
        kill_by_command_token(self.run_token, self.process_names, timeout=30.0)
        stop_playwright(self.playwright, timeout=8.0)
        self.page = None
        self.context = None
        self.browser = None
        self.playwright = None
`,
  "security.py": `"""Optional Windows ACL hardening for sensitive runtime paths."""

from __future__ import annotations

import logging
import os
import subprocess
from pathlib import Path
from typing import Iterable

log = logging.getLogger("zoom_sync")

_CREATE_NO_WINDOW = 0x08000000


def apply_user_only_acls(paths: Iterable[Path]) -> None:
    """Best-effort: restrict paths to current user, SYSTEM, and Administrators.

    Failures are logged and ignored so sync still works in restricted environments.
    """
    if os.name != "nt":
        return
    user = os.environ.get("USERNAME") or os.environ.get("USER") or ""
    if not user:
        return
    for path in paths:
        try:
            if not path.exists():
                continue
            # Remove inheritance, then grant explicit rights.
            commands = [
                ["icacls", str(path), "/inheritance:r"],
                [
                    "icacls",
                    str(path),
                    "/grant:r",
                    f"{user}:(OI)(CI)F",
                    "SYSTEM:(OI)(CI)F",
                    "Administrators:(OI)(CI)F",
                ],
            ]
            # Files don't need (OI)(CI)
            if path.is_file():
                commands = [
                    ["icacls", str(path), "/inheritance:r"],
                    [
                        "icacls",
                        str(path),
                        "/grant:r",
                        f"{user}:F",
                        "SYSTEM:F",
                        "Administrators:F",
                    ],
                ]
            for cmd in commands:
                result = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    timeout=30,
                    creationflags=_CREATE_NO_WINDOW,
                )
                if result.returncode != 0:
                    log.warning(
                        "ACL command failed for %s: %s",
                        path,
                        (result.stderr or result.stdout or "").strip()[:200],
                    )
                    break
        except Exception as exc:  # noqa: BLE001
            log.warning("Could not apply ACLs to %s: %s", path, exc)
`,
  "requirements.txt": "playwright==1.55.0\r\n",
  "scripts/register-task.ps1": '# Register the Zoom Notes sync scheduled task (every 30 minutes, logged-on only).\n# Run from an elevated or same-user PowerShell session:\n#   powershell -NoProfile -File .\\scripts\\register-task.ps1\n\n$ErrorActionPreference = "Stop"\n\n$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)\n$RunPs1 = Join-Path $Root "run.ps1"\nif (-not (Test-Path -LiteralPath $RunPs1)) {\n    throw "run.ps1 not found at $RunPs1"\n}\n\n$TaskName = if ($env:ZOOM_TASK_NAME) { $env:ZOOM_TASK_NAME } else { "ZoomNotesSync" }\n$PsExe = Join-Path $env:SystemRoot "System32\\WindowsPowerShell\\v1.0\\powershell.exe"\n$Arg = "-NoProfile -ExecutionPolicy Bypass -File `"$RunPs1`""\n\n$Action = New-ScheduledTaskAction -Execute $PsExe -Argument $Arg -WorkingDirectory $Root\n$Trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).Date.AddMinutes(1) `\n    -RepetitionInterval (New-TimeSpan -Minutes 30) `\n    -RepetitionDuration (New-TimeSpan -Days 3650)\n$Settings = New-ScheduledTaskSettingsSet `\n    -MultipleInstances IgnoreNew `\n    -ExecutionTimeLimit (New-TimeSpan -Minutes 30) `\n    -StartWhenAvailable `\n    -AllowStartIfOnBatteries `\n    -DontStopIfGoingOnBatteries\n# Interactive / logged-on user required for SSO re-auth UI.\n$Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited\n\nRegister-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger `\n    -Settings $Settings -Principal $Principal -Force | Out-Null\n\nWrite-Host "Registered task \'$TaskName\'."\nWrite-Host "  Action: $PsExe $Arg"\nWrite-Host "  Manage: Get-ScheduledTask -TaskName $TaskName"\nWrite-Host "  Run now: Start-ScheduledTask -TaskName $TaskName"\nWrite-Host "  Remove: Unregister-ScheduledTask -TaskName $TaskName -Confirm:`$false"\n',
  "scripts/check.ps1": '# Local quality gate: unit tests (+ ruff if installed).\n$ErrorActionPreference = "Stop"\n$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)\nSet-Location -LiteralPath $Root\n\n$Py = Join-Path $Root ".venv\\Scripts\\python.exe"\nif (-not (Test-Path -LiteralPath $Py)) { $Py = "python" }\n\nWrite-Host "== pytest =="\n& $Py -m pytest\nif ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }\n\n$Ruff = Join-Path $Root ".venv\\Scripts\\ruff.exe"\nif (Test-Path -LiteralPath $Ruff) {\n    Write-Host "== ruff check =="\n    & $Ruff check .\n    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }\n} else {\n    Write-Host "ruff not installed (optional): pip install ruff"\n}\n\nWrite-Host "OK"\nexit 0\n'
};

// src/runner.ts
var import_child_process = require("child_process");
var fs2 = __toESM(require("fs"));
var path3 = __toESM(require("path"));
var active = null;
function isRunning() {
  return active !== null;
}
function cancelActive() {
  if (!active) return false;
  const child = active;
  const pid = child.pid;
  try {
    if (hostPlatform() === "win32" && pid) {
      (0, import_child_process.spawn)("taskkill", ["/pid", String(pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore"
      });
    } else if (pid) {
      child.kill("SIGTERM");
      window.setTimeout(() => {
        try {
          if (!child.killed) child.kill("SIGKILL");
        } catch {
        }
      }, 3e3);
    }
  } catch {
  }
  active = null;
  return true;
}
function baseChildEnv() {
  const keys = [
    "PATH",
    "Path",
    "PATHEXT",
    "SystemRoot",
    "SYSTEMROOT",
    "windir",
    "TEMP",
    "TMP",
    "TMPDIR",
    // Real user home is required on macOS for Chrome/Chromium (fonts, keychain).
    "HOME",
    "USERPROFILE",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "DISPLAY",
    "WAYLAND_DISPLAY",
    "XAUTHORITY",
    "SSL_CERT_FILE",
    "REQUESTS_CA_BUNDLE",
    "PLAYWRIGHT_BROWSERS_PATH",
    "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD",
    "ZOOM_BROWSER_CHANNEL",
    "ComSpec",
    "COMSPEC",
    "ProgramFiles",
    "ProgramFiles(x86)",
    "ProgramW6432",
    "DYLD_LIBRARY_PATH",
    "LD_LIBRARY_PATH"
  ];
  const env = {};
  for (const k of keys) {
    const v = process.env[k];
    if (v !== void 0) env[k] = v;
  }
  return env;
}
function buildEnv(settings, vaultPath, extra) {
  const transcripts = resolveTranscriptsDir(settings, vaultPath);
  const root = resolveSyncRoot(settings);
  const channel = defaultBrowserChannel();
  const env = {
    ...baseChildEnv(),
    ZOOM_TRANSCRIPTS_DIR: transcripts,
    ZOOM_HEADLESS: settings.headless ? "1" : "0",
    ZOOM_LOG_TITLES: settings.logTitles ? "1" : "0",
    PYTHONUNBUFFERED: "1"
  };
  if (channel) env.ZOOM_BROWSER_CHANNEL = channel;
  if (root) {
    env.PLAYWRIGHT_BROWSERS_PATH = path3.join(root, ".playwright");
    if (hostPlatform() === "win32") {
      const sandbox = path3.join(root, ".runtime-home");
      env.USERPROFILE = sandbox;
      env.HOME = sandbox;
      env.APPDATA = path3.join(sandbox, "AppData", "Roaming");
      env.LOCALAPPDATA = path3.join(sandbox, "AppData", "Local");
    }
  }
  return { ...env, ...extra };
}
function toError(err) {
  return err instanceof Error ? err : new Error(String(err));
}
async function runProcess(opts) {
  if (active) {
    throw new Error("Another Zoom sync process is already running");
  }
  const root = resolveSyncRoot(opts.settings);
  const cwd = opts.cwd || root || process.cwd();
  const command = opts.command || resolvePython(opts.settings);
  const args = opts.args ?? [];
  const env = buildEnv(opts.settings, opts.vaultPath, opts.env);
  const started = Date.now();
  const cmdLabel = `${command} ${args.join(" ")}`.trim();
  return new Promise((resolve2, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timer = null;
    let child;
    try {
      child = (0, import_child_process.spawn)(command, args, {
        cwd,
        env,
        windowsHide: true,
        shell: false
      });
    } catch (e) {
      reject(toError(e));
      return;
    }
    active = child;
    const finish = (code, signal) => {
      if (settled) return;
      settled = true;
      if (timer !== null) window.clearTimeout(timer);
      if (active === child) active = null;
      resolve2({
        kind: opts.kind,
        code,
        signal,
        stdout,
        stderr,
        durationMs: Date.now() - started,
        command: cmdLabel
      });
    };
    if (opts.timeoutMs && opts.timeoutMs > 0) {
      timer = window.setTimeout(() => {
        cancelActive();
        finish(null, "SIGTERM");
      }, opts.timeoutMs);
    }
    const feed = (chunk, stream) => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      if (stream === "stdout") stdout += text;
      else stderr += text;
      if (opts.onLine) {
        for (const line of text.split(/\r?\n/)) {
          if (line) opts.onLine(line, stream);
        }
      }
      if (stdout.length > 2e5) stdout = stdout.slice(-15e4);
      if (stderr.length > 2e5) stderr = stderr.slice(-15e4);
    };
    const onStdout = (chunk) => feed(chunk, "stdout");
    const onStderr = (chunk) => feed(chunk, "stderr");
    child.stdout.on("data", onStdout);
    child.stderr.on("data", onStderr);
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      if (timer !== null) window.clearTimeout(timer);
      if (active === child) active = null;
      reject(toError(err));
    });
    child.on("close", (code, signal) => finish(code, signal));
  });
}
async function runSync(settings, vaultPath, onLine) {
  const root = resolveSyncRoot(settings);
  if (!looksLikeSyncRoot(root)) {
    throw new Error(`Invalid sync root (need sync.py): ${root || "(empty)"}`);
  }
  const py = resolvePython(settings);
  return runProcess({
    kind: "sync",
    settings,
    vaultPath,
    command: py,
    args: [path3.join(root, "sync.py")],
    cwd: root,
    timeoutMs: 25 * 60 * 1e3,
    onLine
  });
}
async function runLogin(settings, vaultPath, onLine) {
  const root = resolveSyncRoot(settings);
  if (!looksLikeSyncRoot(root)) {
    throw new Error(`Invalid sync root (need login.py): ${root || "(empty)"}`);
  }
  const py = resolvePython(settings);
  return runProcess({
    kind: "login",
    settings,
    vaultPath,
    command: py,
    args: [path3.join(root, "login.py")],
    cwd: root,
    env: { ZOOM_HEADLESS: "0" },
    timeoutMs: 15 * 60 * 1e3,
    onLine
  });
}
async function runSetupVenv(settings, vaultPath, systemPython, onLine) {
  const root = resolveSyncRoot(settings);
  if (!looksLikeSyncRoot(root)) {
    throw new Error(`Invalid sync root: ${root || "(empty)"}`);
  }
  const venvDir = path3.join(root, ".venv");
  return runProcess({
    kind: "setup-venv",
    settings,
    vaultPath,
    command: systemPython,
    args: ["-m", "venv", venvDir],
    cwd: root,
    timeoutMs: 5 * 60 * 1e3,
    onLine
  });
}
async function runPipInstall(settings, vaultPath, onLine) {
  const root = resolveSyncRoot(settings);
  const py = resolvePython(settings);
  const req = path3.join(root, "requirements.txt");
  if (!fs2.existsSync(req)) throw new Error(`Missing ${req}`);
  return runProcess({
    kind: "pip-install",
    settings,
    vaultPath,
    command: py,
    args: ["-m", "pip", "install", "-r", req],
    cwd: root,
    timeoutMs: 15 * 60 * 1e3,
    onLine
  });
}
function exitLabel(code) {
  if (code === null) return "killed";
  if (code === 0) return "ok";
  if (code === 1) return "hard fail";
  if (code === 2) return "degraded";
  if (code === 3) return "locked";
  return `exit ${code}`;
}

// src/provision.ts
function defaultBackendRoot(vaultPath, configDir) {
  return path4.join(vaultPath, configDir, "zoom-mynotes-backend");
}
function writeBundledBackend(destRoot) {
  const written = [];
  fs3.mkdirSync(destRoot, { recursive: true });
  for (const [rel, content] of Object.entries(BACKEND_FILES)) {
    const full = path4.join(destRoot, ...rel.split("/"));
    fs3.mkdirSync(path4.dirname(full), { recursive: true });
    fs3.writeFileSync(full, content, "utf8");
    written.push(rel);
  }
  return written;
}
function ensureBundledBackend(vaultPath, configDir, settings) {
  const preferred = settings.syncRoot && looksLikeSyncRoot(settings.syncRoot) ? settings.syncRoot : defaultBackendRoot(vaultPath, configDir);
  const wrote = writeBundledBackend(preferred);
  settings.syncRoot = preferred;
  return {
    root: preferred,
    wrote,
    reused: looksLikeSyncRoot(preferred)
  };
}
function emptySettings() {
  return {
    syncRoot: "",
    pythonPath: "",
    outputFolder: "mynotes",
    autoSyncMinutes: 0,
    headless: true,
    logTitles: false,
    taskName: "ZoomNotesSync",
    lastSyncAt: "",
    lastExitCode: null,
    lastStatus: ""
  };
}
async function tryPythonCmd(cmd, onLog) {
  try {
    const result = await runProcess({
      kind: "custom",
      settings: emptySettings(),
      vaultPath: process.cwd(),
      command: cmd,
      args: ["-c", "import sys; print(sys.executable)"],
      cwd: process.cwd(),
      timeoutMs: 15e3,
      onLine: onLog ? (l) => onLog(l) : void 0
    });
    const line = (result.stdout || "").trim().split(/\r?\n/).filter(Boolean).pop();
    if (result.code === 0 && line) return line;
  } catch {
  }
  return null;
}
async function findSystemPython(onLog) {
  const candidates = hostPlatform() === "win32" ? ["py", "python", "python3"] : [
    "python3",
    "python",
    "/opt/homebrew/bin/python3",
    "/usr/local/bin/python3",
    "/usr/bin/python3"
  ];
  for (const cmd of candidates) {
    const found = await tryPythonCmd(cmd, onLog);
    if (found) return found;
  }
  return null;
}
function portablePythonBinary(pythonRoot) {
  const candidates = hostPlatform() === "win32" ? [
    path4.join(pythonRoot, "python.exe"),
    path4.join(pythonRoot, "python", "python.exe")
  ] : [
    path4.join(pythonRoot, "bin", "python3"),
    path4.join(pythonRoot, "python", "bin", "python3"),
    path4.join(pythonRoot, "bin", "python")
  ];
  for (const c of candidates) {
    if (isFile(c) || pathExists(c)) return c;
  }
  return null;
}
function portablePythonAsset() {
  const tag = "20260718";
  const ver = "3.12.13";
  const plat = hostPlatform();
  const arch = process.arch;
  let triple = null;
  if (plat === "darwin" && arch === "arm64") {
    triple = "aarch64-apple-darwin";
  } else if (plat === "darwin" && arch === "x64") {
    triple = "x86_64-apple-darwin";
  } else if (plat === "linux" && arch === "arm64") {
    triple = "aarch64-unknown-linux-gnu";
  } else if (plat === "linux" && arch === "x64") {
    triple = "x86_64-unknown-linux-gnu";
  } else if (plat === "win32" && arch === "arm64") {
    triple = "aarch64-pc-windows-msvc";
  } else if (plat === "win32" && (arch === "x64" || arch === "ia32")) {
    triple = "x86_64-pc-windows-msvc";
  }
  if (!triple) return null;
  const name = `cpython-${ver}+${tag}-${triple}-install_only.tar.gz`;
  const url = `https://github.com/astral-sh/python-build-standalone/releases/download/${tag}/${name}`;
  return { tag, name, url };
}
function downloadToFile(url, dest) {
  return new Promise((resolve2, reject) => {
    const maxRedirects = 5;
    const go = (current, left) => {
      const lib = current.startsWith("http://") ? http : https;
      const req = lib.get(current, (res) => {
        const code = res.statusCode || 0;
        if (code >= 300 && code < 400 && res.headers.location && left > 0) {
          res.resume();
          go(res.headers.location, left - 1);
          return;
        }
        if (code !== 200) {
          res.resume();
          reject(new Error(`Download failed HTTP ${code} for ${current}`));
          return;
        }
        fs3.mkdirSync(path4.dirname(dest), { recursive: true });
        const out = fs3.createWriteStream(dest);
        res.pipe(out);
        out.on("finish", () => out.close(() => resolve2()));
        out.on("error", reject);
      });
      req.on("error", reject);
    };
    go(url, maxRedirects);
  });
}
async function extractTarGz(archive, destDir, settings, vaultPath, onLog) {
  fs3.mkdirSync(destDir, { recursive: true });
  const tar = hostPlatform() === "win32" ? "tar.exe" : "tar";
  const result = await runProcess({
    kind: "custom",
    settings,
    vaultPath,
    command: tar,
    args: ["-xzf", archive, "-C", destDir],
    cwd: destDir,
    timeoutMs: 5 * 60 * 1e3,
    onLine: onLog ? (l) => onLog(l) : void 0
  });
  if (result.code !== 0) {
    throw new Error(
      `Failed to extract Python archive (exit ${result.code}): ${result.stderr || result.stdout}`
    );
  }
}
async function ensurePython(backendRoot, settings, vaultPath, onLog) {
  for (const c of venvPythonCandidates(backendRoot)) {
    if (isFile(c) || pathExists(c)) {
      return { python: c, source: "venv" };
    }
  }
  if (settings.pythonPath && pathExists(settings.pythonPath)) {
    return { python: settings.pythonPath, source: "system" };
  }
  const system = await findSystemPython(onLog);
  if (system) return { python: system, source: "system" };
  const portableRoot = path4.join(backendRoot, ".python");
  const existing = portablePythonBinary(portableRoot);
  if (existing) return { python: existing, source: "portable" };
  const asset = portablePythonAsset();
  if (!asset) {
    throw new Error(
      `No system Python found and no portable build for ${process.platform}/${process.arch}. Install Python 3.11+ and retry.`
    );
  }
  onLog?.(`Downloading portable Python: ${asset.name}`);
  const archive = path4.join(backendRoot, ".cache", asset.name);
  await downloadToFile(asset.url, archive);
  onLog?.("Extracting portable Python\u2026");
  fs3.rmSync(portableRoot, { recursive: true, force: true });
  fs3.mkdirSync(portableRoot, { recursive: true });
  await extractTarGz(archive, portableRoot, settings, vaultPath, onLog);
  const bin = portablePythonBinary(portableRoot);
  if (!bin) {
    throw new Error(
      `Portable Python extracted but interpreter not found under ${portableRoot}`
    );
  }
  return { python: bin, source: "portable" };
}

// src/schedule.ts
var fs4 = __toESM(require("fs"));
var path5 = __toESM(require("path"));
var CRON_BEGIN = "# BEGIN zoom-mynotes-sync";
var CRON_END = "# END zoom-mynotes-sync";
function writeLocalEnvFiles(settings, vaultPath) {
  const root = resolveSyncRoot(settings);
  const out = resolveTranscriptsDir(settings, vaultPath);
  const py = resolvePython(settings);
  const channel = defaultBrowserChannel();
  const syncPy = path5.join(root, "sync.py");
  const envSh = path5.join(root, "local-env.sh");
  const envPs1 = path5.join(root, "local-env.ps1");
  const runSh = path5.join(root, "run-sync.sh");
  const runPs1 = path5.join(root, "run-sync.ps1");
  const shBody = `# Generated by Zoom MyNotes Sync Obsidian plugin \u2014 do not commit secrets.
export ZOOM_TRANSCRIPTS_DIR=${shellQuotePosix(out)}
export ZOOM_HEADLESS=\${ZOOM_HEADLESS:-1}
export ZOOM_LOG_TITLES=\${ZOOM_LOG_TITLES:-0}
export ZOOM_BROWSER_CHANNEL=\${ZOOM_BROWSER_CHANNEL:-${channel}}
export PYTHONUNBUFFERED=1
`;
  const psBody = `# Generated by Zoom MyNotes Sync Obsidian plugin \u2014 do not commit secrets.
$env:ZOOM_TRANSCRIPTS_DIR = ${shellQuotePowerShell(out)}
if (-not $env:ZOOM_HEADLESS) { $env:ZOOM_HEADLESS = '1' }
if (-not $env:ZOOM_LOG_TITLES) { $env:ZOOM_LOG_TITLES = '0' }
if (-not $env:ZOOM_BROWSER_CHANNEL) { $env:ZOOM_BROWSER_CHANNEL = '${channel}' }
$env:PYTHONUNBUFFERED = '1'
`;
  const runShBody = `#!/usr/bin/env bash
set -euo pipefail
ROOT=${shellQuotePosix(root)}
cd "$ROOT"
# shellcheck disable=SC1091
source "$ROOT/local-env.sh"
exec ${shellQuotePosix(py)} ${shellQuotePosix(syncPy)}
`;
  const runPsBody = `$ErrorActionPreference = 'Stop'
$Root = ${shellQuotePowerShell(root)}
Set-Location -LiteralPath $Root
. (Join-Path $Root 'local-env.ps1')
& ${shellQuotePowerShell(py)} ${shellQuotePowerShell(syncPy)}
exit $LASTEXITCODE
`;
  fs4.writeFileSync(envSh, shBody, "utf8");
  fs4.writeFileSync(envPs1, psBody, "utf8");
  fs4.writeFileSync(runSh, runShBody, { encoding: "utf8", mode: 493 });
  fs4.writeFileSync(runPs1, runPsBody, "utf8");
  try {
    fs4.chmodSync(runSh, 493);
    fs4.chmodSync(envSh, 420);
  } catch {
  }
  return { envSh, envPs1, runSh, runPs1 };
}
async function registerWindows(ctx, runPs1) {
  const root = resolveSyncRoot(ctx.settings);
  const script = path5.join(root, "scripts", "register-task.ps1");
  const ps = "powershell.exe";
  if (isFile(script)) {
    return runProcess({
      kind: "register-task",
      settings: ctx.settings,
      vaultPath: ctx.vaultPath,
      command: ps,
      args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script],
      cwd: root,
      env: {
        ZOOM_TASK_NAME: ctx.settings.taskName || "ZoomNotesSync"
      },
      timeoutMs: 2 * 60 * 1e3,
      onLine: ctx.onLine
    });
  }
  const name = sanitizeJobName(ctx.settings.taskName);
  const tr = `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${runPs1}"`;
  return runProcess({
    kind: "register-task",
    settings: ctx.settings,
    vaultPath: ctx.vaultPath,
    command: "schtasks",
    args: [
      "/Create",
      "/F",
      "/TN",
      name,
      "/SC",
      "MINUTE",
      "/MO",
      "30",
      "/TR",
      tr,
      "/RL",
      "LIMITED"
    ],
    cwd: root,
    timeoutMs: 2 * 60 * 1e3,
    onLine: ctx.onLine
  });
}
async function registerDarwin(ctx, runSh) {
  const name = sanitizeJobName(ctx.settings.taskName);
  const label = `com.zoom-mynotes-sync.${name}`;
  const root = resolveSyncRoot(ctx.settings);
  const agentsDir = path5.join(root, "launchd");
  fs4.mkdirSync(agentsDir, { recursive: true });
  const plistPath = path5.join(agentsDir, `${label}.plist`);
  const logOut = path5.join(root, "logs", "launchd-stdout.log");
  const logErr = path5.join(root, "logs", "launchd-stderr.log");
  fs4.mkdirSync(path5.join(root, "logs"), { recursive: true });
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${escapeXml(runSh)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${escapeXml(root)}</string>
  <key>StartInterval</key>
  <integer>1800</integer>
  <key>RunAtLoad</key>
  <false/>
  <key>StandardOutPath</key>
  <string>${escapeXml(logOut)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(logErr)}</string>
  <key>ProcessType</key>
  <string>Background</string>
</dict>
</plist>
`;
  fs4.writeFileSync(plistPath, plist, "utf8");
  await runProcess({
    kind: "register-task",
    settings: ctx.settings,
    vaultPath: ctx.vaultPath,
    command: "launchctl",
    args: ["unload", plistPath],
    cwd: root,
    timeoutMs: 3e4,
    onLine: ctx.onLine
  }).catch(() => void 0);
  return runProcess({
    kind: "register-task",
    settings: ctx.settings,
    vaultPath: ctx.vaultPath,
    command: "launchctl",
    args: ["load", plistPath],
    cwd: root,
    timeoutMs: 3e4,
    onLine: ctx.onLine
  });
}
async function registerLinux(ctx, runSh) {
  const root = resolveSyncRoot(ctx.settings);
  const name = sanitizeJobName(ctx.settings.taskName);
  const begin = `${CRON_BEGIN} ${name}`;
  const end = `${CRON_END} ${name}`;
  const line = `*/30 * * * * /bin/bash ${shellQuotePosix(runSh)} >> ${shellQuotePosix(
    path5.join(root, "logs", "cron-sync.log")
  )} 2>&1`;
  fs4.mkdirSync(path5.join(root, "logs"), { recursive: true });
  let existing = "";
  try {
    const r = await runProcess({
      kind: "custom",
      settings: ctx.settings,
      vaultPath: ctx.vaultPath,
      command: "crontab",
      args: ["-l"],
      cwd: root,
      timeoutMs: 15e3,
      onLine: ctx.onLine
    });
    if (r.code === 0) existing = r.stdout || "";
  } catch {
    existing = "";
  }
  const stripped = stripCronBlock(existing, begin, end);
  const next = (stripped.trimEnd() ? stripped.trimEnd() + "\n" : "") + `${begin}
${line}
${end}
`;
  const tmp = path5.join(root, ".zoom-mynotes-crontab.tmp");
  fs4.writeFileSync(tmp, next, "utf8");
  try {
    const r = await runProcess({
      kind: "register-task",
      settings: ctx.settings,
      vaultPath: ctx.vaultPath,
      command: "crontab",
      args: [tmp],
      cwd: root,
      timeoutMs: 15e3,
      onLine: ctx.onLine
    });
    return r;
  } finally {
    try {
      fs4.unlinkSync(tmp);
    } catch {
    }
  }
}
function stripCronBlock(src, begin, end) {
  const lines = src.split(/\r?\n/);
  const out = [];
  let skipping = false;
  for (const line of lines) {
    if (line.trim() === begin) {
      skipping = true;
      continue;
    }
    if (line.trim() === end) {
      skipping = false;
      continue;
    }
    if (!skipping) out.push(line);
  }
  while (out.length && out[out.length - 1] === "") out.pop();
  return out.join("\n") + (out.length ? "\n" : "");
}
function escapeXml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
async function runRegisterSchedule(ctx) {
  const files = writeLocalEnvFiles(ctx.settings, ctx.vaultPath);
  const platform = hostPlatform();
  const label = schedulerLabel();
  if (platform === "win32") {
    const result = await registerWindows(ctx, files.runPs1);
    return {
      result,
      detail: result.code === 0 ? `${label} job '${sanitizeJobName(ctx.settings.taskName)}' every 30 min` : `Failed to register ${label}`
    };
  }
  if (platform === "darwin") {
    const result = await registerDarwin(ctx, files.runSh);
    return {
      result,
      detail: result.code === 0 ? `${label}: com.zoom-mynotes-sync.${sanitizeJobName(
        ctx.settings.taskName
      )} every 30 min` : `Failed to load LaunchAgent`
    };
  }
  if (platform === "linux") {
    const result = await registerLinux(ctx, files.runSh);
    return {
      result,
      detail: result.code === 0 ? `${label} entry every 30 min (user crontab)` : `Failed to install crontab entry (is cron available?)`
    };
  }
  return {
    result: {
      kind: "register-task",
      code: 0,
      signal: null,
      stdout: "",
      stderr: "",
      durationMs: 0,
      command: "(skip)"
    },
    detail: `Background scheduling not automated on ${process.platform}. Use Obsidian auto-sync or run ${files.runSh} manually.`
  };
}

// src/deploy.ts
function step(id, title, status = "pending", detail = "") {
  return { id, title, status, detail };
}
function initialSteps() {
  return [
    step("root", "Install Python backend"),
    step("python", "Locate or download Python"),
    step("venv", "Create .venv"),
    step("deps", "Install Python packages"),
    step("playwright", `Install Playwright browser (${platformLabel()})`),
    step("output", "Prepare transcripts folder"),
    step("auth", "Check Zoom login state"),
    step("task", `Register ${schedulerLabel()} job`),
    step("plugin", "Install plugin into this vault")
  ];
}
function summarizeResult(r) {
  const out = (r.stdout || r.stderr || "").trim();
  const tail = out.slice(-400);
  return `exit=${r.code} ${tail}`.trim();
}
function resolveVenvPython(root) {
  for (const c of venvPythonCandidates(root)) {
    if (isFile(c) || pathExists(c)) return c;
  }
  return null;
}
async function runFullDeploy(ctx) {
  const steps = initialSteps();
  const set = (id, status, detail) => {
    const s = steps.find((x) => x.id === id);
    if (s) {
      s.status = status;
      s.detail = detail;
    }
    ctx.onUpdate([...steps]);
  };
  const log = (line) => ctx.onLog?.(line);
  const configDir = (ctx.configDir || "").trim();
  if (!configDir) {
    set(
      "root",
      "fail",
      "Missing vault config directory (Vault.configDir is empty)."
    );
    return steps;
  }
  set("root", "running", "Writing bundled backend\u2026");
  let root = "";
  try {
    const provisioned = ensureBundledBackend(
      ctx.vaultPath,
      configDir,
      ctx.settings
    );
    root = provisioned.root;
    if (!looksLikeSyncRoot(root)) {
      set(
        "root",
        "fail",
        `Backend incomplete at ${root} (need sync.py, config.py, requirements.txt)`
      );
      return steps;
    }
    set(
      "root",
      "ok",
      provisioned.reused ? `Using existing backend:
${root}` : `Installed backend (${provisioned.wrote.length} files):
${root}`
    );
  } catch (e) {
    set("root", "fail", e instanceof Error ? e.message : String(e));
    return steps;
  }
  set("python", "running", "Searching for Python (download if missing)\u2026");
  let bootstrapPy = "";
  try {
    const found = await ensurePython(root, ctx.settings, ctx.vaultPath, log);
    bootstrapPy = found.python;
    set(
      "python",
      "ok",
      `${found.source}: ${bootstrapPy}`
    );
  } catch (e) {
    set("python", "fail", e instanceof Error ? e.message : String(e));
    return steps;
  }
  set("venv", "running", "Creating .venv if needed\u2026");
  let venvPy = resolveVenvPython(root);
  if (venvPy) {
    set("venv", "ok", `Exists: ${venvPy}`);
  } else {
    try {
      const r = await runSetupVenv(
        ctx.settings,
        ctx.vaultPath,
        bootstrapPy,
        log
      );
      venvPy = resolveVenvPython(root);
      if (r.code !== 0 || !venvPy) {
        set("venv", "fail", summarizeResult(r));
        return steps;
      }
      set("venv", "ok", venvPy);
    } catch (e) {
      set("venv", "fail", e instanceof Error ? e.message : String(e));
      return steps;
    }
  }
  ctx.settings.pythonPath = venvPy;
  ctx.settings.syncRoot = root;
  set("deps", "running", "pip install -r requirements.txt\u2026");
  try {
    const r = await runPipInstall(ctx.settings, ctx.vaultPath, log);
    if (r.code !== 0) {
      set("deps", "fail", summarizeResult(r));
      return steps;
    }
    set("deps", "ok", "requirements installed");
  } catch (e) {
    set("deps", "fail", e instanceof Error ? e.message : String(e));
    return steps;
  }
  const channel = defaultBrowserChannel();
  set("playwright", "running", `import playwright + ensure ${channel || "chromium"}\u2026`);
  try {
    const py = resolvePython(ctx.settings);
    const r = await runProcess({
      kind: "custom",
      settings: ctx.settings,
      vaultPath: ctx.vaultPath,
      command: py,
      args: ["-c", "import playwright; print('playwright ok')"],
      cwd: root,
      timeoutMs: 3e4,
      onLine: log
    });
    if (r.code !== 0) {
      set("playwright", "fail", summarizeResult(r));
      return steps;
    }
    const installTargets = channel === "msedge" ? ["msedge"] : channel === "chrome" ? ["chrome", "chromium"] : ["chromium"];
    let lastCode = 0;
    for (const target of installTargets) {
      const ir = await runProcess({
        kind: "custom",
        settings: ctx.settings,
        vaultPath: ctx.vaultPath,
        command: py,
        args: ["-m", "playwright", "install", target],
        cwd: root,
        timeoutMs: 15 * 60 * 1e3,
        onLine: log
      });
      lastCode = ir.code ?? 1;
      if (ir.code === 0) break;
    }
    const smoke = await runProcess({
      kind: "custom",
      settings: ctx.settings,
      vaultPath: ctx.vaultPath,
      command: py,
      args: [
        "-c",
        "from playwright.sync_api import sync_playwright\nimport os\nch=(os.environ.get('ZOOM_BROWSER_CHANNEL') or '').strip()\np=sync_playwright().start()\ntry:\n  kw={'headless':True}\n  if ch: kw['channel']=ch\n  b=p.chromium.launch(**kw); b.close(); print('launch ok', ch or 'chromium')\nexcept Exception as e:\n  if ch:\n    b=p.chromium.launch(headless=True); b.close(); print('fallback chromium ok', type(e).__name__)\n  else:\n    raise\nfinally:\n  p.stop()\n"
      ],
      cwd: root,
      timeoutMs: 12e4,
      onLine: log
    });
    if (smoke.code !== 0) {
      set(
        "playwright",
        "fail",
        `Browser launch failed (channel=${channel || "chromium"}). On macOS install Google Chrome, or re-run deploy. ${summarizeResult(smoke)}`
      );
      return steps;
    }
    set(
      "playwright",
      "ok",
      `${(smoke.stdout || "").trim() || "ok"}; install_exit=${lastCode} (${platformLabel()})`
    );
  } catch (e) {
    set("playwright", "fail", e instanceof Error ? e.message : String(e));
    return steps;
  }
  set("output", "running", "Creating transcripts folder\u2026");
  try {
    const out = resolveTranscriptsDir(ctx.settings, ctx.vaultPath);
    fs5.mkdirSync(out, { recursive: true });
    const files = writeLocalEnvFiles(ctx.settings, ctx.vaultPath);
    set(
      "output",
      "ok",
      `${out}
(wrote ${path6.basename(files.envSh)}, ${path6.basename(
        files.envPs1
      )}, ${path6.basename(files.runSh)}, ${path6.basename(files.runPs1)})`
    );
  } catch (e) {
    set("output", "fail", e instanceof Error ? e.message : String(e));
    return steps;
  }
  set("auth", "running", "Checking storage_state.json\u2026");
  const state = path6.join(root, "storage_state.json");
  if (isFile(state)) {
    set("auth", "ok", `Session present: ${state}`);
  } else {
    set(
      "auth",
      "skip",
      "No login yet \u2014 run command \u201CLogin (interactive SSO)\u201D once after deploy."
    );
  }
  set("task", "running", `Registering ${schedulerLabel()}\u2026`);
  try {
    const { result, detail } = await runRegisterSchedule({
      settings: ctx.settings,
      vaultPath: ctx.vaultPath,
      onLine: log
    });
    if (hostPlatform() === "other") {
      set("task", "skip", detail);
    } else if (result.code !== 0) {
      set("task", "fail", `${detail}
${summarizeResult(result)}`);
    } else {
      set("task", "ok", detail);
    }
  } catch (e) {
    set("task", "fail", e instanceof Error ? e.message : String(e));
  }
  set("plugin", "running", `Copying plugin into ${configDir}/plugins\u2026`);
  try {
    const dest = path6.join(
      ctx.vaultPath,
      configDir,
      "plugins",
      "zoom-mynotes-sync"
    );
    fs5.mkdirSync(dest, { recursive: true });
    const files = ["main.js", "manifest.json", "styles.css"];
    const srcDir = ctx.pluginDir;
    const copied = [];
    for (const f of files) {
      const from = path6.join(srcDir, f);
      if (!pathExists(from)) {
        if (pathExists(path6.join(dest, f))) {
          copied.push(`${f} (present)`);
          continue;
        }
        throw new Error(`Missing build artifact: ${from}`);
      }
      fs5.copyFileSync(from, path6.join(dest, f));
      copied.push(f);
    }
    const community = path6.join(
      ctx.vaultPath,
      configDir,
      "community-plugins.json"
    );
    let list = [];
    if (isFile(community)) {
      try {
        list = JSON.parse(fs5.readFileSync(community, "utf8"));
        if (!Array.isArray(list)) list = [];
      } catch {
        list = [];
      }
    }
    if (!list.includes("zoom-mynotes-sync")) {
      list.push("zoom-mynotes-sync");
      fs5.writeFileSync(community, JSON.stringify(list, null, 2) + "\n", "utf8");
    }
    set(
      "plugin",
      "ok",
      `Plugin ready at ${dest} (${copied.join(", ")}).`
    );
  } catch (e) {
    set("plugin", "fail", e instanceof Error ? e.message : String(e));
  }
  return steps;
}
function detectDefaultSyncRoot(pluginDir) {
  const candidates = [
    path6.resolve(pluginDir, ".."),
    path6.resolve(pluginDir, "..", ".."),
    path6.resolve(pluginDir, "..", "..", "..")
  ];
  for (const c of candidates) {
    if (looksLikeSyncRoot(c)) return c;
  }
  return "";
}
function deploySummary(steps) {
  const fail = steps.filter((s) => s.status === "fail");
  const ok = steps.filter((s) => s.status === "ok");
  const skip = steps.filter((s) => s.status === "skip");
  if (fail.length)
    return `Deploy incomplete: ${fail.map((f) => f.id).join(", ")} failed`;
  return `Deploy OK (${ok.length} ok, ${skip.length} skipped)`;
}

// src/settings.ts
var DEFAULT_SETTINGS = {
  syncRoot: "",
  pythonPath: "",
  outputFolder: "mynotes",
  autoSyncMinutes: 0,
  headless: true,
  logTitles: false,
  taskName: "ZoomNotesSync",
  lastSyncAt: "",
  lastExitCode: null,
  lastStatus: ""
};

// src/main.ts
var ZoomMyNotesSyncPlugin = class extends import_obsidian.Plugin {
  constructor() {
    super(...arguments);
    this.settings = { ...DEFAULT_SETTINGS };
    this.statusEl = null;
    this.autoTimer = null;
    this.running = false;
  }
  async onload() {
    await this.loadSettings();
    if (!this.settings.syncRoot) {
      const guessed = detectDefaultSyncRoot(this.manifest.dir || "");
      if (guessed) {
        this.settings.syncRoot = guessed;
        await this.saveSettings();
      }
    }
    this.statusEl = this.addStatusBarItem();
    this.statusEl.addClass("zoom-sync-status");
    this.refreshStatusBar();
    this.addRibbonIcon("audio-file", "Zoom MyNotes Sync", () => {
      void this.commandSync();
    });
    this.addCommand({
      id: "zoom-sync-now",
      name: "Sync now",
      callback: () => void this.commandSync()
    });
    this.addCommand({
      id: "zoom-sync-login",
      name: "Login (interactive SSO)",
      callback: () => void this.commandLogin()
    });
    this.addCommand({
      id: "zoom-sync-deploy",
      name: "Open deploy wizard",
      callback: () => new DeployModal(this.app, this).open()
    });
    this.addCommand({
      id: "zoom-sync-cancel",
      name: "Cancel running job",
      callback: () => {
        if (cancelActive()) {
          new import_obsidian.Notice("Zoom sync: cancelled");
          this.setRunning(false, "cancelled");
        } else {
          new import_obsidian.Notice("Zoom sync: nothing running");
        }
      }
    });
    this.addCommand({
      id: "zoom-sync-open-folder",
      name: "Open transcripts folder",
      callback: () => void this.openTranscriptsFolder()
    });
    this.addCommand({
      id: "zoom-sync-show-log",
      name: "Show latest sync log",
      callback: () => new LogModal(this.app, this).open()
    });
    this.addSettingTab(new ZoomSyncSettingTab(this.app, this));
    this.rescheduleAutoSync();
  }
  onunload() {
    if (this.autoTimer !== null) {
      window.clearInterval(this.autoTimer);
      this.autoTimer = null;
    }
    cancelActive();
  }
  async loadSettings() {
    const data = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data ?? {});
  }
  async saveSettings() {
    await this.saveData(this.settings);
    this.rescheduleAutoSync();
    this.refreshStatusBar();
  }
  vaultPath() {
    const adapter = this.app.vault.adapter;
    if (typeof adapter.getBasePath === "function") {
      return adapter.getBasePath();
    }
    throw new Error("Vault base path unavailable (desktop only)");
  }
  configDir() {
    return this.app.vault.configDir;
  }
  pluginSourceDir() {
    const dir = this.manifest.dir;
    if (dir) {
      const abs = path7.join(this.vaultPath(), dir);
      if (isFile(path7.join(abs, "main.js"))) return abs;
    }
    const root = resolveSyncRoot(this.settings);
    if (root) {
      const dev = path7.join(root, "Zoom-MyNotes-Obsidian-plugin");
      if (isFile(path7.join(dev, "main.js"))) return dev;
    }
    return dir ? path7.join(this.vaultPath(), dir) : "";
  }
  rescheduleAutoSync() {
    if (this.autoTimer !== null) {
      window.clearInterval(this.autoTimer);
      this.autoTimer = null;
    }
    const mins = Number(this.settings.autoSyncMinutes) || 0;
    if (mins <= 0) return;
    this.autoTimer = window.setInterval(() => {
      if (!this.running && !isRunning()) void this.commandSync(true);
    }, mins * 60 * 1e3);
  }
  setRunning(running, status) {
    this.running = running;
    if (status !== void 0) this.settings.lastStatus = status;
    this.refreshStatusBar();
  }
  refreshStatusBar() {
    if (!this.statusEl) return;
    this.statusEl.removeClass("is-running");
    this.statusEl.removeClass("is-error");
    this.statusEl.removeClass("is-ok");
    if (this.running) {
      this.statusEl.addClass("is-running");
      this.statusEl.setText("Zoom sync: running\u2026");
      return;
    }
    const code = this.settings.lastExitCode;
    const label = this.settings.lastStatus || (code === null || code === void 0 ? "idle" : `last ${exitLabel(code)}`);
    if (code === 0) this.statusEl.addClass("is-ok");
    else if (code !== null && code !== void 0 && code !== 0) {
      this.statusEl.addClass("is-error");
    }
    this.statusEl.setText(`Zoom sync: ${label}`);
  }
  assertReady() {
    const root = resolveSyncRoot(this.settings);
    if (!looksLikeSyncRoot(root)) {
      throw new Error(
        "Set Settings \u2192 Zoom MyNotes Sync \u2192 Sync repo path (folder with sync.py)"
      );
    }
    const py = resolvePython(this.settings);
    if (!py) throw new Error("Python not found \u2014 run Deploy wizard");
  }
  async commandSync(quiet = false) {
    if (this.running || isRunning()) {
      if (!quiet) new import_obsidian.Notice("Zoom sync already running");
      return;
    }
    try {
      this.assertReady();
    } catch (e) {
      new import_obsidian.Notice(e instanceof Error ? e.message : String(e));
      return;
    }
    this.setRunning(true, "syncing\u2026");
    if (!quiet) new import_obsidian.Notice("Zoom sync started");
    try {
      const result = await runSync(this.settings, this.vaultPath());
      await this.recordResult(result);
      const msg = `Zoom sync ${exitLabel(result.code)} (${Math.round(result.durationMs / 1e3)}s)`;
      new import_obsidian.Notice(msg);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.settings.lastExitCode = 1;
      this.settings.lastStatus = msg.slice(0, 120);
      await this.saveSettings();
      new import_obsidian.Notice(`Zoom sync failed: ${msg}`);
    } finally {
      this.setRunning(false);
    }
  }
  async commandLogin() {
    if (this.running || isRunning()) {
      new import_obsidian.Notice("Zoom sync already running");
      return;
    }
    try {
      this.assertReady();
    } catch (e) {
      new import_obsidian.Notice(e instanceof Error ? e.message : String(e));
      return;
    }
    this.setRunning(true, "login\u2026");
    new import_obsidian.Notice("Zoom login: complete SSO in the browser window");
    try {
      const settings = { ...this.settings, headless: false };
      const result = await runLogin(settings, this.vaultPath());
      await this.recordResult(result);
      new import_obsidian.Notice(
        result.code === 0 ? "Zoom login saved" : `Zoom login ${exitLabel(result.code)}`
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      new import_obsidian.Notice(`Zoom login failed: ${msg}`);
      this.settings.lastStatus = msg.slice(0, 120);
      await this.saveSettings();
    } finally {
      this.setRunning(false);
    }
  }
  async recordResult(result) {
    this.settings.lastExitCode = result.code;
    this.settings.lastStatus = exitLabel(result.code);
    if (result.code === 0) {
      this.settings.lastSyncAt = (/* @__PURE__ */ new Date()).toISOString();
    }
    await this.saveSettings();
  }
  async openTranscriptsFolder() {
    try {
      const rel = (0, import_obsidian.normalizePath)(this.settings.outputFolder || "mynotes");
      if (!this.app.vault.getAbstractFileByPath(rel)) {
        await this.app.vault.createFolder(rel);
      }
      const abs = resolveTranscriptsDir(this.settings, this.vaultPath());
      new import_obsidian.Notice(`Transcripts folder: ${rel} (${abs})`);
    } catch (e) {
      new import_obsidian.Notice(e instanceof Error ? e.message : String(e));
    }
  }
};
var ZoomSyncSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  getSettingDefinitions() {
    const pathPlaceholder = process.platform === "win32" ? "C:\\Users\\\u2026\\zoom-mynotes-sync" : "/Users/\u2026/zoom-mynotes-sync";
    return [
      {
        type: "group",
        items: [
          {
            name: "About",
            desc: "Controls the Python + Playwright backend that downloads Zoom AI notes transcripts into this vault. Desktop only; runs a local Python process you configure."
          },
          {
            name: "Sync backend path",
            desc: "Filled automatically by Deploy wizard (under your vault config folder). Override only if you maintain your own backend.",
            aliases: ["sync root", "python repo", "sync repo path"],
            control: {
              type: "text",
              key: "syncRoot",
              placeholder: pathPlaceholder
            }
          },
          {
            name: "Python path",
            desc: "Filled automatically by Deploy wizard (.venv or portable Python). Leave empty for auto.",
            control: {
              type: "text",
              key: "pythonPath",
              placeholder: "(auto)"
            }
          },
          {
            name: "Transcripts folder",
            desc: "Vault-relative folder for .md transcripts (month subfolders inside).",
            control: {
              type: "folder",
              key: "outputFolder",
              placeholder: "mynotes",
              includeRoot: false
            }
          },
          {
            name: "Headless sync",
            desc: "Run browser without a visible window (login always opens a window).",
            control: {
              type: "toggle",
              key: "headless"
            }
          },
          {
            name: "Log meeting titles",
            desc: "Include titles in sync logs (off by default for privacy).",
            control: {
              type: "toggle",
              key: "logTitles"
            }
          },
          {
            name: "Auto-sync while Obsidian is open",
            desc: "Minutes between syncs (0 = disabled). OS background job still covers when Obsidian is closed.",
            aliases: ["interval"],
            control: {
              type: "number",
              key: "autoSyncMinutes",
              placeholder: "0",
              min: 0,
              step: 1
            }
          },
          {
            name: "Background job name",
            desc: "Name used by the deploy wizard: Windows Task Scheduler, macOS LaunchAgent, or Linux cron marker.",
            control: {
              type: "text",
              key: "taskName",
              placeholder: "ZoomNotesSync"
            }
          },
          {
            name: "Open deploy wizard",
            desc: "Create venv, install deps, register OS background job, install plugin into vault.",
            action: () => {
              new DeployModal(this.app, this.plugin).open();
            }
          },
          {
            name: "Sync now",
            desc: "Run the Python sync backend once.",
            action: () => {
              void this.plugin.commandSync();
            }
          },
          {
            name: "Login",
            desc: "Interactive Zoom SSO (opens a browser window).",
            action: () => {
              void this.plugin.commandLogin();
            }
          },
          {
            name: "Show log",
            desc: "Open the latest sync log from the backend repo.",
            action: () => {
              new LogModal(this.app, this.plugin).open();
            }
          },
          {
            name: "Resolved paths",
            desc: "Current paths used by the plugin.",
            searchable: true,
            render: (setting) => {
              const root = resolveSyncRoot(this.plugin.settings);
              const lines = [
                `repo: ${root || "(not set)"}`,
                `python: ${resolvePython(this.plugin.settings)}`,
                `transcripts: ${resolveTranscriptsDir(this.plugin.settings, this.plugin.vaultPath())}`,
                `configDir: ${this.plugin.configDir()}`,
                `last: ${this.plugin.settings.lastSyncAt || "never"} (${this.plugin.settings.lastStatus || "\u2014"})`
              ];
              setting.setDesc(lines.join("\n"));
              setting.descEl.addClass("zoom-deploy-detail");
            }
          }
        ]
      }
    ];
  }
  async setControlValue(key, value) {
    const k = key;
    switch (k) {
      case "syncRoot":
      case "pythonPath":
        this.plugin.settings[k] = String(value ?? "").trim();
        break;
      case "outputFolder": {
        const folder = String(value ?? "").trim() || "mynotes";
        this.plugin.settings.outputFolder = (0, import_obsidian.normalizePath)(folder);
        break;
      }
      case "taskName":
        this.plugin.settings.taskName = String(value ?? "").trim() || "ZoomNotesSync";
        break;
      case "headless":
      case "logTitles":
        this.plugin.settings[k] = Boolean(value);
        break;
      case "autoSyncMinutes": {
        const n = typeof value === "number" ? value : parseInt(String(value), 10);
        this.plugin.settings.autoSyncMinutes = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
        break;
      }
      default:
        break;
    }
    await this.plugin.saveSettings();
  }
  /**
   * Fallback for Obsidian &lt; 1.13 when getSettingDefinitions is unavailable.
   */
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("p", {
      text: "Controls the Python + Playwright backend that downloads Zoom AI notes transcripts into this vault."
    });
    new import_obsidian.Setting(containerEl).setName("Sync repo path").setDesc(
      "Absolute path to the zoom-mynotes-sync repository (contains sync.py)."
    ).addText(
      (t) => t.setPlaceholder(
        process.platform === "win32" ? "C:\\Users\\\u2026\\zoom-mynotes-sync" : "/Users/\u2026/zoom-mynotes-sync"
      ).setValue(this.plugin.settings.syncRoot).onChange(async (v) => {
        await this.setControlValue("syncRoot", v);
      })
    );
    new import_obsidian.Setting(containerEl).setName("Python path").setDesc(
      "Optional. Leave empty to use .venv (Windows: Scripts/python.exe, macOS/Linux: bin/python3)."
    ).addText(
      (t) => t.setPlaceholder("(auto)").setValue(this.plugin.settings.pythonPath).onChange(async (v) => {
        await this.setControlValue("pythonPath", v);
      })
    );
    new import_obsidian.Setting(containerEl).setName("Transcripts folder").setDesc(
      "Vault-relative folder for .md transcripts (month subfolders inside)."
    ).addText(
      (t) => t.setPlaceholder("mynotes").setValue(this.plugin.settings.outputFolder).onChange(async (v) => {
        await this.setControlValue("outputFolder", v);
      })
    );
    new import_obsidian.Setting(containerEl).setName("Headless sync").setDesc(
      "Run browser without a visible window (login always opens a window)."
    ).addToggle(
      (t) => t.setValue(this.plugin.settings.headless).onChange(async (v) => {
        await this.setControlValue("headless", v);
      })
    );
    new import_obsidian.Setting(containerEl).setName("Log meeting titles").setDesc("Include titles in sync logs (off by default for privacy).").addToggle(
      (t) => t.setValue(this.plugin.settings.logTitles).onChange(async (v) => {
        await this.setControlValue("logTitles", v);
      })
    );
    new import_obsidian.Setting(containerEl).setName("Auto-sync while Obsidian is open").setDesc(
      "Minutes between syncs (0 = disabled). OS background job still covers when Obsidian is closed."
    ).addText(
      (t) => t.setPlaceholder("0").setValue(String(this.plugin.settings.autoSyncMinutes || 0)).onChange(async (v) => {
        await this.setControlValue("autoSyncMinutes", v);
      })
    );
    new import_obsidian.Setting(containerEl).setName("Background job name").setDesc(
      "Name used by the deploy wizard: Windows Task Scheduler, macOS LaunchAgent, or Linux cron marker."
    ).addText(
      (t) => t.setPlaceholder("ZoomNotesSync").setValue(this.plugin.settings.taskName).onChange(async (v) => {
        await this.setControlValue("taskName", v);
      })
    );
    new import_obsidian.Setting(containerEl).setName("Deploy wizard").setDesc(
      "Create venv, install deps, register OS background job, install plugin into vault."
    ).addButton(
      (b) => b.setButtonText("Open deploy wizard").setCta().onClick(() => {
        new DeployModal(this.app, this.plugin).open();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Actions").addButton(
      (b) => b.setButtonText("Sync now").onClick(() => void this.plugin.commandSync())
    ).addButton(
      (b) => b.setButtonText("Login").onClick(() => void this.plugin.commandLogin())
    ).addButton(
      (b) => b.setButtonText("Show log").onClick(() => new LogModal(this.app, this.plugin).open())
    );
    const root = resolveSyncRoot(this.plugin.settings);
    const info = containerEl.createDiv({ cls: "zoom-deploy-step" });
    new import_obsidian.Setting(info).setName("Resolved paths").setHeading();
    const lines = [
      `repo: ${root || "(not set)"}`,
      `python: ${resolvePython(this.plugin.settings)}`,
      `transcripts: ${resolveTranscriptsDir(this.plugin.settings, this.plugin.vaultPath())}`,
      `configDir: ${this.plugin.configDir()}`,
      `last: ${this.plugin.settings.lastSyncAt || "never"} (${this.plugin.settings.lastStatus || "\u2014"})`
    ];
    info.createDiv({ cls: "zoom-deploy-detail", text: lines.join("\n") });
  }
};
var DeployModal = class extends import_obsidian.Modal {
  constructor(app, plugin) {
    super(app);
    this.stepsEl = null;
    this.logEl = null;
    this.busy = false;
    this.plugin = plugin;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("zoom-deploy-modal");
    new import_obsidian.Setting(contentEl).setName("Deploy wizard").setHeading();
    contentEl.createEl("p", {
      text: "One click installs everything automatically: Python backend, Python runtime (if needed), packages, Playwright browser, transcripts folder, and a background sync job. No manual downloads required."
    });
    this.stepsEl = contentEl.createDiv();
    this.renderSteps([]);
    this.logEl = contentEl.createDiv({ cls: "zoom-log-tail" });
    this.logEl.setText("Ready. Click Run full deploy.");
    new import_obsidian.Setting(contentEl).addButton(
      (b) => b.setButtonText("Run full deploy").setCta().onClick(() => void this.run())
    ).addButton((b) => b.setButtonText("Close").onClick(() => this.close()));
  }
  onClose() {
    this.contentEl.empty();
  }
  renderSteps(steps) {
    if (!this.stepsEl) return;
    this.stepsEl.empty();
    if (!steps.length) {
      this.stepsEl.createEl("p", {
        text: "Click Run full deploy to start. Safe to re-run anytime."
      });
      return;
    }
    for (const s of steps) {
      const statusClass = s.status === "ok" ? "is-ok" : s.status === "fail" ? "is-fail" : s.status === "running" ? "is-running" : "";
      const el = this.stepsEl.createDiv({
        cls: `zoom-deploy-step ${statusClass}`.trim()
      });
      new import_obsidian.Setting(el).setName(`${statusGlyph(s.status)} ${s.title}`).setHeading();
      if (s.detail) {
        el.createDiv({ cls: "zoom-deploy-detail", text: s.detail });
      }
    }
  }
  appendLog(line) {
    if (!this.logEl) return;
    const prev = this.logEl.getText();
    const next = (prev.startsWith("Ready") ? "" : prev + "\n") + line;
    this.logEl.setText(next.slice(-4e3));
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }
  async run() {
    if (this.busy || isRunning()) {
      new import_obsidian.Notice("A job is already running");
      return;
    }
    this.busy = true;
    try {
      const steps = await runFullDeploy({
        settings: this.plugin.settings,
        vaultPath: this.plugin.vaultPath(),
        configDir: this.plugin.configDir(),
        pluginDir: this.plugin.pluginSourceDir(),
        onUpdate: (s) => this.renderSteps(s),
        onLog: (line) => this.appendLog(line)
      });
      await this.plugin.saveSettings();
      const summary = deploySummary(steps);
      this.appendLog(summary);
      new import_obsidian.Notice(summary);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.appendLog(msg);
      new import_obsidian.Notice(`Deploy failed: ${msg}`);
    } finally {
      this.busy = false;
    }
  }
};
var LogModal = class extends import_obsidian.Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    new import_obsidian.Setting(contentEl).setName("Latest sync log").setHeading();
    const root = resolveSyncRoot(this.plugin.settings);
    const logPath = latestLogPath(root);
    if (!logPath) {
      contentEl.createEl("p", { text: "No logs/sync-*.log found yet." });
      return;
    }
    contentEl.createEl("p", { text: logPath });
    contentEl.createDiv({
      cls: "zoom-log-tail",
      text: readTail(logPath)
    });
  }
  onClose() {
    this.contentEl.empty();
  }
};
function statusGlyph(s) {
  switch (s) {
    case "ok":
      return "[ok]";
    case "fail":
      return "[fail]";
    case "running":
      return "[\u2026]";
    case "skip":
      return "[skip]";
    default:
      return "[ ]";
  }
}
