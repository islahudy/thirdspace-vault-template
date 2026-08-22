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
    this.renderTaskPlaceholder(left);
    this.renderToday(right);
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
  renderTaskPlaceholder(container) {
    const card = container.createDiv({ cls: "ts-card ts-task-card" });
    card.createDiv({ cls: "ts-card-label", text: "TASKS" });
    card.createDiv({ cls: "ts-empty", text: "Daily Agent task store loading\u2026" });
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
