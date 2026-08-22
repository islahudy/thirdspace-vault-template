import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";

import { aggregateReport, resolvePeriod } from "../scripts/lib/aggregator.mjs";
import { loadRemoteSources } from "../scripts/lib/remote-config.mjs";
import { syncRemoteSources } from "../scripts/lib/remote-sync.mjs";
import { normalizeEvents } from "../scripts/lib/normalizer.mjs";
import { renderReview, writeReview } from "../scripts/lib/reviews.mjs";

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

function remoteCommit(sourceId, eventId, timestamp = "2026-08-22T09:00:00+08:00") {
  return {
    schema_version: "1.0",
    event_id: eventId,
    timestamp,
    event_type: "git_commit",
    source_id: sourceId,
    subject_id: "research-code",
    repo: "research-code",
    evidence: { commit: `${eventId}-commit` },
  };
}

function remoteTokenUsage(sourceId, eventId, metrics = {}) {
  return {
    schema_version: "1.0",
    event_id: eventId,
    timestamp: "2026-08-22T09:00:00+08:00",
    event_type: "token_usage",
    source_id: sourceId,
    subject_id: eventId,
    repo: "research-code",
    model: "gpt-5",
    session_id: eventId,
    metrics: {
      input_tokens: 100,
      output_tokens: 20,
      cache_read_tokens: null,
      cache_write_tokens: null,
      total_tokens: 120,
      ...metrics,
    },
  };
}

function runCli(root, ...args) {
  const cli = path.resolve(path.dirname(decodeURIComponent(new URL(import.meta.url).pathname)), "../scripts/daily-agent.mjs");
  return JSON.parse(execFileSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    env: { ...process.env, THIRDSPACE_NOW: "2026-08-22T09:00:00+08:00" },
    cwd: root,
  }));
}

function writeNormalizedEvents(root, month, events) {
  const file = path.join(root, ".thirdspace", "events", "normalized", `${month}.ndjson`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`, "utf8");
}

function normalizedCommit(eventId, timestamp, input = {}) {
  return {
    schema_version: "1.0", event_id: eventId, timestamp, event_type: "git_commit",
    source_id: input.source_id || "183", subject_id: input.repo || "research-code",
    repo: input.repo || "research-code", branch: input.branch || "main",
    summary: input.summary || eventId,
    metrics: {
      commits: 1, files_changed: 2, lines_added: 10, lines_deleted: 1,
      ...input.metrics,
    },
    evidence: { commit: input.commit || `${eventId}-sha`, raw_line: "must-not-leak" },
    project_id: input.project_id === undefined ? "project_research" : input.project_id,
    raw_line: "must-not-leak",
  };
}

function normalizedToken(eventId, timestamp, input = {}) {
  return {
    schema_version: "1.0", event_id: eventId, timestamp, event_type: "token_usage",
    source_id: input.source_id || "183", subject_id: input.session_id || eventId,
    repo: input.repo || "research-code", model: input.model || "model-a",
    session_id: input.session_id || eventId,
    metrics: {
      input_tokens: 0, output_tokens: 0, cache_read_tokens: 0,
      cache_write_tokens: 0, total_tokens: 0, ...input.metrics,
    },
    project_id: input.project_id === undefined ? "project_research" : input.project_id,
    raw_line: "must-not-leak",
  };
}

function reportInput(overrides = {}) {
  return {
    version: "1.0",
    generated_at: "2026-08-24T08:00:00+08:00",
    period: {
      id: "2026-W34", kind: "weekly", timezone: "Asia/Shanghai",
      start: "2026-08-17T00:00:00+08:00", end: "2026-08-24T00:00:00+08:00",
    },
    git: {
      total: { commits: 1, files_changed: 2, lines_added: 10, lines_deleted: 1 },
      by_project: {
        project_research: {
          commits: 1, files_changed: 2, lines_added: 10, lines_deleted: 1,
          by_repo: {
            "research-code": {
              commits: 1, files_changed: 2, lines_added: 10, lines_deleted: 1,
              evidence: [{ commit: "abc123", timestamp: "2026-08-20T09:00:00+08:00", branch: "main", summary: "Add evidence" }],
            },
          },
        },
      },
    },
    tokens: {
      total_sessions: 1,
      by_model: {
        "gpt-5": {
          sessions: 1, input_tokens: 100, output_tokens: 20, cache_read_tokens: null,
          cache_write_tokens: null, total_tokens: 120,
        },
      },
    },
    tasks: {
      completed: [{ id: "task-complete", title: "Finished", status: "completed", priority: "high", project_id: "project_research", due: null, completed_at: "2026-08-20T12:00:00+08:00" }],
      carryover: [{ id: "task-active", title: "Continue", status: "active", priority: "normal", project_id: null, due: "2026-08-30", completed_at: null }],
    },
    reading: {
      processed: [{ id: "reading-done", kind: "paper", title: "Read", source_path: "01-收件箱/read.md", status: "processed", added_at: "2026-08-10T09:00:00+08:00", processed_at: "2026-08-18T09:00:00+08:00", output_path: "03-知识/read.md" }],
      backlog: [{ id: "reading-pending", kind: "blog", title: "Pending", source_path: "01-收件箱/pending.md", status: "pending", added_at: "2026-08-19T09:00:00+08:00", processed_at: null, output_path: null }],
    },
    projects: {
      active: [{ id: "project_research", name: "Research", path: "04-项目/Research", stage: "active" }],
      without_activity: [],
    },
    coverage: { sources: ["183"], rejected_events: 1, unmapped_repos: [], missing_token_fields: 2 },
    ...overrides,
  };
}

test("weekly reviews render evidence, coverage warnings, and preserve user text outside managed markers", () => {
  const root = temporaryVault();
  try {
    const context = { vaultRoot: root, now: "2026-08-24T08:00:00+08:00" };
    const first = writeReview(context, reportInput());
    const initial = fs.readFileSync(first.path, "utf8");

    assert.equal(first.path, path.join(root, "02-日记", "复盘", "20260823_周报_2026-W34.md"));
    assert.equal(first.updated, true);
    assert.match(initial, /^---\ntitle: "周报：2026-W34"\ntype: "review"\ntopic: "work"\nworkspace: "02-日记"\ncreated: "2026-08-24T08:00:00\+08:00"\nmodified: "2026-08-24T08:00:00\+08:00"\ntags: \["work", "review", "active"\]\nsource: "agent"\nstatus: "active"\n---/);
    for (const heading of ["总览", "事项与阅读", "项目与 Git", "Token 用量", "数据覆盖", "Agent 评价"]) {
      assert.match(initial, new RegExp(`## ${heading}`));
    }
    assert.match(initial, /`task-complete`/);
    assert.match(initial, /\[Read\]\(\.\.\/\.\.\/01-收件箱\/read\.md\)/);
    assert.match(initial, /`abc123`/);
    assert.match(initial, /Token 字段缺失 2 项，相关统计不完整。/);
    assert.match(initial, /归一化拒绝 1 条事件，结论需结合该缺口阅读。/);
    assert.match(renderReview(reportInput()), /<!-- daily-agent:report:start -->/);

    fs.appendFileSync(first.path, "\n## 我的补充\n\n保留这段。\n", "utf8");
    const changed = reportInput({
      generated_at: "2026-08-25T08:00:00+08:00",
      coverage: { sources: ["183"], rejected_events: 1, unmapped_repos: [], missing_token_fields: 0 },
    });
    const second = writeReview({ ...context, now: "2026-08-25T08:00:00+08:00" }, changed);
    const regenerated = fs.readFileSync(first.path, "utf8");

    assert.deepEqual(second, { path: first.path, updated: true });
    assert.match(regenerated, /## 我的补充\n\n保留这段。/);
    assert.equal((regenerated.match(/<!-- daily-agent:report:start -->/g) || []).length, 1);
    assert.match(regenerated, /created: "2026-08-24T08:00:00\+08:00"/);
    assert.match(regenerated, /modified: "2026-08-24T08:00:00\+08:00"/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("reviews reject unsafe period IDs before resolving output paths", () => {
  const root = temporaryVault();
  try {
    const outside = path.join(root, "outside.md");
    const unsafe = reportInput({ period: {
      id: "../outside", kind: "weekly", timezone: "Asia/Shanghai",
      start: "2026-08-17T00:00:00+08:00", end: "2026-08-24T00:00:00+08:00",
    } });

    assert.throws(
      () => writeReview({ vaultRoot: root, now: "2026-08-24T08:00:00+08:00" }, unsafe),
      /invalid ReportInput period.id/,
    );
    assert.equal(fs.existsSync(outside), false);
    assert.equal(fs.existsSync(path.join(root, "02-日记", "复盘")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("reviews treat missing event sources as a coverage gap", () => {
  const report = reportInput({
    coverage: { sources: [], rejected_events: 0, unmapped_repos: [], missing_token_fields: 0 },
  });

  const markdown = renderReview(report);

  assert.match(markdown, /本周期没有纳入报告的事件来源。/);
  assert.match(markdown, /数据判断：存在覆盖缺口，以上结论仅基于已聚合证据。/);
});

test("review-generate accepts saved bounded input and records the matching review timestamp", () => {
  const root = temporaryVault();
  try {
    initializeAgentState(root);
    fs.writeFileSync(path.join(root, ".thirdspace", "workspace-index.yaml"), 'vault_root: "."\n', "utf8");
    const input = path.join(root, "review-input.json");
    writeJson(input, reportInput({ period: {
      id: "2026-08", kind: "monthly", timezone: "Asia/Shanghai",
      start: "2026-08-01T00:00:00+08:00", end: "2026-09-01T00:00:00+08:00",
    } }));

    const result = runCli(root, "review-generate", "--kind", "monthly", "--date", "2026-08-24", "--input", input, "--vault", root);
    const state = JSON.parse(fs.readFileSync(path.join(root, ".thirdspace", "data", "daily-agent", "agent-state.json"), "utf8"));

    assert.equal(result.path, path.join(root, "02-日记", "复盘", "20260831_月报_2026-08.md"));
    assert.equal(result.updated, true);
    assert.equal(state.last_monthly_review, "2026-08-22T09:00:00+08:00");
    assert.equal(state.last_weekly_review, null);
    assert.equal(state.revision, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("report periods use Shanghai Monday/Sunday and calendar-month boundaries", () => {
  assert.deepEqual(resolvePeriod("weekly", "2026-08-23", "Asia/Shanghai"), {
    id: "2026-W34",
    start: "2026-08-17T00:00:00+08:00",
    end: "2026-08-24T00:00:00+08:00",
  });
  assert.deepEqual(resolvePeriod("weekly", "2026-08-23T16:00:00.000Z", "Asia/Shanghai"), {
    id: "2026-W35",
    start: "2026-08-24T00:00:00+08:00",
    end: "2026-08-31T00:00:00+08:00",
  });
  assert.deepEqual(resolvePeriod("monthly", "2026-09-30", "Asia/Shanghai"), {
    id: "2026-09",
    start: "2026-09-01T00:00:00+08:00",
    end: "2026-10-01T00:00:00+08:00",
  });
});

test("report aggregation is deterministic, deduplicated, bounded, and preserves unknown Token coverage", () => {
  const root = temporaryVault();
  try {
    writeJson(path.join(root, ".thirdspace", "data", "daily-agent", "tasks.json"), {
      version: "1.0", revision: 0, updated_at: null,
      tasks: [
        { id: "task-complete", title: "Finished", status: "completed", priority: "high", project_id: "project_research", due: null, completed_at: "2026-08-20T12:00:00+08:00", private_note: "hide" },
        { id: "task-active", title: "Continue", status: "active", priority: "normal", project_id: null, due: "2026-08-30", completed_at: null, private_note: "hide" },
        { id: "task-old", title: "Old completion", status: "completed", priority: "normal", project_id: null, due: null, completed_at: "2026-08-16T23:59:59+08:00" },
      ],
    });
    writeJson(path.join(root, ".thirdspace", "data", "daily-agent", "reading-queue.json"), {
      version: "1.0", revision: 0, updated_at: null,
      items: [
        { id: "reading-done", kind: "paper", title: "Read", source_path: "01-收件箱/read.md", status: "processed", tags: ["paper"], added_at: "2026-08-10T09:00:00+08:00", processed_at: "2026-08-18T09:00:00+08:00", output_path: "03-知识/read.md", raw_content: "hide" },
        { id: "reading-pending", kind: "blog", title: "Pending", source_path: "01-收件箱/pending.md", status: "pending", tags: ["blog"], added_at: "2026-08-19T09:00:00+08:00", processed_at: null, output_path: null, raw_content: "hide" },
      ], candidates: [], dismissed_source_paths: [],
    });
    writeJson(path.join(root, ".thirdspace", "data", "daily-agent", "project-index.json"), {
      version: "1.0", revision: 0, updated_at: null,
      projects: [
        { id: "project_research", name: "Research", path: "04-项目/Research", status: "active", stage: "active", repo_mappings: ["research-code"] },
        { id: "project_quiet", name: "Quiet", path: "04-项目/Quiet", status: "active", stage: "planning", repo_mappings: ["quiet-code"] },
        { id: "project_archived", name: "Archived", path: "04-项目/Archived", status: "archived", stage: "archived", repo_mappings: ["archive-code"] },
      ],
    });
    const commits = [
      normalizedCommit("commit-2", "2026-08-18T11:00:00+08:00", { source_id: "184", repo: "other-code", project_id: null, branch: "dev", metrics: { files_changed: 1, lines_added: 3, lines_deleted: 0 } }),
      normalizedCommit("commit-1", "2026-08-17T00:00:00+08:00"),
      normalizedCommit("commit-3", "2026-08-23T23:59:59+08:00", { metrics: { files_changed: 4, lines_added: 7, lines_deleted: 2 } }),
      normalizedCommit("end-exclusive", "2026-08-24T00:00:00+08:00"),
    ];
    const tokenEvents = [
      normalizedToken("session-a1", "2026-08-19T09:00:00+08:00", { metrics: { input_tokens: 700, output_tokens: 100, cache_read_tokens: 500, cache_write_tokens: 0, total_tokens: 1300 } }),
      normalizedToken("session-a2", "2026-08-20T09:00:00+08:00", { source_id: "184", metrics: { input_tokens: 500, output_tokens: 200, cache_read_tokens: 0, cache_write_tokens: 0, total_tokens: 700 } }),
      normalizedToken("session-b1", "2026-08-21T09:00:00+08:00", { model: "model-b", repo: "other-code", project_id: null, metrics: { input_tokens: 40, output_tokens: 10, cache_read_tokens: null, cache_write_tokens: null, total_tokens: 50 } }),
    ];
    writeNormalizedEvents(root, "202608", [...commits, ...tokenEvents, commits[0]]);
    const irrelevant = path.join(root, ".thirdspace", "events", "normalized", "202501.ndjson");
    fs.writeFileSync(irrelevant, "not-json\n", "utf8");
    writeJson(path.join(root, ".thirdspace", "events", "reports", "normalization-errors.json"), {
      version: "1.0", generated_at: "2026-08-22T09:00:00+08:00",
      errors: [{ source_id: "broken", line: 2, reason: "invalid JSON", raw_line: "hide" }],
    });

    const context = { vaultRoot: root, now: "2026-08-24T08:00:00+08:00", timezone: "Asia/Shanghai" };
    const report = aggregateReport(context, { kind: "weekly", referenceDate: "2026-08-23" });
    const rebuilt = aggregateReport(context, { kind: "weekly", referenceDate: "2026-08-23" });

    assert.deepEqual(rebuilt, report);
    assert.deepEqual(Object.keys(report), ["version", "generated_at", "period", "git", "tokens", "tasks", "reading", "projects", "coverage"]);
    assert.equal(report.period.id, "2026-W34");
    assert.equal(report.git.total.commits, 3);
    assert.deepEqual(report.git.total, { commits: 3, files_changed: 7, lines_added: 20, lines_deleted: 3 });
    assert.deepEqual(report.git.by_project.unmapped.by_repo["other-code"].evidence, [{
      commit: "commit-2-sha", timestamp: "2026-08-18T11:00:00+08:00", branch: "dev", summary: "commit-2",
    }]);
    assert.deepEqual(report.tokens.by_model["model-a"], {
      sessions: 2, input_tokens: 1200, output_tokens: 300,
      cache_read_tokens: 500, cache_write_tokens: 0, total_tokens: 2000,
    });
    assert.deepEqual(report.tokens.by_model["model-b"], {
      sessions: 1, input_tokens: 40, output_tokens: 10,
      cache_read_tokens: null, cache_write_tokens: null, total_tokens: 50,
    });
    assert.deepEqual(report.tasks.completed.map((item) => item.id), ["task-complete"]);
    assert.deepEqual(report.tasks.carryover.map((item) => item.id), ["task-active"]);
    assert.deepEqual(report.reading.processed.map((item) => item.id), ["reading-done"]);
    assert.deepEqual(report.reading.backlog.map((item) => item.id), ["reading-pending"]);
    assert.deepEqual(report.projects.active.map((item) => item.id), ["project_quiet", "project_research"]);
    assert.deepEqual(report.projects.without_activity.map((item) => item.id), ["project_quiet"]);
    assert.deepEqual(report.coverage, {
      sources: ["183", "184"], rejected_events: 1,
      unmapped_repos: ["other-code"], missing_token_fields: 2,
    });
    assert.equal(JSON.stringify(report).includes("raw_line"), false);
    assert.equal(JSON.stringify(report).includes("private_note"), false);
    assert.equal(JSON.stringify(report).includes("raw_content"), false);
    const output = path.join(root, ".thirdspace", "data", "daily-agent", "report-input", "2026-W34.json");
    assert.deepEqual(JSON.parse(fs.readFileSync(output, "utf8")), report);
    assert.equal(fs.existsSync(`${output}.tmp-${process.pid}`), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("report aggregation preserves prototype-like grouping keys and uses locale-independent ordering", () => {
  const root = temporaryVault();
  try {
    writeJson(path.join(root, ".thirdspace", "data", "daily-agent", "tasks.json"), {
      version: "1.0", revision: 0, updated_at: null, tasks: [],
    });
    writeJson(path.join(root, ".thirdspace", "data", "daily-agent", "reading-queue.json"), {
      version: "1.0", revision: 0, updated_at: null, items: [], candidates: [], dismissed_source_paths: [],
    });
    writeJson(path.join(root, ".thirdspace", "data", "daily-agent", "project-index.json"), {
      version: "1.0", revision: 0, updated_at: null, projects: [],
    });
    writeNormalizedEvents(root, "202608", [
      normalizedCommit("proto-project", "2026-08-18T09:00:00+08:00", { project_id: "__proto__", repo: "z-repo" }),
      normalizedCommit("accent-project", "2026-08-18T10:00:00+08:00", { project_id: "ä-project", repo: "ä-repo" }),
      normalizedCommit("ascii-project", "2026-08-18T11:00:00+08:00", { project_id: "z-project", repo: "z-repo" }),
      normalizedToken("proto-model", "2026-08-18T12:00:00+08:00", { model: "__proto__" }),
      normalizedToken("accent-model", "2026-08-18T13:00:00+08:00", { model: "ä-model" }),
      normalizedToken("ascii-model", "2026-08-18T14:00:00+08:00", { model: "z-model" }),
    ]);

    const report = aggregateReport(
      { vaultRoot: root, now: "2026-08-24T08:00:00+08:00", timezone: "Asia/Shanghai" },
      { kind: "weekly", referenceDate: "2026-08-23" },
    );

    assert.deepEqual(Object.keys(report.git.by_project), ["__proto__", "z-project", "ä-project"]);
    assert.deepEqual(Object.keys(report.git.by_project.__proto__.by_repo), ["z-repo"]);
    assert.deepEqual(Object.keys(report.tokens.by_model), ["__proto__", "z-model", "ä-model"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("report-aggregate CLI exposes weekly, monthly, and custom bounded summaries", () => {
  const root = temporaryVault();
  try {
    fs.writeFileSync(path.join(root, ".thirdspace", "workspace-index.yaml"), 'vault_root: "."\n', "utf8");
    writeJson(path.join(root, ".thirdspace", "data", "daily-agent", "tasks.json"), {
      version: "1.0", revision: 0, updated_at: null, tasks: [],
    });
    writeJson(path.join(root, ".thirdspace", "data", "daily-agent", "reading-queue.json"), {
      version: "1.0", revision: 0, updated_at: null, items: [], candidates: [], dismissed_source_paths: [],
    });
    writeJson(path.join(root, ".thirdspace", "data", "daily-agent", "project-index.json"), {
      version: "1.0", revision: 0, updated_at: null, projects: [],
    });
    writeNormalizedEvents(root, "202608", [normalizedCommit("cli-commit", "2026-08-22T09:00:00+08:00")]);

    const weekly = runCli(root, "report-aggregate", "--kind", "weekly", "--date", "2026-08-23", "--vault", root);
    assert.equal(weekly.path, path.join(root, ".thirdspace", "data", "daily-agent", "report-input", "2026-W34.json"));
    assert.deepEqual(weekly.summary, { commits: 1, token_sessions: 0, completed_tasks: 0, processed_readings: 0 });
    assert.equal(JSON.stringify(weekly).includes("cli-commit"), false);

    const monthly = runCli(root, "report-aggregate", "--kind", "monthly", "--date", "2026-08-01", "--vault", root);
    assert.match(monthly.path, /2026-08\.json$/);

    const custom = runCli(root, "report-aggregate", "--start", "2026-08-01", "--end", "2026-08-15", "--vault", root);
    assert.match(custom.path, /20260801-20260815\.json$/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

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

test("event normalization rejects calendar-invalid timestamps with source and line evidence", () => {
  const root = temporaryVault();
  try {
    writeRawEvents(root, "183", [JSON.stringify(remoteCommit("183", "impossible-date", "2026-02-30T09:00:00+08:00"))]);

    const result = normalizeEvents({ vaultRoot: root, now: "2026-08-22T09:00:00+08:00" });

    assert.equal(result.accepted, 0);
    assert.equal(result.rejected, 1);
    assert.deepEqual(JSON.parse(fs.readFileSync(result.errorReport, "utf8")).errors, [
      { source_id: "183", line: 1, reason: "invalid timestamp" },
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("event normalization orders canonical records by timestamp, source, and event ID", () => {
  const root = temporaryVault();
  try {
    writeRawEvents(root, "183", [
      JSON.stringify(remoteCommit("183", "z-at-nine")),
      JSON.stringify(remoteCommit("183", "a-at-nine")),
      JSON.stringify(remoteCommit("183", "later", "2026-08-22T10:00:00+08:00")),
    ]);
    writeRawEvents(root, "184", [JSON.stringify(remoteCommit("184", "b-at-nine"))]);

    const result = normalizeEvents({ vaultRoot: root, now: "2026-08-22T09:00:00+08:00" });
    const records = fs.readFileSync(result.outputFiles[0], "utf8").trim().split("\n").map(JSON.parse);

    assert.deepEqual(records.map((event) => `${event.source_id}:${event.event_id}`), [
      "183:a-at-nine",
      "183:z-at-nine",
      "184:b-at-nine",
      "183:later",
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("event normalization keeps identical event IDs from separate sources", () => {
  const root = temporaryVault();
  try {
    writeRawEvents(root, "183", [JSON.stringify(remoteCommit("183", "shared-id"))]);
    writeRawEvents(root, "184", [JSON.stringify(remoteCommit("184", "shared-id"))]);

    const result = normalizeEvents({ vaultRoot: root, now: "2026-08-22T09:00:00+08:00" });

    assert.equal(result.accepted, 2);
    assert.equal(result.duplicates, 0);
    assert.deepEqual(fs.readFileSync(result.outputFiles[0], "utf8").trim().split("\n").map(JSON.parse)
      .map((event) => `${event.source_id}:${event.event_id}`), ["183:shared-id", "184:shared-id"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("event normalization rejects non-numeric Token counters", () => {
  const root = temporaryVault();
  try {
    writeRawEvents(root, "183", [JSON.stringify(remoteTokenUsage("183", "bad-counter", { output_tokens: "20" }))]);

    const result = normalizeEvents({ vaultRoot: root, now: "2026-08-22T09:00:00+08:00" });

    assert.equal(result.accepted, 0);
    assert.equal(result.rejected, 1);
    assert.deepEqual(JSON.parse(fs.readFileSync(result.errorReport, "utf8")).errors, [
      { source_id: "183", line: 1, reason: "invalid token metric: output_tokens" },
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("event normalization removes stale generated monthly files", () => {
  const root = temporaryVault();
  try {
    const normalizedRoot = path.join(root, ".thirdspace", "events", "normalized");
    fs.mkdirSync(normalizedRoot, { recursive: true });
    fs.writeFileSync(path.join(normalizedRoot, "202607.ndjson"), '{"stale":true}\n', "utf8");
    fs.writeFileSync(path.join(normalizedRoot, "notes.txt"), "keep\n", "utf8");
    writeRawEvents(root, "183", [JSON.stringify(remoteCommit("183", "current"))]);

    const result = normalizeEvents({ vaultRoot: root, now: "2026-08-22T09:00:00+08:00" });

    assert.equal(fs.existsSync(path.join(normalizedRoot, "202607.ndjson")), false);
    assert.equal(fs.existsSync(path.join(normalizedRoot, "202608.ndjson")), true);
    assert.equal(fs.readFileSync(path.join(normalizedRoot, "notes.txt"), "utf8"), "keep\n");
    assert.deepEqual(result.outputFiles, [path.join(normalizedRoot, "202608.ndjson")]);
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
