import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";

import { readState, mutateState } from "../scripts/lib/store.mjs";
import { appendEvent, makeEventId } from "../scripts/lib/events.mjs";
import { createTask, listOpeningTasks, registerProject, transitionTask } from "../scripts/lib/tasks.mjs";
import { confirmReadingCandidate, scanReadingInbox } from "../scripts/lib/reading.mjs";
import { completeOpening, prepareOpening } from "../scripts/lib/opening.mjs";

function temporaryVault() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "daily-agent-"));
  fs.mkdirSync(path.join(root, ".thirdspace", "data", "daily-agent"), { recursive: true });
  return root;
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function initializeDailyState(root) {
  const stateRoot = path.join(root, ".thirdspace", "data", "daily-agent");
  writeJson(path.join(stateRoot, "tasks.json"), { version: "1.0", revision: 0, updated_at: null, tasks: [] });
  writeJson(path.join(stateRoot, "project-index.json"), { version: "1.0", revision: 0, updated_at: null, projects: [] });
  writeJson(path.join(stateRoot, "reading-queue.json"), {
    version: "1.0", revision: 0, updated_at: null, items: [], candidates: [], dismissed_source_paths: [],
  });
  writeJson(path.join(stateRoot, "agent-state.json"), {
    version: "1.0", revision: 0, updated_at: null,
    last_manual_checkin: null, last_daily_opening: null,
    last_weekly_review: null, last_monthly_review: null,
    last_remote_sync: {}, pending_confirmations: [],
  });
}

function readEvents(root) {
  const eventRoot = path.join(root, ".thirdspace", "events", "local");
  if (!fs.existsSync(eventRoot)) return [];
  return fs.readdirSync(eventRoot).sort().flatMap((name) => fs.readFileSync(path.join(eventRoot, name), "utf8").trim().split("\n").filter(Boolean).map(JSON.parse));
}

function runCli(root, ...args) {
  const cli = path.resolve(path.dirname(decodeURIComponent(new URL(import.meta.url).pathname)), "../scripts/daily-agent.mjs");
  return JSON.parse(execFileSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    env: { ...process.env, THIRDSPACE_NOW: "2026-08-22T09:00:00+08:00" },
    cwd: root,
  }));
}

test("state store validates JSON and supported version", () => {
  const root = temporaryVault();
  try {
    const invalid = path.join(root, "invalid.json");
    fs.writeFileSync(invalid, "{broken\n", "utf8");
    assert.throws(() => readState(invalid, "tasks"), /invalid JSON/);

    const unsupported = path.join(root, "unsupported.json");
    writeJson(unsupported, { version: "2.0", revision: 0, updated_at: null, tasks: [] });
    assert.throws(() => readState(unsupported, "tasks"), /unsupported version/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("state mutation is revisioned and rejects conflicts", () => {
  const root = temporaryVault();
  try {
    const file = path.join(root, ".thirdspace", "data", "daily-agent", "tasks.json");
    writeJson(file, { version: "1.0", revision: 0, updated_at: null, tasks: [] });
    const now = "2026-08-22T09:00:00+08:00";
    assert.throws(() => mutateState(file, 3, (value) => value, now), /revision conflict/);
    const next = mutateState(file, 0, (value) => ({ ...value, tasks: [{ id: "task_1" }] }), now);
    assert.equal(next.revision, 1);
    assert.equal(next.updated_at, now);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), next);
    assert.deepEqual(fs.readdirSync(path.dirname(file)).filter((name) => name.includes(".tmp-")), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("event append writes one local NDJSON record with deterministic ID", () => {
  const root = temporaryVault();
  try {
    const now = "2026-08-22T09:00:00+08:00";
    const eventId = makeEventId("task_created", "task_1", now);
    assert.equal(eventId, "task_created:task_1:20260822T010000000Z");
    const appended = appendEvent(root, {
      event_id: eventId,
      timestamp: now,
      event_type: "task_created",
      source_id: "pi-agent",
      subject_id: "task_1",
    });
    assert.equal(path.relative(root, appended.path), path.join(".thirdspace", "events", "local", "20260822.ndjson"));
    assert.equal(JSON.parse(fs.readFileSync(appended.path, "utf8").trim()).event_id, eventId);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("task lifecycle validates input, project links, and confirmed cancellation", () => {
  const root = temporaryVault();
  try {
    initializeDailyState(root);
    const projectPath = path.join(root, "04-项目", "产品系统", "20260822_ThirdSpace");
    fs.mkdirSync(projectPath, { recursive: true });
    const context = { vaultRoot: root, now: "2026-08-22T09:00:00+08:00" };
    const project = registerProject(context, {
      id: "project_thirdspace", name: "ThirdSpace",
      path: "04-项目/产品系统/20260822_ThirdSpace", status: "active", stage: "active",
    });
    assert.equal(project.path, "04-项目/产品系统/20260822_ThirdSpace");
    const task = createTask(context, {
      title: "提交合作材料", priority: "high", due: "2026-08-25",
      tags: ["横向", "合作", "横向"], project_id: "project_thirdspace",
    });
    assert.equal(task.status, "active");
    assert.equal(task.source, "pi-agent");
    assert.deepEqual(task.tags, ["横向", "合作"]);
    assert.equal(readEvents(root).at(-1).event_type, "task_created");
    assert.throws(() => createTask(context, { title: "", priority: "normal" }), /title is required/);
    assert.throws(() => createTask(context, { title: "x", priority: "urgent" }), /invalid priority/);
    assert.throws(() => createTask(context, { title: "无效项目任务", priority: "normal", project_id: "project_missing" }), /project not found/);
    const completed = transitionTask(context, task.id, "completed", {});
    assert.ok(completed.completed_at);
    assert.equal(readEvents(root).at(-1).event_type, "task_status_changed");
    assert.throws(() => transitionTask(context, task.id, "cancelled", {}), /confirmation required/);
    const cancelled = transitionTask(context, task.id, "cancelled", { confirmed: true });
    assert.equal(cancelled.status, "cancelled");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("task opening query assigns each task to one reminder group", () => {
  const now = "2026-08-22T09:00:00+08:00";
  const tasks = [
    { id: "overdue", status: "active", due: "2026-08-21", updated_at: "2026-08-01T00:00:00+08:00" },
    { id: "soon", status: "active", due: "2026-08-23", updated_at: "2026-08-22T00:00:00+08:00" },
    { id: "upcoming", status: "active", due: "2026-08-25", updated_at: "2026-08-22T00:00:00+08:00" },
    { id: "waiting", status: "waiting", review_after: "2026-08-22", updated_at: "2026-08-20T00:00:00+08:00" },
    { id: "stale", status: "active", due: null, updated_at: "2026-08-01T00:00:00+08:00" },
    { id: "active", status: "active", due: null, updated_at: "2026-08-21T00:00:00+08:00" },
  ];
  const result = listOpeningTasks(tasks, now);
  assert.deepEqual(Object.fromEntries(Object.entries(result).map(([key, value]) => [key, value.map((task) => task.id)])), {
    overdue: ["overdue"], dueSoon: ["soon"], upcoming: ["upcoming"],
    stale: ["stale"], waitingForReview: ["waiting"], active: ["active"],
  });
});

test("reading scan enrolls tagged items, reconciles processed state, and avoids duplicates", () => {
  const root = temporaryVault();
  try {
    initializeDailyState(root);
    const inbox = path.join(root, "01-收件箱", "网页剪藏");
    fs.mkdirSync(inbox, { recursive: true });
    const markdown = (title, tags, status, url = "") => `---\ntitle: "${title}"\ntype: "clipping"\ntopic: "ai"\nworkspace: "01-收件箱"\ncreated: "2026-08-22 08:00:00"\nmodified: "2026-08-22 08:00:00"\ntags: [${tags.join(", ")}]\nsource: "obsidian-clipper"\nstatus: "${status}"\nurl: "${url}"\n---\n\n# ${title}\n`;
    fs.writeFileSync(path.join(inbox, "20260822_论文.md"), markdown("论文", ["paper", "agent"], "draft", "https://example.com/paper"));
    fs.writeFileSync(path.join(inbox, "20260822_Blog.md"), markdown("Blog", ["blog"], "draft", "https://example.com/blog"));
    fs.writeFileSync(path.join(inbox, "20260822_arxiv.md"), markdown("候选", ["ai"], "draft", "https://arxiv.org/abs/1234"));
    fs.writeFileSync(path.join(inbox, "20260822_已处理.md"), markdown("已处理", ["paper"], "processed", "https://example.com/done"));
    fs.writeFileSync(path.join(inbox, "20260822_想法.md"), markdown("临时想法", ["life"], "draft"));
    const context = { vaultRoot: root, now: "2026-08-22T09:00:00+08:00" };
    const first = scanReadingInbox(context);
    assert.deepEqual(first.added.map((item) => item.kind).sort(), ["blog", "paper"]);
    assert.equal(first.candidates.length, 1);
    assert.equal(first.processed.length, 1);
    const second = scanReadingInbox(context);
    assert.equal(second.added.length, 0);
    assert.equal(second.candidates.length, 0);
    const state = readState(path.join(root, ".thirdspace", "data", "daily-agent", "reading-queue.json"), "items");
    assert.equal(state.items.length, 3);
    assert.equal(state.candidates.length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("rejected reading candidates remain dismissed across scans", () => {
  const root = temporaryVault();
  try {
    initializeDailyState(root);
    const inbox = path.join(root, "01-收件箱", "网页剪藏");
    fs.mkdirSync(inbox, { recursive: true });
    fs.writeFileSync(path.join(inbox, "20260822_候选.md"), '---\ntitle: "候选"\ntags: [ai]\nstatus: "draft"\nurl: "https://arxiv.org/abs/1234"\n---\n');
    const context = { vaultRoot: root, now: "2026-08-22T09:00:00+08:00" };
    const candidate = scanReadingInbox(context).candidates[0];
    confirmReadingCandidate(context, candidate.id, "reject");
    assert.equal(scanReadingInbox(context).candidates.length, 0);
    const state = readState(path.join(root, ".thirdspace", "data", "daily-agent", "reading-queue.json"), "items");
    assert.equal(state.dismissed_source_paths.length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("daily opening prepares prompts and completes one idempotent plan snapshot", () => {
  const root = temporaryVault();
  try {
    initializeDailyState(root);
    fs.mkdirSync(path.join(root, "01-收件箱"), { recursive: true });
    const context = { vaultRoot: root, now: "2026-08-22T09:00:00+08:00" };
    const task = createTask(context, { title: "准备组会", priority: "high", tags: ["科研"] });
    const prepared = prepareOpening(context);
    assert.equal(prepared.required, true);
    assert.equal(prepared.date, "2026-08-22");
    assert.equal(prepared.prompts.completionReview, "昨天及更早的事项中，哪些已经完成、取消或需要等待？");
    assert.equal(prepared.prompts.todayPlan, "今天准备推进什么？请选择 1～3 个今日重点。");
    const completed = completeOpening(context, { focusTaskIds: [task.id] });
    const worklog = fs.readFileSync(completed.worklogPath, "utf8");
    assert.equal((worklog.match(/^## 今日重点$/gm) || []).length, 1);
    assert.equal((worklog.match(/^## 今日计划快照$/gm) || []).length, 1);
    assert.match(worklog, /- \[high\] 准备组会/);
    assert.equal(completed.state.last_daily_opening, "2026-08-22");
    assert.equal(readEvents(root).at(-1).event_type, "daily_plan_created");
    assert.deepEqual(prepareOpening(context), { required: false, date: "2026-08-22" });
    completeOpening({ ...context, force: true }, { focusTaskIds: [task.id] });
    const repeated = fs.readFileSync(completed.worklogPath, "utf8");
    assert.equal((repeated.match(/^## 今日重点$/gm) || []).length, 1);
    assert.equal((repeated.match(/^## 今日计划快照$/gm) || []).length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("CLI exposes opening, project, task, reading, and completion commands", () => {
  const root = temporaryVault();
  try {
    initializeDailyState(root);
    fs.writeFileSync(path.join(root, ".thirdspace", "workspace-index.yaml"), 'vault_root: "."\n');
    const projectPath = path.join(root, "04-项目", "研究验证", "20260822_研究项目");
    fs.mkdirSync(projectPath, { recursive: true });
    const inbox = path.join(root, "01-收件箱", "网页剪藏");
    fs.mkdirSync(inbox, { recursive: true });
    fs.writeFileSync(path.join(inbox, "20260822_论文.md"), '---\ntitle: "论文"\ntags: [paper]\nstatus: "draft"\nurl: "https://example.com/paper"\n---\n');
    const opening = runCli(root, "opening", "--vault", root);
    assert.equal(opening.required, true);
    assert.equal(opening.reading.added.length, 1);
    const project = runCli(root, "project-register", "--vault", root, "--id", "project_research", "--name", "研究项目", "--path", "04-项目/研究验证/20260822_研究项目");
    assert.equal(project.project.id, "project_research");
    const created = runCli(root, "task-add", "--vault", root, "--title", "准备组会", "--priority", "high", "--tags", "科研,组会", "--project-id", "project_research");
    assert.equal(created.task.title, "准备组会");
    assert.equal(created.task.project_id, "project_research");
    assert.equal(runCli(root, "reading-scan", "--vault", root).added.length, 0);
    const completed = runCli(root, "opening-complete", "--vault", root, "--focus", created.task.id);
    assert.equal(completed.state.last_daily_opening, "2026-08-22");
    assert.equal(runCli(root, "opening", "--vault", root).required, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
