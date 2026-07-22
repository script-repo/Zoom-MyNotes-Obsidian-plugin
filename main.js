var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => ZoomMyNotesSyncPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var path6 = __toESM(require("path"));

// src/deploy.ts
var fs4 = __toESM(require("fs"));
var path5 = __toESM(require("path"));

// src/platform.ts
var path = __toESM(require("path"));
function hostPlatform() {
  if (process.platform === "win32") return "win32";
  if (process.platform === "darwin") return "darwin";
  if (process.platform === "linux") return "linux";
  return "other";
}
function defaultBrowserChannel() {
  return hostPlatform() === "win32" ? "msedge" : "chromium";
}
function platformLabel() {
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
function schedulerLabel() {
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
function shellQuotePosix(value) {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}
function shellQuotePowerShell(value) {
  return `'${value.replace(/'/g, "''")}'`;
}
function venvPythonCandidates(root) {
  return [
    path.join(root, ".venv", "Scripts", "python.exe"),
    path.join(root, ".venv", "bin", "python3"),
    path.join(root, ".venv", "bin", "python")
  ];
}
function sanitizeJobName(name) {
  const cleaned = (name || "ZoomNotesSync").replace(/[^A-Za-z0-9._-]+/g, "-");
  return cleaned || "ZoomNotesSync";
}

// src/paths.ts
var fs = __toESM(require("fs"));
var path2 = __toESM(require("path"));
function expandPath(raw) {
  if (!raw) return "";
  return path2.normalize(raw.trim());
}
function pathExists(p) {
  try {
    return !!p && fs.existsSync(p);
  } catch {
    return false;
  }
}
function isDir(p) {
  try {
    return pathExists(p) && fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}
function isFile(p) {
  try {
    return pathExists(p) && fs.statSync(p).isFile();
  } catch {
    return false;
  }
}
function resolveSyncRoot(settings) {
  return expandPath(settings.syncRoot);
}
function resolvePython(settings) {
  const explicit = expandPath(settings.pythonPath);
  if (explicit && (isFile(explicit) || pathExists(explicit))) return explicit;
  const root = resolveSyncRoot(settings);
  if (root) {
    for (const c of venvPythonCandidates(root)) {
      if (isFile(c) || pathExists(c)) return c;
    }
  }
  return process.platform === "win32" ? "python" : "python3";
}
function resolveTranscriptsDir(settings, vaultPath) {
  const folder = (settings.outputFolder || "mynotes").replace(/^[\\/]+/, "");
  return path2.normalize(path2.join(vaultPath, folder));
}
function looksLikeSyncRoot(root) {
  if (!isDir(root)) return false;
  return isFile(path2.join(root, "sync.py")) && isFile(path2.join(root, "config.py")) && isFile(path2.join(root, "requirements.txt"));
}
function latestLogPath(root) {
  const logs = path2.join(root, "logs");
  if (!isDir(logs)) return null;
  let best = null;
  for (const name of fs.readdirSync(logs)) {
    if (!/^sync-\d{8}\.log$/i.test(name)) continue;
    const full = path2.join(logs, name);
    try {
      const st = fs.statSync(full);
      if (!best || st.mtimeMs > best.mtime) {
        best = { name: full, mtime: st.mtimeMs };
      }
    } catch {
    }
  }
  return best?.name ?? null;
}
function readTail(filePath, maxBytes = 6e3) {
  try {
    const buf = fs.readFileSync(filePath);
    if (buf.length <= maxBytes) return buf.toString("utf8");
    return buf.subarray(buf.length - maxBytes).toString("utf8");
  } catch (e) {
    return `Could not read log: ${e instanceof Error ? e.message : String(e)}`;
  }
}

// src/schedule.ts
var fs3 = __toESM(require("fs"));
var path4 = __toESM(require("path"));

// src/runner.ts
var import_child_process = require("child_process");
var fs2 = __toESM(require("fs"));
var path3 = __toESM(require("path"));
var active = null;
function isRunning() {
  return active !== null;
}
function cancelActive() {
  if (!active) return false;
  const child = active;
  const pid = child.pid;
  try {
    if (hostPlatform() === "win32" && pid) {
      (0, import_child_process.spawn)("taskkill", ["/pid", String(pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore"
      });
    } else if (pid) {
      child.kill("SIGTERM");
      window.setTimeout(() => {
        try {
          if (!child.killed) child.kill("SIGKILL");
        } catch {
        }
      }, 3e3);
    }
  } catch {
  }
  active = null;
  return true;
}
function baseChildEnv() {
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
    "LD_LIBRARY_PATH"
  ];
  const env = {};
  for (const k of keys) {
    const v = process.env[k];
    if (v !== void 0) env[k] = v;
  }
  return env;
}
function buildEnv(settings, vaultPath, extra) {
  const transcripts = resolveTranscriptsDir(settings, vaultPath);
  const root = resolveSyncRoot(settings);
  const sandbox = root ? path3.join(root, ".runtime-home") : "";
  const env = {
    ...baseChildEnv(),
    ZOOM_TRANSCRIPTS_DIR: transcripts,
    ZOOM_HEADLESS: settings.headless ? "1" : "0",
    ZOOM_LOG_TITLES: settings.logTitles ? "1" : "0",
    ZOOM_BROWSER_CHANNEL: defaultBrowserChannel(),
    PYTHONUNBUFFERED: "1"
  };
  if (sandbox) {
    env.HOME = sandbox;
    env.USERPROFILE = sandbox;
    env.XDG_CACHE_HOME = path3.join(sandbox, "cache");
    env.XDG_CONFIG_HOME = path3.join(sandbox, "config");
    env.XDG_DATA_HOME = path3.join(sandbox, "data");
    env.PLAYWRIGHT_BROWSERS_PATH = path3.join(root, ".playwright");
  }
  return { ...env, ...extra };
}
function toError(err) {
  return err instanceof Error ? err : new Error(String(err));
}
async function runProcess(opts) {
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
  return new Promise((resolve2, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timer = null;
    let child;
    try {
      child = (0, import_child_process.spawn)(command, args, {
        cwd,
        env,
        windowsHide: true,
        shell: false
      });
    } catch (e) {
      reject(toError(e));
      return;
    }
    active = child;
    const finish = (code, signal) => {
      if (settled) return;
      settled = true;
      if (timer !== null) window.clearTimeout(timer);
      if (active === child) active = null;
      resolve2({
        kind: opts.kind,
        code,
        signal,
        stdout,
        stderr,
        durationMs: Date.now() - started,
        command: cmdLabel
      });
    };
    if (opts.timeoutMs && opts.timeoutMs > 0) {
      timer = window.setTimeout(() => {
        cancelActive();
        finish(null, "SIGTERM");
      }, opts.timeoutMs);
    }
    const feed = (chunk, stream) => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      if (stream === "stdout") stdout += text;
      else stderr += text;
      if (opts.onLine) {
        for (const line of text.split(/\r?\n/)) {
          if (line) opts.onLine(line, stream);
        }
      }
      if (stdout.length > 2e5) stdout = stdout.slice(-15e4);
      if (stderr.length > 2e5) stderr = stderr.slice(-15e4);
    };
    const onStdout = (chunk) => feed(chunk, "stdout");
    const onStderr = (chunk) => feed(chunk, "stderr");
    child.stdout.on("data", onStdout);
    child.stderr.on("data", onStderr);
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      if (timer !== null) window.clearTimeout(timer);
      if (active === child) active = null;
      reject(toError(err));
    });
    child.on("close", (code, signal) => finish(code, signal));
  });
}
async function runSync(settings, vaultPath, onLine) {
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
    args: [path3.join(root, "sync.py")],
    cwd: root,
    timeoutMs: 25 * 60 * 1e3,
    onLine
  });
}
async function runLogin(settings, vaultPath, onLine) {
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
    args: [path3.join(root, "login.py")],
    cwd: root,
    env: { ZOOM_HEADLESS: "0" },
    timeoutMs: 15 * 60 * 1e3,
    onLine
  });
}
async function runSetupVenv(settings, vaultPath, systemPython, onLine) {
  const root = resolveSyncRoot(settings);
  if (!looksLikeSyncRoot(root)) {
    throw new Error(`Invalid sync root: ${root || "(empty)"}`);
  }
  const venvDir = path3.join(root, ".venv");
  return runProcess({
    kind: "setup-venv",
    settings,
    vaultPath,
    command: systemPython,
    args: ["-m", "venv", venvDir],
    cwd: root,
    timeoutMs: 5 * 60 * 1e3,
    onLine
  });
}
async function runPipInstall(settings, vaultPath, onLine) {
  const root = resolveSyncRoot(settings);
  const py = resolvePython(settings);
  const req = path3.join(root, "requirements.txt");
  if (!fs2.existsSync(req)) throw new Error(`Missing ${req}`);
  return runProcess({
    kind: "pip-install",
    settings,
    vaultPath,
    command: py,
    args: ["-m", "pip", "install", "-r", req],
    cwd: root,
    timeoutMs: 15 * 60 * 1e3,
    onLine
  });
}
function exitLabel(code) {
  if (code === null) return "killed";
  if (code === 0) return "ok";
  if (code === 1) return "hard fail";
  if (code === 2) return "degraded";
  if (code === 3) return "locked";
  return `exit ${code}`;
}

// src/schedule.ts
var CRON_BEGIN = "# BEGIN zoom-mynotes-sync";
var CRON_END = "# END zoom-mynotes-sync";
function writeLocalEnvFiles(settings, vaultPath) {
  const root = resolveSyncRoot(settings);
  const out = resolveTranscriptsDir(settings, vaultPath);
  const py = resolvePython(settings);
  const channel = defaultBrowserChannel();
  const syncPy = path4.join(root, "sync.py");
  const envSh = path4.join(root, "local-env.sh");
  const envPs1 = path4.join(root, "local-env.ps1");
  const runSh = path4.join(root, "run-sync.sh");
  const runPs1 = path4.join(root, "run-sync.ps1");
  const shBody = `# Generated by Zoom MyNotes Sync Obsidian plugin \u2014 do not commit secrets.
export ZOOM_TRANSCRIPTS_DIR=${shellQuotePosix(out)}
export ZOOM_HEADLESS=\${ZOOM_HEADLESS:-1}
export ZOOM_LOG_TITLES=\${ZOOM_LOG_TITLES:-0}
export ZOOM_BROWSER_CHANNEL=\${ZOOM_BROWSER_CHANNEL:-${channel}}
export PYTHONUNBUFFERED=1
`;
  const psBody = `# Generated by Zoom MyNotes Sync Obsidian plugin \u2014 do not commit secrets.
$env:ZOOM_TRANSCRIPTS_DIR = ${shellQuotePowerShell(out)}
if (-not $env:ZOOM_HEADLESS) { $env:ZOOM_HEADLESS = '1' }
if (-not $env:ZOOM_LOG_TITLES) { $env:ZOOM_LOG_TITLES = '0' }
if (-not $env:ZOOM_BROWSER_CHANNEL) { $env:ZOOM_BROWSER_CHANNEL = '${channel}' }
$env:PYTHONUNBUFFERED = '1'
`;
  const runShBody = `#!/usr/bin/env bash
set -euo pipefail
ROOT=${shellQuotePosix(root)}
cd "$ROOT"
# shellcheck disable=SC1091
source "$ROOT/local-env.sh"
exec ${shellQuotePosix(py)} ${shellQuotePosix(syncPy)}
`;
  const runPsBody = `$ErrorActionPreference = 'Stop'
$Root = ${shellQuotePowerShell(root)}
Set-Location -LiteralPath $Root
. (Join-Path $Root 'local-env.ps1')
& ${shellQuotePowerShell(py)} ${shellQuotePowerShell(syncPy)}
exit $LASTEXITCODE
`;
  fs3.writeFileSync(envSh, shBody, "utf8");
  fs3.writeFileSync(envPs1, psBody, "utf8");
  fs3.writeFileSync(runSh, runShBody, { encoding: "utf8", mode: 493 });
  fs3.writeFileSync(runPs1, runPsBody, "utf8");
  try {
    fs3.chmodSync(runSh, 493);
    fs3.chmodSync(envSh, 420);
  } catch {
  }
  return { envSh, envPs1, runSh, runPs1 };
}
async function registerWindows(ctx, runPs1) {
  const root = resolveSyncRoot(ctx.settings);
  const script = path4.join(root, "scripts", "register-task.ps1");
  const ps = "powershell.exe";
  if (isFile(script)) {
    return runProcess({
      kind: "register-task",
      settings: ctx.settings,
      vaultPath: ctx.vaultPath,
      command: ps,
      args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script],
      cwd: root,
      env: {
        ZOOM_TASK_NAME: ctx.settings.taskName || "ZoomNotesSync"
      },
      timeoutMs: 2 * 60 * 1e3,
      onLine: ctx.onLine
    });
  }
  const name = sanitizeJobName(ctx.settings.taskName);
  const tr = `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${runPs1}"`;
  return runProcess({
    kind: "register-task",
    settings: ctx.settings,
    vaultPath: ctx.vaultPath,
    command: "schtasks",
    args: [
      "/Create",
      "/F",
      "/TN",
      name,
      "/SC",
      "MINUTE",
      "/MO",
      "30",
      "/TR",
      tr,
      "/RL",
      "LIMITED"
    ],
    cwd: root,
    timeoutMs: 2 * 60 * 1e3,
    onLine: ctx.onLine
  });
}
async function registerDarwin(ctx, runSh) {
  const name = sanitizeJobName(ctx.settings.taskName);
  const label = `com.zoom-mynotes-sync.${name}`;
  const root = resolveSyncRoot(ctx.settings);
  const agentsDir = path4.join(root, "launchd");
  fs3.mkdirSync(agentsDir, { recursive: true });
  const plistPath = path4.join(agentsDir, `${label}.plist`);
  const logOut = path4.join(root, "logs", "launchd-stdout.log");
  const logErr = path4.join(root, "logs", "launchd-stderr.log");
  fs3.mkdirSync(path4.join(root, "logs"), { recursive: true });
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${escapeXml(runSh)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${escapeXml(root)}</string>
  <key>StartInterval</key>
  <integer>1800</integer>
  <key>RunAtLoad</key>
  <false/>
  <key>StandardOutPath</key>
  <string>${escapeXml(logOut)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(logErr)}</string>
  <key>ProcessType</key>
  <string>Background</string>
</dict>
</plist>
`;
  fs3.writeFileSync(plistPath, plist, "utf8");
  await runProcess({
    kind: "register-task",
    settings: ctx.settings,
    vaultPath: ctx.vaultPath,
    command: "launchctl",
    args: ["unload", plistPath],
    cwd: root,
    timeoutMs: 3e4,
    onLine: ctx.onLine
  }).catch(() => void 0);
  return runProcess({
    kind: "register-task",
    settings: ctx.settings,
    vaultPath: ctx.vaultPath,
    command: "launchctl",
    args: ["load", plistPath],
    cwd: root,
    timeoutMs: 3e4,
    onLine: ctx.onLine
  });
}
async function registerLinux(ctx, runSh) {
  const root = resolveSyncRoot(ctx.settings);
  const name = sanitizeJobName(ctx.settings.taskName);
  const begin = `${CRON_BEGIN} ${name}`;
  const end = `${CRON_END} ${name}`;
  const line = `*/30 * * * * /bin/bash ${shellQuotePosix(runSh)} >> ${shellQuotePosix(
    path4.join(root, "logs", "cron-sync.log")
  )} 2>&1`;
  fs3.mkdirSync(path4.join(root, "logs"), { recursive: true });
  let existing = "";
  try {
    const r = await runProcess({
      kind: "custom",
      settings: ctx.settings,
      vaultPath: ctx.vaultPath,
      command: "crontab",
      args: ["-l"],
      cwd: root,
      timeoutMs: 15e3,
      onLine: ctx.onLine
    });
    if (r.code === 0) existing = r.stdout || "";
  } catch {
    existing = "";
  }
  const stripped = stripCronBlock(existing, begin, end);
  const next = (stripped.trimEnd() ? stripped.trimEnd() + "\n" : "") + `${begin}
${line}
${end}
`;
  const tmp = path4.join(root, ".zoom-mynotes-crontab.tmp");
  fs3.writeFileSync(tmp, next, "utf8");
  try {
    const r = await runProcess({
      kind: "register-task",
      settings: ctx.settings,
      vaultPath: ctx.vaultPath,
      command: "crontab",
      args: [tmp],
      cwd: root,
      timeoutMs: 15e3,
      onLine: ctx.onLine
    });
    return r;
  } finally {
    try {
      fs3.unlinkSync(tmp);
    } catch {
    }
  }
}
function stripCronBlock(src, begin, end) {
  const lines = src.split(/\r?\n/);
  const out = [];
  let skipping = false;
  for (const line of lines) {
    if (line.trim() === begin) {
      skipping = true;
      continue;
    }
    if (line.trim() === end) {
      skipping = false;
      continue;
    }
    if (!skipping) out.push(line);
  }
  while (out.length && out[out.length - 1] === "") out.pop();
  return out.join("\n") + (out.length ? "\n" : "");
}
function escapeXml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
async function runRegisterSchedule(ctx) {
  const files = writeLocalEnvFiles(ctx.settings, ctx.vaultPath);
  const platform = hostPlatform();
  const label = schedulerLabel();
  if (platform === "win32") {
    const result = await registerWindows(ctx, files.runPs1);
    return {
      result,
      detail: result.code === 0 ? `${label} job '${sanitizeJobName(ctx.settings.taskName)}' every 30 min` : `Failed to register ${label}`
    };
  }
  if (platform === "darwin") {
    const result = await registerDarwin(ctx, files.runSh);
    return {
      result,
      detail: result.code === 0 ? `${label}: com.zoom-mynotes-sync.${sanitizeJobName(
        ctx.settings.taskName
      )} every 30 min` : `Failed to load LaunchAgent`
    };
  }
  if (platform === "linux") {
    const result = await registerLinux(ctx, files.runSh);
    return {
      result,
      detail: result.code === 0 ? `${label} entry every 30 min (user crontab)` : `Failed to install crontab entry (is cron available?)`
    };
  }
  return {
    result: {
      kind: "register-task",
      code: 0,
      signal: null,
      stdout: "",
      stderr: "",
      durationMs: 0,
      command: "(skip)"
    },
    detail: `Background scheduling not automated on ${process.platform}. Use Obsidian auto-sync or run ${files.runSh} manually.`
  };
}

// src/deploy.ts
function step(id, title, status = "pending", detail = "") {
  return { id, title, status, detail };
}
function initialSteps() {
  return [
    step("root", "Locate sync repo"),
    step("python", "Find system Python"),
    step("venv", "Create .venv"),
    step("deps", "Install Python packages"),
    step("playwright", `Verify Playwright + browser (${platformLabel()})`),
    step("output", "Prepare transcripts folder"),
    step("auth", "Check Zoom login state"),
    step("task", `Register ${schedulerLabel()} job`),
    step("plugin", "Install plugin into this vault")
  ];
}
function emptySettings() {
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
    lastStatus: ""
  };
}
async function whichPython(onLog) {
  const candidates = hostPlatform() === "win32" ? ["py", "python", "python3"] : ["python3", "python"];
  for (const cmd of candidates) {
    try {
      const result = await runProcess({
        kind: "custom",
        settings: emptySettings(),
        vaultPath: process.cwd(),
        command: cmd,
        args: ["-c", "import sys; print(sys.executable)"],
        cwd: process.cwd(),
        timeoutMs: 15e3,
        onLine: onLog ? (l) => onLog(l) : void 0
      });
      const line = (result.stdout || "").trim().split(/\r?\n/).filter(Boolean).pop();
      if (result.code === 0 && line && (isFile(line) || pathExists(line))) {
        return line;
      }
      if (result.code === 0 && line) return line;
    } catch {
    }
  }
  return null;
}
function summarizeResult(r) {
  const out = (r.stdout || r.stderr || "").trim();
  const tail = out.slice(-400);
  return `exit=${r.code} ${tail}`.trim();
}
function resolveVenvPython(root) {
  for (const c of venvPythonCandidates(root)) {
    if (isFile(c) || pathExists(c)) return c;
  }
  return null;
}
async function runFullDeploy(ctx) {
  const steps = initialSteps();
  const set = (id, status, detail) => {
    const s = steps.find((x) => x.id === id);
    if (s) {
      s.status = status;
      s.detail = detail;
    }
    ctx.onUpdate([...steps]);
  };
  const log = (line) => ctx.onLog?.(line);
  set("root", "running", "Checking\u2026");
  const root = resolveSyncRoot(ctx.settings);
  if (!looksLikeSyncRoot(root)) {
    set(
      "root",
      "fail",
      `Set Sync repo path in settings to the zoom-mynotes-sync folder (has sync.py). Got: ${root || "(empty)"}`
    );
    return steps;
  }
  set("root", "ok", root);
  set("python", "running", "Searching\u2026");
  const systemPy = await whichPython(log);
  if (!systemPy) {
    set(
      "python",
      "fail",
      "No python3/python on PATH. Install Python 3.11+ and retry."
    );
    return steps;
  }
  set("python", "ok", systemPy);
  set("venv", "running", "Creating .venv if needed\u2026");
  let venvPy = resolveVenvPython(root);
  if (venvPy) {
    set("venv", "ok", `Exists: ${venvPy}`);
  } else {
    try {
      const r = await runSetupVenv(ctx.settings, ctx.vaultPath, systemPy, log);
      venvPy = resolveVenvPython(root);
      if (r.code !== 0 || !venvPy) {
        set("venv", "fail", summarizeResult(r));
        return steps;
      }
      set("venv", "ok", venvPy);
    } catch (e) {
      set("venv", "fail", e instanceof Error ? e.message : String(e));
      return steps;
    }
  }
  ctx.settings.pythonPath = venvPy;
  set("deps", "running", "pip install -r requirements.txt\u2026");
  try {
    const r = await runPipInstall(ctx.settings, ctx.vaultPath, log);
    if (r.code !== 0) {
      set("deps", "fail", summarizeResult(r));
      return steps;
    }
    set("deps", "ok", "requirements installed");
  } catch (e) {
    set("deps", "fail", e instanceof Error ? e.message : String(e));
    return steps;
  }
  const channel = defaultBrowserChannel();
  set("playwright", "running", `import playwright + ensure ${channel}\u2026`);
  try {
    const py = resolvePython(ctx.settings);
    const r = await runProcess({
      kind: "custom",
      settings: ctx.settings,
      vaultPath: ctx.vaultPath,
      command: py,
      args: [
        "-c",
        "import playwright; print('playwright ok')"
      ],
      cwd: root,
      timeoutMs: 3e4,
      onLine: log
    });
    if (r.code !== 0) {
      set("playwright", "fail", summarizeResult(r));
      return steps;
    }
    const installArgs = channel === "msedge" ? ["-m", "playwright", "install", "msedge"] : ["-m", "playwright", "install", "chromium"];
    const ir = await runProcess({
      kind: "custom",
      settings: ctx.settings,
      vaultPath: ctx.vaultPath,
      command: py,
      args: installArgs,
      cwd: root,
      timeoutMs: 10 * 60 * 1e3,
      onLine: log
    });
    if (ir.code !== 0) {
      set(
        "playwright",
        "ok",
        `playwright import ok; browser install exited ${ir.code}. Set ZOOM_BROWSER_CHANNEL if needed (default ${channel}). ` + (hostPlatform() === "win32" ? "Edge recommended on Windows." : "Chromium will be used on macOS/Linux.")
      );
    } else {
      set(
        "playwright",
        "ok",
        `playwright ok; channel=${channel} (${platformLabel()})`
      );
    }
  } catch (e) {
    set("playwright", "fail", e instanceof Error ? e.message : String(e));
    return steps;
  }
  set("output", "running", "Creating transcripts folder\u2026");
  try {
    const out = resolveTranscriptsDir(ctx.settings, ctx.vaultPath);
    fs4.mkdirSync(out, { recursive: true });
    const files = writeLocalEnvFiles(ctx.settings, ctx.vaultPath);
    set(
      "output",
      "ok",
      `${out}
(wrote ${path5.basename(files.envSh)}, ${path5.basename(
        files.envPs1
      )}, ${path5.basename(files.runSh)}, ${path5.basename(files.runPs1)})`
    );
  } catch (e) {
    set("output", "fail", e instanceof Error ? e.message : String(e));
    return steps;
  }
  set("auth", "running", "Checking storage_state.json\u2026");
  const state = path5.join(root, "storage_state.json");
  if (isFile(state)) {
    set("auth", "ok", `Session present: ${state}`);
  } else {
    set(
      "auth",
      "skip",
      "No storage_state.json yet \u2014 run command \u201CLogin (interactive SSO)\u201D once after deploy."
    );
  }
  set("task", "running", `Registering ${schedulerLabel()}\u2026`);
  try {
    const { result, detail } = await runRegisterSchedule({
      settings: ctx.settings,
      vaultPath: ctx.vaultPath,
      onLine: log
    });
    if (hostPlatform() === "other") {
      set("task", "skip", detail);
    } else if (result.code !== 0) {
      set("task", "fail", `${detail}
${summarizeResult(result)}`);
    } else {
      set("task", "ok", detail);
    }
  } catch (e) {
    set("task", "fail", e instanceof Error ? e.message : String(e));
  }
  const configDir = (ctx.configDir || "").trim();
  if (!configDir) {
    set(
      "plugin",
      "fail",
      "Missing vault config directory (Vault.configDir is empty)."
    );
    return steps;
  }
  set("plugin", "running", `Copying plugin into ${configDir}/plugins\u2026`);
  try {
    const dest = path5.join(
      ctx.vaultPath,
      configDir,
      "plugins",
      "zoom-mynotes-sync"
    );
    fs4.mkdirSync(dest, { recursive: true });
    const files = ["main.js", "manifest.json", "styles.css"];
    const srcDir = ctx.pluginDir;
    const copied = [];
    for (const f of files) {
      const from = path5.join(srcDir, f);
      if (!pathExists(from)) {
        throw new Error(`Missing build artifact: ${from}`);
      }
      fs4.copyFileSync(from, path5.join(dest, f));
      copied.push(f);
    }
    const community = path5.join(
      ctx.vaultPath,
      configDir,
      "community-plugins.json"
    );
    let list = [];
    if (isFile(community)) {
      try {
        list = JSON.parse(fs4.readFileSync(community, "utf8"));
        if (!Array.isArray(list)) list = [];
      } catch {
        list = [];
      }
    }
    if (!list.includes("zoom-mynotes-sync")) {
      list.push("zoom-mynotes-sync");
      fs4.writeFileSync(community, JSON.stringify(list, null, 2) + "\n", "utf8");
    }
    set(
      "plugin",
      "ok",
      `Installed to ${dest} (${copied.join(", ")}). Reload Obsidian if this is first install.`
    );
  } catch (e) {
    set("plugin", "fail", e instanceof Error ? e.message : String(e));
  }
  return steps;
}
function detectDefaultSyncRoot(pluginDir) {
  const candidates = [
    path5.resolve(pluginDir, ".."),
    path5.resolve(pluginDir, "..", ".."),
    path5.resolve(pluginDir, "..", "..", "..")
  ];
  for (const c of candidates) {
    if (looksLikeSyncRoot(c)) return c;
  }
  return "";
}
function deploySummary(steps) {
  const fail = steps.filter((s) => s.status === "fail");
  const ok = steps.filter((s) => s.status === "ok");
  const skip = steps.filter((s) => s.status === "skip");
  if (fail.length) return `Deploy incomplete: ${fail.map((f) => f.id).join(", ")} failed`;
  return `Deploy OK (${ok.length} ok, ${skip.length} skipped)`;
}

// src/settings.ts
var DEFAULT_SETTINGS = {
  syncRoot: "",
  pythonPath: "",
  outputFolder: "mynotes",
  autoSyncMinutes: 0,
  headless: true,
  logTitles: false,
  taskName: "ZoomNotesSync",
  lastSyncAt: "",
  lastExitCode: null,
  lastStatus: ""
};

// src/main.ts
var ZoomMyNotesSyncPlugin = class extends import_obsidian.Plugin {
  constructor() {
    super(...arguments);
    this.settings = { ...DEFAULT_SETTINGS };
    this.statusEl = null;
    this.autoTimer = null;
    this.running = false;
  }
  async onload() {
    await this.loadSettings();
    if (!this.settings.syncRoot) {
      const guessed = detectDefaultSyncRoot(this.manifest.dir || "");
      if (guessed) {
        this.settings.syncRoot = guessed;
        await this.saveSettings();
      }
    }
    this.statusEl = this.addStatusBarItem();
    this.statusEl.addClass("zoom-sync-status");
    this.refreshStatusBar();
    this.addRibbonIcon("audio-file", "Zoom MyNotes Sync", () => {
      void this.commandSync();
    });
    this.addCommand({
      id: "zoom-sync-now",
      name: "Sync now",
      callback: () => void this.commandSync()
    });
    this.addCommand({
      id: "zoom-sync-login",
      name: "Login (interactive SSO)",
      callback: () => void this.commandLogin()
    });
    this.addCommand({
      id: "zoom-sync-deploy",
      name: "Open deploy wizard",
      callback: () => new DeployModal(this.app, this).open()
    });
    this.addCommand({
      id: "zoom-sync-cancel",
      name: "Cancel running job",
      callback: () => {
        if (cancelActive()) {
          new import_obsidian.Notice("Zoom sync: cancelled");
          this.setRunning(false, "cancelled");
        } else {
          new import_obsidian.Notice("Zoom sync: nothing running");
        }
      }
    });
    this.addCommand({
      id: "zoom-sync-open-folder",
      name: "Open transcripts folder",
      callback: () => void this.openTranscriptsFolder()
    });
    this.addCommand({
      id: "zoom-sync-show-log",
      name: "Show latest sync log",
      callback: () => new LogModal(this.app, this).open()
    });
    this.addSettingTab(new ZoomSyncSettingTab(this.app, this));
    this.rescheduleAutoSync();
  }
  onunload() {
    if (this.autoTimer !== null) {
      window.clearInterval(this.autoTimer);
      this.autoTimer = null;
    }
    cancelActive();
  }
  async loadSettings() {
    const data = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data ?? {});
  }
  async saveSettings() {
    await this.saveData(this.settings);
    this.rescheduleAutoSync();
    this.refreshStatusBar();
  }
  vaultPath() {
    const adapter = this.app.vault.adapter;
    if (typeof adapter.getBasePath === "function") {
      return adapter.getBasePath();
    }
    throw new Error("Vault base path unavailable (desktop only)");
  }
  configDir() {
    return this.app.vault.configDir;
  }
  pluginSourceDir() {
    const dir = this.manifest.dir;
    if (dir) {
      const abs = path6.join(this.vaultPath(), dir);
      if (isFile(path6.join(abs, "main.js"))) return abs;
    }
    const root = resolveSyncRoot(this.settings);
    if (root) {
      const dev = path6.join(root, "Zoom-MyNotes-Obsidian-plugin");
      if (isFile(path6.join(dev, "main.js"))) return dev;
    }
    return dir ? path6.join(this.vaultPath(), dir) : "";
  }
  rescheduleAutoSync() {
    if (this.autoTimer !== null) {
      window.clearInterval(this.autoTimer);
      this.autoTimer = null;
    }
    const mins = Number(this.settings.autoSyncMinutes) || 0;
    if (mins <= 0) return;
    this.autoTimer = window.setInterval(() => {
      if (!this.running && !isRunning()) void this.commandSync(true);
    }, mins * 60 * 1e3);
  }
  setRunning(running, status) {
    this.running = running;
    if (status !== void 0) this.settings.lastStatus = status;
    this.refreshStatusBar();
  }
  refreshStatusBar() {
    if (!this.statusEl) return;
    this.statusEl.removeClass("is-running");
    this.statusEl.removeClass("is-error");
    this.statusEl.removeClass("is-ok");
    if (this.running) {
      this.statusEl.addClass("is-running");
      this.statusEl.setText("Zoom sync: running\u2026");
      return;
    }
    const code = this.settings.lastExitCode;
    const label = this.settings.lastStatus || (code === null || code === void 0 ? "idle" : `last ${exitLabel(code)}`);
    if (code === 0) this.statusEl.addClass("is-ok");
    else if (code !== null && code !== void 0 && code !== 0) {
      this.statusEl.addClass("is-error");
    }
    this.statusEl.setText(`Zoom sync: ${label}`);
  }
  assertReady() {
    const root = resolveSyncRoot(this.settings);
    if (!looksLikeSyncRoot(root)) {
      throw new Error(
        "Set Settings \u2192 Zoom MyNotes Sync \u2192 Sync repo path (folder with sync.py)"
      );
    }
    const py = resolvePython(this.settings);
    if (!py) throw new Error("Python not found \u2014 run Deploy wizard");
  }
  async commandSync(quiet = false) {
    if (this.running || isRunning()) {
      if (!quiet) new import_obsidian.Notice("Zoom sync already running");
      return;
    }
    try {
      this.assertReady();
    } catch (e) {
      new import_obsidian.Notice(e instanceof Error ? e.message : String(e));
      return;
    }
    this.setRunning(true, "syncing\u2026");
    if (!quiet) new import_obsidian.Notice("Zoom sync started");
    try {
      const result = await runSync(this.settings, this.vaultPath());
      await this.recordResult(result);
      const msg = `Zoom sync ${exitLabel(result.code)} (${Math.round(result.durationMs / 1e3)}s)`;
      new import_obsidian.Notice(msg);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.settings.lastExitCode = 1;
      this.settings.lastStatus = msg.slice(0, 120);
      await this.saveSettings();
      new import_obsidian.Notice(`Zoom sync failed: ${msg}`);
    } finally {
      this.setRunning(false);
    }
  }
  async commandLogin() {
    if (this.running || isRunning()) {
      new import_obsidian.Notice("Zoom sync already running");
      return;
    }
    try {
      this.assertReady();
    } catch (e) {
      new import_obsidian.Notice(e instanceof Error ? e.message : String(e));
      return;
    }
    this.setRunning(true, "login\u2026");
    new import_obsidian.Notice("Zoom login: complete SSO in the browser window");
    try {
      const settings = { ...this.settings, headless: false };
      const result = await runLogin(settings, this.vaultPath());
      await this.recordResult(result);
      new import_obsidian.Notice(
        result.code === 0 ? "Zoom login saved" : `Zoom login ${exitLabel(result.code)}`
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      new import_obsidian.Notice(`Zoom login failed: ${msg}`);
      this.settings.lastStatus = msg.slice(0, 120);
      await this.saveSettings();
    } finally {
      this.setRunning(false);
    }
  }
  async recordResult(result) {
    this.settings.lastExitCode = result.code;
    this.settings.lastStatus = exitLabel(result.code);
    if (result.code === 0) {
      this.settings.lastSyncAt = (/* @__PURE__ */ new Date()).toISOString();
    }
    await this.saveSettings();
  }
  async openTranscriptsFolder() {
    try {
      const rel = (0, import_obsidian.normalizePath)(this.settings.outputFolder || "mynotes");
      if (!this.app.vault.getAbstractFileByPath(rel)) {
        await this.app.vault.createFolder(rel);
      }
      const abs = resolveTranscriptsDir(this.settings, this.vaultPath());
      new import_obsidian.Notice(`Transcripts folder: ${rel} (${abs})`);
    } catch (e) {
      new import_obsidian.Notice(e instanceof Error ? e.message : String(e));
    }
  }
};
var ZoomSyncSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  getSettingDefinitions() {
    const pathPlaceholder = process.platform === "win32" ? "C:\\Users\\\u2026\\zoom-mynotes-sync" : "/Users/\u2026/zoom-mynotes-sync";
    return [
      {
        type: "group",
        heading: "General",
        items: [
          {
            name: "About",
            desc: "Controls the Python + Playwright backend that downloads Zoom AI notes transcripts into this vault. Desktop only; runs a local Python process you configure."
          },
          {
            name: "Sync repo path",
            desc: "Absolute path to the zoom-mynotes-sync repository (contains sync.py). Do not use ~.",
            aliases: ["sync root", "python repo"],
            control: {
              type: "text",
              key: "syncRoot",
              placeholder: pathPlaceholder
            }
          },
          {
            name: "Python path",
            desc: "Optional absolute path. Leave empty to use .venv (Windows: Scripts/python.exe, macOS/Linux: bin/python3).",
            control: {
              type: "text",
              key: "pythonPath",
              placeholder: "(auto)"
            }
          },
          {
            name: "Transcripts folder",
            desc: "Vault-relative folder for .md transcripts (month subfolders inside).",
            control: {
              type: "folder",
              key: "outputFolder",
              placeholder: "mynotes",
              includeRoot: false
            }
          },
          {
            name: "Headless sync",
            desc: "Run browser without a visible window (login always opens a window).",
            control: {
              type: "toggle",
              key: "headless"
            }
          },
          {
            name: "Log meeting titles",
            desc: "Include titles in sync logs (off by default for privacy).",
            control: {
              type: "toggle",
              key: "logTitles"
            }
          },
          {
            name: "Auto-sync while Obsidian is open",
            desc: "Minutes between syncs (0 = disabled). OS background job still covers when Obsidian is closed.",
            aliases: ["interval"],
            control: {
              type: "number",
              key: "autoSyncMinutes",
              placeholder: "0",
              min: 0,
              step: 1
            }
          },
          {
            name: "Background job name",
            desc: "Name used by the deploy wizard: Windows Task Scheduler, macOS LaunchAgent, or Linux cron marker.",
            control: {
              type: "text",
              key: "taskName",
              placeholder: "ZoomNotesSync"
            }
          },
          {
            name: "Open deploy wizard",
            desc: "Create venv, install deps, register OS background job, install plugin into vault.",
            action: () => {
              new DeployModal(this.app, this.plugin).open();
            }
          },
          {
            name: "Sync now",
            desc: "Run the Python sync backend once.",
            action: () => {
              void this.plugin.commandSync();
            }
          },
          {
            name: "Login",
            desc: "Interactive Zoom SSO (opens a browser window).",
            action: () => {
              void this.plugin.commandLogin();
            }
          },
          {
            name: "Show log",
            desc: "Open the latest sync log from the backend repo.",
            action: () => {
              new LogModal(this.app, this.plugin).open();
            }
          },
          {
            name: "Resolved paths",
            desc: "Current paths used by the plugin.",
            searchable: true,
            render: (setting) => {
              const root = resolveSyncRoot(this.plugin.settings);
              const lines = [
                `repo: ${root || "(not set)"}`,
                `python: ${resolvePython(this.plugin.settings)}`,
                `transcripts: ${resolveTranscriptsDir(this.plugin.settings, this.plugin.vaultPath())}`,
                `configDir: ${this.plugin.configDir()}`,
                `last: ${this.plugin.settings.lastSyncAt || "never"} (${this.plugin.settings.lastStatus || "\u2014"})`
              ];
              setting.setDesc(lines.join("\n"));
              setting.descEl.addClass("zoom-deploy-detail");
            }
          }
        ]
      }
    ];
  }
  async setControlValue(key, value) {
    const k = key;
    switch (k) {
      case "syncRoot":
      case "pythonPath":
        this.plugin.settings[k] = String(value ?? "").trim();
        break;
      case "outputFolder": {
        const folder = String(value ?? "").trim() || "mynotes";
        this.plugin.settings.outputFolder = (0, import_obsidian.normalizePath)(folder);
        break;
      }
      case "taskName":
        this.plugin.settings.taskName = String(value ?? "").trim() || "ZoomNotesSync";
        break;
      case "headless":
      case "logTitles":
        this.plugin.settings[k] = Boolean(value);
        break;
      case "autoSyncMinutes": {
        const n = typeof value === "number" ? value : parseInt(String(value), 10);
        this.plugin.settings.autoSyncMinutes = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
        break;
      }
      default:
        break;
    }
    await this.plugin.saveSettings();
  }
  /**
   * Fallback for Obsidian &lt; 1.13 when getSettingDefinitions is unavailable.
   */
  display() {
    const { containerEl } = this;
    containerEl.empty();
    new import_obsidian.Setting(containerEl).setName("General").setHeading();
    containerEl.createEl("p", {
      text: "Controls the Python + Playwright backend that downloads Zoom AI notes transcripts into this vault."
    });
    new import_obsidian.Setting(containerEl).setName("Sync repo path").setDesc(
      "Absolute path to the zoom-mynotes-sync repository (contains sync.py)."
    ).addText(
      (t) => t.setPlaceholder(
        process.platform === "win32" ? "C:\\Users\\\u2026\\zoom-mynotes-sync" : "/Users/\u2026/zoom-mynotes-sync"
      ).setValue(this.plugin.settings.syncRoot).onChange(async (v) => {
        await this.setControlValue("syncRoot", v);
      })
    );
    new import_obsidian.Setting(containerEl).setName("Python path").setDesc(
      "Optional. Leave empty to use .venv (Windows: Scripts/python.exe, macOS/Linux: bin/python3)."
    ).addText(
      (t) => t.setPlaceholder("(auto)").setValue(this.plugin.settings.pythonPath).onChange(async (v) => {
        await this.setControlValue("pythonPath", v);
      })
    );
    new import_obsidian.Setting(containerEl).setName("Transcripts folder").setDesc(
      "Vault-relative folder for .md transcripts (month subfolders inside)."
    ).addText(
      (t) => t.setPlaceholder("mynotes").setValue(this.plugin.settings.outputFolder).onChange(async (v) => {
        await this.setControlValue("outputFolder", v);
      })
    );
    new import_obsidian.Setting(containerEl).setName("Headless sync").setDesc(
      "Run browser without a visible window (login always opens a window)."
    ).addToggle(
      (t) => t.setValue(this.plugin.settings.headless).onChange(async (v) => {
        await this.setControlValue("headless", v);
      })
    );
    new import_obsidian.Setting(containerEl).setName("Log meeting titles").setDesc("Include titles in sync logs (off by default for privacy).").addToggle(
      (t) => t.setValue(this.plugin.settings.logTitles).onChange(async (v) => {
        await this.setControlValue("logTitles", v);
      })
    );
    new import_obsidian.Setting(containerEl).setName("Auto-sync while Obsidian is open").setDesc(
      "Minutes between syncs (0 = disabled). OS background job still covers when Obsidian is closed."
    ).addText(
      (t) => t.setPlaceholder("0").setValue(String(this.plugin.settings.autoSyncMinutes || 0)).onChange(async (v) => {
        await this.setControlValue("autoSyncMinutes", v);
      })
    );
    new import_obsidian.Setting(containerEl).setName("Background job name").setDesc(
      "Name used by the deploy wizard: Windows Task Scheduler, macOS LaunchAgent, or Linux cron marker."
    ).addText(
      (t) => t.setPlaceholder("ZoomNotesSync").setValue(this.plugin.settings.taskName).onChange(async (v) => {
        await this.setControlValue("taskName", v);
      })
    );
    new import_obsidian.Setting(containerEl).setName("Deploy wizard").setDesc(
      "Create venv, install deps, register OS background job, install plugin into vault."
    ).addButton(
      (b) => b.setButtonText("Open deploy wizard").setCta().onClick(() => {
        new DeployModal(this.app, this.plugin).open();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Actions").addButton(
      (b) => b.setButtonText("Sync now").onClick(() => void this.plugin.commandSync())
    ).addButton(
      (b) => b.setButtonText("Login").onClick(() => void this.plugin.commandLogin())
    ).addButton(
      (b) => b.setButtonText("Show log").onClick(() => new LogModal(this.app, this.plugin).open())
    );
    const root = resolveSyncRoot(this.plugin.settings);
    const info = containerEl.createDiv({ cls: "zoom-deploy-step" });
    new import_obsidian.Setting(info).setName("Resolved paths").setHeading();
    const lines = [
      `repo: ${root || "(not set)"}`,
      `python: ${resolvePython(this.plugin.settings)}`,
      `transcripts: ${resolveTranscriptsDir(this.plugin.settings, this.plugin.vaultPath())}`,
      `configDir: ${this.plugin.configDir()}`,
      `last: ${this.plugin.settings.lastSyncAt || "never"} (${this.plugin.settings.lastStatus || "\u2014"})`
    ];
    info.createDiv({ cls: "zoom-deploy-detail", text: lines.join("\n") });
  }
};
var DeployModal = class extends import_obsidian.Modal {
  constructor(app, plugin) {
    super(app);
    this.stepsEl = null;
    this.logEl = null;
    this.busy = false;
    this.plugin = plugin;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("zoom-deploy-modal");
    new import_obsidian.Setting(contentEl).setName("Deploy wizard").setHeading();
    contentEl.createEl("p", {
      text: "Sets up the Python backend, vault output folder, OS background job (Task Scheduler / launchd / cron), and this plugin. Works on Windows, macOS, and Linux."
    });
    this.stepsEl = contentEl.createDiv();
    this.renderSteps([]);
    this.logEl = contentEl.createDiv({ cls: "zoom-log-tail" });
    this.logEl.setText("Ready.");
    new import_obsidian.Setting(contentEl).addButton(
      (b) => b.setButtonText("Run full deploy").setCta().onClick(() => void this.run())
    ).addButton((b) => b.setButtonText("Close").onClick(() => this.close()));
  }
  onClose() {
    this.contentEl.empty();
  }
  renderSteps(steps) {
    if (!this.stepsEl) return;
    this.stepsEl.empty();
    if (!steps.length) {
      this.stepsEl.createEl("p", {
        text: "Click \u201CRun full deploy\u201D to start. You can re-run anytime; safe steps are skipped when already done."
      });
      return;
    }
    for (const s of steps) {
      const statusClass = s.status === "ok" ? "is-ok" : s.status === "fail" ? "is-fail" : s.status === "running" ? "is-running" : "";
      const el = this.stepsEl.createDiv({
        cls: `zoom-deploy-step ${statusClass}`.trim()
      });
      new import_obsidian.Setting(el).setName(`${statusGlyph(s.status)} ${s.title}`).setHeading();
      if (s.detail) {
        el.createDiv({ cls: "zoom-deploy-detail", text: s.detail });
      }
    }
  }
  appendLog(line) {
    if (!this.logEl) return;
    const prev = this.logEl.getText();
    const next = (prev === "Ready." ? "" : prev + "\n") + line;
    this.logEl.setText(next.slice(-4e3));
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }
  async run() {
    if (this.busy || isRunning()) {
      new import_obsidian.Notice("A job is already running");
      return;
    }
    this.busy = true;
    try {
      const steps = await runFullDeploy({
        settings: this.plugin.settings,
        vaultPath: this.plugin.vaultPath(),
        configDir: this.plugin.configDir(),
        pluginDir: this.plugin.pluginSourceDir(),
        onUpdate: (s) => this.renderSteps(s),
        onLog: (line) => this.appendLog(line)
      });
      await this.plugin.saveSettings();
      const summary = deploySummary(steps);
      this.appendLog(summary);
      new import_obsidian.Notice(summary);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.appendLog(msg);
      new import_obsidian.Notice(`Deploy failed: ${msg}`);
    } finally {
      this.busy = false;
    }
  }
};
var LogModal = class extends import_obsidian.Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    new import_obsidian.Setting(contentEl).setName("Latest sync log").setHeading();
    const root = resolveSyncRoot(this.plugin.settings);
    const logPath = latestLogPath(root);
    if (!logPath) {
      contentEl.createEl("p", { text: "No logs/sync-*.log found yet." });
      return;
    }
    contentEl.createEl("p", { text: logPath });
    contentEl.createDiv({
      cls: "zoom-log-tail",
      text: readTail(logPath)
    });
  }
  onClose() {
    this.contentEl.empty();
  }
};
function statusGlyph(s) {
  switch (s) {
    case "ok":
      return "[ok]";
    case "fail":
      return "[fail]";
    case "running":
      return "[\u2026]";
    case "skip":
      return "[skip]";
    default:
      return "[ ]";
  }
}
