import { ItemView, Modal, Notice, Plugin } from "obsidian";

const VIEW_TYPE = "thirdspace-dashboard";
const WORKSPACES = ["00-系统", "01-收件箱", "02-日记", "03-知识", "04-项目", "05-资源", "06-输出", "99-归档"];

function dateKey(date = new Date()) {
  return new Intl.DateTimeFormat("sv-SE").format(date).replaceAll("-", "");
}

function relativeAge(milliseconds) {
  const days = Math.floor(milliseconds / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "1d";
  if (days < 7) return `${days}d`;
  if (days < 30) return `${Math.floor(days / 7)}w`;
  return `${Math.floor(days / 30)}mo`;
}

class QuickNoteModal extends Modal {
  constructor(app, onSubmit) {
    super(app);
    this.onSubmit = onSubmit;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("ts-modal");
    contentEl.createEl("h3", { text: "新笔记" });
    const input = contentEl.createEl("input", { type: "text", cls: "ts-modal-input" });
    input.placeholder = "输入标题";
    const submit = () => {
      const value = input.value.trim();
      if (value) this.onSubmit(value);
      this.close();
    };
    contentEl.createEl("button", { text: "创建", cls: "mod-cta" }).addEventListener("click", submit);
    input.addEventListener("keydown", (event) => event.key === "Enter" && submit());
    input.focus();
  }
  onClose() { this.contentEl.empty(); }
}

class ThirdSpaceView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.timer = null;
  }
  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return "ThirdSpace"; }
  getIcon() { return "layout-dashboard"; }
  async onOpen() {
    await this.render();
    this.timer = window.setInterval(() => this.render(), 60_000);
  }
  async onClose() {
    if (this.timer) window.clearInterval(this.timer);
  }
  workspaceFiles(workspace) {
    return this.app.vault.getFiles().filter((file) => file.path.startsWith(`${workspace}/`) && !/\b(WORKSPACE|AGENTS|CLAUDE)\.md$/.test(file.path));
  }
  async render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("ts-dash");
    const files = this.app.vault.getFiles();
    const now = Date.now();
    const header = contentEl.createDiv({ cls: "ts-hdr" });
    header.createDiv({ cls: "ts-vault-title", text: this.app.vault.getName() });
    header.createDiv({ cls: "ts-pill ts-pill--ok", text: `${WORKSPACES.length} workspaces` });
    const thisWeek = files.filter((file) => now - file.stat.mtime < 7 * 86_400_000).length;
    const stats = contentEl.createDiv({ cls: "ts-stats-row" });
    for (const item of [{ value: files.length, label: "files" }, { value: thisWeek, label: "this week" }, { value: WORKSPACES.length, label: "workspaces" }]) {
      const cell = stats.createDiv({ cls: "ts-stat-cell" });
      cell.createDiv({ cls: "ts-stat-num", text: String(item.value) });
      cell.createDiv({ cls: "ts-stat-lbl", text: item.label });
    }
    this.renderActivity(contentEl, files, now);
    const main = contentEl.createDiv({ cls: "ts-main" });
    const left = main.createDiv({ cls: "ts-left" });
    const right = main.createDiv({ cls: "ts-right" });
    this.renderWorkspaces(left, now);
    this.renderTaskPlaceholder(left);
    this.renderToday(right);
    this.renderQuick(right);
    this.renderRecent(right, files);
  }
  renderActivity(container, files, now) {
    const card = container.createDiv({ cls: "ts-card ts-heatmap-card" });
    card.createDiv({ cls: "ts-card-label", text: "ACTIVITY · PAST 90 DAYS" });
    const grid = card.createDiv({ cls: "ts-activity-grid" });
    for (let offset = 89; offset >= 0; offset -= 1) {
      const start = new Date(now - offset * 86_400_000);
      start.setHours(0, 0, 0, 0);
      const end = start.getTime() + 86_400_000;
      const count = files.filter((file) => file.stat.mtime >= start.getTime() && file.stat.mtime < end).length;
      grid.createSpan({ cls: `ts-activity-cell ts-level-${Math.min(4, count)}`, attr: { title: `${start.toLocaleDateString()}: ${count}` } });
    }
  }
  renderWorkspaces(container, now) {
    const card = container.createDiv({ cls: "ts-card" });
    card.createDiv({ cls: "ts-card-label", text: "WORKSPACES" });
    const grid = card.createDiv({ cls: "ts-ws-grid" });
    for (const workspace of WORKSPACES) {
      const files = this.workspaceFiles(workspace);
      const latest = Math.max(0, ...files.map((file) => file.stat.mtime));
      const row = grid.createDiv({ cls: "ts-ws-card" });
      row.createDiv({ cls: "ts-ws-name", text: workspace.replace(/^\d+-/, "") });
      row.createDiv({ cls: "ts-ws-count", text: `${files.length} files` });
      row.createDiv({ cls: "ts-ws-time", text: latest ? `active ${relativeAge(now - latest)}` : "—" });
      row.addEventListener("click", () => this.openMostRecent(workspace));
    }
  }
  renderTaskPlaceholder(container) {
    const card = container.createDiv({ cls: "ts-card ts-task-card" });
    card.createDiv({ cls: "ts-card-label", text: "TASKS" });
    card.createDiv({ cls: "ts-empty", text: "Daily Agent task store loading…" });
  }
  renderToday(container) {
    const card = container.createDiv({ cls: "ts-card" });
    card.createDiv({ cls: "ts-card-label", text: "TODAY" });
    const prefix = `02-日记/工作日志/${dateKey()}`;
    const file = this.app.vault.getMarkdownFiles().find((candidate) => candidate.path.startsWith(prefix));
    if (!file) card.createDiv({ cls: "ts-empty", text: "No worklog yet" });
    else {
      card.createDiv({ cls: "ts-log-body", text: file.basename });
      card.addEventListener("click", () => this.app.workspace.getLeaf(false).openFile(file));
    }
  }
  renderQuick(container) {
    const card = container.createDiv({ cls: "ts-card" });
    card.createDiv({ cls: "ts-card-label", text: "QUICK" });
    const actions = card.createDiv({ cls: "ts-act-grid" });
    for (const [label, action] of [["新笔记", () => this.createNote()], ["今日志", () => this.openMostRecent("02-日记/工作日志")], ["收件箱", () => this.openMostRecent("01-收件箱")], ["搜索", () => this.app.commands.executeCommandById("global-search:open")]]) {
      actions.createEl("button", { cls: "ts-act-btn", text: label }).addEventListener("click", action);
    }
  }
  renderRecent(container, files) {
    const card = container.createDiv({ cls: "ts-card" });
    card.createDiv({ cls: "ts-card-label", text: "RECENT" });
    for (const file of files.filter((item) => item.extension === "md").sort((a, b) => b.stat.mtime - a.stat.mtime).slice(0, 7)) {
      const row = card.createDiv({ cls: "ts-rec-row", text: file.basename });
      row.addEventListener("click", () => this.app.workspace.getLeaf(false).openFile(file));
    }
  }
  async openMostRecent(prefix) {
    const file = this.app.vault.getFiles().filter((item) => item.path.startsWith(`${prefix}/`)).sort((a, b) => b.stat.mtime - a.stat.mtime)[0];
    if (file) await this.app.workspace.getLeaf(false).openFile(file);
    else new Notice(`No files under ${prefix}`);
  }
  createNote() {
    new QuickNoteModal(this.app, async (title) => {
      const path = `01-收件箱/待整理/${dateKey()}_${title.replace(/[\\/:*?"<>|\s]+/g, "_")}.md`;
      const now = new Date().toISOString();
      const file = await this.app.vault.create(path, `---\ntitle: "${title.replaceAll('"', '\\"')}"\ntype: "note"\ntopic: "work"\nworkspace: "01-收件箱"\ncreated: "${now}"\nmodified: "${now}"\ntags: ["note", "draft"]\nsource: "manual"\nstatus: "draft"\n---\n\n`);
      await this.app.workspace.getLeaf(false).openFile(file);
    }).open();
  }
}

export default class ThirdSpaceDashboard extends Plugin {
  async onload() {
    this.registerView(VIEW_TYPE, (leaf) => new ThirdSpaceView(leaf, this));
    this.addRibbonIcon("layout-dashboard", "ThirdSpace Dashboard", () => this.activateView());
    this.addCommand({ id: "open-dashboard", name: "Open ThirdSpace Dashboard", callback: () => this.activateView() });
  }
  onunload() { this.app.workspace.detachLeavesOfType(VIEW_TYPE); }
  async activateView() {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (existing) return this.app.workspace.revealLeaf(existing);
    const leaf = this.app.workspace.getRightLeaf(false);
    if (leaf) {
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
      await this.app.workspace.revealLeaf(leaf);
    }
  }
}
