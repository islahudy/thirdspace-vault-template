import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";

import { loadRemoteSources } from "../scripts/lib/remote-config.mjs";
import { syncRemoteSources } from "../scripts/lib/remote-sync.mjs";
import { normalizeEvents } from "../scripts/lib/normalizer.mjs";

function temporaryVault() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "daily-agent-events-"));
  fs.mkdirSync(path.join(root, ".thirdspace", "data", "daily-agent"), { recursive: true });
  return root;
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function initializeAgentState(root) {
  writeJson(path.join(root, ".thirdspace", "data", "daily-agent", "agent-state.json"), {
    version: "1.0", revision: 0, updated_at: null,
    last_manual_checkin: null, last_daily_opening: null,
    last_weekly_review: null, last_monthly_review: null,
    last_remote_sync: {}, pending_confirmations: [],
  });
}

function writeConfig(root, text) {
  const file = path.join(root, ".thirdspace", "config", "remote-event-sources.local.yaml");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, "utf8");
  return file;
}

function validCommit(sourceId) {
  return {
    schema_version: "1.0",
    event_id: `${sourceId}:commit:abc123`,
    timestamp: "2026-08-22T09:00:00+08:00",
    event_type: "git_commit",
    source_id: sourceId,
  };
}

function writeRawEvents(root, sourceId, lines) {
  const file = path.join(root, ".thirdspace", "events", "remote", sourceId, "raw", "events.ndjson");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${lines.join("\n")}\n`, "utf8");
  return file;
}

function writeProjectIndex(root) {
  writeJson(path.join(root, ".thirdspace", "data", "daily-agent", "project-index.json"), {
    version: "1.0",
    revision: 0,
    updated_at: null,
    projects: [{
      id: "project_research",
      name: "Research",
      path: "04-项目/Research",
      status: "active",
      stage: "active",
      repo_mappings: ["research-code"],
    }],
  });
}

function runCli(root, ...args) {
  const cli = path.resolve(path.dirname(decodeURIComponent(new URL(import.meta.url).pathname)), "../scripts/daily-agent.mjs");
  return JSON.parse(execFileSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    env: { ...process.env, THIRDSPACE_NOW: "2026-08-22T09:00:00+08:00" },
    cwd: root,
  }));
}

test("remote source config accepts the template subset and rejects unsafe or ambiguous sources", () => {
  const root = temporaryVault();
  try {
    const valid = writeConfig(root, `version: "1.0"\ntimezone: "Asia/Shanghai"\nsources:\n  - source_id: "183"\n    ssh_host: "183"\n    remote_path: "/nas/users/events.ndjson"\n    enabled: true\n`);
    assert.deepEqual(loadRemoteSources(valid), {
      version: "1.0",
      sources: [{ source_id: "183", ssh_host: "183", remote_path: "/nas/users/events.ndjson", enabled: true }],
    });

    const unsafeHost = writeConfig(root, `version: "1.0"\nsources:\n  - source_id: "183"\n    ssh_host: "183;touch-pwned"\n    remote_path: "/nas/users/events.ndjson"\n    enabled: true\n`);
    assert.throws(() => loadRemoteSources(unsafeHost), /invalid ssh_host/);

    const optionHost = writeConfig(root, `version: "1.0"\nsources:\n  - source_id: "183"\n    ssh_host: "-Eaudit.log"\n    remote_path: "/nas/users/events.ndjson"\n    enabled: true\n`);
    assert.throws(() => loadRemoteSources(optionHost), /invalid ssh_host/);

    const unsafePath = writeConfig(root, `version: "1.0"\nsources:\n  - source_id: "183"\n    ssh_host: "183"\n    remote_path: "relative/events.ndjson"\n    enabled: true\n`);
    assert.throws(() => loadRemoteSources(unsafePath), /invalid remote_path/);

    const duplicate = writeConfig(root, `version: "1.0"\nsources:\n  - source_id: "183"\n    ssh_host: "183"\n    remote_path: "/nas/users/events.ndjson"\n    enabled: true\n  - source_id: "183"\n    ssh_host: "backup"\n    remote_path: "/nas/users/backup.ndjson"\n    enabled: true\n`);
    assert.throws(() => loadRemoteSources(duplicate), /duplicate source_id/);

    for (const sourceId of [".", ".."]) {
      const unsafeSourceId = writeConfig(root, `version: "1.0"\nsources:\n  - source_id: "${sourceId}"\n    ssh_host: "183"\n    remote_path: "/nas/users/events.ndjson"\n    enabled: true\n`);
      assert.throws(() => loadRemoteSources(unsafeSourceId), /invalid source_id/);
    }

    const unknown = writeConfig(root, `version: "1.0"\nsecret: "no"\nsources: []\n`);
    assert.throws(() => loadRemoteSources(unknown), /unknown top-level key/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("remote synchronization isolates failures, atomically replaces raw snapshots, and records every result", () => {
  const root = temporaryVault();
  try {
    initializeAgentState(root);
    const configPath = writeConfig(root, `version: "1.0"\ntimezone: "Asia/Shanghai"\nsources:\n  - source_id: "183"\n    ssh_host: "183"\n    remote_path: "/nas/users/events.ndjson"\n    enabled: true\n  - source_id: "disabled"\n    ssh_host: "disabled"\n    remote_path: "/nas/users/disabled.ndjson"\n    enabled: false\n  - source_id: "broken"\n    ssh_host: "broken"\n    remote_path: "/nas/users/broken.ndjson"\n    enabled: true\n`);
    const rawPath = path.join(root, ".thirdspace", "events", "remote", "183", "raw", "events.ndjson");
    fs.mkdirSync(path.dirname(rawPath), { recursive: true });
    fs.writeFileSync(rawPath, '{"previous":true}\n', "utf8");

    const context = { vaultRoot: root, now: "2026-08-22T09:00:00+08:00" };
    const result = syncRemoteSources(context, {
      configPath,
      fetchSource(source) {
        if (source.source_id === "broken") throw new Error("unreachable");
        return `${JSON.stringify(validCommit(source.source_id))}\n`;
      },
    });

    assert.deepEqual(result.succeeded.map((item) => item.source_id), ["183"]);
    assert.deepEqual(result.failed.map((item) => item.source_id), ["broken"]);
    assert.deepEqual(JSON.parse(fs.readFileSync(rawPath, "utf8").trim()), validCommit("183"));
    assert.equal(fs.existsSync(path.join(root, ".thirdspace", "events", "remote", "disabled", "raw", "events.ndjson")), false);
    assert.equal(fs.existsSync(`${rawPath}.tmp-sync`), false);

    const state = JSON.parse(fs.readFileSync(path.join(root, ".thirdspace", "data", "daily-agent", "agent-state.json"), "utf8"));
    assert.deepEqual(state.last_remote_sync, {
      "183": { synced_at: "2026-08-22T09:00:00+08:00", status: "succeeded", error: null },
      broken: { synced_at: "2026-08-22T09:00:00+08:00", status: "failed", error: "unreachable" },
    });
    assert.equal(state.revision, 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("remote synchronization preserves the prior snapshot when fetched NDJSON is invalid", () => {
  const root = temporaryVault();
  try {
    initializeAgentState(root);
    const configPath = writeConfig(root, `version: "1.0"\nsources:\n  - source_id: "183"\n    ssh_host: "183"\n    remote_path: "/nas/users/events.ndjson"\n    enabled: true\n`);
    const rawPath = path.join(root, ".thirdspace", "events", "remote", "183", "raw", "events.ndjson");
    fs.mkdirSync(path.dirname(rawPath), { recursive: true });
    fs.writeFileSync(rawPath, '{"previous":true}\n', "utf8");

    const result = syncRemoteSources({ vaultRoot: root, now: "2026-08-22T09:00:00+08:00" }, {
      configPath,
      fetchSource: () => '{"valid":true}\nnot-json\n',
    });

    assert.deepEqual(result.succeeded, []);
    assert.deepEqual(result.failed.map((item) => item.source_id), ["183"]);
    assert.equal(fs.readFileSync(rawPath, "utf8"), '{"previous":true}\n');
    assert.equal(fs.existsSync(`${rawPath}.tmp-sync`), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("remote synchronization restores the prior snapshot when its state update fails", () => {
  const root = temporaryVault();
  try {
    initializeAgentState(root);
    const configPath = writeConfig(root, `version: "1.0"\nsources:\n  - source_id: "183"\n    ssh_host: "183"\n    remote_path: "/nas/users/events.ndjson"\n    enabled: true\n`);
    const rawPath = path.join(root, ".thirdspace", "events", "remote", "183", "raw", "events.ndjson");
    fs.mkdirSync(path.dirname(rawPath), { recursive: true });
    fs.writeFileSync(rawPath, '{"previous":true}\n', "utf8");

    const result = syncRemoteSources({ vaultRoot: root, now: "2026-08-22T09:00:00+08:00" }, {
      configPath,
      fetchSource: () => `${JSON.stringify(validCommit("183"))}\n`,
      updateSourceState(_context, _sourceId, status) {
        if (status === "succeeded") throw new Error("state unavailable");
      },
    });

    assert.deepEqual(result.succeeded, []);
    assert.deepEqual(result.failed.map((item) => item.source_id), ["183"]);
    assert.equal(fs.readFileSync(rawPath, "utf8"), '{"previous":true}\n');
    assert.equal(fs.existsSync(`${rawPath}.tmp-sync`), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("remote-sync CLI accepts an absolute config path and defaults missing config to the documented example", () => {
  const root = temporaryVault();
  try {
    initializeAgentState(root);
    fs.mkdirSync(path.join(root, ".thirdspace"), { recursive: true });
    fs.writeFileSync(path.join(root, ".thirdspace", "workspace-index.yaml"), 'vault_root: "."\n', "utf8");
    const configPath = writeConfig(root, `version: "1.0"\nsources: []\n`);
    assert.deepEqual(runCli(root, "remote-sync", "--vault", root, "--config", configPath), { succeeded: [], failed: [] });
    fs.unlinkSync(configPath);
    assert.throws(
      () => runCli(root, "remote-sync", "--vault", root),
      /remote-event-sources\.example\.yaml/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("event normalization canonicalizes mapped remote events and rejects invalid records", () => {
  const root = temporaryVault();
  try {
    writeProjectIndex(root);
    const commit = {
      schema_version: "1.0",
      event_id: "commit-1",
      timestamp: "2026-08-22T09:00:00+08:00",
      event_type: "git_commit",
      source_id: "183",
      subject_id: "research-code",
      repo: "research-code",
      branch: "main",
      summary: "Add preprocessing",
      metrics: { commits: 1, files_changed: 2, lines_added: 10, lines_deleted: 1 },
      evidence: { commit: "abc123" },
    };
    const tokenUsage = {
      schema_version: "1.0",
      event_id: "session-1",
      timestamp: "2026-08-22T10:00:00+08:00",
      event_type: "token_usage",
      source_id: "183",
      subject_id: "session-1",
      repo: "research-code",
      model: "gpt-5",
      session_id: "session-1",
      metrics: {
        input_tokens: 100,
        output_tokens: 20,
        cache_read_tokens: null,
        cache_write_tokens: null,
        total_tokens: 120,
      },
    };
    const mismatchedSource = { ...commit, event_id: "wrong-source", source_id: "other" };
    const unknownType = { ...commit, event_id: "unknown-type", event_type: "agent_session" };
    const invalidTimestamp = { ...commit, event_id: "bad-time", timestamp: "not-a-timestamp" };
    const rawPath = writeRawEvents(root, "183", [
      JSON.stringify(commit),
      JSON.stringify(tokenUsage),
      JSON.stringify({ ...commit }),
      "not-json",
      JSON.stringify(mismatchedSource),
      JSON.stringify(unknownType),
      JSON.stringify(invalidTimestamp),
    ]);

    const result = normalizeEvents({ vaultRoot: root, now: "2026-08-22T09:00:00+08:00" });

    assert.equal(result.accepted, 2);
    assert.equal(result.duplicates, 1);
    assert.equal(result.rejected, 4);
    assert.deepEqual(result.outputFiles, [path.join(root, ".thirdspace", "events", "normalized", "202608.ndjson")]);
    assert.equal(result.errorReport, path.join(root, ".thirdspace", "events", "reports", "normalization-errors.json"));
    const normalized = fs.readFileSync(result.outputFiles[0], "utf8").trim().split("\n").map(JSON.parse);
    const normalizedCommit = normalized.find((event) => event.event_id === "commit-1");
    const normalizedToken = normalized.find((event) => event.event_id === "session-1");
    assert.equal(normalizedCommit.project_id, "project_research");
    assert.deepEqual(normalizedToken.metrics, {
      input_tokens: 100,
      output_tokens: 20,
      cache_read_tokens: null,
      cache_write_tokens: null,
      total_tokens: 120,
    });
    const errors = JSON.parse(fs.readFileSync(result.errorReport, "utf8"));
    assert.deepEqual(errors.errors.map((error) => error.reason), [
      "invalid JSON",
      "source_id does not match raw source",
      "unsupported event_type",
      "invalid timestamp",
    ]);
    assert.equal(JSON.stringify(errors).includes("not-json"), false);
    assert.equal(fs.readFileSync(rawPath, "utf8").includes("not-json"), true);

    const rebuilt = normalizeEvents({ vaultRoot: root, now: "2026-08-22T09:00:00+08:00" });
    assert.equal(rebuilt.accepted, 2);
    assert.equal(fs.readFileSync(rebuilt.outputFiles[0], "utf8").trim().split("\n").length, 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("events-normalize CLI returns the normalizer result", () => {
  const root = temporaryVault();
  try {
    writeProjectIndex(root);
    fs.writeFileSync(path.join(root, ".thirdspace", "workspace-index.yaml"), 'vault_root: "."\n', "utf8");
    writeRawEvents(root, "183", [JSON.stringify({
      schema_version: "1.0",
      event_id: "commit-cli",
      timestamp: "2026-08-22T09:00:00+08:00",
      event_type: "git_commit",
      source_id: "183",
      subject_id: "research-code",
      repo: "research-code",
      evidence: { commit: "abc123" },
    })]);

    const result = runCli(root, "events-normalize", "--vault", root);

    assert.equal(result.accepted, 1);
    assert.equal(result.duplicates, 0);
    assert.equal(result.rejected, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
