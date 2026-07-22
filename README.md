# Zoom MyNotes Sync — Obsidian plugin

Desktop plugin that **deploys and controls** the Python + Playwright Zoom transcript
sync from inside Obsidian.

> Folder: `Zoom-MyNotes-Obsidian-plugin/` (lives next to the Python scraper in the monorepo).
> For a public/community release, copy this folder to its own GitHub repo root.

## What it does

- **Deploy wizard**: create `.venv`, `pip install`, prepare `mynotes/`, register
  Windows Task Scheduler (`ZoomNotesSync` every 30 min), copy plugin into the vault
- **Sync now** / **Login** commands and ribbon button
- **Settings**: repo path, transcripts folder, headless, auto-sync interval
- Sets `ZOOM_TRANSCRIPTS_DIR` to `<vault>/<output folder>` on every run

The scraper itself stays in the parent repo (`sync.py` / Playwright). This plugin
is the control plane and installer.

## Build & install (this monorepo)

```powershell
cd Zoom-MyNotes-Obsidian-plugin
npm install
npm run build
npm run install-vault
# or: node scripts/install-vault.mjs "D:\path\to\vault"
```

Then in Obsidian: **Settings → Community plugins → Zoom MyNotes Sync** (enable if needed),
reload app, open **Deploy wizard** once.

## Standalone / community packaging

1. Create a new public GitHub repo and put **these files at the repo root**
   (everything in this folder).
2. Keep `manifest.json` `id` as `zoom-mynotes-sync` (never change after publish).
3. Tag a release matching `manifest.json` → `version` (e.g. `1.0.0`).
4. Attach release assets: `main.js`, `manifest.json`, `styles.css`
   (workflow: `.github/workflows/release.yml`).
5. Optional: install via [BRAT](https://github.com/TfTHacker/obsidian42-brat).
6. Optional: PR to [obsidianmd/obsidian-releases](https://github.com/obsidianmd/obsidian-releases)
   `community-plugins.json` (review is strict for plugins that spawn processes).

```powershell
npm ci
npm run build
git tag 1.0.0
git push origin 1.0.0
```

## Commands

| Command | Action |
| --- | --- |
| Sync now | Run `sync.py` |
| Login (interactive SSO) | Run `login.py` (visible browser) |
| Open deploy wizard | Full setup |
| Show latest sync log | Tail `logs/sync-*.log` |
| Open transcripts folder | Focus vault output folder |
| Cancel running job | Kill active child process |

## Settings

| Setting | Default |
| --- | --- |
| Sync repo path | auto-detected when possible |
| Python path | `<repo>\.venv\Scripts\python.exe` |
| Transcripts folder | `mynotes` |
| Auto-sync (minutes) | `0` (off; use Task Scheduler) |
| Task name | `ZoomNotesSync` |

## Requirements

- Obsidian desktop (Windows recommended for Task Scheduler step)
- Python 3.11+ on PATH for first deploy
- Installed Microsoft Edge (Playwright channel `msedge`)
- Parent **zoom-mynotes-sync** Python repo cloned locally
