import * as fs from "fs";
import * as path from "path";
import {
  defaultBrowserChannel,
  hostPlatform,
  platformLabel,
  schedulerLabel,
  venvPythonCandidates,
} from "./platform";
import {
  isDir,
  isFile,
  looksLikeSyncRoot,
  pathExists,
  resolvePython,
  resolveSyncRoot,
  resolveTranscriptsDir,
} from "./paths";
import { runRegisterSchedule, writeLocalEnvFiles } from "./schedule";
import type { ZoomSyncSettings } from "./settings";
import {
  runPipInstall,
  runProcess,
  runSetupVenv,
  type RunResult,
} from "./runner";

export type StepId =
  | "root"
  | "python"
  | "venv"
  | "deps"
  | "playwright"
  | "output"
  | "auth"
  | "task"
  | "plugin";

export type StepStatus = "pending" | "ok" | "fail" | "skip" | "running";

export interface DeployStep {
  id: StepId;
  title: string;
  status: StepStatus;
  detail: string;
}

export interface DeployContext {
  settings: ZoomSyncSettings;
  vaultPath: string;
  /** Obsidian config folder name from Vault#configDir (not always `.obsidian`). */
  configDir: string;
  pluginDir: string;
  onUpdate: (steps: DeployStep[]) => void;
  onLog?: (line: string) => void;
}

function step(
  id: StepId,
  title: string,
  status: StepStatus = "pending",
  detail = ""
): DeployStep {
  return { id, title, status, detail };
}

export function initialSteps(): DeployStep[] {
  return [
    step("root", "Locate sync repo"),
    step("python", "Find system Python"),
    step("venv", "Create .venv"),
    step("deps", "Install Python packages"),
    step("playwright", `Verify Playwright + browser (${platformLabel()})`),
    step("output", "Prepare transcripts folder"),
    step("auth", "Check Zoom login state"),
    step("task", `Register ${schedulerLabel()} job`),
    step("plugin", "Install plugin into this vault"),
  ];
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

async function whichPython(onLog?: (s: string) => void): Promise<string | null> {
  const candidates =
    hostPlatform() === "win32"
      ? ["py", "python", "python3"]
      : ["python3", "python"];
  for (const cmd of candidates) {
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
      if (result.code === 0 && line && (isFile(line) || pathExists(line))) {
        return line;
      }
      if (result.code === 0 && line) return line;
    } catch {
      /* try next */
    }
  }
  return null;
}

function summarizeResult(r: RunResult): string {
  const out = (r.stdout || r.stderr || "").trim();
  const tail = out.slice(-400);
  return `exit=${r.code} ${tail}`.trim();
}

function resolveVenvPython(root: string): string | null {
  for (const c of venvPythonCandidates(root)) {
    if (isFile(c) || pathExists(c)) return c;
  }
  return null;
}

export async function runFullDeploy(ctx: DeployContext): Promise<DeployStep[]> {
  const steps = initialSteps();
  const set = (id: StepId, status: StepStatus, detail: string) => {
    const s = steps.find((x) => x.id === id);
    if (s) {
      s.status = status;
      s.detail = detail;
    }
    ctx.onUpdate([...steps]);
  };
  const log = (line: string) => ctx.onLog?.(line);

  // 1. Root
  set("root", "running", "Checking…");
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

  // 2. System python
  set("python", "running", "Searching…");
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

  // 3. Venv
  set("venv", "running", "Creating .venv if needed…");
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

  // 4. pip install
  set("deps", "running", "pip install -r requirements.txt…");
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

  // 5. Playwright + browser bits
  const channel = defaultBrowserChannel();
  set("playwright", "running", `import playwright + ensure ${channel}…`);
  try {
    const py = resolvePython(ctx.settings);
    const r = await runProcess({
      kind: "custom",
      settings: ctx.settings,
      vaultPath: ctx.vaultPath,
      command: py,
      args: [
        "-c",
        "import playwright; print('playwright ok')",
      ],
      cwd: root,
      timeoutMs: 30_000,
      onLine: log,
    });
    if (r.code !== 0) {
      set("playwright", "fail", summarizeResult(r));
      return steps;
    }

    // Install browser binaries for the preferred channel (no-op if already present).
    const installArgs =
      channel === "msedge"
        ? ["-m", "playwright", "install", "msedge"]
        : ["-m", "playwright", "install", "chromium"];
    const ir = await runProcess({
      kind: "custom",
      settings: ctx.settings,
      vaultPath: ctx.vaultPath,
      command: py,
      args: installArgs,
      cwd: root,
      timeoutMs: 10 * 60 * 1000,
      onLine: log,
    });
    if (ir.code !== 0) {
      // Soft-fail: user may already have a system browser Playwright can attach to.
      set(
        "playwright",
        "ok",
        `playwright import ok; browser install exited ${ir.code}. ` +
          `Set ZOOM_BROWSER_CHANNEL if needed (default ${channel}). ` +
          (hostPlatform() === "win32"
            ? "Edge recommended on Windows."
            : "Chromium will be used on macOS/Linux.")
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

  // 6. Output folder + portable env/run scripts
  set("output", "running", "Creating transcripts folder…");
  try {
    const out = resolveTranscriptsDir(ctx.settings, ctx.vaultPath);
    fs.mkdirSync(out, { recursive: true });
    const files = writeLocalEnvFiles(ctx.settings, ctx.vaultPath);
    set(
      "output",
      "ok",
      `${out}\n(wrote ${path.basename(files.envSh)}, ${path.basename(
        files.envPs1
      )}, ${path.basename(files.runSh)}, ${path.basename(files.runPs1)})`
    );
  } catch (e) {
    set("output", "fail", e instanceof Error ? e.message : String(e));
    return steps;
  }

  // 7. Auth state
  set("auth", "running", "Checking storage_state.json…");
  const state = path.join(root, "storage_state.json");
  if (isFile(state)) {
    set("auth", "ok", `Session present: ${state}`);
  } else {
    set(
      "auth",
      "skip",
      "No storage_state.json yet — run command “Login (interactive SSO)” once after deploy."
    );
  }

  // 8. Background schedule (Windows / macOS / Linux)
  set("task", "running", `Registering ${schedulerLabel()}…`);
  try {
    const { result, detail } = await runRegisterSchedule({
      settings: ctx.settings,
      vaultPath: ctx.vaultPath,
      onLine: log,
    });
    if (hostPlatform() === "other") {
      set("task", "skip", detail);
    } else if (result.code !== 0) {
      set("task", "fail", `${detail}\n${summarizeResult(result)}`);
    } else {
      set("task", "ok", detail);
    }
  } catch (e) {
    set("task", "fail", e instanceof Error ? e.message : String(e));
  }

  // 9. Install plugin files into vault
  const configDir = ctx.configDir || ".obsidian";
  set("plugin", "running", `Copying plugin into ${configDir}/plugins…`);
  try {
    const dest = path.join(
      ctx.vaultPath,
      configDir,
      "plugins",
      "zoom-mynotes-sync"
    );
    fs.mkdirSync(dest, { recursive: true });
    const files = ["main.js", "manifest.json", "styles.css"];
    const srcDir = ctx.pluginDir;
    const copied: string[] = [];
    for (const f of files) {
      const from = path.join(srcDir, f);
      if (!pathExists(from)) {
        throw new Error(`Missing build artifact: ${from}`);
      }
      fs.copyFileSync(from, path.join(dest, f));
      copied.push(f);
    }
    const community = path.join(
      ctx.vaultPath,
      configDir,
      "community-plugins.json"
    );
    let list: string[] = [];
    if (isFile(community)) {
      try {
        list = JSON.parse(fs.readFileSync(community, "utf8")) as string[];
        if (!Array.isArray(list)) list = [];
      } catch {
        list = [];
      }
    }
    if (!list.includes("zoom-mynotes-sync")) {
      list.push("zoom-mynotes-sync");
      fs.writeFileSync(community, JSON.stringify(list, null, 2) + "\n", "utf8");
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

export function detectDefaultSyncRoot(pluginDir: string): string {
  const candidates = [
    path.resolve(pluginDir, ".."),
    path.resolve(pluginDir, "..", ".."),
    path.resolve(pluginDir, "..", "..", ".."),
  ];
  for (const c of candidates) {
    if (looksLikeSyncRoot(c)) return c;
  }
  return "";
}

export function deploySummary(steps: DeployStep[]): string {
  const fail = steps.filter((s) => s.status === "fail");
  const ok = steps.filter((s) => s.status === "ok");
  const skip = steps.filter((s) => s.status === "skip");
  if (fail.length) return `Deploy incomplete: ${fail.map((f) => f.id).join(", ")} failed`;
  return `Deploy OK (${ok.length} ok, ${skip.length} skipped)`;
}

export function ensureDir(p: string): void {
  if (!isDir(p)) fs.mkdirSync(p, { recursive: true });
}
