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
  resolveTranscriptsDir,
} from "./paths";
import {
  ensureBundledBackend,
  ensurePython,
} from "./provision";
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
  /** Obsidian config folder name from Vault#configDir. */
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
    step("root", "Install Python backend"),
    step("python", "Locate or download Python"),
    step("venv", "Create .venv"),
    step("deps", "Install Python packages"),
    step("playwright", `Install Playwright browser (${platformLabel()})`),
    step("output", "Prepare transcripts folder"),
    step("auth", "Check Zoom login state"),
    step("task", `Register ${schedulerLabel()} job`),
    step("plugin", "Install plugin into this vault"),
  ];
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

  const configDir = (ctx.configDir || "").trim();
  if (!configDir) {
    set(
      "root",
      "fail",
      "Missing vault config directory (Vault.configDir is empty)."
    );
    return steps;
  }

  // 1. Provision bundled backend (no manual clone / path required)
  set("root", "running", "Writing bundled backend…");
  let root = "";
  try {
    const provisioned = ensureBundledBackend(
      ctx.vaultPath,
      configDir,
      ctx.settings
    );
    root = provisioned.root;
    if (!looksLikeSyncRoot(root)) {
      set(
        "root",
        "fail",
        `Backend incomplete at ${root} (need sync.py, config.py, requirements.txt)`
      );
      return steps;
    }
    set(
      "root",
      "ok",
      provisioned.reused
        ? `Using existing backend:\n${root}`
        : `Installed backend (${provisioned.wrote.length} files):\n${root}`
    );
  } catch (e) {
    set("root", "fail", e instanceof Error ? e.message : String(e));
    return steps;
  }

  // 2. System Python or portable download
  set("python", "running", "Searching for Python (download if missing)…");
  let bootstrapPy = "";
  try {
    const found = await ensurePython(root, ctx.settings, ctx.vaultPath, log);
    bootstrapPy = found.python;
    set(
      "python",
      "ok",
      `${found.source}: ${bootstrapPy}`
    );
  } catch (e) {
    set("python", "fail", e instanceof Error ? e.message : String(e));
    return steps;
  }

  // 3. Venv
  set("venv", "running", "Creating .venv if needed…");
  let venvPy = resolveVenvPython(root);
  if (venvPy) {
    set("venv", "ok", `Exists: ${venvPy}`);
  } else {
    try {
      const r = await runSetupVenv(
        ctx.settings,
        ctx.vaultPath,
        bootstrapPy,
        log
      );
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
  ctx.settings.syncRoot = root;

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
  set("playwright", "running", `import playwright + ensure ${channel || "chromium"}…`);
  try {
    const py = resolvePython(ctx.settings);
    const r = await runProcess({
      kind: "custom",
      settings: ctx.settings,
      vaultPath: ctx.vaultPath,
      command: py,
      args: ["-c", "import playwright; print('playwright ok')"],
      cwd: root,
      timeoutMs: 30_000,
      onLine: log,
    });
    if (r.code !== 0) {
      set("playwright", "fail", summarizeResult(r));
      return steps;
    }

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
      timeoutMs: 15 * 60 * 1000,
      onLine: log,
    });
    if (ir.code !== 0) {
      set(
        "playwright",
        "ok",
        `playwright import ok; browser install exited ${ir.code}. ` +
          (hostPlatform() === "win32"
            ? "Edge recommended on Windows."
            : "Chromium will be used on macOS/Linux.")
      );
    } else {
      set(
        "playwright",
        "ok",
        `playwright ok; channel=${channel || "chromium"} (${platformLabel()})`
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
      "No login yet — run command “Login (interactive SSO)” once after deploy."
    );
  }

  // 8. Background schedule
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

  // 9. Ensure plugin files present in vault
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
        // Already running from vault install — treat as ok
        if (pathExists(path.join(dest, f))) {
          copied.push(`${f} (present)`);
          continue;
        }
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
      `Plugin ready at ${dest} (${copied.join(", ")}).`
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
  if (fail.length)
    return `Deploy incomplete: ${fail.map((f) => f.id).join(", ")} failed`;
  return `Deploy OK (${ok.length} ok, ${skip.length} skipped)`;
}

export function ensureDir(p: string): void {
  if (!isDir(p)) fs.mkdirSync(p, { recursive: true });
}
