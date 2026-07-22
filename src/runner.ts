import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { defaultBrowserChannel, hostPlatform } from "./platform";
import type { ZoomSyncSettings } from "./settings";
import {
  looksLikeSyncRoot,
  resolvePython,
  resolveSyncRoot,
  resolveTranscriptsDir,
} from "./paths";

export type RunKind =
  | "sync"
  | "login"
  | "setup-venv"
  | "pip-install"
  | "register-task"
  | "custom";

export interface RunResult {
  kind: RunKind;
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  command: string;
}

export interface RunOptions {
  kind: RunKind;
  settings: ZoomSyncSettings;
  vaultPath: string;
  /** Override executable (default: resolved python). */
  command?: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Kill after this many ms (0 = no timeout). */
  timeoutMs?: number;
  onLine?: (line: string, stream: "stdout" | "stderr") => void;
}

let active: ChildProcessWithoutNullStreams | null = null;

export function isRunning(): boolean {
  return active !== null;
}

export function cancelActive(): boolean {
  if (!active) return false;
  const child = active;
  const pid = child.pid;
  try {
    if (hostPlatform() === "win32" && pid) {
      spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
    } else if (pid) {
      child.kill("SIGTERM");
      window.setTimeout(() => {
        try {
          if (!child.killed) child.kill("SIGKILL");
        } catch {
          /* ignore */
        }
      }, 3000);
    }
  } catch {
    /* ignore */
  }
  active = null;
  return true;
}

/**
 * Pass only non-identity env vars needed to locate executables and temp dirs.
 * Does not forward HOME/USERPROFILE/USERNAME or other identity-related values.
 */
function baseChildEnv(): NodeJS.ProcessEnv {
  const keys = [
    "PATH",
    "Path",
    "PATHEXT",
    "SystemRoot",
    "SYSTEMROOT",
    "windir",
    "TEMP",
    "TMP",
    "TMPDIR",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "DISPLAY",
    "WAYLAND_DISPLAY",
    "XAUTHORITY",
    "SSL_CERT_FILE",
    "REQUESTS_CA_BUNDLE",
    "PLAYWRIGHT_BROWSERS_PATH",
    "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD",
    "ZOOM_BROWSER_CHANNEL",
    "ComSpec",
    "COMSPEC",
    "ProgramFiles",
    "ProgramFiles(x86)",
    "ProgramW6432",
    "DYLD_LIBRARY_PATH",
    "LD_LIBRARY_PATH",
  ];
  const env: NodeJS.ProcessEnv = {};
  for (const k of keys) {
    const v = process.env[k];
    if (v !== undefined) env[k] = v;
  }
  return env;
}

function buildEnv(
  settings: ZoomSyncSettings,
  vaultPath: string,
  extra?: NodeJS.ProcessEnv
): NodeJS.ProcessEnv {
  const transcripts = resolveTranscriptsDir(settings, vaultPath);
  const root = resolveSyncRoot(settings);
  // Sandbox "home" under the sync repo so Playwright/Python never need the real user profile.
  const sandbox = root ? path.join(root, ".runtime-home") : "";
  const env: NodeJS.ProcessEnv = {
    ...baseChildEnv(),
    ZOOM_TRANSCRIPTS_DIR: transcripts,
    ZOOM_HEADLESS: settings.headless ? "1" : "0",
    ZOOM_LOG_TITLES: settings.logTitles ? "1" : "0",
    ZOOM_BROWSER_CHANNEL: defaultBrowserChannel(),
    PYTHONUNBUFFERED: "1",
  };
  if (sandbox) {
    env.HOME = sandbox;
    env.USERPROFILE = sandbox;
    env.XDG_CACHE_HOME = path.join(sandbox, "cache");
    env.XDG_CONFIG_HOME = path.join(sandbox, "config");
    env.XDG_DATA_HOME = path.join(sandbox, "data");
    env.PLAYWRIGHT_BROWSERS_PATH = path.join(root, ".playwright");
  }
  return { ...env, ...extra };
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

export async function runProcess(opts: RunOptions): Promise<RunResult> {
  if (active) {
    throw new Error("Another Zoom sync process is already running");
  }

  const root = resolveSyncRoot(opts.settings);
  const cwd = opts.cwd || root || process.cwd();
  const command = opts.command || resolvePython(opts.settings);
  const args = opts.args ?? [];
  const env = buildEnv(opts.settings, opts.vaultPath, opts.env);
  const started = Date.now();
  const cmdLabel = `${command} ${args.join(" ")}`.trim();

  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timer: number | null = null;

    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(command, args, {
        cwd,
        env,
        windowsHide: true,
        shell: false,
      });
    } catch (e) {
      reject(toError(e));
      return;
    }

    active = child;

    const finish = (code: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      if (timer !== null) window.clearTimeout(timer);
      if (active === child) active = null;
      resolve({
        kind: opts.kind,
        code,
        signal,
        stdout,
        stderr,
        durationMs: Date.now() - started,
        command: cmdLabel,
      });
    };

    if (opts.timeoutMs && opts.timeoutMs > 0) {
      timer = window.setTimeout(() => {
        cancelActive();
        finish(null, "SIGTERM");
      }, opts.timeoutMs);
    }

    const feed = (chunk: Buffer | string, stream: "stdout" | "stderr") => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      if (stream === "stdout") stdout += text;
      else stderr += text;
      if (opts.onLine) {
        for (const line of text.split(/\r?\n/)) {
          if (line) opts.onLine(line, stream);
        }
      }
      if (stdout.length > 200_000) stdout = stdout.slice(-150_000);
      if (stderr.length > 200_000) stderr = stderr.slice(-150_000);
    };

    const onStdout = (chunk: Buffer | string) => feed(chunk, "stdout");
    const onStderr = (chunk: Buffer | string) => feed(chunk, "stderr");

    child.stdout.on("data", onStdout);
    child.stderr.on("data", onStderr);
    child.on("error", (err: Error) => {
      if (settled) return;
      settled = true;
      if (timer !== null) window.clearTimeout(timer);
      if (active === child) active = null;
      reject(toError(err));
    });
    child.on("close", (code, signal) => finish(code, signal));
  });
}

export async function runSync(
  settings: ZoomSyncSettings,
  vaultPath: string,
  onLine?: RunOptions["onLine"]
): Promise<RunResult> {
  const root = resolveSyncRoot(settings);
  if (!looksLikeSyncRoot(root)) {
    throw new Error(`Invalid sync root (need sync.py): ${root || "(empty)"}`);
  }
  const py = resolvePython(settings);
  return runProcess({
    kind: "sync",
    settings,
    vaultPath,
    command: py,
    args: [path.join(root, "sync.py")],
    cwd: root,
    timeoutMs: 25 * 60 * 1000,
    onLine,
  });
}

export async function runLogin(
  settings: ZoomSyncSettings,
  vaultPath: string,
  onLine?: RunOptions["onLine"]
): Promise<RunResult> {
  const root = resolveSyncRoot(settings);
  if (!looksLikeSyncRoot(root)) {
    throw new Error(`Invalid sync root (need login.py): ${root || "(empty)"}`);
  }
  const py = resolvePython(settings);
  return runProcess({
    kind: "login",
    settings,
    vaultPath,
    command: py,
    args: [path.join(root, "login.py")],
    cwd: root,
    env: { ZOOM_HEADLESS: "0" },
    timeoutMs: 15 * 60 * 1000,
    onLine,
  });
}

export async function runSetupVenv(
  settings: ZoomSyncSettings,
  vaultPath: string,
  systemPython: string,
  onLine?: RunOptions["onLine"]
): Promise<RunResult> {
  const root = resolveSyncRoot(settings);
  if (!looksLikeSyncRoot(root)) {
    throw new Error(`Invalid sync root: ${root || "(empty)"}`);
  }
  const venvDir = path.join(root, ".venv");
  return runProcess({
    kind: "setup-venv",
    settings,
    vaultPath,
    command: systemPython,
    args: ["-m", "venv", venvDir],
    cwd: root,
    timeoutMs: 5 * 60 * 1000,
    onLine,
  });
}

export async function runPipInstall(
  settings: ZoomSyncSettings,
  vaultPath: string,
  onLine?: RunOptions["onLine"]
): Promise<RunResult> {
  const root = resolveSyncRoot(settings);
  const py = resolvePython(settings);
  const req = path.join(root, "requirements.txt");
  if (!fs.existsSync(req)) throw new Error(`Missing ${req}`);
  return runProcess({
    kind: "pip-install",
    settings,
    vaultPath,
    command: py,
    args: ["-m", "pip", "install", "-r", req],
    cwd: root,
    timeoutMs: 15 * 60 * 1000,
    onLine,
  });
}

export function exitLabel(code: number | null): string {
  if (code === null) return "killed";
  if (code === 0) return "ok";
  if (code === 1) return "hard fail";
  if (code === 2) return "degraded";
  if (code === 3) return "locked";
  return `exit ${code}`;
}
