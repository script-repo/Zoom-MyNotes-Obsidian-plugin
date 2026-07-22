export interface ZoomSyncSettings {
  /** Absolute path to the zoom-mynotes-sync repo root. */
  syncRoot: string;
  /** Absolute path to python.exe (empty = auto-detect .venv then PATH). */
  pythonPath: string;
  /** Vault-relative folder for transcripts (ZOOM_TRANSCRIPTS_DIR). */
  outputFolder: string;
  /** Auto-sync interval while Obsidian is open (0 = off). */
  autoSyncMinutes: number;
  /** Run sync headless (ZOOM_HEADLESS). */
  headless: boolean;
  /** Log meeting titles (ZOOM_LOG_TITLES). */
  logTitles: boolean;
  /** Scheduled task name for Windows Task Scheduler. */
  taskName: string;
  /** Last successful sync ISO timestamp (UI only). */
  lastSyncAt: string;
  /** Last exit code from sync. */
  lastExitCode: number | null;
  /** Last short status line. */
  lastStatus: string;
}

const DEFAULT_SYNC_ROOT =
  process.platform === "win32"
    ? "C:\\Users\\DaemonBehr\\local-repo\\zoom-mynotes-sync"
    : "";

export const DEFAULT_SETTINGS: ZoomSyncSettings = {
  syncRoot: DEFAULT_SYNC_ROOT,
  pythonPath: "",
  outputFolder: "mynotes",
  autoSyncMinutes: 0,
  headless: true,
  logTitles: false,
  taskName: "ZoomNotesSync",
  lastSyncAt: "",
  lastExitCode: null,
  lastStatus: "",
};
