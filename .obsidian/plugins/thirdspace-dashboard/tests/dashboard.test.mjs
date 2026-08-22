import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { parseState, prepareMutation } from "../src/state.mjs";

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
