import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import * as fs from "fs";
import * as path from "path";
import type { ZoomSyncSettings } from "./settings";
import {
  looksLikeSyncRoot,
  resolvePython,
  resolveSyncRoot,
  resolveTranscriptsDir,
} from "./paths";

export type RunKind = "sync" | "login" | "setup-venv" | "pip-install" | "register-task" | "custom";

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
  try {
    if (process.platform === "win32" && active.pid) {
      spawn("taskkill", ["/pid", String(active.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
    } else {
      active.kill("SIGTERM");
    }
  } catch {
    /* ignore */
  }
  active = null;
  return true;
}

function buildEnv(
  settings: ZoomSyncSettings,
  vaultPath: string,
  extra?: NodeJS.ProcessEnv
): NodeJS.ProcessEnv {
  const transcripts = resolveTranscriptsDir(settings, vaultPath);
  return {
    ...process.env,
    ZOOM_TRANSCRIPTS_DIR: transcripts,
    ZOOM_HEADLESS: settings.headless ? "1" : "0",
    ZOOM_LOG_TITLES: settings.logTitles ? "1" : "0",
    PYTHONUNBUFFERED: "1",
    ...extra,
  };
}

export async function runProcess(opts: RunOptions): Promise<RunResult> {
  if (active) {
    throw new Error("Another Zoom sync process is already running");
  }

  const root = resolveSyncRoot(opts.settings);
  const cwd = opts.cwd || root;
  const command = opts.command || resolvePython(opts.settings);
  const args = opts.args ?? [];
  const env = buildEnv(opts.settings, opts.vaultPath, opts.env);
  const started = Date.now();
  const cmdLabel = `${command} ${args.join(" ")}`.trim();

  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;

    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(command, args, {
        cwd,
        env,
        windowsHide: true,
        shell: false,
      });
    } catch (e) {
      reject(e);
      return;
    }

    active = child;

    const finish = (code: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
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

    let timer: ReturnType<typeof setTimeout> | null = null;
    if (opts.timeoutMs && opts.timeoutMs > 0) {
      timer = setTimeout(() => {
        cancelActive();
        finish(null, "SIGTERM");
      }, opts.timeoutMs);
    }

    const feed = (chunk: Buffer | string, stream: "stdout" | "stderr") => {
      const text = chunk.toString();
      if (stream === "stdout") stdout += text;
      else stderr += text;
      if (opts.onLine) {
        for (const line of text.split(/\r?\n/)) {
          if (line) opts.onLine(line, stream);
        }
      }
      // Cap buffers
      if (stdout.length > 200_000) stdout = stdout.slice(-150_000);
      if (stderr.length > 200_000) stderr = stderr.slice(-150_000);
    };

    child.stdout.on("data", (d) => feed(d, "stdout"));
    child.stderr.on("data", (d) => feed(d, "stderr"));
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (active === child) active = null;
      reject(err);
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
    // Login is interactive; leave headless off via env override
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

export async function runRegisterTask(
  settings: ZoomSyncSettings,
  vaultPath: string,
  onLine?: RunOptions["onLine"]
): Promise<RunResult> {
  const root = resolveSyncRoot(settings);
  const script = path.join(root, "scripts", "register-task.ps1");
  if (!fs.existsSync(script)) {
    throw new Error(`Missing ${script}`);
  }
  const ps =
    process.env.SystemRoot
      ? path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
      : "powershell.exe";
  return runProcess({
    kind: "register-task",
    settings,
    vaultPath,
    command: ps,
    args: [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      script,
    ],
    cwd: root,
    env: {
      ZOOM_TASK_NAME: settings.taskName || "ZoomNotesSync",
    },
    timeoutMs: 2 * 60 * 1000,
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
