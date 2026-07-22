"""Playwright page helpers for the Zoom Notes (docs.zoom.us/notes) UI.

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
        'text=/download\\s+transcript/i',
        'text=/export\\s+transcript/i',
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
    r"/notes/([A-Za-z0-9_\-]{6,})|[?&](?:doc|docId|noteId|id)=([A-Za-z0-9_\-]{6,})"
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
    return re.sub(r"\s+", " ", (text or "")).strip()


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
    return re.sub(r"\s+", " ", (s or "")).strip().lower()


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
    data = (body + "\n").encode("utf-8")
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
    r"^(?P<span>.{1,80}?)\s*[:\-–—]\s+.+$|"
    r"^\[[0-9:.]+\]\s*.+$|"
    r"^[0-9]{1,2}:[0-9]{2}(?::[0-9]{2})?\s+.+$",
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
            candidate = "\n".join(lines).strip()
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
    candidate = "\n".join(lines).strip()
    return candidate if _looks_like_transcript(candidate) else ""


def _try_menu_download(page: Page, dest: Path) -> DownloadResult:
    """Open kebabs / export menus and attempt a real file download."""
    import hashlib

    name_patterns = (
        re.compile(r"download\s+transcript", re.I),
        re.compile(r"export\s+transcript", re.I),
        re.compile(r"download\s+.*\.txt", re.I),
        re.compile(r"transcript\s*\(.*txt.*\)", re.I),
        re.compile(r"^transcript$", re.I),
    )
    export_patterns = (
        re.compile(r"^export$", re.I),
        re.compile(r"^download$", re.I),
        re.compile(r"export\s+as", re.I),
        re.compile(r"download\s+as", re.I),
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
            if b"\x00" in data[:2048]:
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
