"""Atomic process lock with ownership token and heartbeat.

Uses O_CREAT|O_EXCL so two processes cannot both create the lock. The lock
payload stores a random token, PID, and heartbeat timestamp. Release only
succeeds when the token still matches. Stale locks are reclaimed only when the
heartbeat is old AND the owning PID is not alive (or not the original process).
"""

from __future__ import annotations

import json
import os
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional  # noqa: F401 — Dict used in helpers


def _now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def _pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    if os.name == "nt":
        try:
            import ctypes

            PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
            STILL_ACTIVE = 259
            handle = ctypes.windll.kernel32.OpenProcess(
                PROCESS_QUERY_LIMITED_INFORMATION, False, pid
            )
            if not handle:
                return False
            try:
                exit_code = ctypes.c_ulong()
                if ctypes.windll.kernel32.GetExitCodeProcess(handle, ctypes.byref(exit_code)) == 0:
                    return False
                return exit_code.value == STILL_ACTIVE
            finally:
                ctypes.windll.kernel32.CloseHandle(handle)
        except Exception:
            return False
    # POSIX
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        return False
    return True


@dataclass
class LockHandle:
    path: Path
    token: str
    pid: int

    def heartbeat(self) -> None:
        data = _read(self.path)
        if not data or data.get("token") != self.token:
            return
        data["heartbeat_at"] = _now_iso()
        data["heartbeat_epoch"] = time.time()
        _write_replace(self.path, data)

    def release(self) -> bool:
        data = _read(self.path)
        if not data:
            return False
        if data.get("token") != self.token:
            return False
        try:
            self.path.unlink(missing_ok=True)
            return True
        except OSError:
            return False


def _read(path: Path) -> Optional[Dict[str, Any]]:
    try:
        if not path.exists():
            return None
        raw = path.read_text(encoding="utf-8")
        data = json.loads(raw)
        return data if isinstance(data, dict) else None
    except (OSError, json.JSONDecodeError, UnicodeError):
        return None


def _write_replace(path: Path, data: Dict[str, Any]) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
    tmp.replace(path)


def acquire(path: Path, stale_minutes: float = 25.0) -> Optional[LockHandle]:
    """Try to acquire the lock. Returns a handle or None if held by a healthy peer."""
    path.parent.mkdir(parents=True, exist_ok=True)
    token = uuid.uuid4().hex
    pid = os.getpid()
    payload = {
        "token": token,
        "pid": pid,
        "started_at": _now_iso(),
        "heartbeat_at": _now_iso(),
        "heartbeat_epoch": time.time(),
    }

    # Fast path: exclusive create.
    try:
        fd = os.open(str(path), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        try:
            os.write(fd, json.dumps(payload, indent=2).encode("utf-8"))
        finally:
            os.close(fd)
        return LockHandle(path=path, token=token, pid=pid)
    except FileExistsError:
        pass
    except OSError:
        return None

    existing = _read(path)
    if existing is None:
        # Unreadable or empty; try reclaim by unlink + recreate.
        try:
            path.unlink(missing_ok=True)
        except OSError:
            return None
        return acquire(path, stale_minutes=stale_minutes)

    # Legacy plain-PID lock (old format was just a pid string).
    if "token" not in existing:
        try:
            age_min = (time.time() - path.stat().st_mtime) / 60.0
        except OSError:
            age_min = stale_minutes + 1
        legacy_pid = None
        try:
            legacy_pid = int(path.read_text(encoding="utf-8").strip())
        except Exception:
            legacy_pid = existing.get("pid")
        if age_min < stale_minutes and legacy_pid and _pid_alive(int(legacy_pid)):
            return None
        try:
            path.unlink(missing_ok=True)
        except OSError:
            return None
        return acquire(path, stale_minutes=stale_minutes)

    owner_pid = int(existing.get("pid") or 0)
    heartbeat_epoch = existing.get("heartbeat_epoch")
    if isinstance(heartbeat_epoch, (int, float)):
        stale = (time.time() - float(heartbeat_epoch)) > (stale_minutes * 60.0)
    else:
        try:
            stale = (time.time() - path.stat().st_mtime) > (stale_minutes * 60.0)
        except OSError:
            stale = True

    if not stale and _pid_alive(owner_pid):
        return None

    # Stale or dead owner: reclaim.
    try:
        path.unlink(missing_ok=True)
    except OSError:
        return None
    return acquire(path, stale_minutes=stale_minutes)
