export interface ZoomSyncSettings {
  /** Absolute path to the zoom-mynotes-sync repo root. */
  syncRoot: string;
  /** Absolute path to Python (empty = auto-detect .venv then PATH). */
  pythonPath: string;
  /** Vault-relative folder for transcripts (ZOOM_TRANSCRIPTS_DIR). */
  outputFolder: string;
  /** Auto-sync interval while Obsidian is open (0 = off). */
  autoSyncMinutes: number;
  /** Run sync headless (ZOOM_HEADLESS). */
  headless: boolean;
  /** Log meeting titles (ZOOM_LOG_TITLES). */
  logTitles: boolean;
  /**
   * Background job name:
   * - Windows Task Scheduler task
   * - macOS LaunchAgent label suffix
   * - Linux cron comment marker
   */
  taskName: string;
  /** Last successful sync ISO timestamp (UI only). */
  lastSyncAt: string;
  /** Last exit code from sync. */
  lastExitCode: number | null;
  /** Last short status line. */
  lastStatus: string;
}

export const DEFAULT_SETTINGS: ZoomSyncSettings = {
  syncRoot: "",
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
