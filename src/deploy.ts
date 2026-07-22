import * as fs from "fs";
import * as path from "path";
import {
  isDir,
  isFile,
  looksLikeSyncRoot,
  pathExists,
  resolvePython,
  resolveSyncRoot,
  resolveTranscriptsDir,
} from "./paths";
import type { ZoomSyncSettings } from "./settings";
import {
  runPipInstall,
  runProcess,
  runRegisterTask,
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
    step("playwright", "Verify Playwright + Edge"),
    step("output", "Prepare transcripts folder"),
    step("auth", "Check Zoom login state"),
    step("task", "Register Task Scheduler job"),
    step("plugin", "Install plugin into this vault"),
  ];
}

async function whichPython(onLog?: (s: string) => void): Promise<string | null> {
  const candidates =
    process.platform === "win32"
      ? ["py", "python", "python3"]
      : ["python3", "python"];
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
          lastStatus: "",
        },
        vaultPath: process.cwd(),
        command: cmd,
        args: ["-c", "import sys; print(sys.executable)"],
        cwd: process.cwd(),
        timeoutMs: 15_000,
        onLine: onLog ? (l) => onLog(l) : undefined,
      });
      const line = (result.stdout || "").trim().split(/\r?\n/).filter(Boolean).pop();
      if (result.code === 0 && line && isFile(line)) return line;
      // py launcher may print path without being the file itself on some setups
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
  let systemPy = await whichPython(log);
  if (!systemPy) {
    set("python", "fail", "No python/py on PATH. Install Python 3.11+ and retry.");
    return steps;
  }
  set("python", "ok", systemPy);

  // 3. Venv
  set("venv", "running", "Creating .venv if needed…");
  const venvPy =
    process.platform === "win32"
      ? path.join(root, ".venv", "Scripts", "python.exe")
      : path.join(root, ".venv", "bin", "python");
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

  // Point settings at venv python for remaining steps
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

  // 5. Playwright import + channel note
  set("playwright", "running", "import playwright…");
  try {
    const py = resolvePython(ctx.settings);
    const r = await runProcess({
      kind: "custom",
      settings: ctx.settings,
      vaultPath: ctx.vaultPath,
      command: py,
      args: [
        "-c",
        "import playwright; print('playwright', playwright.__version__ if hasattr(playwright,'__version__') else 'ok')",
      ],
      cwd: root,
      timeoutMs: 30_000,
      onLine: log,
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

  // 6. Output folder + local-env.ps1 for Task Scheduler / run.ps1
  set("output", "running", "Creating transcripts folder…");
  try {
    const out = resolveTranscriptsDir(ctx.settings, ctx.vaultPath);
    fs.mkdirSync(out, { recursive: true });
    const envPs1 = path.join(root, "local-env.ps1");
    const escaped = out.replace(/'/g, "''");
    const body =
      `# Generated by Zoom MyNotes Sync Obsidian plugin — do not commit secrets.\n` +
      `$env:ZOOM_TRANSCRIPTS_DIR = '${escaped}'\n`;
    fs.writeFileSync(envPs1, body, "utf8");
    set("output", "ok", `${out}\n(wrote local-env.ps1 for scheduled runs)`);
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
      "No storage_state.json yet — run command “Zoom Sync: Login” once after deploy."
    );
  }

  // 8. Task Scheduler (Windows only)
  if (process.platform !== "win32") {
    set("task", "skip", "Task Scheduler registration is Windows-only.");
  } else {
    set("task", "running", "Registering scheduled task…");
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

  // 9. Install plugin files into vault
  set("plugin", "running", "Copying plugin into .obsidian/plugins…");
  try {
    const dest = path.join(
      ctx.vaultPath,
      ".obsidian",
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
    // Enable in community-plugins.json
    const community = path.join(ctx.vaultPath, ".obsidian", "community-plugins.json");
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
  // pluginDir is .../Zoom-MyNotes-Obsidian-plugin or vault/.obsidian/plugins/zoom-mynotes-sync
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
