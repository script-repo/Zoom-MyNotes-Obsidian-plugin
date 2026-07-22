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
var fs4 = __toESM(require("fs"));
var path4 = __toESM(require("path"));

// src/deploy.ts
var fs3 = __toESM(require("fs"));
var path3 = __toESM(require("path"));

// src/paths.ts
var fs = __toESM(require("fs"));
var path = __toESM(require("path"));
function expandPath(raw) {
  if (!raw) return "";
  let p = raw.trim();
  if (p.startsWith("~")) {
    const home = process.env.USERPROFILE || process.env.HOME || "";
    p = path.join(home, p.slice(1).replace(/^[\\/]/, ""));
  }
  return path.normalize(p);
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
  if (explicit && isFile(explicit)) return explicit;
  const root = resolveSyncRoot(settings);
  if (root) {
    const candidates = [
      path.join(root, ".venv", "Scripts", "python.exe"),
      path.join(root, ".venv", "bin", "python"),
      path.join(root, ".venv", "bin", "python3")
    ];
    for (const c of candidates) {
      if (isFile(c)) return c;
    }
  }
  return process.platform === "win32" ? "python" : "python3";
}
function resolveTranscriptsDir(settings, vaultPath) {
  const folder = (settings.outputFolder || "mynotes").replace(/^[\\/]+/, "");
  return path.normalize(path.join(vaultPath, folder));
}
function looksLikeSyncRoot(root) {
  if (!isDir(root)) return false;
  return isFile(path.join(root, "sync.py")) && isFile(path.join(root, "config.py")) && isFile(path.join(root, "requirements.txt"));
}
function latestLogPath(root) {
  const logs = path.join(root, "logs");
  if (!isDir(logs)) return null;
  let best = null;
  for (const name of fs.readdirSync(logs)) {
    if (!/^sync-\d{8}\.log$/i.test(name)) continue;
    const full = path.join(logs, name);
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

// src/runner.ts
var import_child_process = require("child_process");
var fs2 = __toESM(require("fs"));
var path2 = __toESM(require("path"));
var active = null;
function isRunning() {
  return active !== null;
}
function cancelActive() {
  if (!active) return false;
  try {
    if (process.platform === "win32" && active.pid) {
      (0, import_child_process.spawn)("taskkill", ["/pid", String(active.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore"
      });
    } else {
      active.kill("SIGTERM");
    }
  } catch {
  }
  active = null;
  return true;
}
function buildEnv(settings, vaultPath, extra) {
  const transcripts = resolveTranscriptsDir(settings, vaultPath);
  return {
    ...process.env,
    ZOOM_TRANSCRIPTS_DIR: transcripts,
    ZOOM_HEADLESS: settings.headless ? "1" : "0",
    ZOOM_LOG_TITLES: settings.logTitles ? "1" : "0",
    PYTHONUNBUFFERED: "1",
    ...extra
  };
}
async function runProcess(opts) {
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
  return new Promise((resolve2, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let child;
    try {
      child = (0, import_child_process.spawn)(command, args, {
        cwd,
        env,
        windowsHide: true,
        shell: false
      });
    } catch (e) {
      reject(e);
      return;
    }
    active = child;
    const finish = (code, signal) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
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
    let timer = null;
    if (opts.timeoutMs && opts.timeoutMs > 0) {
      timer = setTimeout(() => {
        cancelActive();
        finish(null, "SIGTERM");
      }, opts.timeoutMs);
    }
    const feed = (chunk, stream) => {
      const text = chunk.toString();
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
    args: [path2.join(root, "sync.py")],
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
    args: [path2.join(root, "login.py")],
    cwd: root,
    // Login is interactive; leave headless off via env override
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
  const venvDir = path2.join(root, ".venv");
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
  const req = path2.join(root, "requirements.txt");
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
async function runRegisterTask(settings, vaultPath, onLine) {
  const root = resolveSyncRoot(settings);
  const script = path2.join(root, "scripts", "register-task.ps1");
  if (!fs2.existsSync(script)) {
    throw new Error(`Missing ${script}`);
  }
  const ps = process.env.SystemRoot ? path2.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe") : "powershell.exe";
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
      script
    ],
    cwd: root,
    env: {
      ZOOM_TASK_NAME: settings.taskName || "ZoomNotesSync"
    },
    timeoutMs: 2 * 60 * 1e3,
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
    step("playwright", "Verify Playwright + Edge"),
    step("output", "Prepare transcripts folder"),
    step("auth", "Check Zoom login state"),
    step("task", "Register Task Scheduler job"),
    step("plugin", "Install plugin into this vault")
  ];
}
async function whichPython(onLog) {
  const candidates = process.platform === "win32" ? ["py", "python", "python3"] : ["python3", "python"];
  for (const cmd of candidates) {
    try {
      const result = await runProcess({
        kind: "custom",
        settings: {
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
        },
        vaultPath: process.cwd(),
        command: cmd,
        args: ["-c", "import sys; print(sys.executable)"],
        cwd: process.cwd(),
        timeoutMs: 15e3,
        onLine: onLog ? (l) => onLog(l) : void 0
      });
      const line = (result.stdout || "").trim().split(/\r?\n/).filter(Boolean).pop();
      if (result.code === 0 && line && isFile(line)) return line;
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
  let systemPy = await whichPython(log);
  if (!systemPy) {
    set("python", "fail", "No python/py on PATH. Install Python 3.11+ and retry.");
    return steps;
  }
  set("python", "ok", systemPy);
  set("venv", "running", "Creating .venv if needed\u2026");
  const venvPy = process.platform === "win32" ? path3.join(root, ".venv", "Scripts", "python.exe") : path3.join(root, ".venv", "bin", "python");
  if (isFile(venvPy)) {
    set("venv", "ok", `Exists: ${venvPy}`);
  } else {
    try {
      const r = await runSetupVenv(ctx.settings, ctx.vaultPath, systemPy, log);
      if (r.code !== 0 || !isFile(venvPy)) {
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
  set("playwright", "running", "import playwright\u2026");
  try {
    const py = resolvePython(ctx.settings);
    const r = await runProcess({
      kind: "custom",
      settings: ctx.settings,
      vaultPath: ctx.vaultPath,
      command: py,
      args: [
        "-c",
        "import playwright; print('playwright', playwright.__version__ if hasattr(playwright,'__version__') else 'ok')"
      ],
      cwd: root,
      timeoutMs: 3e4,
      onLine: log
    });
    if (r.code !== 0) {
      set("playwright", "fail", summarizeResult(r));
      return steps;
    }
    set(
      "playwright",
      "ok",
      `${(r.stdout || "").trim() || "ok"} (uses installed Edge via ZOOM_BROWSER_CHANNEL=msedge)`
    );
  } catch (e) {
    set("playwright", "fail", e instanceof Error ? e.message : String(e));
    return steps;
  }
  set("output", "running", "Creating transcripts folder\u2026");
  try {
    const out = resolveTranscriptsDir(ctx.settings, ctx.vaultPath);
    fs3.mkdirSync(out, { recursive: true });
    const envPs1 = path3.join(root, "local-env.ps1");
    const escaped = out.replace(/'/g, "''");
    const body = `# Generated by Zoom MyNotes Sync Obsidian plugin \u2014 do not commit secrets.
$env:ZOOM_TRANSCRIPTS_DIR = '${escaped}'
`;
    fs3.writeFileSync(envPs1, body, "utf8");
    set("output", "ok", `${out}
(wrote local-env.ps1 for scheduled runs)`);
  } catch (e) {
    set("output", "fail", e instanceof Error ? e.message : String(e));
    return steps;
  }
  set("auth", "running", "Checking storage_state.json\u2026");
  const state = path3.join(root, "storage_state.json");
  if (isFile(state)) {
    set("auth", "ok", `Session present: ${state}`);
  } else {
    set(
      "auth",
      "skip",
      "No storage_state.json yet \u2014 run command \u201CZoom Sync: Login\u201D once after deploy."
    );
  }
  if (process.platform !== "win32") {
    set("task", "skip", "Task Scheduler registration is Windows-only.");
  } else {
    set("task", "running", "Registering scheduled task\u2026");
    try {
      const r = await runRegisterTask(ctx.settings, ctx.vaultPath, log);
      if (r.code !== 0) {
        set("task", "fail", summarizeResult(r));
      } else {
        set(
          "task",
          "ok",
          `Task '${ctx.settings.taskName || "ZoomNotesSync"}' registered (every 30 min, logged-on).`
        );
      }
    } catch (e) {
      set("task", "fail", e instanceof Error ? e.message : String(e));
    }
  }
  set("plugin", "running", "Copying plugin into .obsidian/plugins\u2026");
  try {
    const dest = path3.join(
      ctx.vaultPath,
      ".obsidian",
      "plugins",
      "zoom-mynotes-sync"
    );
    fs3.mkdirSync(dest, { recursive: true });
    const files = ["main.js", "manifest.json", "styles.css"];
    const srcDir = ctx.pluginDir;
    const copied = [];
    for (const f of files) {
      const from = path3.join(srcDir, f);
      if (!pathExists(from)) {
        throw new Error(`Missing build artifact: ${from}`);
      }
      fs3.copyFileSync(from, path3.join(dest, f));
      copied.push(f);
    }
    const community = path3.join(ctx.vaultPath, ".obsidian", "community-plugins.json");
    let list = [];
    if (isFile(community)) {
      try {
        list = JSON.parse(fs3.readFileSync(community, "utf8"));
        if (!Array.isArray(list)) list = [];
      } catch {
        list = [];
      }
    }
    if (!list.includes("zoom-mynotes-sync")) {
      list.push("zoom-mynotes-sync");
      fs3.writeFileSync(community, JSON.stringify(list, null, 2) + "\n", "utf8");
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
    path3.resolve(pluginDir, ".."),
    path3.resolve(pluginDir, "..", ".."),
    path3.resolve(pluginDir, "..", "..", "..")
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
var DEFAULT_SYNC_ROOT = process.platform === "win32" ? "C:\\Users\\DaemonBehr\\local-repo\\zoom-mynotes-sync" : "";
var DEFAULT_SETTINGS = {
  syncRoot: DEFAULT_SYNC_ROOT,
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
      callback: () => this.openTranscriptsFolder()
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
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
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
  pluginSourceDir() {
    const dir = this.manifest.dir;
    if (dir) {
      const abs = path4.join(this.vaultPath(), dir);
      if (isFile(path4.join(abs, "main.js"))) return abs;
    }
    const root = resolveSyncRoot(this.settings);
    if (root) {
      const dev = path4.join(root, "Zoom-MyNotes-Obsidian-plugin");
      if (isFile(path4.join(dev, "main.js"))) return dev;
    }
    return dir ? path4.join(this.vaultPath(), dir) : "";
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
      const result = await runSync(
        this.settings,
        this.vaultPath(),
        (line) => console.log("[zoom-sync]", line)
      );
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
      const result = await runLogin(
        settings,
        this.vaultPath(),
        (line) => console.log("[zoom-login]", line)
      );
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
  openTranscriptsFolder() {
    try {
      const dir = resolveTranscriptsDir(this.settings, this.vaultPath());
      fs4.mkdirSync(dir, { recursive: true });
      const rel = (0, import_obsidian.normalizePath)(this.settings.outputFolder || "mynotes");
      const folder = this.app.vault.getAbstractFileByPath(rel);
      if (folder) {
        this.app.workspace.getLeavesOfType("file-explorer")[0]?.view?.revealInFolder?.(folder);
      }
      new import_obsidian.Notice(`Transcripts: ${dir}`);
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
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Zoom MyNotes Sync" });
    containerEl.createEl("p", {
      text: "Controls the Python + Playwright backend that downloads Zoom AI notes transcripts into this vault."
    });
    new import_obsidian.Setting(containerEl).setName("Sync repo path").setDesc("Absolute path to the zoom-mynotes-sync repository (contains sync.py).").addText(
      (t) => t.setPlaceholder("C:\\Users\\\u2026\\zoom-mynotes-sync").setValue(this.plugin.settings.syncRoot).onChange(async (v) => {
        this.plugin.settings.syncRoot = v.trim();
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Python path").setDesc("Optional. Leave empty to use <repo>\\.venv\\Scripts\\python.exe.").addText(
      (t) => t.setPlaceholder("(auto)").setValue(this.plugin.settings.pythonPath).onChange(async (v) => {
        this.plugin.settings.pythonPath = v.trim();
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Transcripts folder").setDesc("Vault-relative folder for .md transcripts (month subfolders inside).").addText(
      (t) => t.setPlaceholder("mynotes").setValue(this.plugin.settings.outputFolder).onChange(async (v) => {
        this.plugin.settings.outputFolder = v.trim() || "mynotes";
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Headless sync").setDesc("Run browser without a visible window (login always opens a window).").addToggle(
      (t) => t.setValue(this.plugin.settings.headless).onChange(async (v) => {
        this.plugin.settings.headless = v;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Log meeting titles").setDesc("Include titles in sync logs (off by default for privacy).").addToggle(
      (t) => t.setValue(this.plugin.settings.logTitles).onChange(async (v) => {
        this.plugin.settings.logTitles = v;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Auto-sync while Obsidian is open").setDesc("Minutes between syncs (0 = disabled). Task Scheduler still covers background.").addText(
      (t) => t.setPlaceholder("0").setValue(String(this.plugin.settings.autoSyncMinutes || 0)).onChange(async (v) => {
        const n = parseInt(v.trim(), 10);
        this.plugin.settings.autoSyncMinutes = Number.isFinite(n) && n > 0 ? n : 0;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Scheduled task name").setDesc("Windows Task Scheduler task created by the deploy wizard.").addText(
      (t) => t.setPlaceholder("ZoomNotesSync").setValue(this.plugin.settings.taskName).onChange(async (v) => {
        this.plugin.settings.taskName = v.trim() || "ZoomNotesSync";
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Deploy wizard").setDesc("Create venv, install deps, register Task Scheduler, install plugin into vault.").addButton(
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
    info.createEl("h3", { text: "Resolved paths" });
    const lines = [
      `repo: ${root || "(not set)"}`,
      `python: ${resolvePython(this.plugin.settings)}`,
      `transcripts: ${resolveTranscriptsDir(this.plugin.settings, this.plugin.vaultPath())}`,
      `last: ${this.plugin.settings.lastSyncAt || "never"} (${this.plugin.settings.lastStatus || "\u2014"})`
    ];
    info.createEl("div", { cls: "zoom-deploy-detail", text: lines.join("\n") });
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
    contentEl.createEl("h2", { text: "Zoom MyNotes deploy wizard" });
    contentEl.createEl("p", {
      text: "Sets up the Python backend, vault output folder, Windows scheduled task, and this plugin."
    });
    this.stepsEl = contentEl.createDiv();
    this.renderSteps([]);
    this.logEl = contentEl.createEl("div", { cls: "zoom-log-tail" });
    this.logEl.setText("Ready.");
    const actions = contentEl.createDiv({ cls: "zoom-deploy-actions" });
    const runBtn = actions.createEl("button", { text: "Run full deploy", cls: "mod-cta" });
    runBtn.onclick = () => void this.run();
    const closeBtn = actions.createEl("button", { text: "Close" });
    closeBtn.onclick = () => this.close();
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
      const el = this.stepsEl.createDiv({
        cls: `zoom-deploy-step is-${s.status === "ok" ? "ok" : s.status === "fail" ? "fail" : s.status === "running" ? "running" : ""}`
      });
      el.createEl("h3", { text: `${statusGlyph(s.status)} ${s.title}` });
      if (s.detail) el.createEl("div", { cls: "zoom-deploy-detail", text: s.detail });
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
    contentEl.createEl("h2", { text: "Latest sync log" });
    const root = resolveSyncRoot(this.plugin.settings);
    const logPath = latestLogPath(root);
    if (!logPath) {
      contentEl.createEl("p", { text: "No logs/sync-*.log found yet." });
      return;
    }
    contentEl.createEl("p", { text: logPath });
    contentEl.createEl("div", {
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
