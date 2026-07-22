"""Interactive login for Zoom Notes.

Run this once (or whenever the session expires) to open a real browser window,
log in manually, and persist the authenticated session to `storage_state.json`.

    python login.py

It is also imported by `sync.py` to drive the auto re-auth flow when a
scheduled run detects an expired session.
"""

from __future__ import annotations

import sys
import time
import uuid

from playwright.sync_api import Error as PWError

import config
import procs
import zoom_notes


def _logged_in_page(context):
    """Return the first open page/tab that looks authenticated, else None."""
    for pg in list(context.pages):
        try:
            if zoom_notes.is_logged_in(pg):
                return pg
        except PWError:
            continue
    return None


def interactive_login(wait_seconds: int = None) -> bool:
    """Open a visible browser, let the user sign in, and save the session.

    Returns True if login succeeded and the session was saved. Owns its browser
    lifecycle completely; callers must not hold another Playwright Edge session
    open while this runs.
    """
    wait_seconds = wait_seconds if wait_seconds is not None else config.LOGIN_WAIT_SECONDS
    config.ensure_dirs()
    config.validate_config()

    run_token = f"zoom-login-{uuid.uuid4().hex}"
    session = procs.BrowserSession(
        headless=False,
        run_token=run_token,
        process_names=config.browser_process_names(),
        launch_kwargs=config.launch_kwargs(headless=False),
        new_context_fn=config.new_context,
        use_saved_state=True,
    )

    try:
        session.start()
        context = session.context
        page = session.page

        print(f"Opening {config.redact_url(config.NOTES_URL)} ...", flush=True)
        try:
            page.goto(config.NOTES_URL, wait_until="domcontentloaded")
        except PWError as exc:
            print(f"Initial navigation warning: {exc}", flush=True)

        print("Please complete the sign-in in the browser window.", flush=True)
        print(f"Waiting up to {wait_seconds}s for the notes list to appear...", flush=True)

        # Let redirects settle before auth checks.
        time.sleep(5)

        deadline = time.time() + wait_seconds
        authed_page = None
        last_report = 0.0
        while time.time() < deadline:
            if not context.pages:
                print("  [info] no tabs open; reopening notes page...", flush=True)
                try:
                    newp = context.new_page()
                    newp.goto(config.NOTES_URL, wait_until="domcontentloaded")
                except PWError as exc:
                    print(f"  [info] reopen failed: {exc}", flush=True)
                    time.sleep(2)
                    continue

            authed_page = _logged_in_page(context)
            if authed_page is not None:
                break

            now = time.time()
            if now - last_report > 10:
                urls = []
                for pg in list(context.pages):
                    try:
                        urls.append(config.redact_url(pg.url))
                    except PWError:
                        pass
                print(f"  [waiting] open tabs: {urls}", flush=True)
                last_report = now
            time.sleep(2)

        logged_in = authed_page is not None
        if logged_in:
            time.sleep(2)
            try:
                config.save_storage_state(context)
                print(
                    f"Login successful (url: {config.redact_url(authed_page.url)}). "
                    f"Session saved to {config.STORAGE_STATE}",
                    flush=True,
                )
            except PWError as exc:
                logged_in = False
                print(f"Session save failed: {exc}", flush=True)
        else:
            print("Timed out / no authenticated tab. Session NOT saved.", flush=True)

        return logged_in
    finally:
        session.stop()


if __name__ == "__main__":
    try:
        ok = interactive_login()
    except Exception as exc:  # noqa: BLE001
        print(f"Login failed: {exc}", flush=True)
        ok = False
    sys.exit(0 if ok else 1)
