import * as fs from "fs";
import * as path from "path";
import type { ZoomSyncSettings } from "./settings";

export function expandPath(raw: string): string {
  if (!raw) return "";
  let p = raw.trim();
  if (p.startsWith("~")) {
    const home = process.env.USERPROFILE || process.env.HOME || "";
    p = path.join(home, p.slice(1).replace(/^[\\/]/, ""));
  }
  return path.normalize(p);
}

export function pathExists(p: string): boolean {
  try {
    return !!p && fs.existsSync(p);
  } catch {
    return false;
  }
}

export function isDir(p: string): boolean {
  try {
    return pathExists(p) && fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export function isFile(p: string): boolean {
  try {
    return pathExists(p) && fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

export function resolveSyncRoot(settings: ZoomSyncSettings): string {
  return expandPath(settings.syncRoot);
}

export function resolvePython(settings: ZoomSyncSettings): string {
  const explicit = expandPath(settings.pythonPath);
  if (explicit && isFile(explicit)) return explicit;

  const root = resolveSyncRoot(settings);
  if (root) {
    const candidates = [
      path.join(root, ".venv", "Scripts", "python.exe"),
      path.join(root, ".venv", "bin", "python"),
      path.join(root, ".venv", "bin", "python3"),
    ];
    for (const c of candidates) {
      if (isFile(c)) return c;
    }
  }
  return process.platform === "win32" ? "python" : "python3";
}

export function resolveTranscriptsDir(
  settings: ZoomSyncSettings,
  vaultPath: string
): string {
  const folder = (settings.outputFolder || "mynotes").replace(/^[\\/]+/, "");
  return path.normalize(path.join(vaultPath, folder));
}

export function looksLikeSyncRoot(root: string): boolean {
  if (!isDir(root)) return false;
  return (
    isFile(path.join(root, "sync.py")) &&
    isFile(path.join(root, "config.py")) &&
    isFile(path.join(root, "requirements.txt"))
  );
}

export function latestLogPath(root: string): string | null {
  const logs = path.join(root, "logs");
  if (!isDir(logs)) return null;
  let best: { name: string; mtime: number } | null = null;
  for (const name of fs.readdirSync(logs)) {
    if (!/^sync-\d{8}\.log$/i.test(name)) continue;
    const full = path.join(logs, name);
    try {
      const st = fs.statSync(full);
      if (!best || st.mtimeMs > best.mtime) {
        best = { name: full, mtime: st.mtimeMs };
      }
    } catch {
      /* skip */
    }
  }
  return best?.name ?? null;
}

export function readTail(filePath: string, maxBytes = 6000): string {
  try {
    const buf = fs.readFileSync(filePath);
    if (buf.length <= maxBytes) return buf.toString("utf8");
    return buf.subarray(buf.length - maxBytes).toString("utf8");
  } catch (e) {
    return `Could not read log: ${e instanceof Error ? e.message : String(e)}`;
  }
}
