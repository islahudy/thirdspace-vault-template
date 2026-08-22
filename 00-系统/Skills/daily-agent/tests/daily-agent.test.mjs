import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { readState, mutateState } from "../scripts/lib/store.mjs";
import { appendEvent, makeEventId } from "../scripts/lib/events.mjs";
import { createTask, listOpeningTasks, registerProject, transitionTask } from "../scripts/lib/tasks.mjs";

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
}

function readEvents(root) {
  const eventRoot = path.join(root, ".thirdspace", "events", "local");
  if (!fs.existsSync(eventRoot)) return [];
  return fs.readdirSync(eventRoot).sort().flatMap((name) => fs.readFileSync(path.join(eventRoot, name), "utf8").trim().split("\n").filter(Boolean).map(JSON.parse));
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
