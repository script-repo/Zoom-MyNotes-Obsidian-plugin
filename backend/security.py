"""Optional Windows ACL hardening for sensitive runtime paths."""

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
