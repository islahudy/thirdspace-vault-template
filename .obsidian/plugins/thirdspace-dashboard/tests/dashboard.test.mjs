import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { parseState, prepareMutation } from "../src/state.mjs";
import { filterTasks, groupTasks } from "../src/models.mjs";

const pluginRoot = path.resolve(path.dirname(decodeURIComponent(new URL(import.meta.url).pathname)), "..");

test("dashboard exposes reproducible source build and test scripts", () => {
  const packageFile = path.join(pluginRoot, "package.json");
  assert.equal(fs.existsSync(packageFile), true);
  const manifest = JSON.parse(fs.readFileSync(packageFile, "utf8"));
  assert.equal(manifest.scripts.build, "esbuild src/main.mjs --bundle --external:obsidian --format=cjs --platform=browser --outfile=main.js");
  assert.equal(manifest.scripts.test, "node --test tests/*.test.mjs");
  assert.equal(fs.existsSync(path.join(pluginRoot, "src", "main.mjs")), true);
});

test("dashboard state parser rejects invalid contracts", () => {
  assert.throws(() => parseState("{broken", "tasks"), /invalid JSON/);
  assert.throws(() => parseState('{"version":"2.0","revision":0,"tasks":[]}', "tasks"), /unsupported version/);
  assert.throws(() => parseState('{"version":"1.0","revision":-1,"tasks":[]}', "tasks"), /invalid revision/);
  assert.throws(() => parseState('{"version":"1.0","revision":0}', "tasks"), /missing collection/);
});

test("dashboard prepares one revisioned state mutation", () => {
  const current = { version: "1.0", revision: 2, updated_at: null, tasks: [] };
  assert.throws(() => prepareMutation(current, 1, (value) => value, "2026-08-22T09:00:00+08:00"), /revision conflict/);
  const next = prepareMutation(current, 2, (value) => ({ ...value, tasks: [{ id: "task_1" }] }), "2026-08-22T09:00:00+08:00");
  assert.equal(next.revision, 3);
  assert.equal(next.updated_at, "2026-08-22T09:00:00+08:00");
  assert.deepEqual(next.tasks, [{ id: "task_1" }]);
});

test("task model groups once with priority-stable ordering", () => {
  const tasks = [
    { id: "normal-overdue", status: "active", priority: "normal", due: "2026-08-21", tags: [] },
    { id: "critical-overdue", status: "active", priority: "critical", due: "2026-08-20", tags: [] },
    { id: "today", status: "active", priority: "high", due: "2026-08-22", tags: [] },
    { id: "future", status: "active", priority: "low", due: "2026-08-25", tags: [] },
    { id: "waiting", status: "waiting", priority: "normal", due: null, tags: [] },
    { id: "active", status: "active", priority: "normal", due: null, tags: [] },
    { id: "done", status: "completed", priority: "critical", due: null, tags: [] },
  ];
  const grouped = groupTasks(tasks, "2026-08-22");
  assert.deepEqual(grouped.overdue.map((task) => task.id), ["critical-overdue", "normal-overdue"]);
  assert.deepEqual(grouped.today.map((task) => task.id), ["today"]);
  assert.deepEqual(grouped.upcoming.map((task) => task.id), ["future"]);
  assert.deepEqual(grouped.waiting.map((task) => task.id), ["waiting"]);
  assert.deepEqual(grouped.active.map((task) => task.id), ["active"]);
  assert.deepEqual(grouped.completed.map((task) => task.id), ["done"]);
});

test("task model filters by tag, project, and completed visibility", () => {
  const tasks = [
    { id: "a", status: "active", tags: ["科研"], project_id: "p1" },
    { id: "b", status: "completed", tags: ["科研"], project_id: "p1" },
    { id: "c", status: "active", tags: ["生活"], project_id: null },
  ];
  assert.deepEqual(filterTasks(tasks, { tag: "科研", projectId: "p1", showCompleted: false }).map((task) => task.id), ["a"]);
  assert.deepEqual(filterTasks(tasks, { tag: "科研", projectId: "p1", showCompleted: true }).map((task) => task.id), ["a", "b"]);
});
