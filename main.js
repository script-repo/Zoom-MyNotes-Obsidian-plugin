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
  "sync.py": `"""Scheduled sync entry point.\r
\r
Run every 30 minutes (via Task Scheduler / run.ps1). Loads the saved session,\r
scans Zoom notes, downloads transcripts not already in the index, and records\r
results. Expired sessions trigger interactive re-login in a separate browser\r
lifecycle, then a fresh sync session continues.\r
\r
By default Playwright work runs in an isolated child process so hung Edge\r
teardown cannot pin the lock forever.\r
\r
Exit codes:\r
  0 success\r
  1 hard failure\r
  2 degraded (partial failures / selector issues)\r
  3 skipped (lock held by healthy peer)\r
\r
    python sync.py\r
    python sync.py --worker   # internal: browser phase only (no lock)\r
"""\r
\r
from __future__ import annotations\r
\r
import logging\r
import os\r
import re\r
import subprocess\r
import sys\r
import time\r
import uuid\r
from dataclasses import dataclass\r
from datetime import datetime\r
from pathlib import Path\r
\r
import config\r
import lockfile\r
import login as login_module\r
import procs\r
import security\r
import zoom_notes\r
from index_store import (\r
    CONTENT_VERSION,\r
    STATUS_DOWNLOADED,\r
    STATUS_NO_TRANSCRIPT,\r
    STATUS_RETRYABLE,\r
    IndexCorruptError,\r
    IndexStore,\r
)\r
from zoom_notes import DownloadOutcome, OpenMismatchError\r
\r
log = logging.getLogger("zoom_sync")\r
\r
EXIT_OK = 0\r
EXIT_HARD = 1\r
EXIT_DEGRADED = 2\r
EXIT_LOCKED = 3\r
\r
\r
@dataclass\r
class RunStats:\r
    scanned: int = 0\r
    opened: int = 0\r
    downloaded: int = 0\r
    transcripts: int = 0\r
    absent: int = 0\r
    retryable: int = 0\r
    failed: int = 0\r
    skipped_known: int = 0\r
    selector_broken: int = 0\r
    orphans: int = 0\r
\r
    def summary(self, index_size: int, code: int) -> str:\r
        return (\r
            f"scanned={self.scanned} opened={self.opened} downloaded={self.downloaded} "\r
            f"transcripts={self.transcripts} "\r
            f"absent={self.absent} retryable={self.retryable} selector_broken={self.selector_broken} "\r
            f"failed={self.failed} skipped_known={self.skipped_known} orphans={self.orphans} "\r
            f"index={index_size} exit={code}"\r
        )\r
\r
\r
def setup_logging() -> None:\r
    config.ensure_dirs()\r
    logfile = config.LOGS_DIR / f"sync-{datetime.now():%Y%m%d}.log"\r
    handlers = [logging.FileHandler(logfile, encoding="utf-8"), logging.StreamHandler(sys.stdout)]\r
    logging.basicConfig(\r
        level=logging.INFO,\r
        format="%(asctime)s %(levelname)s %(message)s",\r
        handlers=handlers,\r
        force=True,\r
    )\r
\r
\r
_MONTH_ABBR = {\r
    "jan": 1,\r
    "feb": 2,\r
    "mar": 3,\r
    "apr": 4,\r
    "may": 5,\r
    "jun": 6,\r
    "jul": 7,\r
    "aug": 8,\r
    "sep": 9,\r
    "oct": 10,\r
    "nov": 11,\r
    "dec": 12,\r
}\r
\r
\r
def _parse_meeting_date(\r
    note: zoom_notes.NoteRef, *, today: datetime | None = None\r
) -> datetime:\r
    """Best-effort calendar day for path/filename (date part only; time ignored).\r
\r
    Prefer ISO yyyy-mm-dd in the title (Zoom often embeds it), then the list-row\r
    date text (e.g. 'Monday Jul 20, 13:58-14:51'), else today.\r
    """\r
    now = (today or datetime.now()).date()\r
    for text in (note.title or "", note.date or ""):\r
        m = re.search(r"(20\\d{2})-(\\d{2})-(\\d{2})", text)\r
        if m:\r
            try:\r
                return datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)))\r
            except ValueError:\r
                pass\r
\r
    raw = note.date or ""\r
    m = re.search(\r
        r"\\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\\s+"\r
        r"(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\\s+"\r
        r"(\\d{1,2})\\b",\r
        raw,\r
        re.IGNORECASE,\r
    )\r
    if m:\r
        month = _MONTH_ABBR[m.group(1)[:3].lower()]\r
        day = int(m.group(2))\r
        year = now.year\r
        try:\r
            candidate = datetime(year, month, day).date()\r
        except ValueError:\r
            candidate = None\r
        if candidate is not None:\r
            # UI omits year; if the day is far in the future, it was last year.\r
            if (candidate - now).days > 180:\r
                try:\r
                    candidate = datetime(year - 1, month, day).date()\r
                except ValueError:\r
                    candidate = None\r
            if candidate is not None:\r
                return datetime(candidate.year, candidate.month, candidate.day)\r
\r
    m = re.search(\r
        r"\\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|"\r
        r"Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|"\r
        r"Dec(?:ember)?)\\s+(\\d{1,2})(?:st|nd|rd|th)?"\r
        r"(?:,?\\s*)?(20\\d{2})?\\b",\r
        note.title or "",\r
        re.IGNORECASE,\r
    )\r
    if m:\r
        month = _MONTH_ABBR[m.group(1)[:3].lower()]\r
        day = int(m.group(2))\r
        year = int(m.group(3)) if m.group(3) else now.year\r
        try:\r
            return datetime(year, month, day)\r
        except ValueError:\r
            pass\r
\r
    return datetime(now.year, now.month, now.day)\r
\r
\r
def _safe_name(note: zoom_notes.NoteRef, meeting_day: datetime | None = None) -> str:\r
    day = meeting_day or _parse_meeting_date(note)\r
    prefix = f"{day:%Y-%m-%d}"\r
    note_id = note.stable_id()\r
    if config.PRIVACY_FILENAMES:\r
        return f"{prefix}-{note_id}.md"\r
    slug = re.sub(r"[^A-Za-z0-9._-]+", "_", note.title).strip("_")[:80] or "note"\r
    return f"{prefix}-{slug}__{note_id}.md"\r
\r
\r
def _transcript_dest(note: zoom_notes.NoteRef) -> Path:\r
    """Month folder under TRANSCRIPTS_DIR: {yyyy-mm}/{yyyy-mm-dd}-{name}.md"""\r
    day = _parse_meeting_date(note)\r
    return config.TRANSCRIPTS_DIR / f"{day:%Y-%m}" / _safe_name(note, day)\r
\r
\r
def _note_ids(note: zoom_notes.NoteRef) -> list[str]:\r
    ids = [note.metadata_id()]\r
    if note.note_id:\r
        ids.append(note.note_id)\r
    sid = note.stable_id()\r
    if sid not in ids:\r
        ids.append(sid)\r
    return ids\r
\r
\r
def _is_due(note: zoom_notes.NoteRef, index: IndexStore) -> bool:\r
    return any(index.should_process(i) for i in _note_ids(note))\r
\r
\r
def _order_notes_for_processing(\r
    notes: list[zoom_notes.NoteRef], index: IndexStore\r
) -> list[zoom_notes.NoteRef]:\r
    """Process every due note first (newest-first), then optional backfill candidates.\r
\r
    Never bury new top-of-list notes behind known ones \u2014 that interacted badly with\r
    STOP_AFTER_KNOWN and skipped fresh meetings.\r
    """\r
    due: list[zoom_notes.NoteRef] = []\r
    known: list[zoom_notes.NoteRef] = []\r
    for note in notes:\r
        if _is_due(note, index):\r
            due.append(note)\r
        else:\r
            known.append(note)\r
\r
    # Among known-only tail, optionally rotate from watermark for future backfill\r
    # discovery logging; we do not open known notes unless should_process says so.\r
    marks = set(index.watermark_ids())\r
    if marks and known:\r
        cut = None\r
        for i, note in enumerate(known):\r
            if note.metadata_id() in marks or note.stable_id() in marks:\r
                cut = i\r
                break\r
        if cut is not None and cut > 0:\r
            known = known[cut:] + known[:cut]\r
    return due + known\r
\r
\r
def process_notes(page, index: IndexStore, lock: lockfile.LockHandle | None, stats: RunStats) -> int:\r
    """Scan and download. Returns EXIT_OK or EXIT_DEGRADED."""\r
    notes = zoom_notes.collect_notes(page, config.MAX_ITEMS, config.MAX_SCROLL_STEPS)\r
    notes = _order_notes_for_processing(notes, index)\r
    stats.scanned = len(notes)\r
    due_count = sum(1 for n in notes if _is_due(n, index))\r
    log.info("Found %d note(s) after scan/scroll (%d due).", len(notes), due_count)\r
    if not notes:\r
        if zoom_notes.is_logged_in(page):\r
            log.warning(\r
                "No meeting notes parsed while authenticated. "\r
                "Selectors may need updating (see zoom_notes.SELECTORS)."\r
            )\r
            zoom_notes.save_diagnostics(page, f"empty-list-{datetime.now():%H%M%S}")\r
            return EXIT_DEGRADED\r
        log.error("Not authenticated and no notes found.")\r
        return EXIT_HARD\r
\r
    consecutive_known = 0\r
    work_budget = config.MAX_ITEMS\r
    degraded = False\r
    last_processed_ids: list[str] = []\r
    reached_end = True\r
    due_remaining = due_count\r
\r
    for note in notes:\r
        if work_budget <= 0:\r
            log.info("Work budget (%d) exhausted; remaining notes deferred.", config.MAX_ITEMS)\r
            reached_end = False\r
            break\r
\r
        if lock is not None:\r
            try:\r
                lock.heartbeat()\r
            except Exception:\r
                pass\r
\r
        pre_ids = _note_ids(note)\r
        if not _is_due(note, index):\r
            consecutive_known += 1\r
            stats.skipped_known += 1\r
            last_processed_ids = pre_ids[:3]\r
            # Only stop early when no due notes remain later in the queue.\r
            if due_remaining <= 0 and consecutive_known >= config.STOP_AFTER_KNOWN:\r
                log.info("Hit %d consecutive known notes; stopping scan.", consecutive_known)\r
                break\r
            continue\r
\r
        due_remaining = max(0, due_remaining - 1)\r
        label = config.note_label(note.metadata_id(), note.title)\r
        log.info("Processing due note %s", label)\r
        try:\r
            zoom_notes.open_note(page, note)\r
        except OpenMismatchError as exc:\r
            log.error("Open mismatch for %s: %s", label, exc)\r
            stats.failed += 1\r
            degraded = True\r
            consecutive_known = 0\r
            work_budget -= 1\r
            zoom_notes._dismiss_menu(page)\r
            zoom_notes.save_diagnostics(page, f"mismatch-{note.metadata_id()}")\r
            index.add(\r
                note.metadata_id(),\r
                title=note.title,\r
                status=STATUS_RETRYABLE,\r
                host=note.host,\r
                meeting_date=note.date,\r
                last_outcome="open_mismatch",\r
                last_error=str(exc)[:300],\r
            )\r
            continue\r
        except Exception as exc:  # noqa: BLE001\r
            log.error("Failed to open note %s: %s", label, exc)\r
            stats.failed += 1\r
            degraded = True\r
            consecutive_known = 0\r
            work_budget -= 1\r
            zoom_notes._dismiss_menu(page)\r
            index.add(\r
                note.metadata_id(),\r
                title=note.title,\r
                status=STATUS_RETRYABLE,\r
                host=note.host,\r
                meeting_date=note.date,\r
                last_outcome="open_error",\r
                last_error=str(exc)[:300],\r
            )\r
            continue\r
\r
        stats.opened += 1\r
        work_budget -= 1\r
        note_id = note.stable_id()\r
        meta_id = note.metadata_id()\r
        aliases = [a for a in _note_ids(note) if a != note_id]\r
        last_processed_ids = _note_ids(note)[:3]\r
\r
        if not index.should_process(note_id) and not index.should_process(meta_id):\r
            log.info("Already have %s (resolved). Skipping.", label)\r
            consecutive_known += 1\r
            stats.skipped_known += 1\r
            if consecutive_known >= config.STOP_AFTER_KNOWN:\r
                break\r
            continue\r
\r
        consecutive_known = 0\r
        dest = _transcript_dest(note)\r
        try:\r
            result = zoom_notes.download_transcript(page, dest)\r
        except Exception as exc:  # noqa: BLE001\r
            log.error("Download error for %s: %s", label, exc)\r
            stats.failed += 1\r
            degraded = True\r
            index.add(\r
                note_id,\r
                title=note.title,\r
                status=STATUS_RETRYABLE,\r
                source_url=note.url,\r
                host=note.host,\r
                meeting_date=note.date,\r
                aliases=aliases,\r
                last_outcome="error",\r
                last_error=str(exc)[:300],\r
            )\r
            continue\r
\r
        if result.outcome == DownloadOutcome.DOWNLOADED:\r
            try:\r
                rel = str(dest.relative_to(config.BASE_DIR))\r
            except ValueError:\r
                rel = str(dest)\r
            index.add(\r
                note_id,\r
                title=note.title,\r
                status=STATUS_DOWNLOADED,\r
                source_url=note.url,\r
                host=note.host,\r
                meeting_date=note.date,\r
                file=rel,\r
                aliases=aliases,\r
                size=result.size,\r
                sha256=result.sha256,\r
                last_outcome="downloaded",\r
                content_version=CONTENT_VERSION,\r
                has_transcript=result.has_transcript,\r
            )\r
            stats.downloaded += 1\r
            if result.has_transcript:\r
                stats.transcripts += 1\r
            try:\r
                shown = str(dest.relative_to(config.TRANSCRIPTS_DIR))\r
            except ValueError:\r
                shown = str(dest)\r
            log.info(\r
                "Saved note content%s: %s -> %s",\r
                " + transcript" if result.has_transcript else "",\r
                label,\r
                shown,\r
            )\r
        elif result.outcome == DownloadOutcome.ABSENT:\r
            index.add(\r
                note_id,\r
                title=note.title,\r
                status=STATUS_NO_TRANSCRIPT,\r
                source_url=note.url,\r
                host=note.host,\r
                meeting_date=note.date,\r
                aliases=aliases,\r
                last_outcome="absent",\r
                last_error=result.error,\r
            )\r
            stats.absent += 1\r
            log.info(\r
                "No transcript for %s; backoff scheduled. (%s)",\r
                label,\r
                (result.error or "")[:200],\r
            )\r
        elif result.outcome == DownloadOutcome.SELECTOR_BROKEN:\r
            index.add(\r
                note_id,\r
                title=note.title,\r
                status=STATUS_RETRYABLE,\r
                source_url=note.url,\r
                host=note.host,\r
                meeting_date=note.date,\r
                aliases=aliases,\r
                last_outcome="selector_broken",\r
                last_error=result.error,\r
            )\r
            stats.selector_broken += 1\r
            degraded = True\r
            log.warning("Selector issue for %s: %s", label, result.error)\r
            zoom_notes.save_diagnostics(page, f"selector-{note.metadata_id()}")\r
        else:\r
            index.add(\r
                note_id,\r
                title=note.title,\r
                status=STATUS_RETRYABLE,\r
                source_url=note.url,\r
                host=note.host,\r
                meeting_date=note.date,\r
                aliases=aliases,\r
                last_outcome="retryable",\r
                last_error=result.error,\r
            )\r
            stats.retryable += 1\r
            degraded = True\r
            log.warning("Retryable download issue for %s: %s", label, result.error)\r
\r
    # Persist watermark so the next run can continue deeper into history.\r
    top_ids = [n.metadata_id() for n in notes[:5]]\r
    index.mark_scan(\r
        last_run_at=datetime.now().isoformat(timespec="seconds"),\r
        watermark_ids=last_processed_ids or top_ids,\r
        last_top_ids=top_ids,\r
        reached_end=reached_end and consecutive_known >= config.STOP_AFTER_KNOWN,\r
        last_scanned_count=stats.scanned,\r
        last_downloaded=stats.downloaded,\r
    )\r
    return EXIT_DEGRADED if degraded else EXIT_OK\r
\r
\r
def ensure_authenticated(session: procs.BrowserSession) -> procs.BrowserSession:\r
    """Ensure session is authenticated. May stop and replace the session."""\r
    page = session.page\r
    page.goto(config.NOTES_URL, wait_until="domcontentloaded")\r
    page.wait_for_timeout(3000)\r
    if zoom_notes.is_logged_in(page):\r
        return session\r
\r
    log.warning("Session expired or missing. Launching interactive login...")\r
    session.stop()\r
\r
    if not login_module.interactive_login():\r
        raise RuntimeError("Interactive login failed or timed out.")\r
\r
    run_token = f"zoom-sync-{uuid.uuid4().hex}"\r
    session = procs.BrowserSession(\r
        headless=config.HEADLESS,\r
        run_token=run_token,\r
        process_names=config.browser_process_names(),\r
        launch_kwargs=config.launch_kwargs(headless=config.HEADLESS),\r
        new_context_fn=config.new_context,\r
        use_saved_state=True,\r
    )\r
    session.start()\r
    page = session.page\r
    page.goto(config.NOTES_URL, wait_until="domcontentloaded")\r
    page.wait_for_timeout(3000)\r
    if not zoom_notes.is_logged_in(page):\r
        raise RuntimeError("Still not authenticated after interactive login.")\r
    return session\r
\r
\r
def run_browser_phase(lock: lockfile.LockHandle | None = None) -> int:\r
    """Browser + index work. Used in-process or as an isolated worker child."""\r
    stats = RunStats()\r
    code = EXIT_OK\r
    session = None\r
\r
    try:\r
        index = IndexStore.load(config.INDEX_FILE, backoff_hours=config.absent_backoff_hours())\r
    except IndexCorruptError as exc:\r
        log.error("%s", exc)\r
        return EXIT_HARD\r
\r
    missing = index.reconcile_files(config.BASE_DIR)\r
    if missing:\r
        log.warning("Reconcile: %d downloaded record(s) missing files; will retry.", len(missing))\r
\r
    requeued = index.requeue_false_absents()\r
    if requeued:\r
        log.info(\r
            "Re-queued %d note(s) previously marked no-transcript (likely menu/UI miss).",\r
            requeued,\r
        )\r
\r
    backfill = index.requeue_pre_transcript()\r
    if backfill:\r
        log.info(\r
            "Re-queued %d already-downloaded note(s) to append the raw transcript.",\r
            backfill,\r
        )\r
\r
    orphans = index.find_orphan_files(config.TRANSCRIPTS_DIR, config.BASE_DIR)\r
    stats.orphans = len(orphans)\r
    if orphans:\r
        preview = ", ".join(orphans[:5])\r
        more = f" (+{len(orphans) - 5} more)" if len(orphans) > 5 else ""\r
        log.warning("Orphan transcript file(s) not in index: %s%s", preview, more)\r
\r
    try:\r
        run_token = f"zoom-sync-{uuid.uuid4().hex}"\r
        session = procs.BrowserSession(\r
            headless=config.HEADLESS,\r
            run_token=run_token,\r
            process_names=config.browser_process_names(),\r
            launch_kwargs=config.launch_kwargs(headless=config.HEADLESS),\r
            new_context_fn=config.new_context,\r
            use_saved_state=True,\r
        )\r
        session.start()\r
        session = ensure_authenticated(session)\r
        code = process_notes(session.page, index, lock, stats)\r
\r
        try:\r
            if session.context is not None:\r
                config.save_storage_state(session.context)\r
                log.info("Session state refreshed.")\r
        except Exception as exc:  # noqa: BLE001\r
            log.warning("Could not refresh storage state: %s", exc)\r
\r
    except Exception as exc:  # noqa: BLE001\r
        log.exception("Sync failed: %s", exc)\r
        code = EXIT_HARD\r
    finally:\r
        if session is not None:\r
            try:\r
                session.stop()\r
            except Exception:\r
                pass\r
        try:\r
            idx_count = IndexStore.load(config.INDEX_FILE).count if config.INDEX_FILE.exists() else 0\r
        except Exception:\r
            idx_count = -1\r
        log.info("Run summary: %s", stats.summary(idx_count, code))\r
        _touch_sync_stamp(code, stats)\r
\r
    return code\r
\r
\r
def _touch_sync_stamp(code: int, stats: RunStats) -> None:\r
    """Write a root-level stamp so IDE/OpenCode file trees notice external writes.\r
\r
    data/ is gitignored and often poorly watched; a small root file change is a\r
    reliable FS event for UIs that cache the tree until restart.\r
    """\r
    try:\r
        stamp = config.BASE_DIR / ".last-sync"\r
        stamp.write_text(\r
            f"{datetime.now().isoformat(timespec='seconds')} exit={code} "\r
            f"downloaded={stats.downloaded} scanned={stats.scanned}\\n",\r
            encoding="utf-8",\r
        )\r
    except OSError:\r
        pass\r
\r
\r
def _run_isolated_worker(lock: lockfile.LockHandle) -> int:\r
    """Spawn a child process for Playwright work; kill the tree on timeout."""\r
    cmd = [sys.executable, str(Path(__file__).resolve()), "--worker"]\r
    log.info("Starting isolated browser worker: %s", " ".join(cmd))\r
    creationflags = 0\r
    if os.name == "nt":\r
        # New process group so we can kill the tree.\r
        creationflags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0x00000200)\r
\r
    env = os.environ.copy()\r
    env["ZOOM_SYNC_WORKER"] = "1"\r
    # Child must not re-enter isolation.\r
    env["ZOOM_WORKER_ISOLATION"] = "0"\r
\r
    proc = subprocess.Popen(\r
        cmd,\r
        cwd=str(config.BASE_DIR),\r
        env=env,\r
        creationflags=creationflags,\r
    )\r
    deadline = time.time() + config.WORKER_TIMEOUT_SECONDS\r
    try:\r
        while True:\r
            try:\r
                lock.heartbeat()\r
            except Exception:\r
                pass\r
            rc = proc.poll()\r
            if rc is not None:\r
                log.info("Browser worker exited with code %s", rc)\r
                return int(rc)\r
            if time.time() >= deadline:\r
                log.error(\r
                    "Browser worker timed out after %ss; killing process tree.",\r
                    config.WORKER_TIMEOUT_SECONDS,\r
                )\r
                procs.kill_process_tree(proc.pid)\r
                try:\r
                    proc.wait(timeout=15)\r
                except Exception:\r
                    pass\r
                return EXIT_HARD\r
            time.sleep(2)\r
    except Exception:\r
        procs.kill_process_tree(proc.pid)\r
        raise\r
\r
\r
def run(*, worker: bool = False) -> int:\r
    setup_logging()\r
    log.info("=== Zoom notes sync starting%s ===", " (worker)" if worker else "")\r
\r
    try:\r
        config.validate_config()\r
        config.ensure_dirs()\r
        config.prune_old_logs()\r
        if config.APPLY_ACLS:\r
            acl_paths = [\r
                config.STORAGE_STATE,\r
                config.DATA_DIR,\r
                config.LOGS_DIR,\r
                config.DIAGNOSTICS_DIR,\r
            ]\r
            # Do not lock down an external vault/share (e.g. Obsidian under OneDrive).\r
            try:\r
                config.TRANSCRIPTS_DIR.resolve().relative_to(config.DATA_DIR.resolve())\r
                acl_paths.append(config.TRANSCRIPTS_DIR)\r
            except ValueError:\r
                pass\r
            security.apply_user_only_acls(acl_paths)\r
    except ValueError as exc:\r
        log.error("Configuration error: %s", exc)\r
        return EXIT_HARD\r
\r
    # Worker child: parent already holds the lock.\r
    if worker:\r
        code = run_browser_phase(lock=None)\r
        log.info("=== Zoom notes sync finished (exit %d) ===", code)\r
        return code\r
\r
    lock = lockfile.acquire(config.LOCK_FILE, stale_minutes=config.LOCK_STALE_MINUTES)\r
    if lock is None:\r
        log.warning("Another healthy run holds the lock; exiting.")\r
        return EXIT_LOCKED\r
\r
    code = EXIT_OK\r
    try:\r
        if config.WORKER_ISOLATION:\r
            code = _run_isolated_worker(lock)\r
        else:\r
            code = run_browser_phase(lock)\r
    except Exception as exc:  # noqa: BLE001\r
        log.exception("Sync failed: %s", exc)\r
        code = EXIT_HARD\r
    finally:\r
        lock.release()\r
        log.info("=== Zoom notes sync finished (exit %d) ===", code)\r
\r
    return code\r
\r
\r
if __name__ == "__main__":\r
    is_worker = "--worker" in sys.argv[1:]\r
    sys.exit(run(worker=is_worker))\r
`,
  "login.py": '"""Interactive login for Zoom Notes.\r\n\r\nRun this once (or whenever the session expires) to open a real browser window,\r\nlog in manually, and persist the authenticated session to `storage_state.json`.\r\n\r\n    python login.py\r\n\r\nIt is also imported by `sync.py` to drive the auto re-auth flow when a\r\nscheduled run detects an expired session.\r\n"""\r\n\r\nfrom __future__ import annotations\r\n\r\nimport sys\r\nimport time\r\nimport uuid\r\n\r\nfrom playwright.sync_api import Error as PWError\r\n\r\nimport config\r\nimport procs\r\nimport zoom_notes\r\n\r\n\r\ndef _logged_in_page(context):\r\n    """Return the first open page/tab that looks authenticated, else None."""\r\n    for pg in list(context.pages):\r\n        try:\r\n            if zoom_notes.is_logged_in(pg):\r\n                return pg\r\n        except PWError:\r\n            continue\r\n    return None\r\n\r\n\r\ndef interactive_login(wait_seconds: int = None) -> bool:\r\n    """Open a visible browser, let the user sign in, and save the session.\r\n\r\n    Returns True if login succeeded and the session was saved. Owns its browser\r\n    lifecycle completely; callers must not hold another Playwright Edge session\r\n    open while this runs.\r\n    """\r\n    wait_seconds = wait_seconds if wait_seconds is not None else config.LOGIN_WAIT_SECONDS\r\n    config.ensure_dirs()\r\n    config.validate_config()\r\n\r\n    run_token = f"zoom-login-{uuid.uuid4().hex}"\r\n    session = procs.BrowserSession(\r\n        headless=False,\r\n        run_token=run_token,\r\n        process_names=config.browser_process_names(),\r\n        launch_kwargs=config.launch_kwargs(headless=False),\r\n        new_context_fn=config.new_context,\r\n        use_saved_state=True,\r\n    )\r\n\r\n    try:\r\n        session.start()\r\n        context = session.context\r\n        page = session.page\r\n\r\n        print(f"Opening {config.redact_url(config.NOTES_URL)} ...", flush=True)\r\n        try:\r\n            page.goto(config.NOTES_URL, wait_until="domcontentloaded")\r\n        except PWError as exc:\r\n            print(f"Initial navigation warning: {exc}", flush=True)\r\n\r\n        print("Please complete the sign-in in the browser window.", flush=True)\r\n        print(f"Waiting up to {wait_seconds}s for the notes list to appear...", flush=True)\r\n\r\n        # Let redirects settle before auth checks.\r\n        time.sleep(5)\r\n\r\n        deadline = time.time() + wait_seconds\r\n        authed_page = None\r\n        last_report = 0.0\r\n        while time.time() < deadline:\r\n            if not context.pages:\r\n                print("  [info] no tabs open; reopening notes page...", flush=True)\r\n                try:\r\n                    newp = context.new_page()\r\n                    newp.goto(config.NOTES_URL, wait_until="domcontentloaded")\r\n                except PWError as exc:\r\n                    print(f"  [info] reopen failed: {exc}", flush=True)\r\n                    time.sleep(2)\r\n                    continue\r\n\r\n            authed_page = _logged_in_page(context)\r\n            if authed_page is not None:\r\n                break\r\n\r\n            now = time.time()\r\n            if now - last_report > 10:\r\n                urls = []\r\n                for pg in list(context.pages):\r\n                    try:\r\n                        urls.append(config.redact_url(pg.url))\r\n                    except PWError:\r\n                        pass\r\n                print(f"  [waiting] open tabs: {urls}", flush=True)\r\n                last_report = now\r\n            time.sleep(2)\r\n\r\n        logged_in = authed_page is not None\r\n        if logged_in:\r\n            time.sleep(2)\r\n            try:\r\n                config.save_storage_state(context)\r\n                print(\r\n                    f"Login successful (url: {config.redact_url(authed_page.url)}). "\r\n                    f"Session saved to {config.STORAGE_STATE}",\r\n                    flush=True,\r\n                )\r\n            except PWError as exc:\r\n                logged_in = False\r\n                print(f"Session save failed: {exc}", flush=True)\r\n        else:\r\n            print("Timed out / no authenticated tab. Session NOT saved.", flush=True)\r\n\r\n        return logged_in\r\n    finally:\r\n        session.stop()\r\n\r\n\r\nif __name__ == "__main__":\r\n    try:\r\n        ok = interactive_login()\r\n    except Exception as exc:  # noqa: BLE001\r\n        print(f"Login failed: {exc}", flush=True)\r\n        ok = False\r\n    sys.exit(0 if ok else 1)\r\n',
  "config.py": `"""Central configuration for the Zoom Notes transcript sync.\r
\r
All tunables live here so the rest of the code stays declarative. Paths are\r
resolved relative to this file so the scripts work regardless of the current\r
working directory (important when launched from Task Scheduler).\r
"""\r
\r
from __future__ import annotations\r
\r
import os\r
import re\r
import sys\r
from pathlib import Path\r
from typing import List\r
from urllib.parse import urlparse\r
\r
BASE_DIR = Path(__file__).resolve().parent\r
\r
# --- Target ---------------------------------------------------------------\r
_DEFAULT_NOTES_URL = "https://docs.zoom.us/notes?from=client"\r
NOTES_URL = os.environ.get("ZOOM_NOTES_URL", _DEFAULT_NOTES_URL)\r
\r
# Hostnames allowed for automated navigation (authenticated browser).\r
_DEFAULT_ALLOWED_HOSTS = ("docs.zoom.us",)\r
ALLOWED_HOSTS = tuple(\r
    h.strip().lower()\r
    for h in os.environ.get("ZOOM_ALLOWED_HOSTS", ",".join(_DEFAULT_ALLOWED_HOSTS)).split(",")\r
    if h.strip()\r
)\r
\r
# Substring that indicates we were bounced to a sign-in page (not logged in).\r
SIGNIN_URL_MARKERS = ("/signin", "zoom.us/signin", "/oauth", "/saml")\r
\r
# --- Filesystem -----------------------------------------------------------\r
STORAGE_STATE = BASE_DIR / "storage_state.json"\r
DATA_DIR = Path(os.environ.get("ZOOM_DATA_DIR", str(BASE_DIR / "data")))\r
# Transcript destination (may live outside the repo, e.g. an Obsidian vault).\r
# Override with ZOOM_TRANSCRIPTS_DIR. Index/backoff stay under DATA_DIR.\r
_DEFAULT_TRANSCRIPTS_DIR = str(BASE_DIR / "mynotes")\r
TRANSCRIPTS_DIR = Path(\r
    os.environ.get("ZOOM_TRANSCRIPTS_DIR", _DEFAULT_TRANSCRIPTS_DIR)\r
)\r
INDEX_FILE = DATA_DIR / "index.json"\r
LOGS_DIR = Path(os.environ.get("ZOOM_LOGS_DIR", str(BASE_DIR / "logs")))\r
DIAGNOSTICS_DIR = LOGS_DIR / "diagnostics"\r
LOCK_FILE = BASE_DIR / "sync.lock"\r
\r
# --- Browser --------------------------------------------------------------\r
# Use an installed, IT-approved browser instead of Playwright's bundled\r
# Chromium (which may be blocked by security policy). Valid channels:\r
# "msedge", "chrome", "chrome-beta", "msedge-beta", etc. Set to "" (empty)\r
# to fall back to Playwright's bundled Chromium (requires \`playwright install\`).\r
# Prefer real desktop browsers: Edge (Windows), Chrome (macOS), Chromium (Linux).\r
if os.name == "nt":\r
    _DEFAULT_CHANNEL = "msedge"\r
elif sys.platform == "darwin":\r
    _DEFAULT_CHANNEL = "chrome"\r
else:\r
    _DEFAULT_CHANNEL = ""\r
# Empty env var must fall through to default (os.environ.get("", default) returns "").\r
_raw_channel = os.environ.get("ZOOM_BROWSER_CHANNEL")\r
BROWSER_CHANNEL = _DEFAULT_CHANNEL if _raw_channel is None or _raw_channel.strip() == "" else _raw_channel.strip()\r
\r
\r
def _env_bool(name: str, default: bool) -> bool:\r
    raw = os.environ.get(name)\r
    if raw is None:\r
        return default\r
    return raw.strip().lower() in ("1", "true", "t", "yes", "y", "on")\r
\r
\r
def _env_int(name: str, default: int, *, minimum: int | None = None, maximum: int | None = None) -> int:\r
    raw = os.environ.get(name)\r
    if raw is None or raw.strip() == "":\r
        value = default\r
    else:\r
        try:\r
            value = int(raw.strip())\r
        except ValueError as exc:\r
            raise ValueError(f"{name} must be an integer, got {raw!r}") from exc\r
    if minimum is not None and value < minimum:\r
        raise ValueError(f"{name} must be >= {minimum}, got {value}")\r
    if maximum is not None and value > maximum:\r
        raise ValueError(f"{name} must be <= {maximum}, got {value}")\r
    return value\r
\r
\r
def launch_kwargs(headless: bool) -> dict:\r
    """Build chromium.launch kwargs, honoring the configured browser channel."""\r
    kwargs: dict = {"headless": headless}\r
    if BROWSER_CHANNEL:\r
        kwargs["channel"] = BROWSER_CHANNEL\r
    args = [\r
        "--disable-dev-shm-usage",\r
        "--no-default-browser-check",\r
        "--disable-blink-features=AutomationControlled",\r
    ]\r
    # macOS: avoid background throttling that stalls Zoom\u2019s SPA in automation.\r
    if sys.platform == "darwin":\r
        args.extend(\r
            [\r
                "--disable-background-timer-throttling",\r
                "--disable-backgrounding-occluded-windows",\r
                "--disable-renderer-backgrounding",\r
            ]\r
        )\r
    kwargs["args"] = args\r
    return kwargs\r
\r
\r
def new_context(browser, use_saved_state: bool = True):\r
    """Create a non-persistent context, loading the saved session if present.\r
\r
    Non-persistent contexts use a throwaway profile, avoiding the profile-lock\r
    problems that plague persistent contexts on Windows. The authenticated\r
    session is carried via STORAGE_STATE instead.\r
    """\r
    # Note: downloads_path is only valid on launch_persistent_context, not new_context.\r
    # File downloads are saved via page.expect_download() + download.save_as(...).\r
    kwargs: dict = {\r
        "accept_downloads": True,\r
        "viewport": {"width": 1400, "height": 900},\r
        "locale": "en-US",\r
        # Required for Zoom "Copy page content" \u2192 clipboard workflow.\r
        "permissions": ["clipboard-read", "clipboard-write"],\r
    }\r
    if use_saved_state and STORAGE_STATE.exists():\r
        kwargs["storage_state"] = str(STORAGE_STATE)\r
    ctx = browser.new_context(**kwargs)\r
    ctx.set_default_navigation_timeout(NAV_TIMEOUT_MS)\r
    ctx.set_default_timeout(ACTION_TIMEOUT_MS)\r
    try:\r
        ctx.grant_permissions(\r
            ["clipboard-read", "clipboard-write"],\r
            origin="https://docs.zoom.us",\r
        )\r
    except Exception:\r
        pass\r
    return ctx\r
\r
\r
def save_storage_state(context) -> None:\r
    """Atomically persist the browser storage state."""\r
    STORAGE_STATE.parent.mkdir(parents=True, exist_ok=True)\r
    tmp = STORAGE_STATE.with_suffix(STORAGE_STATE.suffix + ".tmp")\r
    bak = STORAGE_STATE.with_suffix(STORAGE_STATE.suffix + ".bak")\r
    context.storage_state(path=str(tmp))\r
    if STORAGE_STATE.exists():\r
        try:\r
            if bak.exists():\r
                bak.unlink()\r
            STORAGE_STATE.replace(bak)\r
        except OSError:\r
            pass\r
    tmp.replace(STORAGE_STATE)\r
\r
\r
def validate_notes_url(url: str = None) -> str:\r
    """Validate NOTES_URL is https and on an allowed Zoom host. Returns the URL."""\r
    candidate = (url if url is not None else NOTES_URL).strip()\r
    parsed = urlparse(candidate)\r
    if parsed.scheme.lower() != "https":\r
        raise ValueError(f"ZOOM_NOTES_URL must be https, got scheme={parsed.scheme!r}")\r
    host = (parsed.hostname or "").lower()\r
    if host not in ALLOWED_HOSTS:\r
        raise ValueError(\r
            f"ZOOM_NOTES_URL host {host!r} is not allowed; allowed={list(ALLOWED_HOSTS)}"\r
        )\r
    return candidate\r
\r
\r
def browser_process_names() -> List[str]:\r
    """Process image names used by the configured channel (for scoped cleanup)."""\r
    channel = (BROWSER_CHANNEL or "").lower()\r
    if os.name == "nt":\r
        if channel.startswith("msedge"):\r
            return ["msedge.exe"]\r
        if channel.startswith("chrome"):\r
            return ["chrome.exe"]\r
        return ["chrome.exe", "chromium.exe"]\r
    # macOS / Linux process names (for pgrep/pkill token cleanup)\r
    if channel.startswith("msedge") or channel.startswith("edge"):\r
        return ["Microsoft Edge", "msedge"]\r
    if channel.startswith("chrome"):\r
        return ["Google Chrome", "chrome"]\r
    return ["Chromium", "chrome", "chromium"]\r
\r
\r
# --- Behaviour ------------------------------------------------------------\r
# Run headless during scheduled syncs. Re-auth temporarily forces a headed\r
# window regardless of this value.\r
HEADLESS = _env_bool("ZOOM_HEADLESS", True)\r
\r
# Max note open/download attempts per run (work budget, not visibility ceiling).\r
MAX_ITEMS = _env_int("ZOOM_MAX_ITEMS", 25, minimum=1, maximum=500)\r
\r
# Stop scanning after this many consecutive already-known notes once the list\r
# end has been reached (or scroll produces no new rows).\r
STOP_AFTER_KNOWN = _env_int("ZOOM_STOP_AFTER_KNOWN", 3, minimum=1, maximum=100)\r
\r
# Max scroll steps while collecting/scanning the notes list.\r
MAX_SCROLL_STEPS = _env_int("ZOOM_MAX_SCROLL_STEPS", 30, minimum=0, maximum=200)\r
\r
# Timeouts (milliseconds).\r
NAV_TIMEOUT_MS = _env_int("ZOOM_NAV_TIMEOUT_MS", 45000, minimum=1000)\r
ACTION_TIMEOUT_MS = _env_int("ZOOM_ACTION_TIMEOUT_MS", 20000, minimum=1000)\r
DOWNLOAD_TIMEOUT_MS = _env_int("ZOOM_DOWNLOAD_TIMEOUT_MS", 60000, minimum=1000)\r
\r
# How long (seconds) to wait for the human to finish logging in during the\r
# interactive re-auth flow.\r
LOGIN_WAIT_SECONDS = _env_int("ZOOM_LOGIN_WAIT_SECONDS", 300, minimum=30, maximum=3600)\r
\r
# Treat a lock file older than this many minutes (by heartbeat) as stale.\r
LOCK_STALE_MINUTES = _env_int("ZOOM_LOCK_STALE_MINUTES", 25, minimum=1, maximum=240)\r
\r
# Log retention and privacy.\r
LOG_RETENTION_DAYS = _env_int("ZOOM_LOG_RETENTION_DAYS", 30, minimum=1, maximum=3650)\r
LOG_TITLES = _env_bool("ZOOM_LOG_TITLES", False)\r
APPLY_ACLS = _env_bool("ZOOM_APPLY_ACLS", True)\r
# New downloads only: omit title from filename (date prefix + id only; existing untouched).\r
PRIVACY_FILENAMES = _env_bool("ZOOM_PRIVACY_FILENAMES", False)\r
# Require opened-note title to match before downloading (hard fail on clear mismatch).\r
STRICT_OPEN_VERIFY = _env_bool("ZOOM_STRICT_OPEN_VERIFY", True)\r
# Run Playwright work in a child process so hung Edge can be killed as a tree.\r
WORKER_ISOLATION = _env_bool("ZOOM_WORKER_ISOLATION", True)\r
# Max seconds the parent waits for the browser worker (includes login wait headroom).\r
WORKER_TIMEOUT_SECONDS = _env_int("ZOOM_WORKER_TIMEOUT_SECONDS", 1200, minimum=60, maximum=7200)\r
\r
# Absent-transcript backoff schedule in hours (comma-separated).\r
_DEFAULT_BACKOFF_HOURS = "6,24,72,168"\r
\r
\r
def absent_backoff_hours() -> List[int]:\r
    raw = os.environ.get("ZOOM_ABSENT_BACKOFF_HOURS", _DEFAULT_BACKOFF_HOURS)\r
    hours: List[int] = []\r
    for part in raw.split(","):\r
        part = part.strip()\r
        if not part:\r
            continue\r
        value = int(part)\r
        if value < 1:\r
            raise ValueError("ZOOM_ABSENT_BACKOFF_HOURS values must be >= 1")\r
        hours.append(value)\r
    if not hours:\r
        hours = [6, 24, 72, 168]\r
    return hours\r
\r
\r
def ensure_dirs() -> None:\r
    """Create the runtime directories if they don't exist yet."""\r
    TRANSCRIPTS_DIR.mkdir(parents=True, exist_ok=True)\r
    LOGS_DIR.mkdir(parents=True, exist_ok=True)\r
    DIAGNOSTICS_DIR.mkdir(parents=True, exist_ok=True)\r
\r
\r
def redact_url(url: str) -> str:\r
    """Strip query string and fragment from a URL for safe logging."""\r
    if not url:\r
        return ""\r
    try:\r
        parsed = urlparse(url)\r
        host = parsed.netloc or ""\r
        path = parsed.path or ""\r
        return f"{parsed.scheme}://{host}{path}" if parsed.scheme else f"{host}{path}"\r
    except Exception:\r
        return re.sub(r"[?#].*$", "", url)\r
\r
\r
def note_label(note_id: str, title: str = "") -> str:\r
    """Human-readable log label; titles are opt-in via ZOOM_LOG_TITLES."""\r
    if LOG_TITLES and title:\r
        return f"{note_id} ({title})"\r
    return note_id\r
\r
\r
def validate_config() -> None:\r
    """Validate configuration early; raise ValueError on bad values."""\r
    validate_notes_url(NOTES_URL)\r
    # Touch validated ints already parsed at import; re-check backoff.\r
    absent_backoff_hours()\r
    if not ALLOWED_HOSTS:\r
        raise ValueError("ZOOM_ALLOWED_HOSTS must list at least one host")\r
\r
\r
def prune_old_logs(directory: Path = None, retention_days: int = None) -> int:\r
    """Delete dated log files older than retention. Returns number removed."""\r
    import time\r
\r
    directory = directory or LOGS_DIR\r
    retention_days = LOG_RETENTION_DAYS if retention_days is None else retention_days\r
    if not directory.exists():\r
        return 0\r
    cutoff = time.time() - (retention_days * 86400)\r
    removed = 0\r
    patterns = ("sync-*.log", "run-*.log")\r
    for pattern in patterns:\r
        for path in directory.glob(pattern):\r
            try:\r
                if path.is_file() and path.stat().st_mtime < cutoff:\r
                    path.unlink(missing_ok=True)\r
                    removed += 1\r
            except OSError:\r
                continue\r
    # Cap diagnostics to newest 20 files.\r
    try:\r
        diags = sorted(\r
            DIAGNOSTICS_DIR.glob("*"),\r
            key=lambda p: p.stat().st_mtime if p.exists() else 0,\r
            reverse=True,\r
        )\r
        for stale in diags[20:]:\r
            try:\r
                stale.unlink(missing_ok=True)\r
            except OSError:\r
                pass\r
    except OSError:\r
        pass\r
    return removed\r
`,
  "zoom_notes.py": `"""Playwright page helpers for the Zoom Notes (docs.zoom.us/notes) UI.\r
\r
Workflow:\r
  1. Open My Notes list at docs.zoom.us/notes\r
  2. Open each note\r
  3. Top-right \u22EE menu \u2192 "Copy page content" (the note summary)\r
  4. Top-right \u22EE menu \u2192 "Download transcript" (the raw transcript, when available)\r
  5. Save one .md file: summary on top, raw transcript appended at the bottom\r
\r
Selectors are centralized and role/text based where possible.\r
"""\r
\r
from __future__ import annotations\r
\r
import hashlib\r
import re\r
import uuid\r
from dataclasses import dataclass\r
from enum import Enum\r
from pathlib import Path\r
from typing import List, Optional, Sequence, Set\r
from urllib.parse import urlparse\r
\r
from playwright.sync_api import (\r
    Error as PWError,\r
    Locator,\r
    Page,\r
    TimeoutError as PWTimeoutError,\r
)\r
\r
import config\r
\r
# --- Tunable selectors ----------------------------------------------------\r
SELECTORS = {\r
    "app_ready": [\r
        'text=My Notes',\r
        'button:has-text("Import")',\r
        'text=Shared folders',\r
    ],\r
    "notes_pane_hints": [\r
        'text=My Notes',\r
    ],\r
    "note_items": [\r
        '[role="listitem"]',\r
        '[data-testid="note-list-item"]',\r
    ],\r
    "kebab": [\r
        'button[aria-label="More"]',\r
        'button[aria-label*="More" i]',\r
        'button[aria-label*="more" i]',\r
        'button[aria-label*="options" i]',\r
        'button[aria-label*="Page options" i]',\r
        'button[aria-haspopup="menu"]',\r
        'button[data-testid*="more" i]',\r
        'button[data-testid*="menu" i]',\r
    ],\r
    "copy_page_content": [\r
        '[role="menuitem"]:has-text("Copy page content")',\r
        '[role="menuitem"]:has-text("Copy Page Content")',\r
        'text="Copy page content"',\r
        'text=/copy\\\\s+page\\\\s+content/i',\r
        'button:has-text("Copy page content")',\r
    ],\r
    "download_transcript": [\r
        '[role="menuitem"]:has-text("Download transcript")',\r
        '[role="menuitem"]:has-text("Download Transcript")',\r
        'text="Download transcript"',\r
        'text=/download\\\\s+transcript/i',\r
        'button:has-text("Download transcript")',\r
    ],\r
    "transcript_tab": [\r
        '[role="tab"]:has-text("Transcript")',\r
        'button:has-text("Transcript")',\r
        'text=Transcript',\r
    ],\r
    "opened_title": [\r
        '[data-testid="note-title"]',\r
        '[class*="note-title" i]',\r
        'main h1',\r
        '[role="main"] h1',\r
        'h1',\r
    ],\r
}\r
\r
# Sidebar / chrome labels that must never be treated as meeting notes.\r
NAV_DENYLIST = {\r
    "home",\r
    "search",\r
    "help me write",\r
    "starred",\r
    "notifications",\r
    "my docs",\r
    "my notes",\r
    "meetings",\r
    "shared folders",\r
    "import",\r
    "shared with me",\r
    "trash",\r
    "settings",\r
}\r
\r
# Opened-view chrome that is NOT the meeting title (strict verify must ignore these).\r
OPENED_TITLE_DENYLIST = {\r
    "page options",\r
    "more",\r
    "more options",\r
    "options",\r
    "download transcript",\r
    "manual notes",\r
    "transcript",\r
    "workflow",\r
    "share",\r
    "import",\r
    "my notes",\r
}\r
\r
_ID_FROM_URL = re.compile(\r
    r"/notes/([A-Za-z0-9_\\-]{6,})|[?&](?:doc|docId|noteId|id)=([A-Za-z0-9_\\-]{6,})"\r
)\r
\r
\r
class DownloadOutcome(str, Enum):\r
    DOWNLOADED = "downloaded"\r
    ABSENT = "absent"\r
    RETRYABLE = "retryable"\r
    SELECTOR_BROKEN = "selector_broken"\r
\r
\r
@dataclass\r
class DownloadResult:\r
    outcome: DownloadOutcome\r
    path: Optional[Path] = None\r
    size: int = 0\r
    sha256: str = ""\r
    error: str = ""\r
    has_transcript: bool = False\r
\r
\r
class OpenMismatchError(RuntimeError):\r
    """Opened note title does not match the intended list row."""\r
\r
\r
@dataclass\r
class NoteRef:\r
    index: int\r
    title: str\r
    host: str = ""\r
    date: str = ""\r
    note_id: str = ""\r
    url: str = ""\r
    raw_text: str = ""\r
\r
    def stable_id(self) -> str:\r
        """Stable dedup key: prefer real note id, else hash of metadata."""\r
        if self.note_id:\r
            return self.note_id\r
        seed = f"{self.title}|{self.host}|{self.date}".encode("utf-8")\r
        return "h_" + hashlib.sha1(seed).hexdigest()[:16]\r
\r
    def metadata_id(self) -> str:\r
        seed = f"{self.title}|{self.host}|{self.date}".encode("utf-8")\r
        return "h_" + hashlib.sha1(seed).hexdigest()[:16]\r
\r
\r
def _first_usable(page: Page, candidates: Sequence[str], *, root: Locator = None) -> Optional[Locator]:\r
    base = root if root is not None else page\r
    for sel in candidates:\r
        try:\r
            loc = base.locator(sel)\r
            count = loc.count()\r
        except PWError:\r
            continue\r
        for i in range(min(count, 25)):\r
            item = loc.nth(i)\r
            try:\r
                if item.is_visible():\r
                    return item\r
            except PWError:\r
                continue\r
        # Fall back to first match even if visibility check failed.\r
        try:\r
            if count > 0:\r
                return loc.first\r
        except PWError:\r
            continue\r
    return None\r
\r
\r
def _all_visible(page: Page, candidates: Sequence[str], *, root: Locator = None) -> List[Locator]:\r
    base = root if root is not None else page\r
    for sel in candidates:\r
        try:\r
            loc = base.locator(sel)\r
            count = loc.count()\r
        except PWError:\r
            continue\r
        if count <= 0:\r
            continue\r
        items: List[Locator] = []\r
        for i in range(count):\r
            item = loc.nth(i)\r
            try:\r
                if item.is_visible():\r
                    items.append(item)\r
            except PWError:\r
                continue\r
        if items:\r
            return items\r
    return []\r
\r
\r
def is_logged_in(page: Page) -> bool:\r
    """DOM-first auth check against the notes app shell."""\r
    for sel in SELECTORS["app_ready"]:\r
        try:\r
            loc = page.locator(sel)\r
            if loc.count() > 0 and loc.first.is_visible():\r
                return True\r
        except PWError:\r
            continue\r
\r
    url = (page.url or "").lower()\r
    if any(marker in url for marker in config.SIGNIN_URL_MARKERS):\r
        return False\r
    try:\r
        host = (urlparse(page.url or "").hostname or "").lower()\r
    except Exception:\r
        host = ""\r
    if host in config.ALLOWED_HOSTS and "/notes" in url:\r
        # URL alone is weak; require at least one app_ready attempt already failed.\r
        return False\r
    return False\r
\r
\r
def _note_id_from_url(url: str) -> str:\r
    m = _ID_FROM_URL.search(url or "")\r
    if not m:\r
        return ""\r
    return m.group(1) or m.group(2) or ""\r
\r
\r
def _clean(text: str) -> str:\r
    return re.sub(r"\\s+", " ", (text or "")).strip()\r
\r
\r
def _is_nav_title(title: str) -> bool:\r
    return _clean(title).lower() in NAV_DENYLIST\r
\r
\r
def _looks_like_note_row(title: str, host: str, date: str, lines: Sequence[str]) -> bool:\r
    if _is_nav_title(title):\r
        return False\r
    if host:\r
        return True\r
    if date and len(lines) >= 2:\r
        return True\r
    # Single-line chrome labels are not notes.\r
    if len(lines) <= 1:\r
        return False\r
    return True\r
\r
\r
def wait_for_notes(page: Page, timeout_ms: int = None) -> bool:\r
    """Wait until note rows render. Returns False on timeout."""\r
    timeout_ms = timeout_ms or config.ACTION_TIMEOUT_MS\r
    for sel in SELECTORS["note_items"]:\r
        try:\r
            page.wait_for_selector(sel, timeout=timeout_ms, state="visible")\r
            return True\r
        except (PWTimeoutError, PWError):\r
            continue\r
    return False\r
\r
\r
def _parse_row_text(raw: str) -> tuple[str, str, str, List[str]]:\r
    lines = [ln.strip() for ln in (raw or "").splitlines() if ln.strip()]\r
    if not lines:\r
        return "", "", "", []\r
    title = lines[0][:200]\r
    date = ""\r
    host = ""\r
    for ln in lines[1:]:\r
        if ln.lower().startswith("host:"):\r
            host = ln.split(":", 1)[1].strip()\r
        elif not date:\r
            date = ln\r
    return title, host, date, lines\r
\r
\r
def list_notes(page: Page, max_items: int) -> List[NoteRef]:\r
    """Return up to max_items meeting notes from the list (newest-first)."""\r
    wait_for_notes(page)\r
    items = _all_visible(page, SELECTORS["note_items"])\r
    notes: List[NoteRef] = []\r
    if not items:\r
        return notes\r
\r
    for i, row in enumerate(items):\r
        if len(notes) >= max_items:\r
            break\r
        try:\r
            raw = row.inner_text(timeout=config.ACTION_TIMEOUT_MS)\r
        except PWTimeoutError:\r
            continue\r
        title, host, date, lines = _parse_row_text(raw)\r
        if not title:\r
            continue\r
        if not _looks_like_note_row(title, host, date, lines):\r
            continue\r
        notes.append(\r
            NoteRef(\r
                index=i,\r
                title=title,\r
                host=host,\r
                date=date,\r
                raw_text=raw,\r
            )\r
        )\r
    return notes\r
\r
\r
def scroll_notes_list(page: Page) -> bool:\r
    """Scroll the notes list to load more rows. Returns True if scroll ran."""\r
    items = _all_visible(page, SELECTORS["note_items"])\r
    if not items:\r
        return False\r
    try:\r
        items[-1].scroll_into_view_if_needed(timeout=config.ACTION_TIMEOUT_MS)\r
        page.wait_for_timeout(800)\r
        page.mouse.wheel(0, 1200)\r
        page.wait_for_timeout(800)\r
        return True\r
    except PWError:\r
        return False\r
\r
\r
def collect_notes(page: Page, max_items: int, max_scroll_steps: int = None) -> List[NoteRef]:\r
    """Collect notes with limited scrolling (dedupe by metadata id)."""\r
    max_scroll_steps = config.MAX_SCROLL_STEPS if max_scroll_steps is None else max_scroll_steps\r
    seen: Set[str] = set()\r
    collected: List[NoteRef] = []\r
    stagnant = 0\r
\r
    for step in range(max_scroll_steps + 1):\r
        batch = list_notes(page, max_items=max(max_items * 3, 50))\r
        grew = 0\r
        for note in batch:\r
            mid = note.metadata_id()\r
            if mid in seen:\r
                continue\r
            seen.add(mid)\r
            collected.append(note)\r
            grew += 1\r
            if len(collected) >= max_items * 3:\r
                break\r
        if len(collected) >= max_items and grew == 0:\r
            stagnant += 1\r
        else:\r
            stagnant = 0 if grew else stagnant + 1\r
        if stagnant >= 2:\r
            break\r
        if step >= max_scroll_steps:\r
            break\r
        if not scroll_notes_list(page):\r
            break\r
    return collected[: max(max_items * 3, len(collected))]\r
\r
\r
def _normalize(s: str) -> str:\r
    return re.sub(r"\\s+", " ", (s or "")).strip().lower()\r
\r
\r
def open_note(page: Page, note: NoteRef) -> None:\r
    """Click the note row matching metadata and verify the note view loaded."""\r
    items = _all_visible(page, SELECTORS["note_items"])\r
    if not items:\r
        raise RuntimeError("Note list disappeared before opening a note")\r
\r
    target: Optional[Locator] = None\r
    # Prefer exact raw-text / title match over stale positional index.\r
    want_title = _normalize(note.title)\r
    for row in items:\r
        try:\r
            raw = row.inner_text(timeout=3000)\r
        except PWError:\r
            continue\r
        title, host, date, _lines = _parse_row_text(raw)\r
        if _normalize(title) == want_title:\r
            if note.host and host and _normalize(host) != _normalize(note.host):\r
                continue\r
            target = row\r
            break\r
    if target is None and 0 <= note.index < len(items):\r
        target = items[note.index]\r
    if target is None:\r
        raise RuntimeError(f"Could not locate note row for {note.title!r}")\r
\r
    target.click(timeout=config.ACTION_TIMEOUT_MS)\r
    # Client-side view swap; wait for note body/title (not just shell chrome).\r
    page.wait_for_timeout(2500)\r
    _wait_opened(page, note)\r
    note.url = page.url\r
    note.note_id = _note_id_from_url(page.url)\r
\r
\r
def _titles_compatible(want: str, shown: str) -> bool:\r
    """True if opened title reasonably matches the list-row title."""\r
    w = _normalize(want)\r
    s = _normalize(shown)\r
    if not w or not s:\r
        return True  # cannot verify\r
    if w == s:\r
        return True\r
    # UI may truncate, append date, or include extra whitespace/punctuation.\r
    w40, s40 = w[:40], s[:40]\r
    if w40 and (w40 in s or s40 in w):\r
        return True\r
    # Token overlap: at least half of significant tokens from want appear in shown.\r
    w_tokens = [t for t in re.split(r"[^a-z0-9]+", w) if len(t) > 2]\r
    if not w_tokens:\r
        return True\r
    hits = sum(1 for t in w_tokens if t in s)\r
    return hits >= max(1, (len(w_tokens) + 1) // 2)\r
\r
\r
def _is_chrome_title(text: str) -> bool:\r
    t = _normalize(text)\r
    if not t:\r
        return True\r
    if t in OPENED_TITLE_DENYLIST or t in NAV_DENYLIST:\r
        return True\r
    # Very short generic labels are almost never meeting titles.\r
    if len(t) < 4:\r
        return True\r
    return False\r
\r
\r
def _read_opened_title(page: Page) -> str:\r
    """Return the best candidate meeting title from the opened note view."""\r
    for sel in SELECTORS["opened_title"]:\r
        try:\r
            loc = page.locator(sel)\r
            count = min(loc.count(), 10)\r
        except PWError:\r
            continue\r
        for i in range(count):\r
            try:\r
                item = loc.nth(i)\r
                if not item.is_visible():\r
                    continue\r
                text = _clean(item.inner_text(timeout=1500))\r
            except PWError:\r
                continue\r
            if _is_chrome_title(text):\r
                continue\r
            return text\r
    return ""\r
\r
\r
def _page_shows_title(page: Page, title: str) -> bool:\r
    """True if the expected meeting title is visible somewhere on the page."""\r
    want = _clean(title)\r
    if not want:\r
        return False\r
    # Try progressively shorter prefixes (UI may truncate).\r
    candidates = [want, want[:80], want[:60], want[:40]]\r
    seen = set()\r
    for c in candidates:\r
        c = c.strip()\r
        if len(c) < 12 or c in seen:\r
            continue\r
        seen.add(c)\r
        try:\r
            loc = page.get_by_text(c, exact=False)\r
            n = min(loc.count(), 8)\r
            for i in range(n):\r
                try:\r
                    if loc.nth(i).is_visible():\r
                        return True\r
                except PWError:\r
                    continue\r
        except PWError:\r
            continue\r
    return False\r
\r
\r
def _wait_opened(page: Page, note: NoteRef) -> None:\r
    """Verify the note chrome rendered; hard-fail on clear title mismatch when enabled."""\r
    # Note body/title often paints after the shell; give it a moment.\r
    page.wait_for_timeout(800)\r
\r
    # Strongest signal: expected title text is visible (matches live Zoom layout).\r
    if _page_shows_title(page, note.title):\r
        return\r
\r
    kebab = _first_usable(page, SELECTORS["kebab"])\r
    if kebab is None:\r
        page.wait_for_timeout(1200)\r
        kebab = _first_usable(page, SELECTORS["kebab"])\r
        if _page_shows_title(page, note.title):\r
            return\r
\r
    shown = _read_opened_title(page)\r
\r
    # Only enforce mismatch when we found a real title candidate (not UI chrome).\r
    if shown and not _is_chrome_title(shown) and not _titles_compatible(note.title, shown):\r
        if config.STRICT_OPEN_VERIFY:\r
            raise OpenMismatchError(\r
                f"opened title {shown!r} does not match expected {note.title!r}"\r
            )\r
\r
    if kebab is None and not shown and not _page_shows_title(page, note.title):\r
        # Still proceed; copy-page-content will report selector issues.\r
        page.wait_for_timeout(500)\r
\r
\r
def _menu_item_labels(page: Page) -> List[str]:\r
    """Collect visible menu/list item labels for diagnostics."""\r
    labels: List[str] = []\r
    try:\r
        loc = page.get_by_role("menuitem")\r
        count = min(loc.count(), 40)\r
        for i in range(count):\r
            try:\r
                item = loc.nth(i)\r
                if not item.is_visible():\r
                    continue\r
                text = _clean(item.inner_text(timeout=500))\r
            except PWError:\r
                continue\r
            if text and text not in labels and len(text) < 120:\r
                labels.append(text)\r
    except PWError:\r
        pass\r
    return labels\r
\r
\r
def _click_timeout_ms() -> int:\r
    return min(5000, int(config.ACTION_TIMEOUT_MS))\r
\r
\r
def _safe_click(locator: Locator, *, timeout_ms: int = None) -> Optional[str]:\r
    """Click a locator; return None on success or an error string."""\r
    timeout_ms = timeout_ms if timeout_ms is not None else _click_timeout_ms()\r
    try:\r
        locator.scroll_into_view_if_needed(timeout=timeout_ms)\r
    except PWError:\r
        pass\r
    try:\r
        locator.click(timeout=timeout_ms, force=False)\r
        return None\r
    except PWError:\r
        pass\r
    try:\r
        locator.click(timeout=timeout_ms, force=True)\r
        return None\r
    except PWError as exc:\r
        return str(exc)[:240]\r
\r
\r
def _menuitem_by_name(page: Page, pattern: re.Pattern[str]) -> Optional[Locator]:\r
    """Return a stable role=menuitem locator matched by accessible name."""\r
    try:\r
        loc = page.get_by_role("menuitem", name=pattern)\r
        if loc.count() <= 0:\r
            return None\r
        first = loc.first\r
        if first.is_visible():\r
            return first\r
    except PWError:\r
        return None\r
    return None\r
\r
\r
def _all_kebabs(page: Page) -> List[Locator]:\r
    """Return distinct visible \u22EE / More buttons; top-right preferred."""\r
    found: List[Locator] = []\r
    seen: Set[str] = set()\r
    for sel in SELECTORS["kebab"]:\r
        try:\r
            loc = page.locator(sel)\r
            count = min(loc.count(), 12)\r
        except PWError:\r
            continue\r
        for i in range(count):\r
            try:\r
                item = loc.nth(i)\r
                if not item.is_visible():\r
                    continue\r
                box = item.bounding_box()\r
                key = (\r
                    f"{int(box['x'])}:{int(box['y'])}"\r
                    if box\r
                    else f"{sel}:{i}"\r
                )\r
            except PWError:\r
                continue\r
            if key in seen:\r
                continue\r
            seen.add(key)\r
            found.append(item)\r
\r
    def _sort_key(el: Locator) -> tuple:\r
        # Prefer upper-right chrome (page options), not sidebar.\r
        try:\r
            box = el.bounding_box() or {"x": 0, "y": 9999}\r
            return (float(box.get("y", 9999)), -float(box.get("x", 0)))\r
        except PWError:\r
            return (9999.0, 0.0)\r
\r
    found.sort(key=_sort_key)\r
    return found\r
\r
\r
def _write_text_download(dest: Path, text: str) -> DownloadResult:\r
    body = (text or "").strip()\r
    if len(body) < 20:\r
        return DownloadResult(DownloadOutcome.ABSENT, error="copied page content too short")\r
    dest.parent.mkdir(parents=True, exist_ok=True)\r
    part = dest.with_suffix(dest.suffix + ".part")\r
    data = (body + "\\n").encode("utf-8")\r
    part.write_bytes(data)\r
    digest = hashlib.sha256(data).hexdigest()\r
    part.replace(dest)\r
    return DownloadResult(\r
        DownloadOutcome.DOWNLOADED,\r
        path=dest,\r
        size=len(data),\r
        sha256=digest,\r
    )\r
\r
\r
def _clear_clipboard(page: Page) -> None:\r
    try:\r
        page.evaluate(\r
            """async () => {\r
                try { await navigator.clipboard.writeText(''); } catch (e) {}\r
            }"""\r
        )\r
    except PWError:\r
        pass\r
\r
\r
def _read_clipboard(page: Page) -> str:\r
    """Read text from the system clipboard via the page context."""\r
    try:\r
        text = page.evaluate(\r
            """async () => {\r
                try {\r
                    return await navigator.clipboard.readText();\r
                } catch (e) {\r
                    return '';\r
                }\r
            }"""\r
        )\r
        if isinstance(text, str) and text.strip():\r
            return text\r
    except PWError:\r
        pass\r
    return ""\r
\r
\r
def _find_copy_page_content_item(page: Page) -> Optional[Locator]:\r
    """Locate the Zoom 'Copy page content' menu item."""\r
    patterns = (\r
        re.compile(r"copy\\s+page\\s+content", re.I),\r
        re.compile(r"copy\\s+content", re.I),\r
        re.compile(r"copy\\s+page", re.I),\r
    )\r
    for pat in patterns:\r
        item = _menuitem_by_name(page, pat)\r
        if item is not None:\r
            return item\r
    item = _first_usable(page, SELECTORS["copy_page_content"])\r
    if item is not None:\r
        return item\r
    # Last resort: any visible control whose text matches.\r
    try:\r
        loc = page.get_by_text(re.compile(r"copy\\s+page\\s+content", re.I))\r
        if loc.count() > 0 and loc.first.is_visible():\r
            return loc.first\r
    except PWError:\r
        pass\r
    return None\r
\r
\r
def _capture_summary_text(page: Page) -> tuple[str, str, str]:\r
    """\u22EE \u2192 Copy page content \u2192 clipboard.\r
\r
    Returns (text, status, detail). status is one of:\r
      "ok"              text captured\r
      "selector_broken" page options (\u22EE) never found\r
      "retryable"       menu/clipboard failed after retries\r
    """\r
    try:\r
        page.context.grant_permissions(\r
            ["clipboard-read", "clipboard-write"],\r
            origin="https://docs.zoom.us",\r
        )\r
    except Exception:\r
        pass\r
\r
    kebabs = _all_kebabs(page)\r
    if not kebabs:\r
        return "", "selector_broken", "page options (\u22EE) not found"\r
\r
    menu_labels_seen: List[str] = []\r
    last_error = "Copy page content menu item missing"\r
\r
    for kebab in kebabs[:6]:\r
        _dismiss_menu(page)\r
        _clear_clipboard(page)\r
\r
        err = _safe_click(kebab)\r
        if err:\r
            last_error = f"\u22EE click failed: {err}"\r
            continue\r
\r
        page.wait_for_timeout(700)\r
        for lab in _menu_item_labels(page):\r
            if lab not in menu_labels_seen:\r
                menu_labels_seen.append(lab)\r
\r
        target = _find_copy_page_content_item(page)\r
        if target is None:\r
            last_error = "Copy page content menu item missing"\r
            _dismiss_menu(page)\r
            continue\r
\r
        click_err = _safe_click(target, timeout_ms=4000)\r
        if click_err:\r
            last_error = f"Copy page content click failed: {click_err}"\r
            _dismiss_menu(page)\r
            continue\r
\r
        # Clipboard write is async after the menu action.\r
        text = ""\r
        for _ in range(10):\r
            page.wait_for_timeout(250)\r
            text = _read_clipboard(page)\r
            if text.strip():\r
                break\r
\r
        _dismiss_menu(page)\r
\r
        if not text.strip():\r
            last_error = "clipboard empty after Copy page content"\r
            continue\r
\r
        return text, "ok", ""\r
\r
    detail = last_error\r
    if menu_labels_seen:\r
        detail = f"{last_error}; menu items: [{', '.join(menu_labels_seen[:12])}]"\r
    return "", "retryable", detail\r
\r
\r
def _is_disabled(locator: Locator) -> bool:\r
    """True if a menu item is present but disabled/greyed out."""\r
    try:\r
        aria = locator.get_attribute("aria-disabled")\r
        if aria and aria.strip().lower() in ("true", "1"):\r
            return True\r
    except PWError:\r
        pass\r
    try:\r
        if locator.get_attribute("disabled") is not None:\r
            return True\r
    except PWError:\r
        pass\r
    try:\r
        if not locator.is_enabled():\r
            return True\r
    except PWError:\r
        pass\r
    return False\r
\r
\r
def _find_download_transcript_item(page: Page) -> Optional[Locator]:\r
    """Locate the Zoom 'Download transcript' menu item."""\r
    item = _menuitem_by_name(page, re.compile(r"download\\s+transcript", re.I))\r
    if item is not None:\r
        return item\r
    return _first_usable(page, SELECTORS["download_transcript"])\r
\r
\r
def _capture_raw_transcript(page: Page) -> tuple[str, str, str]:\r
    """\u22EE \u2192 Download transcript \u2192 captured download file text.\r
\r
    Returns (text, status, detail). status is one of:\r
      "ok"        transcript text captured\r
      "absent"    the menu item is missing or greyed out (no transcript)\r
      "retryable" the item was present but the download failed\r
    """\r
    kebabs = _all_kebabs(page)\r
    if not kebabs:\r
        return "", "absent", "page options (\u22EE) not found"\r
\r
    last_error = "Download transcript menu item missing"\r
    saw_item = False\r
\r
    for kebab in kebabs[:6]:\r
        _dismiss_menu(page)\r
\r
        err = _safe_click(kebab)\r
        if err:\r
            last_error = f"\u22EE click failed: {err}"\r
            continue\r
\r
        page.wait_for_timeout(700)\r
        target = _find_download_transcript_item(page)\r
        if target is None:\r
            last_error = "Download transcript menu item missing"\r
            _dismiss_menu(page)\r
            continue\r
\r
        saw_item = True\r
        if _is_disabled(target):\r
            last_error = "Download transcript disabled (no transcript for this note)"\r
            _dismiss_menu(page)\r
            return "", "absent", last_error\r
\r
        text = ""\r
        try:\r
            with page.expect_download(timeout=config.DOWNLOAD_TIMEOUT_MS) as dl_info:\r
                click_err = _safe_click(target, timeout_ms=4000)\r
                if click_err:\r
                    raise PWError(click_err)\r
            download = dl_info.value\r
            tmp = config.DATA_DIR / f".transcript-{uuid.uuid4().hex}.tmp"\r
            tmp.parent.mkdir(parents=True, exist_ok=True)\r
            download.save_as(str(tmp))\r
            try:\r
                text = tmp.read_text(encoding="utf-8", errors="replace")\r
            finally:\r
                try:\r
                    tmp.unlink()\r
                except OSError:\r
                    pass\r
        except (PWTimeoutError, PWError) as exc:\r
            last_error = f"Download transcript failed: {str(exc)[:200]}"\r
            _dismiss_menu(page)\r
            continue\r
\r
        _dismiss_menu(page)\r
        if text.strip():\r
            return text, "ok", ""\r
        last_error = "downloaded transcript was empty"\r
\r
    status = "retryable" if saw_item else "absent"\r
    return "", status, last_error\r
\r
\r
def _compose_markdown(summary: str, transcript: str) -> str:\r
    """Summary on top; raw transcript appended under a heading when present."""\r
    body = (summary or "").strip()\r
    tx = (transcript or "").strip()\r
    if tx:\r
        body = f"{body}\\n\\n---\\n\\n## Raw transcript\\n\\n{tx}"\r
    return body\r
\r
\r
def _extract_transcript_from_page(page: Page) -> str:\r
    """Fallback: scrape main note body if clipboard copy fails."""\r
    container_sels = [\r
        "article",\r
        '[role="article"]',\r
        "main",\r
        '[role="main"]',\r
        '[contenteditable="true"]',\r
    ]\r
    best = ""\r
    for sel in container_sels:\r
        try:\r
            loc = page.locator(sel)\r
            count = min(loc.count(), 8)\r
        except PWError:\r
            continue\r
        for i in range(count):\r
            try:\r
                item = loc.nth(i)\r
                if not item.is_visible():\r
                    continue\r
                text = (item.inner_text(timeout=2500) or "").strip()\r
            except PWError:\r
                continue\r
            if len(text) > len(best):\r
                best = text\r
        if len(best) > 400:\r
            break\r
    return best\r
\r
\r
def download_transcript(page: Page, dest: Path) -> DownloadResult:\r
    """Capture a note as one .md: summary (Copy page content) + raw transcript.\r
\r
    Kept name for sync.py compatibility. The summary is captured first, then the\r
    raw transcript via the 'Download transcript' menu item (when available) is\r
    appended at the bottom under a heading.\r
    """\r
    summary, s_status, s_detail = _capture_summary_text(page)\r
\r
    if not summary.strip():\r
        # Fallback scrape of the open note body.\r
        scraped = _extract_transcript_from_page(page)\r
        if scraped and len(scraped.strip()) >= 40:\r
            summary = scraped\r
            s_status = "ok"\r
\r
    if not summary.strip():\r
        save_diagnostics(page, f"copy-fail-{dest.stem[:40]}")\r
        outcome = (\r
            DownloadOutcome.SELECTOR_BROKEN\r
            if s_status == "selector_broken"\r
            else DownloadOutcome.RETRYABLE\r
        )\r
        return DownloadResult(outcome, error=s_detail or "summary capture failed")\r
\r
    transcript, t_status, _t_detail = _capture_raw_transcript(page)\r
\r
    body = _compose_markdown(summary, transcript)\r
    result = _write_text_download(dest, body)\r
    result.has_transcript = bool(transcript.strip()) and t_status == "ok"\r
    return result\r
\r
\r
def _dismiss_menu(page: Page) -> None:\r
    try:\r
        page.keyboard.press("Escape")\r
        page.wait_for_timeout(300)\r
        # Second escape helps nested overlays.\r
        page.keyboard.press("Escape")\r
        page.wait_for_timeout(200)\r
    except PWError:\r
        pass\r
\r
\r
def save_diagnostics(page: Page, label: str) -> Optional[Path]:\r
    """Best-effort screenshot for selector failures."""\r
    try:\r
        config.DIAGNOSTICS_DIR.mkdir(parents=True, exist_ok=True)\r
        safe = re.sub(r"[^A-Za-z0-9._-]+", "_", label)[:60] or "diag"\r
        path = config.DIAGNOSTICS_DIR / f"{safe}.png"\r
        page.screenshot(path=str(path), full_page=False)\r
        return path\r
    except Exception:\r
        return None\r
`,
  "index_store.py": `"""Persistent index of downloaded transcripts, used for deduplication.\r
\r
The index is a single JSON file mapping a stable note id to a record. Both\r
successfully downloaded notes and notes that have no transcript are recorded.\r
Absent transcripts use a backoff schedule so they are rechecked later.\r
\r
Schema is additive: existing v1 records (no version field) remain readable.\r
Corrupt indexes are quarantined and never silently replaced with an empty file.\r
"""\r
\r
from __future__ import annotations\r
\r
import json\r
import shutil\r
from dataclasses import dataclass, field\r
from datetime import datetime, timedelta, timezone\r
from pathlib import Path\r
from typing import Any, Dict, Iterable, List, Optional, Sequence\r
\r
STATUS_DOWNLOADED = "downloaded"\r
STATUS_NO_TRANSCRIPT = "no_transcript"\r
STATUS_MISSING_FILE = "missing_file"\r
STATUS_RETRYABLE = "retryable"\r
\r
INDEX_VERSION = 2\r
\r
# Bumped whenever the saved note layout changes. Downloaded records below this\r
# are re-queued once so they are regenerated with the newest layout (e.g. the\r
# raw transcript appended at the bottom).\r
CONTENT_VERSION = 2\r
\r
\r
class IndexCorruptError(Exception):\r
    """Raised when the on-disk index cannot be loaded safely."""\r
\r
\r
def _now() -> datetime:\r
    return datetime.now(timezone.utc).astimezone()\r
\r
\r
def _now_iso() -> str:\r
    return _now().isoformat(timespec="seconds")\r
\r
\r
def _parse_iso(value: str) -> Optional[datetime]:\r
    if not value:\r
        return None\r
    try:\r
        return datetime.fromisoformat(value)\r
    except ValueError:\r
        return None\r
\r
\r
@dataclass\r
class IndexStore:\r
    path: Path\r
    _data: Dict[str, Any] = field(default_factory=dict)\r
    backoff_hours: Sequence[int] = field(default_factory=lambda: (6, 24, 72, 168))\r
\r
    def __post_init__(self) -> None:\r
        if not self._data:\r
            self._data = self._empty()\r
\r
    @staticmethod\r
    def _empty() -> Dict[str, Any]:\r
        return {\r
            "version": INDEX_VERSION,\r
            "transcripts": {},\r
            "scan": {},\r
            "meta": {},\r
        }\r
\r
    @classmethod\r
    def load(cls, path: Path, *, backoff_hours: Sequence[int] = (6, 24, 72, 168)) -> "IndexStore":\r
        store = cls(path=path, backoff_hours=tuple(backoff_hours))\r
        if not path.exists():\r
            return store\r
        try:\r
            raw = path.read_text(encoding="utf-8")\r
            loaded = json.loads(raw)\r
        except (json.JSONDecodeError, OSError, UnicodeError) as exc:\r
            quarantine = path.with_name(\r
                f"{path.name}.corrupt-{_now().strftime('%Y%m%d%H%M%S')}"\r
            )\r
            try:\r
                shutil.copy2(path, quarantine)\r
            except OSError:\r
                quarantine = None\r
            detail = f"quarantined to {quarantine}" if quarantine else "could not quarantine"\r
            raise IndexCorruptError(f"Unreadable index at {path} ({detail}): {exc}") from exc\r
\r
        if not isinstance(loaded, dict) or not isinstance(loaded.get("transcripts"), dict):\r
            quarantine = path.with_name(\r
                f"{path.name}.corrupt-{_now().strftime('%Y%m%d%H%M%S')}"\r
            )\r
            try:\r
                shutil.copy2(path, quarantine)\r
            except OSError:\r
                pass\r
            raise IndexCorruptError(f"Malformed index structure at {path}")\r
\r
        # Preserve all existing fields; fill additive defaults.\r
        store._data = loaded\r
        store._data.setdefault("version", 1)\r
        store._data.setdefault("scan", {})\r
        store._data.setdefault("meta", {})\r
        if not isinstance(store._data["scan"], dict):\r
            store._data["scan"] = {}\r
        if not isinstance(store._data["meta"], dict):\r
            store._data["meta"] = {}\r
        return store\r
\r
    @property\r
    def transcripts(self) -> Dict[str, Any]:\r
        return self._data["transcripts"]\r
\r
    def has(self, note_id: str) -> bool:\r
        return self.resolve_id(note_id) is not None\r
\r
    def resolve_id(self, note_id: str) -> Optional[str]:\r
        """Return the canonical key for note_id or one of its aliases."""\r
        if note_id in self.transcripts:\r
            return note_id\r
        for key, rec in self.transcripts.items():\r
            aliases = rec.get("aliases") or []\r
            if isinstance(aliases, list) and note_id in aliases:\r
                return key\r
        return None\r
\r
    def get(self, note_id: str) -> Optional[Dict[str, Any]]:\r
        key = self.resolve_id(note_id)\r
        if key is None:\r
            return None\r
        return self.transcripts.get(key)\r
\r
    def requeue_false_absents(self) -> int:\r
        """Re-open notes wrongly marked absent due to UI/menu selector misses."""\r
        markers = (\r
            "download menu item missing",\r
            "copy page content",\r
            "clipboard empty",\r
            "menu items:",\r
            "kebab not found",\r
            "page options",\r
            "download/click timeout",\r
            "download timeout",\r
            "locator.click",\r
            "requeued for selector",\r
        )\r
        count = 0\r
        for key, rec in list(self.transcripts.items()):\r
            if rec.get("status") != STATUS_NO_TRANSCRIPT:\r
                continue\r
            err = str(rec.get("last_error") or "").lower()\r
            if not any(m in err for m in markers):\r
                # Also requeue absents with empty error (older runs).\r
                if err.strip():\r
                    continue\r
            rec = dict(rec)\r
            rec["status"] = STATUS_RETRYABLE\r
            rec["next_retry"] = ""\r
            rec["last_outcome"] = "requeued_false_absent"\r
            rec["last_error"] = "requeued for selector refresh"\r
            self.transcripts[key] = rec\r
            count += 1\r
        if count:\r
            self.save()\r
        return count\r
\r
    def requeue_pre_transcript(self) -> int:\r
        """Re-queue downloaded notes saved before the transcript-append layout.\r
\r
        Records whose content_version is below CONTENT_VERSION are flipped to\r
        retryable (due now) so they get re-opened once and regenerated with the\r
        raw transcript appended. Reprocessing overwrites the same deterministic\r
        filename, so no duplicate files are created.\r
        """\r
        count = 0\r
        for key, rec in list(self.transcripts.items()):\r
            if rec.get("status") != STATUS_DOWNLOADED:\r
                continue\r
            if int(rec.get("content_version") or 1) >= CONTENT_VERSION:\r
                continue\r
            rec = dict(rec)\r
            rec["status"] = STATUS_RETRYABLE\r
            rec["next_retry"] = ""\r
            rec["last_outcome"] = "requeued_pre_transcript"\r
            rec["last_error"] = "requeued to append raw transcript"\r
            self.transcripts[key] = rec\r
            count += 1\r
        if count:\r
            self.save()\r
        return count\r
\r
    def should_process(self, note_id: str, *, now: datetime = None) -> bool:\r
        """True if this note should be opened/checked on this run."""\r
        now = now or _now()\r
        rec = self.get(note_id)\r
        if rec is None:\r
            return True\r
        status = rec.get("status")\r
        if status == STATUS_DOWNLOADED:\r
            file_rel = rec.get("file") or ""\r
            if file_rel:\r
                # Caller may still reconcile; treat as skip if marked downloaded.\r
                return False\r
            return True\r
        if status == STATUS_MISSING_FILE:\r
            return True\r
        if status == STATUS_RETRYABLE:\r
            return self._is_due(rec, now)\r
        if status == STATUS_NO_TRANSCRIPT:\r
            return self._is_due(rec, now)\r
        return True\r
\r
    def _is_due(self, rec: Dict[str, Any], now: datetime) -> bool:\r
        nxt = _parse_iso(str(rec.get("next_retry") or ""))\r
        if nxt is None:\r
            return True\r
        # Compare timezone-aware when possible.\r
        if nxt.tzinfo is None:\r
            nxt = nxt.replace(tzinfo=now.tzinfo)\r
        return now >= nxt\r
\r
    def _backoff_delta(self, attempts: int) -> timedelta:\r
        hours = list(self.backoff_hours) or [6, 24, 72, 168]\r
        idx = max(0, min(attempts - 1, len(hours) - 1))\r
        if attempts <= 0:\r
            idx = 0\r
        return timedelta(hours=int(hours[idx]))\r
\r
    def add(\r
        self,\r
        note_id: str,\r
        *,\r
        title: str,\r
        status: str,\r
        source_url: str = "",\r
        host: str = "",\r
        meeting_date: str = "",\r
        file: str = "",\r
        aliases: Optional[Iterable[str]] = None,\r
        size: Optional[int] = None,\r
        sha256: str = "",\r
        last_outcome: str = "",\r
        last_error: str = "",\r
        content_version: Optional[int] = None,\r
        has_transcript: Optional[bool] = None,\r
    ) -> None:\r
        existing_key = self.resolve_id(note_id)\r
        key = existing_key or note_id\r
        prev = dict(self.transcripts.get(key) or {})\r
\r
        alias_set = set(prev.get("aliases") or [])\r
        if aliases:\r
            alias_set.update(a for a in aliases if a and a != key)\r
        if existing_key and note_id != existing_key:\r
            alias_set.add(note_id)\r
        # If we previously knew this under another hash only, keep it.\r
\r
        attempts = int(prev.get("attempts") or 0)\r
        if status in (STATUS_NO_TRANSCRIPT, STATUS_RETRYABLE, STATUS_MISSING_FILE):\r
            attempts += 1\r
        elif status == STATUS_DOWNLOADED:\r
            attempts = int(prev.get("attempts") or 0)\r
\r
        now = _now()\r
        next_retry = ""\r
        if status in (STATUS_NO_TRANSCRIPT, STATUS_RETRYABLE, STATUS_MISSING_FILE):\r
            next_retry = (now + self._backoff_delta(max(attempts, 1))).isoformat(timespec="seconds")\r
\r
        if file:\r
            file_val = file\r
        elif status == STATUS_DOWNLOADED:\r
            file_val = prev.get("file") or ""\r
        else:\r
            file_val = ""\r
\r
        rec = {\r
            "id": key,\r
            "title": title or prev.get("title") or "",\r
            "host": host if host != "" else prev.get("host") or "",\r
            "meeting_date": meeting_date if meeting_date != "" else prev.get("meeting_date") or "",\r
            "source_url": source_url if source_url != "" else prev.get("source_url") or "",\r
            "status": status,\r
            "file": file_val,\r
            "recorded_at": prev.get("recorded_at") or _now_iso(),\r
            "updated_at": _now_iso(),\r
            "attempts": attempts,\r
            "last_checked": _now_iso(),\r
            "next_retry": next_retry,\r
            "last_outcome": last_outcome or status,\r
            "last_error": last_error,\r
            "aliases": sorted(alias_set),\r
        }\r
        if size is not None:\r
            rec["size"] = size\r
        elif "size" in prev:\r
            rec["size"] = prev["size"]\r
        if sha256:\r
            rec["sha256"] = sha256\r
        elif prev.get("sha256"):\r
            rec["sha256"] = prev["sha256"]\r
\r
        if content_version is not None:\r
            rec["content_version"] = int(content_version)\r
        elif "content_version" in prev:\r
            rec["content_version"] = prev["content_version"]\r
        if has_transcript is not None:\r
            rec["has_transcript"] = bool(has_transcript)\r
        elif "has_transcript" in prev:\r
            rec["has_transcript"] = prev["has_transcript"]\r
\r
        if status == STATUS_DOWNLOADED:\r
            rec["next_retry"] = ""\r
            if file:\r
                rec["file"] = file\r
\r
        self.transcripts[key] = rec\r
        self.save()\r
\r
    def add_alias(self, canonical_id: str, alias: str) -> None:\r
        if not alias or alias == canonical_id:\r
            return\r
        key = self.resolve_id(canonical_id) or canonical_id\r
        rec = self.transcripts.get(key)\r
        if not rec:\r
            return\r
        aliases = set(rec.get("aliases") or [])\r
        aliases.add(alias)\r
        rec["aliases"] = sorted(aliases)\r
        self.save()\r
\r
    def mark_scan(self, **fields: Any) -> None:\r
        scan = self._data.setdefault("scan", {})\r
        if not isinstance(scan, dict):\r
            scan = {}\r
            self._data["scan"] = scan\r
        scan.update(fields)\r
        scan["updated_at"] = _now_iso()\r
        self.save()\r
\r
    def save(self) -> None:\r
        self.path.parent.mkdir(parents=True, exist_ok=True)\r
        self._data["version"] = max(int(self._data.get("version") or 1), INDEX_VERSION)\r
        # Rolling backup of previous good file.\r
        if self.path.exists():\r
            bak = self.path.with_suffix(self.path.suffix + ".bak")\r
            try:\r
                shutil.copy2(self.path, bak)\r
            except OSError:\r
                pass\r
        tmp = self.path.with_suffix(self.path.suffix + ".tmp")\r
        tmp.write_text(json.dumps(self._data, indent=2, ensure_ascii=False), encoding="utf-8")\r
        tmp.replace(self.path)\r
\r
    def reconcile_files(self, base_dir: Path) -> List[str]:\r
        """Mark downloaded records whose files are missing/empty. Returns ids."""\r
        changed: List[str] = []\r
        for key, rec in list(self.transcripts.items()):\r
            if rec.get("status") != STATUS_DOWNLOADED:\r
                continue\r
            rel = rec.get("file") or ""\r
            if not rel:\r
                rec["status"] = STATUS_MISSING_FILE\r
                rec["next_retry"] = _now_iso()\r
                rec["last_outcome"] = "missing_file"\r
                rec["updated_at"] = _now_iso()\r
                changed.append(key)\r
                continue\r
            path = (base_dir / rel).resolve() if not Path(rel).is_absolute() else Path(rel)\r
            try:\r
                ok = path.is_file() and path.stat().st_size > 0\r
            except OSError:\r
                ok = False\r
            if not ok:\r
                rec["status"] = STATUS_MISSING_FILE\r
                rec["next_retry"] = _now_iso()\r
                rec["last_outcome"] = "missing_file"\r
                rec["updated_at"] = _now_iso()\r
                changed.append(key)\r
        if changed:\r
            self.save()\r
        return changed\r
\r
    def find_orphan_files(self, transcripts_dir: Path, base_dir: Path) -> List[str]:\r
        """Return transcript paths on disk not referenced by any index record.\r
\r
        Walks month subfolders under transcripts_dir. Returns paths relative to\r
        transcripts_dir when possible (e.g. '2026-07/foo.md'). Never deletes;\r
        caller logs only.\r
        """\r
        if not transcripts_dir.is_dir():\r
            return []\r
        referenced: set[str] = set()\r
        for rec in self.transcripts.values():\r
            rel = rec.get("file") or ""\r
            if not rel:\r
                continue\r
            try:\r
                path = (base_dir / rel).resolve() if not Path(rel).is_absolute() else Path(rel).resolve()\r
                referenced.add(path.name.lower())\r
            except OSError:\r
                referenced.add(Path(rel).name.lower())\r
        orphans: List[str] = []\r
        root = transcripts_dir.resolve()\r
        try:\r
            for pattern in ("*.md", "*.txt"):\r
                for path in transcripts_dir.rglob(pattern):\r
                    if not path.is_file():\r
                        continue\r
                    if path.name.endswith(".part"):\r
                        continue\r
                    if path.name.lower() in referenced:\r
                        continue\r
                    try:\r
                        orphans.append(str(path.resolve().relative_to(root)).replace("\\\\", "/"))\r
                    except ValueError:\r
                        orphans.append(path.name)\r
        except OSError:\r
            return []\r
        return sorted(set(orphans))\r
\r
    def get_scan(self) -> Dict[str, Any]:\r
        scan = self._data.get("scan") or {}\r
        return scan if isinstance(scan, dict) else {}\r
\r
    def watermark_ids(self) -> List[str]:\r
        scan = self.get_scan()\r
        ids = scan.get("watermark_ids") or []\r
        return [str(x) for x in ids] if isinstance(ids, list) else []\r
\r
    @property\r
    def count(self) -> int:\r
        return len(self.transcripts)\r
\r
    def status_counts(self) -> Dict[str, int]:\r
        counts: Dict[str, int] = {}\r
        for rec in self.transcripts.values():\r
            st = str(rec.get("status") or "unknown")\r
            counts[st] = counts.get(st, 0) + 1\r
        return counts\r
`,
  "lockfile.py": '"""Atomic process lock with ownership token and heartbeat.\r\n\r\nUses O_CREAT|O_EXCL so two processes cannot both create the lock. The lock\r\npayload stores a random token, PID, and heartbeat timestamp. Release only\r\nsucceeds when the token still matches. Stale locks are reclaimed only when the\r\nheartbeat is old AND the owning PID is not alive (or not the original process).\r\n"""\r\n\r\nfrom __future__ import annotations\r\n\r\nimport json\r\nimport os\r\nimport time\r\nimport uuid\r\nfrom dataclasses import dataclass\r\nfrom datetime import datetime, timezone\r\nfrom pathlib import Path\r\nfrom typing import Any, Dict, Optional  # noqa: F401 \u2014 Dict used in helpers\r\n\r\n\r\ndef _now_iso() -> str:\r\n    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")\r\n\r\n\r\ndef _pid_alive(pid: int) -> bool:\r\n    if pid <= 0:\r\n        return False\r\n    if os.name == "nt":\r\n        try:\r\n            import ctypes\r\n\r\n            PROCESS_QUERY_LIMITED_INFORMATION = 0x1000\r\n            STILL_ACTIVE = 259\r\n            handle = ctypes.windll.kernel32.OpenProcess(\r\n                PROCESS_QUERY_LIMITED_INFORMATION, False, pid\r\n            )\r\n            if not handle:\r\n                return False\r\n            try:\r\n                exit_code = ctypes.c_ulong()\r\n                if ctypes.windll.kernel32.GetExitCodeProcess(handle, ctypes.byref(exit_code)) == 0:\r\n                    return False\r\n                return exit_code.value == STILL_ACTIVE\r\n            finally:\r\n                ctypes.windll.kernel32.CloseHandle(handle)\r\n        except Exception:\r\n            return False\r\n    # POSIX\r\n    try:\r\n        os.kill(pid, 0)\r\n    except ProcessLookupError:\r\n        return False\r\n    except PermissionError:\r\n        return True\r\n    except OSError:\r\n        return False\r\n    return True\r\n\r\n\r\n@dataclass\r\nclass LockHandle:\r\n    path: Path\r\n    token: str\r\n    pid: int\r\n\r\n    def heartbeat(self) -> None:\r\n        data = _read(self.path)\r\n        if not data or data.get("token") != self.token:\r\n            return\r\n        data["heartbeat_at"] = _now_iso()\r\n        data["heartbeat_epoch"] = time.time()\r\n        _write_replace(self.path, data)\r\n\r\n    def release(self) -> bool:\r\n        data = _read(self.path)\r\n        if not data:\r\n            return False\r\n        if data.get("token") != self.token:\r\n            return False\r\n        try:\r\n            self.path.unlink(missing_ok=True)\r\n            return True\r\n        except OSError:\r\n            return False\r\n\r\n\r\ndef _read(path: Path) -> Optional[Dict[str, Any]]:\r\n    try:\r\n        if not path.exists():\r\n            return None\r\n        raw = path.read_text(encoding="utf-8")\r\n        data = json.loads(raw)\r\n        return data if isinstance(data, dict) else None\r\n    except (OSError, json.JSONDecodeError, UnicodeError):\r\n        return None\r\n\r\n\r\ndef _write_replace(path: Path, data: Dict[str, Any]) -> None:\r\n    tmp = path.with_suffix(path.suffix + ".tmp")\r\n    tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")\r\n    tmp.replace(path)\r\n\r\n\r\ndef acquire(path: Path, stale_minutes: float = 25.0) -> Optional[LockHandle]:\r\n    """Try to acquire the lock. Returns a handle or None if held by a healthy peer."""\r\n    path.parent.mkdir(parents=True, exist_ok=True)\r\n    token = uuid.uuid4().hex\r\n    pid = os.getpid()\r\n    payload = {\r\n        "token": token,\r\n        "pid": pid,\r\n        "started_at": _now_iso(),\r\n        "heartbeat_at": _now_iso(),\r\n        "heartbeat_epoch": time.time(),\r\n    }\r\n\r\n    # Fast path: exclusive create.\r\n    try:\r\n        fd = os.open(str(path), os.O_CREAT | os.O_EXCL | os.O_WRONLY)\r\n        try:\r\n            os.write(fd, json.dumps(payload, indent=2).encode("utf-8"))\r\n        finally:\r\n            os.close(fd)\r\n        return LockHandle(path=path, token=token, pid=pid)\r\n    except FileExistsError:\r\n        pass\r\n    except OSError:\r\n        return None\r\n\r\n    existing = _read(path)\r\n    if existing is None:\r\n        # Unreadable or empty; try reclaim by unlink + recreate.\r\n        try:\r\n            path.unlink(missing_ok=True)\r\n        except OSError:\r\n            return None\r\n        return acquire(path, stale_minutes=stale_minutes)\r\n\r\n    # Legacy plain-PID lock (old format was just a pid string).\r\n    if "token" not in existing:\r\n        try:\r\n            age_min = (time.time() - path.stat().st_mtime) / 60.0\r\n        except OSError:\r\n            age_min = stale_minutes + 1\r\n        legacy_pid = None\r\n        try:\r\n            legacy_pid = int(path.read_text(encoding="utf-8").strip())\r\n        except Exception:\r\n            legacy_pid = existing.get("pid")\r\n        if age_min < stale_minutes and legacy_pid and _pid_alive(int(legacy_pid)):\r\n            return None\r\n        try:\r\n            path.unlink(missing_ok=True)\r\n        except OSError:\r\n            return None\r\n        return acquire(path, stale_minutes=stale_minutes)\r\n\r\n    owner_pid = int(existing.get("pid") or 0)\r\n    heartbeat_epoch = existing.get("heartbeat_epoch")\r\n    if isinstance(heartbeat_epoch, (int, float)):\r\n        stale = (time.time() - float(heartbeat_epoch)) > (stale_minutes * 60.0)\r\n    else:\r\n        try:\r\n            stale = (time.time() - path.stat().st_mtime) > (stale_minutes * 60.0)\r\n        except OSError:\r\n            stale = True\r\n\r\n    if not stale and _pid_alive(owner_pid):\r\n        return None\r\n\r\n    # Stale or dead owner: reclaim.\r\n    try:\r\n        path.unlink(missing_ok=True)\r\n    except OSError:\r\n        return None\r\n    return acquire(path, stale_minutes=stale_minutes)\r\n',
  "procs.py": `"""Process helpers for Playwright browser lifecycle on Windows.\r
\r
Headless Edge can hang on graceful close. Cleanup is scoped to a unique run\r
token embedded in the browser launch user-data-dir / env so unrelated Edge or\r
Playwright sessions are never killed.\r
"""\r
\r
from __future__ import annotations\r
\r
import os\r
import subprocess\r
import threading\r
from typing import Sequence\r
\r
_CREATE_NO_WINDOW = 0x08000000\r
\r
\r
def kill_process_tree(pid: int, timeout: float = 30.0) -> None:\r
    """Force-kill a process and its descendants (Windows taskkill /F /T)."""\r
    if not pid or pid <= 0:\r
        return\r
    try:\r
        if os.name == "nt":\r
            subprocess.run(\r
                ["taskkill", "/PID", str(pid), "/T", "/F"],\r
                capture_output=True,\r
                timeout=timeout,\r
                creationflags=_CREATE_NO_WINDOW,\r
            )\r
        else:\r
            # Best-effort POSIX: kill process group if possible.\r
            try:\r
                os.killpg(pid, 9)\r
            except Exception:\r
                subprocess.run(["kill", "-9", str(pid)], capture_output=True, timeout=timeout)\r
    except Exception:\r
        pass\r
\r
\r
def kill_by_command_token(\r
    token: str,\r
    process_names: Sequence[str],\r
    timeout: float = 40.0,\r
) -> None:\r
    """Force-kill processes whose command line contains \`token\`.\r
\r
    \`token\` must be unique to this run (e.g. a UUID path segment). Never pass a\r
    generic Playwright signature alone.\r
    """\r
    if not token or len(token) < 8:\r
        return\r
    names = [n for n in process_names if n]\r
    if not names:\r
        return\r
\r
    if os.name == "nt":\r
        name_clauses = " -or ".join(f"$_.Name -eq '{n}'" for n in names)\r
        safe_token = token.replace("'", "''")\r
        ps = (\r
            f"Get-CimInstance Win32_Process | Where-Object {{ "\r
            f"({name_clauses}) -and ($_.CommandLine -like '*{safe_token}*') "\r
            f"}} | ForEach-Object {{ Stop-Process -Id $_.ProcessId -Force "\r
            f"-ErrorAction SilentlyContinue }}"\r
        )\r
        try:\r
            subprocess.run(\r
                ["powershell", "-NoProfile", "-Command", ps],\r
                capture_output=True,\r
                timeout=timeout,\r
                creationflags=_CREATE_NO_WINDOW,\r
            )\r
        except Exception:\r
            pass\r
        return\r
\r
    # macOS / Linux: pkill by token in the full command line (scoped).\r
    try:\r
        subprocess.run(\r
            ["pkill", "-f", token],\r
            capture_output=True,\r
            timeout=timeout,\r
        )\r
    except Exception:\r
        pass\r
\r
\r
def stop_playwright(playwright, timeout: float = 10.0) -> None:\r
    """Call playwright.stop() on the same logical wait, bounded by timeout.\r
\r
    Prefer calling this after browsers are already closed/killed. Uses a daemon\r
    thread only as a last-resort timeout gate; the stop call itself may still\r
    run in the background if it hangs.\r
    """\r
    if playwright is None:\r
        return\r
    done = threading.Event()\r
\r
    def _stop():\r
        try:\r
            playwright.stop()\r
        except Exception:\r
            pass\r
        finally:\r
            done.set()\r
\r
    threading.Thread(target=_stop, daemon=True).start()\r
    done.wait(timeout)\r
\r
\r
def close_context(context, timeout: float = 5.0) -> None:\r
    if context is None:\r
        return\r
    done = threading.Event()\r
\r
    def _close():\r
        try:\r
            context.close()\r
        except Exception:\r
            pass\r
        finally:\r
            done.set()\r
\r
    threading.Thread(target=_close, daemon=True).start()\r
    done.wait(timeout)\r
\r
\r
def close_browser(browser, timeout: float = 5.0) -> None:\r
    if browser is None:\r
        return\r
    done = threading.Event()\r
\r
    def _close():\r
        try:\r
            browser.close()\r
        except Exception:\r
            pass\r
        finally:\r
            done.set()\r
\r
    threading.Thread(target=_close, daemon=True).start()\r
    done.wait(timeout)\r
\r
\r
class BrowserSession:\r
    """Owns one Playwright driver + browser + context for a single run phase."""\r
\r
    def __init__(\r
        self,\r
        *,\r
        headless: bool,\r
        run_token: str,\r
        process_names: Sequence[str],\r
        launch_kwargs: dict,\r
        new_context_fn,\r
        use_saved_state: bool = True,\r
    ):\r
        self.headless = headless\r
        self.run_token = run_token\r
        self.process_names = list(process_names)\r
        self._launch_kwargs = dict(launch_kwargs)\r
        self._new_context_fn = new_context_fn\r
        self.use_saved_state = use_saved_state\r
        self.playwright = None\r
        self.browser = None\r
        self.context = None\r
        self.page = None\r
\r
    def start(self):\r
        from playwright.sync_api import sync_playwright\r
\r
        # Unique marker so cleanup only targets this session's processes.\r
        # Playwright puts the user data dir on the command line for the channel.\r
        os.environ["ZOOM_SYNC_RUN_TOKEN"] = self.run_token\r
        self.playwright = sync_playwright().start()\r
        kwargs = dict(self._launch_kwargs)\r
        # args marker appears on the process command line for scoped kill.\r
        args = list(kwargs.get("args") or [])\r
        args.append(f"--zoom-sync-run-token={self.run_token}")\r
        kwargs["args"] = args\r
        try:\r
            self.browser = self.playwright.chromium.launch(**kwargs)\r
        except Exception:\r
            # macOS without Chrome installed: fall back to bundled Chromium.\r
            if kwargs.get("channel"):\r
                fallback = dict(kwargs)\r
                fallback.pop("channel", None)\r
                self.browser = self.playwright.chromium.launch(**fallback)\r
            else:\r
                raise\r
        self.context = self._new_context_fn(self.browser, use_saved_state=self.use_saved_state)\r
        self.page = self.context.pages[0] if self.context.pages else self.context.new_page()\r
        return self\r
\r
    def stop(self) -> None:\r
        close_context(self.context, timeout=4.0)\r
        close_browser(self.browser, timeout=4.0)\r
        # Scoped force-kill for hung Edge/Chrome children from this run only.\r
        kill_by_command_token(self.run_token, self.process_names, timeout=30.0)\r
        stop_playwright(self.playwright, timeout=8.0)\r
        self.page = None\r
        self.context = None\r
        self.browser = None\r
        self.playwright = None\r
`,
  "security.py": `"""Optional Windows ACL hardening for sensitive runtime paths."""\r
\r
from __future__ import annotations\r
\r
import logging\r
import os\r
import subprocess\r
from pathlib import Path\r
from typing import Iterable\r
\r
log = logging.getLogger("zoom_sync")\r
\r
_CREATE_NO_WINDOW = 0x08000000\r
\r
\r
def apply_user_only_acls(paths: Iterable[Path]) -> None:\r
    """Best-effort: restrict paths to current user, SYSTEM, and Administrators.\r
\r
    Failures are logged and ignored so sync still works in restricted environments.\r
    """\r
    if os.name != "nt":\r
        return\r
    user = os.environ.get("USERNAME") or os.environ.get("USER") or ""\r
    if not user:\r
        return\r
    for path in paths:\r
        try:\r
            if not path.exists():\r
                continue\r
            # Remove inheritance, then grant explicit rights.\r
            commands = [\r
                ["icacls", str(path), "/inheritance:r"],\r
                [\r
                    "icacls",\r
                    str(path),\r
                    "/grant:r",\r
                    f"{user}:(OI)(CI)F",\r
                    "SYSTEM:(OI)(CI)F",\r
                    "Administrators:(OI)(CI)F",\r
                ],\r
            ]\r
            # Files don't need (OI)(CI)\r
            if path.is_file():\r
                commands = [\r
                    ["icacls", str(path), "/inheritance:r"],\r
                    [\r
                        "icacls",\r
                        str(path),\r
                        "/grant:r",\r
                        f"{user}:F",\r
                        "SYSTEM:F",\r
                        "Administrators:F",\r
                    ],\r
                ]\r
            for cmd in commands:\r
                result = subprocess.run(\r
                    cmd,\r
                    capture_output=True,\r
                    text=True,\r
                    timeout=30,\r
                    creationflags=_CREATE_NO_WINDOW,\r
                )\r
                if result.returncode != 0:\r
                    log.warning(\r
                        "ACL command failed for %s: %s",\r
                        path,\r
                        (result.stderr or result.stdout or "").strip()[:200],\r
                    )\r
                    break\r
        except Exception as exc:  # noqa: BLE001\r
            log.warning("Could not apply ACLs to %s: %s", path, exc)\r
`,
  "requirements.txt": "playwright==1.55.0\r\n",
  "scripts/register-task.ps1": '# Register the Zoom Notes sync scheduled task (every 30 minutes, logged-on only).\r\n# Run from an elevated or same-user PowerShell session:\r\n#   powershell -NoProfile -File .\\scripts\\register-task.ps1\r\n\r\n$ErrorActionPreference = "Stop"\r\n\r\n$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)\r\n$RunPs1 = Join-Path $Root "run.ps1"\r\nif (-not (Test-Path -LiteralPath $RunPs1)) {\r\n    throw "run.ps1 not found at $RunPs1"\r\n}\r\n\r\n$TaskName = if ($env:ZOOM_TASK_NAME) { $env:ZOOM_TASK_NAME } else { "ZoomNotesSync" }\r\n$PsExe = Join-Path $env:SystemRoot "System32\\WindowsPowerShell\\v1.0\\powershell.exe"\r\n$Arg = "-NoProfile -ExecutionPolicy Bypass -File `"$RunPs1`""\r\n\r\n$Action = New-ScheduledTaskAction -Execute $PsExe -Argument $Arg -WorkingDirectory $Root\r\n$Trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).Date.AddMinutes(1) `\r\n    -RepetitionInterval (New-TimeSpan -Minutes 30) `\r\n    -RepetitionDuration (New-TimeSpan -Days 3650)\r\n$Settings = New-ScheduledTaskSettingsSet `\r\n    -MultipleInstances IgnoreNew `\r\n    -ExecutionTimeLimit (New-TimeSpan -Minutes 30) `\r\n    -StartWhenAvailable `\r\n    -AllowStartIfOnBatteries `\r\n    -DontStopIfGoingOnBatteries\r\n# Interactive / logged-on user required for SSO re-auth UI.\r\n$Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited\r\n\r\nRegister-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger `\r\n    -Settings $Settings -Principal $Principal -Force | Out-Null\r\n\r\nWrite-Host "Registered task \'$TaskName\'."\r\nWrite-Host "  Action: $PsExe $Arg"\r\nWrite-Host "  Manage: Get-ScheduledTask -TaskName $TaskName"\r\nWrite-Host "  Run now: Start-ScheduledTask -TaskName $TaskName"\r\nWrite-Host "  Remove: Unregister-ScheduledTask -TaskName $TaskName -Confirm:`$false"\r\n',
  "scripts/check.ps1": '# Local quality gate: unit tests (+ ruff if installed).\r\n$ErrorActionPreference = "Stop"\r\n$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)\r\nSet-Location -LiteralPath $Root\r\n\r\n$Py = Join-Path $Root ".venv\\Scripts\\python.exe"\r\nif (-not (Test-Path -LiteralPath $Py)) { $Py = "python" }\r\n\r\nWrite-Host "== pytest =="\r\n& $Py -m pytest\r\nif ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }\r\n\r\n$Ruff = Join-Path $Root ".venv\\Scripts\\ruff.exe"\r\nif (Test-Path -LiteralPath $Ruff) {\r\n    Write-Host "== ruff check =="\r\n    & $Ruff check .\r\n    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }\r\n} else {\r\n    Write-Host "ruff not installed (optional): pip install ruff"\r\n}\r\n\r\nWrite-Host "OK"\r\nexit 0\r\n'
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
