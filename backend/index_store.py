"""Persistent index of downloaded transcripts, used for deduplication.

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
                        orphans.append(str(path.resolve().relative_to(root)).replace("\\", "/"))
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
