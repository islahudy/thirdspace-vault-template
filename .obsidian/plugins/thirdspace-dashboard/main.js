var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
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
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.mjs
var main_exports = {};
__export(main_exports, {
  DailyAgentStore: () => DailyAgentStore,
  default: () => ThirdSpaceDashboard
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");

// src/state.mjs
function parseState(text, collection) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("invalid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid state root");
  if (value.version !== "1.0") throw new Error(`unsupported version: ${value.version ?? "missing"}`);
  if (!Number.isInteger(value.revision) || value.revision < 0) throw new Error("invalid revision");
  if (!Array.isArray(value[collection])) throw new Error(`missing collection: ${collection}`);
  return value;
}
function prepareMutation(current, expectedRevision, mutate, now) {
  if (current.revision !== expectedRevision) throw new Error(`revision conflict: expected ${expectedRevision}, found ${current.revision}`);
  const changed = mutate(structuredClone(current));
  if (!changed || typeof changed !== "object" || Array.isArray(changed)) throw new Error("mutation must return an object");
  return { ...changed, version: "1.0", revision: current.revision + 1, updated_at: now };
}

// src/models.mjs
var PRIORITY_ORDER = { critical: 0, high: 1, normal: 2, low: 3 };
function prioritySort(left, right) {
  return (PRIORITY_ORDER[left.priority] ?? 2) - (PRIORITY_ORDER[right.priority] ?? 2) || String(left.due || "9999-99-99").localeCompare(String(right.due || "9999-99-99"));
}
function filterTasks(tasks, { tag = "", projectId = "", showCompleted = false } = {}) {
  return tasks.filter((task) => {
    if (!showCompleted && task.status === "completed") return false;
    if (tag && !(task.tags || []).includes(tag)) return false;
    if (projectId && task.project_id !== projectId) return false;
    return true;
  });
}
function groupTasks(tasks, today) {
  const groups = { overdue: [], today: [], upcoming: [], waiting: [], active: [], completed: [] };
  for (const task of tasks) {
    if (task.status === "completed" || task.status === "cancelled") groups.completed.push(task);
    else if (task.status === "waiting") groups.waiting.push(task);
    else if (task.due && task.due < today) groups.overdue.push(task);
    else if (task.due === today) groups.today.push(task);
    else if (task.due && task.due > today) groups.upcoming.push(task);
    else groups.active.push(task);
  }
  for (const values of Object.values(groups)) values.sort(prioritySort);
  return groups;
}
function summarizeReading(state, now, staleDays = 7) {
  const items = Array.isArray(state.items) ? state.items : [];
  const candidates = Array.isArray(state.candidates) ? state.candidates : [];
  const counts = { pending: 0, reading: 0, processed: 0, candidates: candidates.length };
  for (const item of items) {
    if (Object.hasOwn(counts, item.status)) counts[item.status] += 1;
  }
  const cutoff = new Date(now).getTime() - staleDays * 864e5;
  const stale = items.filter((item) => ["pending", "reading"].includes(item.status) && Number.isFinite(Date.parse(item.added_at)) && Date.parse(item.added_at) <= cutoff).sort((left, right) => Date.parse(left.added_at) - Date.parse(right.added_at));
  return { counts, stale, candidates };
}

// src/main.mjs
var VIEW_TYPE = "thirdspace-dashboard";
var WORKSPACES = ["00-\u7CFB\u7EDF", "01-\u6536\u4EF6\u7BB1", "02-\u65E5\u8BB0", "03-\u77E5\u8BC6", "04-\u9879\u76EE", "05-\u8D44\u6E90", "06-\u8F93\u51FA", "99-\u5F52\u6863"];
var DAILY_ROOT = ".thirdspace/data/daily-agent";
var DailyAgentStore = class {
  constructor(app) {
    this.app = app;
  }
  path(name) {
    return (0, import_obsidian.normalizePath)(`${DAILY_ROOT}/${name}`);
  }
  async read(name, collection) {
    const file = this.path(name);
    return parseState(await this.app.vault.adapter.read(file), collection);
  }
  async mutate(name, collection, mutate, event) {
    const file = this.path(name);
    const current = await this.read(name, collection);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const next = prepareMutation(current, current.revision, mutate, now);
    const temporary = `${file}.tmp-dashboard`;
    await this.app.vault.adapter.write(temporary, `${JSON.stringify(next, null, 2)}
`);
    try {
      await this.app.vault.adapter.rename(temporary, file);
    } catch (error) {
      if (await this.app.vault.adapter.exists(temporary)) await this.app.vault.adapter.remove(temporary);
      throw error;
    }
    try {
      await this.appendEvent({ timestamp: now, source_id: "thirdspace-dashboard", ...event });
    } catch (error) {
      new import_obsidian.Notice(`Task saved, event append failed: ${error.message}`);
    }
    return next;
  }
  async appendEvent(event) {
    const required = ["event_id", "timestamp", "event_type", "source_id", "subject_id"];
    for (const field of required) if (!event[field]) throw new Error(`event field required: ${field}`);
    const date = event.timestamp.slice(0, 10).replaceAll("-", "");
    const directory = (0, import_obsidian.normalizePath)(".thirdspace/events/local");
    if (!await this.app.vault.adapter.exists(directory)) await this.app.vault.adapter.mkdir(directory);
    const file = (0, import_obsidian.normalizePath)(`${directory}/${date}.ndjson`);
    await this.app.vault.adapter.append(file, `${JSON.stringify({ schema_version: "1.0", ...event })}
`);
  }
};
function dateKey(date = /* @__PURE__ */ new Date()) {
  return new Intl.DateTimeFormat("sv-SE").format(date).replaceAll("-", "");
}
function relativeAge(milliseconds) {
  const days = Math.floor(milliseconds / 864e5);
  if (days <= 0) return "today";
  if (days === 1) return "1d";
  if (days < 7) return `${days}d`;
  if (days < 30) return `${Math.floor(days / 7)}w`;
  return `${Math.floor(days / 30)}mo`;
}
function eventId(type, subjectId, timestamp = (/* @__PURE__ */ new Date()).toISOString()) {
  return `${type}:${subjectId}:${timestamp.replace(/[-:.]/g, "")}`;
}
var TaskModal = class extends import_obsidian.Modal {
  constructor(app, { task = null, projects = [], onSubmit }) {
    super(app);
    this.task = task;
    this.projects = projects;
    this.onSubmit = onSubmit;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("ts-modal");
    contentEl.createEl("h3", { text: this.task ? "\u7F16\u8F91\u4E8B\u9879" : "\u65B0\u589E\u4E8B\u9879" });
    const field = (label, type, value = "") => {
      const row = contentEl.createDiv({ cls: "ts-form-row" });
      row.createEl("label", { text: label });
      const input = row.createEl("input", { type, value: value || "", cls: "ts-modal-input" });
      return input;
    };
    const title = field("\u6807\u9898", "text", this.task?.title);
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
    const priority = select("\u4F18\u5148\u7EA7", [["critical", "Critical"], ["high", "High"], ["normal", "Normal"], ["low", "Low"]], this.task?.priority || "normal");
    const status = select("\u72B6\u6001", [["active", "Active"], ["waiting", "Waiting"], ["completed", "Completed"], ["cancelled", "Cancelled"]], this.task?.status || "active");
    const project = select("\u9879\u76EE", [["", "\u65E0\u9879\u76EE"], ...this.projects.map((item) => [item.id, item.name])], this.task?.project_id || "");
    const buttons = contentEl.createDiv({ cls: "ts-modal-row" });
    buttons.createEl("button", { text: "\u4FDD\u5B58", cls: "mod-cta" }).addEventListener("click", async () => {
      if (!title.value.trim()) return new import_obsidian.Notice("\u6807\u9898\u4E0D\u80FD\u4E3A\u7A7A");
      await this.onSubmit({
        title: title.value.trim(),
        priority: priority.value,
        status: status.value,
        due: due.value || null,
        tags: [...new Set(tags.value.split(",").map((value) => value.trim()).filter(Boolean))],
        project_id: project.value || null
      });
      this.close();
    });
    buttons.createEl("button", { text: "\u53D6\u6D88" }).addEventListener("click", () => this.close());
    title.focus();
  }
  onClose() {
    this.contentEl.empty();
  }
};
var ConfirmModal = class extends import_obsidian.Modal {
  constructor(app, message, onConfirm) {
    super(app);
    this.message = message;
    this.onConfirm = onConfirm;
  }
  onOpen() {
    this.contentEl.createEl("h3", { text: "\u9700\u8981\u786E\u8BA4" });
    this.contentEl.createEl("p", { text: this.message });
    const buttons = this.contentEl.createDiv({ cls: "ts-modal-row" });
    buttons.createEl("button", { text: "\u786E\u8BA4\u53D6\u6D88\u4E8B\u9879", cls: "mod-warning" }).addEventListener("click", async () => {
      await this.onConfirm();
      this.close();
    });
    buttons.createEl("button", { text: "\u8FD4\u56DE" }).addEventListener("click", () => this.close());
  }
  onClose() {
    this.contentEl.empty();
  }
};
var QuickNoteModal = class extends import_obsidian.Modal {
  constructor(app, onSubmit) {
    super(app);
    this.onSubmit = onSubmit;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("ts-modal");
    contentEl.createEl("h3", { text: "\u65B0\u7B14\u8BB0" });
    const input = contentEl.createEl("input", { type: "text", cls: "ts-modal-input" });
    input.placeholder = "\u8F93\u5165\u6807\u9898";
    const submit = () => {
      const value = input.value.trim();
      if (value) this.onSubmit(value);
      this.close();
    };
    contentEl.createEl("button", { text: "\u521B\u5EFA", cls: "mod-cta" }).addEventListener("click", submit);
    input.addEventListener("keydown", (event) => event.key === "Enter" && submit());
    input.focus();
  }
  onClose() {
    this.contentEl.empty();
  }
};
var ThirdSpaceView = class extends import_obsidian.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.store = new DailyAgentStore(this.app);
    this.timer = null;
  }
  getViewType() {
    return VIEW_TYPE;
  }
  getDisplayText() {
    return "ThirdSpace";
  }
  getIcon() {
    return "layout-dashboard";
  }
  async onOpen() {
    await this.render();
    this.timer = window.setInterval(() => this.render(), 6e4);
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
    const thisWeek = files.filter((file) => now - file.stat.mtime < 7 * 864e5).length;
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
    await this.renderReading(right);
    this.renderQuick(right);
    this.renderRecent(right, files);
  }
  renderActivity(container, files, now) {
    const card = container.createDiv({ cls: "ts-card ts-heatmap-card" });
    card.createDiv({ cls: "ts-card-label", text: "ACTIVITY \xB7 PAST 90 DAYS" });
    const grid = card.createDiv({ cls: "ts-activity-grid" });
    for (let offset = 89; offset >= 0; offset -= 1) {
      const start = new Date(now - offset * 864e5);
      start.setHours(0, 0, 0, 0);
      const end = start.getTime() + 864e5;
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
      row.createDiv({ cls: "ts-ws-time", text: latest ? `active ${relativeAge(now - latest)}` : "\u2014" });
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
        this.store.read("project-index.json", "projects").then((state) => state.projects)
      ]);
    } catch (error) {
      card.createDiv({ cls: "ts-warning", text: `Task store unavailable: ${error.message}` });
      return;
    }
    head.createEl("button", { text: "+ \u65B0\u589E", cls: "ts-small-btn" }).addEventListener("click", () => this.openTaskModal(null, projects));
    const filters = card.createDiv({ cls: "ts-task-filters" });
    const tagFilter = filters.createEl("select");
    tagFilter.createEl("option", { value: "", text: "\u5168\u90E8 tags" });
    const allTags = [...new Set(taskState.tasks.flatMap((task) => task.tags || []))].sort();
    for (const tag of allTags) tagFilter.createEl("option", { value: tag, text: tag });
    const projectFilter = filters.createEl("select");
    projectFilter.createEl("option", { value: "", text: "\u5168\u90E8\u9879\u76EE" });
    for (const project of projects) projectFilter.createEl("option", { value: project.id, text: project.name });
    const completedLabel = filters.createEl("label", { cls: "ts-check-label" });
    const completedToggle = completedLabel.createEl("input", { type: "checkbox" });
    completedLabel.appendText(" \u663E\u793A\u5DF2\u5B8C\u6210");
    const list = card.createDiv({ cls: "ts-task-groups" });
    const redraw = () => {
      list.empty();
      const tasks = filterTasks(taskState.tasks, { tag: tagFilter.value, projectId: projectFilter.value, showCompleted: completedToggle.checked });
      const groups = groupTasks(tasks, new Intl.DateTimeFormat("sv-SE").format(/* @__PURE__ */ new Date()));
      const labels = { overdue: "\u903E\u671F", today: "\u4ECA\u5929", upcoming: "\u5373\u5C06\u5230\u671F", waiting: "\u7B49\u5F85", active: "\u8FDB\u884C\u4E2D", completed: "\u5DF2\u5B8C\u6210/\u53D6\u6D88" };
      for (const [key, values] of Object.entries(groups)) {
        if (!values.length) continue;
        const section = list.createDiv({ cls: `ts-task-group ts-task-group--${key}` });
        section.createDiv({ cls: "ts-task-group-title", text: `${labels[key]} \xB7 ${values.length}` });
        for (const task of values) this.renderTaskRow(section, task, projects);
      }
      if (!tasks.length) list.createDiv({ cls: "ts-empty", text: "\u6CA1\u6709\u5339\u914D\u7684\u4E8B\u9879" });
    };
    tagFilter.addEventListener("change", redraw);
    projectFilter.addEventListener("change", redraw);
    completedToggle.addEventListener("change", redraw);
    redraw();
  }
  renderTaskRow(container, task, projects) {
    const row = container.createDiv({ cls: `ts-task-row ts-priority-${task.priority}` });
    const check = row.createEl("button", { cls: "ts-task-check", text: task.status === "completed" ? "\u2611" : "\u2610" });
    check.addEventListener("click", () => this.updateTask(task, { status: task.status === "completed" ? "active" : "completed" }, "task_status_changed"));
    const body = row.createDiv({ cls: "ts-task-body" });
    body.createDiv({ cls: "ts-task-title", text: task.title });
    const meta = body.createDiv({ cls: "ts-task-meta" });
    meta.createSpan({ cls: `ts-chip ts-chip-${task.priority}`, text: task.priority });
    if (task.due) meta.createSpan({ cls: "ts-chip", text: `DDL ${task.due}` });
    const project = projects.find((item) => item.id === task.project_id);
    if (project) meta.createSpan({ cls: "ts-chip", text: project.name });
    for (const tag of task.tags || []) meta.createSpan({ cls: "ts-chip", text: `#${tag}` });
    row.createEl("button", { cls: "ts-task-edit", text: "\u7F16\u8F91" }).addEventListener("click", () => this.openTaskModal(task, projects));
  }
  openTaskModal(task, projects) {
    new TaskModal(this.app, { task, projects, onSubmit: async (input) => {
      if (input.status === "cancelled" && task?.status !== "cancelled") {
        return new ConfirmModal(this.app, `\u786E\u8BA4\u53D6\u6D88\u201C${input.title}\u201D\uFF1F\u5386\u53F2\u8BB0\u5F55\u4F1A\u4FDD\u7559\u3002`, () => this.saveTask(task, input)).open();
      }
      await this.saveTask(task, input);
    } }).open();
  }
  async saveTask(task, input) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const id = task?.id || `task_${now.replace(/[-:.TZ]/g, "").slice(0, 14)}_${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;
    const nextTask = task ? {
      ...task,
      ...input,
      updated_at: now,
      completed_at: input.status === "completed" ? task.completed_at || now : task.completed_at
    } : {
      id,
      ...input,
      review_after: null,
      created_at: now,
      updated_at: now,
      completed_at: input.status === "completed" ? now : null,
      source: "thirdspace-dashboard"
    };
    await this.store.mutate("tasks.json", "tasks", (state) => ({
      ...state,
      tasks: task ? state.tasks.map((item) => item.id === task.id ? nextTask : item) : [...state.tasks, nextTask]
    }), {
      event_id: eventId(task ? task.status === input.status ? "task_updated" : "task_status_changed" : "task_created", id, now),
      event_type: task ? task.status === input.status ? "task_updated" : "task_status_changed" : "task_created",
      subject_id: id
    });
    await this.render();
  }
  async updateTask(task, patch, type) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    await this.store.mutate("tasks.json", "tasks", (state) => ({
      ...state,
      tasks: state.tasks.map((item) => item.id === task.id ? {
        ...item,
        ...patch,
        updated_at: now,
        completed_at: patch.status === "completed" ? now : item.completed_at
      } : item)
    }), { event_id: eventId(type, task.id, now), event_type: type, subject_id: task.id });
    await this.render();
  }
  renderToday(container) {
    const card = container.createDiv({ cls: "ts-card" });
    card.createDiv({ cls: "ts-card-label", text: "TODAY" });
    const prefix = `02-\u65E5\u8BB0/\u5DE5\u4F5C\u65E5\u5FD7/${dateKey()}`;
    const file = this.app.vault.getMarkdownFiles().find((candidate) => candidate.path.startsWith(prefix));
    if (!file) card.createDiv({ cls: "ts-empty", text: "No worklog yet" });
    else {
      card.createDiv({ cls: "ts-log-body", text: file.basename });
      card.addEventListener("click", () => this.app.workspace.getLeaf(false).openFile(file));
    }
  }
  async renderReading(container) {
    const card = container.createDiv({ cls: "ts-card ts-reading-card" });
    const head = card.createDiv({ cls: "ts-card-head" });
    head.createDiv({ cls: "ts-card-label", text: "READING QUEUE" });
    head.createEl("button", { text: "\u6253\u5F00\u6536\u4EF6\u7BB1", cls: "ts-small-btn" }).addEventListener("click", () => this.openMostRecent("01-\u6536\u4EF6\u7BB1"));
    let state;
    try {
      state = await this.store.read("reading-queue.json", "items");
    } catch (error) {
      card.createDiv({ cls: "ts-warning", text: `Reading store unavailable: ${error.message}` });
      return;
    }
    const summary = summarizeReading(state, (/* @__PURE__ */ new Date()).toISOString(), 7);
    const stats = card.createDiv({ cls: "ts-reading-stats" });
    for (const [label, value] of [["\u5F85\u9605\u8BFB", summary.counts.pending], ["\u9605\u8BFB\u4E2D", summary.counts.reading], ["\u5DF2\u5904\u7406", summary.counts.processed]]) {
      const item = stats.createDiv({ cls: "ts-reading-stat" });
      item.createDiv({ cls: "ts-reading-num", text: String(value) });
      item.createDiv({ cls: "ts-reading-label", text: label });
    }
    if (summary.counts.candidates) card.createDiv({ cls: "ts-reading-candidates", text: `${summary.counts.candidates} \u6761\u5019\u9009\u5185\u5BB9\u7B49\u5F85\u786E\u8BA4` });
    if (!summary.stale.length) {
      card.createDiv({ cls: "ts-empty", text: "\u6682\u65E0\u8D85\u8FC7 7 \u5929\u7684\u9605\u8BFB\u79EF\u538B" });
      return;
    }
    card.createDiv({ cls: "ts-reading-heading", text: `\u8D85\u8FC7 7 \u5929 \xB7 ${summary.stale.length}` });
    for (const item of summary.stale.slice(0, 5)) {
      const row = card.createDiv({ cls: "ts-reading-row" });
      row.createDiv({ cls: "ts-reading-title", text: item.title || item.source_path || item.id });
      row.createDiv({ cls: "ts-reading-meta", text: `${item.kind || "reading"} \xB7 ${item.status}` });
      if (item.source_path) row.addEventListener("click", () => this.openPath(item.source_path));
    }
  }
  renderQuick(container) {
    const card = container.createDiv({ cls: "ts-card" });
    card.createDiv({ cls: "ts-card-label", text: "QUICK" });
    const actions = card.createDiv({ cls: "ts-act-grid" });
    for (const [label, action] of [["\u65B0\u7B14\u8BB0", () => this.createNote()], ["\u4ECA\u65E5\u5FD7", () => this.openMostRecent("02-\u65E5\u8BB0/\u5DE5\u4F5C\u65E5\u5FD7")], ["\u6536\u4EF6\u7BB1", () => this.openMostRecent("01-\u6536\u4EF6\u7BB1")], ["\u641C\u7D22", () => this.app.commands.executeCommandById("global-search:open")]]) {
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
    else new import_obsidian.Notice(`No files under ${prefix}`);
  }
  async openPath(path) {
    const file = this.app.vault.getAbstractFileByPath((0, import_obsidian.normalizePath)(path));
    if (file?.path) await this.app.workspace.getLeaf(false).openFile(file);
    else new import_obsidian.Notice(`File not found: ${path}`);
  }
  createNote() {
    new QuickNoteModal(this.app, async (title) => {
      const path = `01-\u6536\u4EF6\u7BB1/\u5F85\u6574\u7406/${dateKey()}_${title.replace(/[\\/:*?"<>|\s]+/g, "_")}.md`;
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const file = await this.app.vault.create(path, `---
title: "${title.replaceAll('"', '\\"')}"
type: "note"
topic: "work"
workspace: "01-\u6536\u4EF6\u7BB1"
created: "${now}"
modified: "${now}"
tags: ["note", "draft"]
source: "manual"
status: "draft"
---

`);
      await this.app.workspace.getLeaf(false).openFile(file);
    }).open();
  }
};
var ThirdSpaceDashboard = class extends import_obsidian.Plugin {
  async onload() {
    this.registerView(VIEW_TYPE, (leaf) => new ThirdSpaceView(leaf, this));
    this.addRibbonIcon("layout-dashboard", "ThirdSpace Dashboard", () => this.activateView());
    this.addCommand({ id: "open-dashboard", name: "Open ThirdSpace Dashboard", callback: () => this.activateView() });
  }
  onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
  }
  async activateView() {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (existing) return this.app.workspace.revealLeaf(existing);
    const leaf = this.app.workspace.getRightLeaf(false);
    if (leaf) {
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
      await this.app.workspace.revealLeaf(leaf);
    }
  }
};
