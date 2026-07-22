import * as fs from "fs";
import * as http from "http";
import * as https from "https";
import * as path from "path";
import { BACKEND_FILES } from "./backendBundle.generated";
import { hostPlatform, venvPythonCandidates } from "./platform";
import { isFile, looksLikeSyncRoot, pathExists } from "./paths";
import { runProcess } from "./runner";
import type { ZoomSyncSettings } from "./settings";

/** Runtime backend lives under the vault config dir so plugin updates don't wipe it. */
export function defaultBackendRoot(
  vaultPath: string,
  configDir: string
): string {
  return path.join(vaultPath, configDir, "zoom-mynotes-backend");
}

export function writeBundledBackend(destRoot: string): string[] {
  const written: string[] = [];
  fs.mkdirSync(destRoot, { recursive: true });
  for (const [rel, content] of Object.entries(BACKEND_FILES)) {
    const full = path.join(destRoot, ...rel.split("/"));
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, "utf8");
    written.push(rel);
  }
  return written;
}

export function ensureBundledBackend(
  vaultPath: string,
  configDir: string,
  settings: ZoomSyncSettings
): { root: string; wrote: string[]; reused: boolean } {
  // Prefer an existing valid user-configured root.
  if (settings.syncRoot && looksLikeSyncRoot(settings.syncRoot)) {
    return { root: settings.syncRoot, wrote: [], reused: true };
  }

  const root = defaultBackendRoot(vaultPath, configDir);
  const wrote = writeBundledBackend(root);
  settings.syncRoot = root;
  return { root, wrote, reused: false };
}

function emptySettings(): ZoomSyncSettings {
  return {
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
}

async function tryPythonCmd(
  cmd: string,
  onLog?: (s: string) => void
): Promise<string | null> {
  try {
    const result = await runProcess({
      kind: "custom",
      settings: emptySettings(),
      vaultPath: process.cwd(),
      command: cmd,
      args: ["-c", "import sys; print(sys.executable)"],
      cwd: process.cwd(),
      timeoutMs: 15_000,
      onLine: onLog ? (l) => onLog(l) : undefined,
    });
    const line = (result.stdout || "")
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .pop();
    if (result.code === 0 && line) return line;
  } catch {
    /* next */
  }
  return null;
}

/** Find any usable system / package-manager Python. */
export async function findSystemPython(
  onLog?: (s: string) => void
): Promise<string | null> {
  const candidates: string[] =
    hostPlatform() === "win32"
      ? ["py", "python", "python3"]
      : [
          "python3",
          "python",
          "/opt/homebrew/bin/python3",
          "/usr/local/bin/python3",
          "/usr/bin/python3",
        ];
  for (const cmd of candidates) {
    const found = await tryPythonCmd(cmd, onLog);
    if (found) return found;
  }
  return null;
}

function portablePythonBinary(pythonRoot: string): string | null {
  const candidates =
    hostPlatform() === "win32"
      ? [
          path.join(pythonRoot, "python.exe"),
          path.join(pythonRoot, "python", "python.exe"),
        ]
      : [
          path.join(pythonRoot, "bin", "python3"),
          path.join(pythonRoot, "python", "bin", "python3"),
          path.join(pythonRoot, "bin", "python"),
        ];
  for (const c of candidates) {
    if (isFile(c) || pathExists(c)) return c;
  }
  return null;
}

/** python-build-standalone install_only asset for this OS/arch. */
export function portablePythonAsset(): {
  tag: string;
  name: string;
  url: string;
} | null {
  const tag = "20260718";
  const ver = "3.12.13";
  const plat = hostPlatform();
  const arch = process.arch; // 'arm64' | 'x64' | ...

  let triple: string | null = null;
  if (plat === "darwin" && arch === "arm64") {
    triple = "aarch64-apple-darwin";
  } else if (plat === "darwin" && arch === "x64") {
    triple = "x86_64-apple-darwin";
  } else if (plat === "linux" && arch === "arm64") {
    triple = "aarch64-unknown-linux-gnu";
  } else if (plat === "linux" && arch === "x64") {
    triple = "x86_64-unknown-linux-gnu";
  } else if (plat === "win32" && arch === "arm64") {
    triple = "aarch64-pc-windows-msvc";
  } else if (plat === "win32" && (arch === "x64" || arch === "ia32")) {
    triple = "x86_64-pc-windows-msvc";
  }

  if (!triple) return null;
  const name = `cpython-${ver}+${tag}-${triple}-install_only.tar.gz`;
  const url = `https://github.com/astral-sh/python-build-standalone/releases/download/${tag}/${name}`;
  return { tag, name, url };
}

function downloadToFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const maxRedirects = 5;
    const go = (current: string, left: number) => {
      const lib = current.startsWith("http://") ? http : https;
      const req = lib.get(current, (res) => {
        const code = res.statusCode || 0;
        if (
          code >= 300 &&
          code < 400 &&
          res.headers.location &&
          left > 0
        ) {
          res.resume();
          go(res.headers.location, left - 1);
          return;
        }
        if (code !== 200) {
          res.resume();
          reject(new Error(`Download failed HTTP ${code} for ${current}`));
          return;
        }
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        const out = fs.createWriteStream(dest);
        res.pipe(out);
        out.on("finish", () => out.close(() => resolve()));
        out.on("error", reject);
      });
      req.on("error", reject);
    };
    go(url, maxRedirects);
  });
}

async function extractTarGz(
  archive: string,
  destDir: string,
  settings: ZoomSyncSettings,
  vaultPath: string,
  onLog?: (s: string) => void
): Promise<void> {
  fs.mkdirSync(destDir, { recursive: true });
  const tar = hostPlatform() === "win32" ? "tar.exe" : "tar";
  const result = await runProcess({
    kind: "custom",
    settings,
    vaultPath,
    command: tar,
    args: ["-xzf", archive, "-C", destDir],
    cwd: destDir,
    timeoutMs: 5 * 60 * 1000,
    onLine: onLog ? (l) => onLog(l) : undefined,
  });
  if (result.code !== 0) {
    throw new Error(
      `Failed to extract Python archive (exit ${result.code}): ${
        result.stderr || result.stdout
      }`
    );
  }
}

/**
 * Ensure a Python interpreter exists: system first, else download portable CPython
 * into <backendRoot>/.python
 */
export async function ensurePython(
  backendRoot: string,
  settings: ZoomSyncSettings,
  vaultPath: string,
  onLog?: (s: string) => void
): Promise<{ python: string; source: "system" | "venv" | "portable" }> {
  // Existing venv under backend
  for (const c of venvPythonCandidates(backendRoot)) {
    if (isFile(c) || pathExists(c)) {
      return { python: c, source: "venv" };
    }
  }

  // Explicit setting
  if (settings.pythonPath && pathExists(settings.pythonPath)) {
    return { python: settings.pythonPath, source: "system" };
  }

  const system = await findSystemPython(onLog);
  if (system) return { python: system, source: "system" };

  // Portable already extracted?
  const portableRoot = path.join(backendRoot, ".python");
  const existing = portablePythonBinary(portableRoot);
  if (existing) return { python: existing, source: "portable" };

  const asset = portablePythonAsset();
  if (!asset) {
    throw new Error(
      `No system Python found and no portable build for ${process.platform}/${process.arch}. Install Python 3.11+ and retry.`
    );
  }

  onLog?.(`Downloading portable Python: ${asset.name}`);
  const archive = path.join(backendRoot, ".cache", asset.name);
  await downloadToFile(asset.url, archive);
  onLog?.("Extracting portable Python…");
  // Clear previous extract
  fs.rmSync(portableRoot, { recursive: true, force: true });
  fs.mkdirSync(portableRoot, { recursive: true });
  await extractTarGz(archive, portableRoot, settings, vaultPath, onLog);

  const bin = portablePythonBinary(portableRoot);
  if (!bin) {
    throw new Error(
      `Portable Python extracted but interpreter not found under ${portableRoot}`
    );
  }
  return { python: bin, source: "portable" };
}
