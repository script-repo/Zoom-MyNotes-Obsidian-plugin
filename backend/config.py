"""Central configuration for the Zoom Notes transcript sync.

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
# to fall back to Playwright's bundled Chromium (requires `playwright install`).
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
    # macOS: avoid background throttling that stalls Zoom’s SPA in automation.
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
    # Note: downloads_path is only valid on launch_persistent_context, not new_context.
    # File downloads are saved via page.expect_download() + download.save_as(...).
    kwargs: dict = {
        "accept_downloads": True,
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
