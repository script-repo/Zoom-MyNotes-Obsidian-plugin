import * as path from "path";

export type HostPlatform = "win32" | "darwin" | "linux" | "other";

export function hostPlatform(): HostPlatform {
  if (process.platform === "win32") return "win32";
  if (process.platform === "darwin") return "darwin";
  if (process.platform === "linux") return "linux";
  return "other";
}

/** Playwright channel preferred for this OS. Empty = bundled Chromium. */
export function defaultBrowserChannel(): string {
  // Windows: prefer installed Edge. macOS/Linux: bundled Chromium via playwright install.
  return hostPlatform() === "win32" ? "msedge" : "";
}

export function platformLabel(): string {
  switch (hostPlatform()) {
    case "win32":
      return "Windows";
    case "darwin":
      return "macOS";
    case "linux":
      return "Linux";
    default:
      return process.platform;
  }
}

/** User-facing name for the OS background scheduler. */
export function schedulerLabel(): string {
  switch (hostPlatform()) {
    case "win32":
      return "Task Scheduler";
    case "darwin":
      return "launchd (LaunchAgent)";
    case "linux":
      return "cron";
    default:
      return "background scheduler";
  }
}

/** POSIX single-quote (bash / sh). */
export function shellQuotePosix(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

/** PowerShell single-quoted string. */
export function shellQuotePowerShell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function venvPythonCandidates(root: string): string[] {
  return [
    path.join(root, ".venv", "Scripts", "python.exe"),
    path.join(root, ".venv", "bin", "python3"),
    path.join(root, ".venv", "bin", "python"),
  ];
}

export function sanitizeJobName(name: string): string {
  const cleaned = (name || "ZoomNotesSync").replace(/[^A-Za-z0-9._-]+/g, "-");
  return cleaned || "ZoomNotesSync";
}
