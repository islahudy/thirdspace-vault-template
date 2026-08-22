import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { readState, mutateState } from "../scripts/lib/store.mjs";
import { appendEvent, makeEventId } from "../scripts/lib/events.mjs";

function temporaryVault() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "daily-agent-"));
  fs.mkdirSync(path.join(root, ".thirdspace", "data", "daily-agent"), { recursive: true });
  return root;
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
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
