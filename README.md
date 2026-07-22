# Zoom MyNotes Sync

**Obsidian desktop plugin** that deploys and controls a Python + Playwright backend to download Zoom AI Companion / My Notes transcripts into your vault.

| | |
| --- | --- |
| **Plugin ID** | `zoom-mynotes-sync` |
| **Platform** | Obsidian **desktop** on Windows, macOS, and Linux (`isDesktopOnly`) |
| **Repo** | [script-repo/Zoom-MyNotes-Obsidian-plugin](https://github.com/script-repo/Zoom-MyNotes-Obsidian-plugin) |
| **Latest release** | [GitHub Releases](https://github.com/script-repo/Zoom-MyNotes-Obsidian-plugin/releases) |

## What it does

- **Deploy wizard** — creates a Python `.venv`, installs dependencies, prepares the transcripts folder, registers a background job every 30 minutes, and ensures the plugin files are in the vault
- **Background jobs by OS**
  - **Windows** — Task Scheduler (or the backend’s `scripts/register-task.ps1` when present)
  - **macOS** — user LaunchAgent (`launchd`)
  - **Linux** — user `crontab` entry
- **Sync now** / **Login** commands and a ribbon button
- **Settings** — path to the Python sync repo, transcripts folder, headless browser mode, auto-sync interval
- Sets `ZOOM_TRANSCRIPTS_DIR` to `<vault>/<output folder>` on every run so notes land in your vault
- Sets `ZOOM_BROWSER_CHANNEL` to `msedge` on Windows and `chromium` on macOS/Linux (overridable)

The browser automation lives in a **separate local Python project** (folder containing `sync.py` / `login.py`). This plugin is the control plane and installer; it does not embed the scraper.

## Requirements

- [Obsidian](https://obsidian.md) **desktop** (Windows, macOS, or Linux)
- **Python 3.11+** on `PATH` for first-time deploy (`python3` on macOS/Linux)
- Browser for Playwright:
  - **Windows:** Microsoft Edge (channel `msedge`), or Chromium via Playwright install
  - **macOS / Linux:** Chromium (installed by the deploy wizard via `playwright install chromium`)
- A local clone of the **Zoom MyNotes Python sync backend** (must contain `sync.py`, `config.py`, `requirements.txt`)

## Install in Obsidian

### Option A — Community plugins (after approval)

Once this plugin is listed in the [Obsidian community plugin directory](https://obsidian.md/plugins):

1. Open **Settings → Community plugins**.
2. If needed, turn off **Restricted mode**.
3. Click **Browse**.
4. Search for **Zoom MyNotes Sync**.
5. Click **Install**, then **Enable**.
6. Continue with [First-time setup](#first-time-setup) below.

### Option B — BRAT (recommended while waiting for community review)

[BRAT](https://github.com/TfTHacker/obsidian42-brat) installs plugins directly from GitHub releases.

1. Install **BRAT** from Community plugins (`obsidian42-brat`).
2. Open **Settings → BRAT → Add beta plugin**.
3. Paste:

   ```text
   https://github.com/script-repo/Zoom-MyNotes-Obsidian-plugin
   ```

4. Choose the latest release version when prompted.
5. Enable **Zoom MyNotes Sync** under **Settings → Community plugins**.
6. Continue with [First-time setup](#first-time-setup).

### Option C — Manual install from a GitHub release

1. Open the [latest release](https://github.com/script-repo/Zoom-MyNotes-Obsidian-plugin/releases/latest).
2. Download these three files (do **not** download source zip only):
   - `main.js`
   - `manifest.json`
   - `styles.css`
3. In your vault, create this folder (create `.obsidian` / `plugins` if missing):

   ```text
   <YourVault>/.obsidian/plugins/zoom-mynotes-sync/
   ```

   The folder name **must** match the plugin id: `zoom-mynotes-sync`.

4. Copy the three files into that folder. You should have:

   ```text
   <YourVault>/.obsidian/plugins/zoom-mynotes-sync/main.js
   <YourVault>/.obsidian/plugins/zoom-mynotes-sync/manifest.json
   <YourVault>/.obsidian/plugins/zoom-mynotes-sync/styles.css
   ```

5. In Obsidian: **Settings → Community plugins** — turn off **Restricted mode** if it is on.
6. Click **Reload plugins** (or restart Obsidian).
7. Find **Zoom MyNotes Sync** in the installed list and toggle it **on**.
8. Continue with [First-time setup](#first-time-setup).

### Option D — Build from source (developers)

```bash
git clone https://github.com/script-repo/Zoom-MyNotes-Obsidian-plugin.git
cd Zoom-MyNotes-Obsidian-plugin
npm install
npm run build
```

Copy `main.js`, `manifest.json`, and `styles.css` into:

```text
<YourVault>/.obsidian/plugins/zoom-mynotes-sync/
```

Or install straight into a vault:

```bash
# macOS / Linux
npm run install-vault -- "/path/to/your/vault"

# Windows (PowerShell)
npm run install-vault -- "D:\path\to\your\vault"
```

Then enable the plugin in Obsidian and reload.

## First-time setup

1. Clone or locate your **Python Zoom MyNotes sync** project on disk (the folder that contains `sync.py`).
2. In Obsidian, open **Settings → Zoom MyNotes Sync**.
3. Set **Sync repo path** to that folder’s absolute path:
   - Windows: `C:\Users\you\zoom-mynotes-sync`
   - macOS / Linux: `/Users/you/zoom-mynotes-sync` or `/home/you/zoom-mynotes-sync`
4. Run **Open deploy wizard** (also available from the command palette).
5. Click **Run full deploy**. This will:
   - locate Python and create `.venv` in the sync repo
   - install Python packages and Playwright browser bits (Edge on Windows, Chromium on macOS/Linux)
   - create the vault transcripts folder (default `mynotes`)
   - write portable runners: `local-env.sh`, `local-env.ps1`, `run-sync.sh`, `run-sync.ps1`
   - register a background job every 30 minutes (Task Scheduler / launchd / cron)
   - confirm plugin files in the vault
6. Run command **Login (interactive SSO)** and complete Zoom sign-in in the browser window.
7. Run **Sync now** (ribbon icon or command palette).

Transcripts appear under the configured vault folder (default `mynotes/`), often with month subfolders.

## Commands

| Command | Action |
| --- | --- |
| Sync now | Run `sync.py` |
| Login (interactive SSO) | Run `login.py` (visible browser) |
| Open deploy wizard | Full backend + vault setup |
| Show latest sync log | Tail `logs/sync-*.log` from the sync repo |
| Open transcripts folder | Focus the vault output folder |
| Cancel running job | Kill the active child process |

## Settings

| Setting | Default | Notes |
| --- | --- | --- |
| Sync repo path | (empty / auto) | Absolute path to folder with `sync.py` |
| Python path | (auto) | `.venv/Scripts/python.exe` (Windows) or `.venv/bin/python3` (macOS/Linux) |
| Transcripts folder | `mynotes` | Vault-relative |
| Headless sync | on | Login always opens a window |
| Auto-sync (minutes) | `0` (off) | While Obsidian is open; OS job covers background |
| Background job name | `ZoomNotesSync` | Task Scheduler / LaunchAgent / cron marker |

## Privacy

- Meeting titles are **not** written to logs unless you enable **Log meeting titles**.
- Auth state is stored by the Python/Playwright backend on disk under the sync repo, not in Obsidian cloud sync by this plugin.

## Troubleshooting

| Symptom | What to try |
| --- | --- |
| Plugin missing after copy | Folder must be named `zoom-mynotes-sync`; enable under Community plugins; reload Obsidian |
| “Set … Sync repo path” | Point settings at the folder that contains `sync.py` |
| “Python not found” | Install Python 3.11+ (`python3` on macOS/Linux), then re-run Deploy wizard |
| Login / sync browser fails | Re-run deploy (installs Chromium on macOS/Linux; Edge on Windows). Override with env `ZOOM_BROWSER_CHANNEL` if needed |
| macOS LaunchAgent failed | Check `~/Library/LaunchAgents/com.zoom-mynotes-sync.*.plist` and `logs/launchd-*.log` in the sync repo |
| Linux cron failed | Ensure `crontab` is available; inspect `crontab -l` and `logs/cron-sync.log` |
| No notes in vault | Confirm **Transcripts folder** and that sync exited successfully (Show latest sync log) |

## Development

```bash
npm install
npm run dev      # watch build → main.js
npm run build    # production build
```

### Release checklist (maintainers)

1. Bump `version` in `manifest.json` and `package.json` (same value, no `v` prefix).
2. Add `"<version>": "<minAppVersion>"` to `versions.json`.
3. Commit and push to `main`.
4. Tag and push the version (triggers [`.github/workflows/release.yml`](.github/workflows/release.yml)):

   ```powershell
   git tag 1.0.0
   git push origin 1.0.0
   ```

5. Confirm the GitHub Release attaches `main.js`, `manifest.json`, and `styles.css`.

Obsidian loads community installs **from GitHub release assets**, not from the git tree alone. The `manifest.json` at the repo root must match the latest release tag.

## Community plugin directory

To list this plugin in Obsidian’s **Community plugins** browser, a pull request is opened against [obsidianmd/obsidian-releases](https://github.com/obsidianmd/obsidian-releases) adding an entry to `community-plugins.json`:

```json
{
  "id": "zoom-mynotes-sync",
  "name": "Zoom MyNotes Sync",
  "author": "DaemonBehr",
  "description": "Deploy and run Zoom Notes transcript sync into this vault (Python + Playwright backend).",
  "repo": "script-repo/Zoom-MyNotes-Obsidian-plugin"
}
```

Requirements before/during review:

- Public GitHub repo with a clear README
- At least one [GitHub Release](https://github.com/script-repo/Zoom-MyNotes-Obsidian-plugin/releases) whose tag equals `manifest.json` → `version`, with `main.js`, `manifest.json`, and `styles.css` attached
- `id` never changes after publish (`zoom-mynotes-sync`)
- Desktop-only and process-spawning plugins receive stricter review

Until the PR is merged, use **BRAT** or **manual install** above.

## License

MIT — see [LICENSE](LICENSE).
