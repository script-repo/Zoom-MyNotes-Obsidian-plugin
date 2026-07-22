"""Process helpers for Playwright browser lifecycle on Windows.

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
    """Force-kill processes whose command line contains `token`.

    `token` must be unique to this run (e.g. a UUID path segment). Never pass a
    generic Playwright signature alone.
    """
    if not token or len(token) < 8:
        return
    names = [n for n in process_names if n]
    if not names:
        return

    # Build a PowerShell filter that matches any of the process names and the token.
    name_clauses = " -or ".join(f"$_.Name -eq '{n}'" for n in names)
    # Escape single quotes in token for PowerShell single-quoted string.
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
            creationflags=_CREATE_NO_WINDOW if os.name == "nt" else 0,
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
        self.browser = self.playwright.chromium.launch(**kwargs)
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
