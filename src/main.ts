import {
  App,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  normalizePath,
} from "obsidian";
import * as fs from "fs";
import * as path from "path";
import {
  deploySummary,
  detectDefaultSyncRoot,
  runFullDeploy,
  type DeployStep,
} from "./deploy";
import {
  isFile,
  latestLogPath,
  looksLikeSyncRoot,
  readTail,
  resolvePython,
  resolveSyncRoot,
  resolveTranscriptsDir,
} from "./paths";
import {
  cancelActive,
  exitLabel,
  isRunning,
  runLogin,
  runSync,
  type RunResult,
} from "./runner";
import { DEFAULT_SETTINGS, type ZoomSyncSettings } from "./settings";

export default class ZoomMyNotesSyncPlugin extends Plugin {
  settings: ZoomSyncSettings = { ...DEFAULT_SETTINGS };
  statusEl: HTMLElement | null = null;
  private autoTimer: number | null = null;
  private running = false;

  async onload(): Promise<void> {
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
      callback: () => void this.commandSync(),
    });
    this.addCommand({
      id: "zoom-sync-login",
      name: "Login (interactive SSO)",
      callback: () => void this.commandLogin(),
    });
    this.addCommand({
      id: "zoom-sync-deploy",
      name: "Open deploy wizard",
      callback: () => new DeployModal(this.app, this).open(),
    });
    this.addCommand({
      id: "zoom-sync-cancel",
      name: "Cancel running job",
      callback: () => {
        if (cancelActive()) {
          new Notice("Zoom sync: cancelled");
          this.setRunning(false, "cancelled");
        } else {
          new Notice("Zoom sync: nothing running");
        }
      },
    });
    this.addCommand({
      id: "zoom-sync-open-folder",
      name: "Open transcripts folder",
      callback: () => this.openTranscriptsFolder(),
    });
    this.addCommand({
      id: "zoom-sync-show-log",
      name: "Show latest sync log",
      callback: () => new LogModal(this.app, this).open(),
    });

    this.addSettingTab(new ZoomSyncSettingTab(this.app, this));
    this.rescheduleAutoSync();
  }

  onunload(): void {
    if (this.autoTimer !== null) {
      window.clearInterval(this.autoTimer);
      this.autoTimer = null;
    }
    cancelActive();
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.rescheduleAutoSync();
    this.refreshStatusBar();
  }

  vaultPath(): string {
    // Desktop adapter base path
    const adapter = this.app.vault.adapter as { getBasePath?: () => string };
    if (typeof adapter.getBasePath === "function") {
      return adapter.getBasePath();
    }
    throw new Error("Vault base path unavailable (desktop only)");
  }

  pluginSourceDir(): string {
    // Prefer built files next to the loaded plugin (vault install).
    const dir = this.manifest.dir;
    if (dir) {
      // manifest.dir is vault-relative like .obsidian/plugins/zoom-mynotes-sync
      const abs = path.join(this.vaultPath(), dir);
      if (isFile(path.join(abs, "main.js"))) return abs;
    }
    // Dev: repo/Zoom-MyNotes-Obsidian-plugin
    const root = resolveSyncRoot(this.settings);
    if (root) {
      const dev = path.join(root, "Zoom-MyNotes-Obsidian-plugin");
      if (isFile(path.join(dev, "main.js"))) return dev;
    }
    return dir ? path.join(this.vaultPath(), dir) : "";
  }

  private rescheduleAutoSync(): void {
    if (this.autoTimer !== null) {
      window.clearInterval(this.autoTimer);
      this.autoTimer = null;
    }
    const mins = Number(this.settings.autoSyncMinutes) || 0;
    if (mins <= 0) return;
    this.autoTimer = window.setInterval(() => {
      if (!this.running && !isRunning()) void this.commandSync(true);
    }, mins * 60 * 1000);
  }

  private setRunning(running: boolean, status?: string): void {
    this.running = running;
    if (status !== undefined) this.settings.lastStatus = status;
    this.refreshStatusBar();
  }

  refreshStatusBar(): void {
    if (!this.statusEl) return;
    this.statusEl.removeClass("is-running");
    this.statusEl.removeClass("is-error");
    this.statusEl.removeClass("is-ok");
    if (this.running) {
      this.statusEl.addClass("is-running");
      this.statusEl.setText("Zoom sync: running…");
      return;
    }
    const code = this.settings.lastExitCode;
    const label =
      this.settings.lastStatus ||
      (code === null || code === undefined
        ? "idle"
        : `last ${exitLabel(code)}`);
    if (code === 0) this.statusEl.addClass("is-ok");
    else if (code !== null && code !== undefined && code !== 0) {
      this.statusEl.addClass("is-error");
    }
    this.statusEl.setText(`Zoom sync: ${label}`);
  }

  private assertReady(): void {
    const root = resolveSyncRoot(this.settings);
    if (!looksLikeSyncRoot(root)) {
      throw new Error(
        "Set Settings → Zoom MyNotes Sync → Sync repo path (folder with sync.py)"
      );
    }
    const py = resolvePython(this.settings);
    if (!py) throw new Error("Python not found — run Deploy wizard");
  }

  async commandSync(quiet = false): Promise<void> {
    if (this.running || isRunning()) {
      if (!quiet) new Notice("Zoom sync already running");
      return;
    }
    try {
      this.assertReady();
    } catch (e) {
      new Notice(e instanceof Error ? e.message : String(e));
      return;
    }

    this.setRunning(true, "syncing…");
    if (!quiet) new Notice("Zoom sync started");
    try {
      const result = await runSync(
        this.settings,
        this.vaultPath(),
        (line) => console.log("[zoom-sync]", line)
      );
      await this.recordResult(result);
      const msg = `Zoom sync ${exitLabel(result.code)} (${Math.round(result.durationMs / 1000)}s)`;
      new Notice(msg);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.settings.lastExitCode = 1;
      this.settings.lastStatus = msg.slice(0, 120);
      await this.saveSettings();
      new Notice(`Zoom sync failed: ${msg}`);
    } finally {
      this.setRunning(false);
    }
  }

  async commandLogin(): Promise<void> {
    if (this.running || isRunning()) {
      new Notice("Zoom sync already running");
      return;
    }
    try {
      this.assertReady();
    } catch (e) {
      new Notice(e instanceof Error ? e.message : String(e));
      return;
    }

    this.setRunning(true, "login…");
    new Notice("Zoom login: complete SSO in the browser window");
    try {
      // Force headed for login
      const settings = { ...this.settings, headless: false };
      const result = await runLogin(settings, this.vaultPath(), (line) =>
        console.log("[zoom-login]", line)
      );
      await this.recordResult(result);
      new Notice(
        result.code === 0
          ? "Zoom login saved"
          : `Zoom login ${exitLabel(result.code)}`
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      new Notice(`Zoom login failed: ${msg}`);
      this.settings.lastStatus = msg.slice(0, 120);
      await this.saveSettings();
    } finally {
      this.setRunning(false);
    }
  }

  private async recordResult(result: RunResult): Promise<void> {
    this.settings.lastExitCode = result.code;
    this.settings.lastStatus = exitLabel(result.code);
    if (result.code === 0) {
      this.settings.lastSyncAt = new Date().toISOString();
    }
    await this.saveSettings();
  }

  openTranscriptsFolder(): void {
    try {
      const dir = resolveTranscriptsDir(this.settings, this.vaultPath());
      fs.mkdirSync(dir, { recursive: true });
      const rel = normalizePath(this.settings.outputFolder || "mynotes");
      const folder = this.app.vault.getAbstractFileByPath(rel);
      if (folder) {
        // Reveal in file explorer if possible
        // @ts-ignore internal API optional
        this.app.workspace.getLeavesOfType("file-explorer")[0]?.view?.revealInFolder?.(folder);
      }
      new Notice(`Transcripts: ${dir}`);
    } catch (e) {
      new Notice(e instanceof Error ? e.message : String(e));
    }
  }
}

class ZoomSyncSettingTab extends PluginSettingTab {
  plugin: ZoomMyNotesSyncPlugin;

  constructor(app: App, plugin: ZoomMyNotesSyncPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Zoom MyNotes Sync" });

    containerEl.createEl("p", {
      text: "Controls the Python + Playwright backend that downloads Zoom AI notes transcripts into this vault.",
    });

    new Setting(containerEl)
      .setName("Sync repo path")
      .setDesc("Absolute path to the zoom-mynotes-sync repository (contains sync.py).")
      .addText((t) =>
        t
          .setPlaceholder("C:\\Users\\…\\zoom-mynotes-sync")
          .setValue(this.plugin.settings.syncRoot)
          .onChange(async (v) => {
            this.plugin.settings.syncRoot = v.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Python path")
      .setDesc("Optional. Leave empty to use <repo>\\.venv\\Scripts\\python.exe.")
      .addText((t) =>
        t
          .setPlaceholder("(auto)")
          .setValue(this.plugin.settings.pythonPath)
          .onChange(async (v) => {
            this.plugin.settings.pythonPath = v.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Transcripts folder")
      .setDesc("Vault-relative folder for .md transcripts (month subfolders inside).")
      .addText((t) =>
        t
          .setPlaceholder("mynotes")
          .setValue(this.plugin.settings.outputFolder)
          .onChange(async (v) => {
            this.plugin.settings.outputFolder = v.trim() || "mynotes";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Headless sync")
      .setDesc("Run browser without a visible window (login always opens a window).")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.headless).onChange(async (v) => {
          this.plugin.settings.headless = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Log meeting titles")
      .setDesc("Include titles in sync logs (off by default for privacy).")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.logTitles).onChange(async (v) => {
          this.plugin.settings.logTitles = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Auto-sync while Obsidian is open")
      .setDesc("Minutes between syncs (0 = disabled). Task Scheduler still covers background.")
      .addText((t) =>
        t
          .setPlaceholder("0")
          .setValue(String(this.plugin.settings.autoSyncMinutes || 0))
          .onChange(async (v) => {
            const n = parseInt(v.trim(), 10);
            this.plugin.settings.autoSyncMinutes = Number.isFinite(n) && n > 0 ? n : 0;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Scheduled task name")
      .setDesc("Windows Task Scheduler task created by the deploy wizard.")
      .addText((t) =>
        t
          .setPlaceholder("ZoomNotesSync")
          .setValue(this.plugin.settings.taskName)
          .onChange(async (v) => {
            this.plugin.settings.taskName = v.trim() || "ZoomNotesSync";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Deploy wizard")
      .setDesc("Create venv, install deps, register Task Scheduler, install plugin into vault.")
      .addButton((b) =>
        b.setButtonText("Open deploy wizard").setCta().onClick(() => {
          new DeployModal(this.app, this.plugin).open();
        })
      );

    new Setting(containerEl)
      .setName("Actions")
      .addButton((b) =>
        b.setButtonText("Sync now").onClick(() => void this.plugin.commandSync())
      )
      .addButton((b) =>
        b.setButtonText("Login").onClick(() => void this.plugin.commandLogin())
      )
      .addButton((b) =>
        b.setButtonText("Show log").onClick(() => new LogModal(this.app, this.plugin).open())
      );

    const root = resolveSyncRoot(this.plugin.settings);
    const info = containerEl.createDiv({ cls: "zoom-deploy-step" });
    info.createEl("h3", { text: "Resolved paths" });
    const lines = [
      `repo: ${root || "(not set)"}`,
      `python: ${resolvePython(this.plugin.settings)}`,
      `transcripts: ${resolveTranscriptsDir(this.plugin.settings, this.plugin.vaultPath())}`,
      `last: ${this.plugin.settings.lastSyncAt || "never"} (${this.plugin.settings.lastStatus || "—"})`,
    ];
    info.createEl("div", { cls: "zoom-deploy-detail", text: lines.join("\n") });
  }
}

class DeployModal extends Modal {
  plugin: ZoomMyNotesSyncPlugin;
  stepsEl: HTMLElement | null = null;
  logEl: HTMLElement | null = null;
  busy = false;

  constructor(app: App, plugin: ZoomMyNotesSyncPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("zoom-deploy-modal");
    contentEl.createEl("h2", { text: "Zoom MyNotes deploy wizard" });
    contentEl.createEl("p", {
      text: "Sets up the Python backend, vault output folder, Windows scheduled task, and this plugin.",
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

  onClose(): void {
    this.contentEl.empty();
  }

  private renderSteps(steps: DeployStep[]): void {
    if (!this.stepsEl) return;
    this.stepsEl.empty();
    if (!steps.length) {
      this.stepsEl.createEl("p", {
        text: "Click “Run full deploy” to start. You can re-run anytime; safe steps are skipped when already done.",
      });
      return;
    }
    for (const s of steps) {
      const el = this.stepsEl.createDiv({
        cls: `zoom-deploy-step is-${s.status === "ok" ? "ok" : s.status === "fail" ? "fail" : s.status === "running" ? "running" : ""}`,
      });
      el.createEl("h3", { text: `${statusGlyph(s.status)} ${s.title}` });
      if (s.detail) el.createEl("div", { cls: "zoom-deploy-detail", text: s.detail });
    }
  }

  private appendLog(line: string): void {
    if (!this.logEl) return;
    const prev = this.logEl.getText();
    const next = (prev === "Ready." ? "" : prev + "\n") + line;
    this.logEl.setText(next.slice(-4000));
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  private async run(): Promise<void> {
    if (this.busy || isRunning()) {
      new Notice("A job is already running");
      return;
    }
    this.busy = true;
    try {
      const steps = await runFullDeploy({
        settings: this.plugin.settings,
        vaultPath: this.plugin.vaultPath(),
        pluginDir: this.plugin.pluginSourceDir(),
        onUpdate: (s) => this.renderSteps(s),
        onLog: (line) => this.appendLog(line),
      });
      await this.plugin.saveSettings();
      const summary = deploySummary(steps);
      this.appendLog(summary);
      new Notice(summary);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.appendLog(msg);
      new Notice(`Deploy failed: ${msg}`);
    } finally {
      this.busy = false;
    }
  }
}

class LogModal extends Modal {
  plugin: ZoomMyNotesSyncPlugin;

  constructor(app: App, plugin: ZoomMyNotesSyncPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen(): void {
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
      text: readTail(logPath),
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

function statusGlyph(s: DeployStep["status"]): string {
  switch (s) {
    case "ok":
      return "[ok]";
    case "fail":
      return "[fail]";
    case "running":
      return "[…]";
    case "skip":
      return "[skip]";
    default:
      return "[ ]";
  }
}
