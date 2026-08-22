import { ItemView, Modal, Notice, Plugin, normalizePath } from "obsidian";
import { parseState, prepareMutation } from "./state.mjs";
import { filterTasks, groupTasks } from "./models.mjs";

const VIEW_TYPE = "thirdspace-dashboard";
const WORKSPACES = ["00-系统", "01-收件箱", "02-日记", "03-知识", "04-项目", "05-资源", "06-输出", "99-归档"];
const DAILY_ROOT = ".thirdspace/data/daily-agent";

export class DailyAgentStore {
  constructor(app) {
    this.app = app;
  }
  path(name) { return normalizePath(`${DAILY_ROOT}/${name}`); }
  async read(name, collection) {
    const file = this.path(name);
    return parseState(await this.app.vault.adapter.read(file), collection);
  }
  async mutate(name, collection, mutate, event) {
    const file = this.path(name);
    const current = await this.read(name, collection);
    const now = new Date().toISOString();
    const next = prepareMutation(current, current.revision, mutate, now);
    const temporary = `${file}.tmp-dashboard`;
    await this.app.vault.adapter.write(temporary, `${JSON.stringify(next, null, 2)}\n`);
    try {
      await this.app.vault.adapter.rename(temporary, file);
    } catch (error) {
      if (await this.app.vault.adapter.exists(temporary)) await this.app.vault.adapter.remove(temporary);
      throw error;
    }
    try {
      await this.appendEvent({ timestamp: now, source_id: "thirdspace-dashboard", ...event });
    } catch (error) {
      new Notice(`Task saved, event append failed: ${error.message}`);
    }
    return next;
  }
  async appendEvent(event) {
    const required = ["event_id", "timestamp", "event_type", "source_id", "subject_id"];
    for (const field of required) if (!event[field]) throw new Error(`event field required: ${field}`);
    const date = event.timestamp.slice(0, 10).replaceAll("-", "");
    const directory = normalizePath(".thirdspace/events/local");
    if (!(await this.app.vault.adapter.exists(directory))) await this.app.vault.adapter.mkdir(directory);
    const file = normalizePath(`${directory}/${date}.ndjson`);
    await this.app.vault.adapter.append(file, `${JSON.stringify({ schema_version: "1.0", ...event })}\n`);
  }
}

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

function eventId(type, subjectId, timestamp = new Date().toISOString()) {
  return `${type}:${subjectId}:${timestamp.replace(/[-:.]/g, "")}`;
}

class TaskModal extends Modal {
  constructor(app, { task = null, projects = [], onSubmit }) {
    super(app);
    this.task = task;
    this.projects = projects;
    this.onSubmit = onSubmit;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("ts-modal");
    contentEl.createEl("h3", { text: this.task ? "编辑事项" : "新增事项" });
    const field = (label, type, value = "") => {
      const row = contentEl.createDiv({ cls: "ts-form-row" });
      row.createEl("label", { text: label });
      const input = row.createEl("input", { type, value: value || "", cls: "ts-modal-input" });
      return input;
    };
    const title = field("标题", "text", this.task?.title);
    const due = field("DDL", "date", this.task?.due);
    const tags = field("Tags", "text", (this.task?.tags || []).join(","));
    const select = (label, options, value) => {
      const row = contentEl.createDiv({ cls: "ts-form-row" });
      row.createEl("label", { text: label });
      const element = row.createEl("select", { cls: "ts-modal-select" });
      for (const [optionValue, text] of options) element.createEl("option", { value: optionValue, text });
      element.value = value || options[0][0];
      return element;
    };
    const priority = select("优先级", [["critical", "Critical"], ["high", "High"], ["normal", "Normal"], ["low", "Low"]], this.task?.priority || "normal");
    const status = select("状态", [["active", "Active"], ["waiting", "Waiting"], ["completed", "Completed"], ["cancelled", "Cancelled"]], this.task?.status || "active");
    const project = select("项目", [["", "无项目"], ...this.projects.map((item) => [item.id, item.name])], this.task?.project_id || "");
    const buttons = contentEl.createDiv({ cls: "ts-modal-row" });
    buttons.createEl("button", { text: "保存", cls: "mod-cta" }).addEventListener("click", async () => {
      if (!title.value.trim()) return new Notice("标题不能为空");
      await this.onSubmit({
        title: title.value.trim(), priority: priority.value, status: status.value,
        due: due.value || null, tags: [...new Set(tags.value.split(",").map((value) => value.trim()).filter(Boolean))],
        project_id: project.value || null,
      });
      this.close();
    });
    buttons.createEl("button", { text: "取消" }).addEventListener("click", () => this.close());
    title.focus();
  }
  onClose() { this.contentEl.empty(); }
}

class ConfirmModal extends Modal {
  constructor(app, message, onConfirm) { super(app); this.message = message; this.onConfirm = onConfirm; }
  onOpen() {
    this.contentEl.createEl("h3", { text: "需要确认" });
    this.contentEl.createEl("p", { text: this.message });
    const buttons = this.contentEl.createDiv({ cls: "ts-modal-row" });
    buttons.createEl("button", { text: "确认取消事项", cls: "mod-warning" }).addEventListener("click", async () => { await this.onConfirm(); this.close(); });
    buttons.createEl("button", { text: "返回" }).addEventListener("click", () => this.close());
  }
  onClose() { this.contentEl.empty(); }
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
    this.store = new DailyAgentStore(this.app);
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
    await this.renderTasks(left);
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
  async renderTasks(container) {
    const card = container.createDiv({ cls: "ts-card ts-task-card" });
    const head = card.createDiv({ cls: "ts-card-head" });
    head.createDiv({ cls: "ts-card-label", text: "TASKS" });
    let taskState;
    let projects = [];
    try {
      [taskState, projects] = await Promise.all([
        this.store.read("tasks.json", "tasks"),
        this.store.read("project-index.json", "projects").then((state) => state.projects),
      ]);
    } catch (error) {
      card.createDiv({ cls: "ts-warning", text: `Task store unavailable: ${error.message}` });
      return;
    }
    head.createEl("button", { text: "+ 新增", cls: "ts-small-btn" }).addEventListener("click", () => this.openTaskModal(null, projects));
    const filters = card.createDiv({ cls: "ts-task-filters" });
    const tagFilter = filters.createEl("select");
    tagFilter.createEl("option", { value: "", text: "全部 tags" });
    const allTags = [...new Set(taskState.tasks.flatMap((task) => task.tags || []))].sort();
    for (const tag of allTags) tagFilter.createEl("option", { value: tag, text: tag });
    const projectFilter = filters.createEl("select");
    projectFilter.createEl("option", { value: "", text: "全部项目" });
    for (const project of projects) projectFilter.createEl("option", { value: project.id, text: project.name });
    const completedLabel = filters.createEl("label", { cls: "ts-check-label" });
    const completedToggle = completedLabel.createEl("input", { type: "checkbox" });
    completedLabel.appendText(" 显示已完成");
    const list = card.createDiv({ cls: "ts-task-groups" });
    const redraw = () => {
      list.empty();
      const tasks = filterTasks(taskState.tasks, { tag: tagFilter.value, projectId: projectFilter.value, showCompleted: completedToggle.checked });
      const groups = groupTasks(tasks, new Intl.DateTimeFormat("sv-SE").format(new Date()));
      const labels = { overdue: "逾期", today: "今天", upcoming: "即将到期", waiting: "等待", active: "进行中", completed: "已完成/取消" };
      for (const [key, values] of Object.entries(groups)) {
        if (!values.length) continue;
        const section = list.createDiv({ cls: `ts-task-group ts-task-group--${key}` });
        section.createDiv({ cls: "ts-task-group-title", text: `${labels[key]} · ${values.length}` });
        for (const task of values) this.renderTaskRow(section, task, projects);
      }
      if (!tasks.length) list.createDiv({ cls: "ts-empty", text: "没有匹配的事项" });
    };
    tagFilter.addEventListener("change", redraw);
    projectFilter.addEventListener("change", redraw);
    completedToggle.addEventListener("change", redraw);
    redraw();
  }
  renderTaskRow(container, task, projects) {
    const row = container.createDiv({ cls: `ts-task-row ts-priority-${task.priority}` });
    const check = row.createEl("button", { cls: "ts-task-check", text: task.status === "completed" ? "☑" : "☐" });
    check.addEventListener("click", () => this.updateTask(task, { status: task.status === "completed" ? "active" : "completed" }, "task_status_changed"));
    const body = row.createDiv({ cls: "ts-task-body" });
    body.createDiv({ cls: "ts-task-title", text: task.title });
    const meta = body.createDiv({ cls: "ts-task-meta" });
    meta.createSpan({ cls: `ts-chip ts-chip-${task.priority}`, text: task.priority });
    if (task.due) meta.createSpan({ cls: "ts-chip", text: `DDL ${task.due}` });
    const project = projects.find((item) => item.id === task.project_id);
    if (project) meta.createSpan({ cls: "ts-chip", text: project.name });
    for (const tag of task.tags || []) meta.createSpan({ cls: "ts-chip", text: `#${tag}` });
    row.createEl("button", { cls: "ts-task-edit", text: "编辑" }).addEventListener("click", () => this.openTaskModal(task, projects));
  }
  openTaskModal(task, projects) {
    new TaskModal(this.app, { task, projects, onSubmit: async (input) => {
      if (input.status === "cancelled" && task?.status !== "cancelled") {
        return new ConfirmModal(this.app, `确认取消“${input.title}”？历史记录会保留。`, () => this.saveTask(task, input)).open();
      }
      await this.saveTask(task, input);
    } }).open();
  }
  async saveTask(task, input) {
    const now = new Date().toISOString();
    const id = task?.id || `task_${now.replace(/[-:.TZ]/g, "").slice(0, 14)}_${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;
    const nextTask = task ? {
      ...task, ...input, updated_at: now,
      completed_at: input.status === "completed" ? task.completed_at || now : task.completed_at,
    } : {
      id, ...input, review_after: null, created_at: now, updated_at: now,
      completed_at: input.status === "completed" ? now : null, source: "thirdspace-dashboard",
    };
    await this.store.mutate("tasks.json", "tasks", (state) => ({
      ...state,
      tasks: task ? state.tasks.map((item) => item.id === task.id ? nextTask : item) : [...state.tasks, nextTask],
    }), {
      event_id: eventId(task ? (task.status === input.status ? "task_updated" : "task_status_changed") : "task_created", id, now),
      event_type: task ? (task.status === input.status ? "task_updated" : "task_status_changed") : "task_created",
      subject_id: id,
    });
    await this.render();
  }
  async updateTask(task, patch, type) {
    const now = new Date().toISOString();
    await this.store.mutate("tasks.json", "tasks", (state) => ({
      ...state,
      tasks: state.tasks.map((item) => item.id === task.id ? {
        ...item, ...patch, updated_at: now,
        completed_at: patch.status === "completed" ? now : item.completed_at,
      } : item),
    }), { event_id: eventId(type, task.id, now), event_type: type, subject_id: task.id });
    await this.render();
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
