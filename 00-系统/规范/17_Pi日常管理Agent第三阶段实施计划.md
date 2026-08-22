---
title: "Pi 日常管理 Agent 第三阶段实施计划"
type: "roadmap"
topic: "system"
workspace: "00-系统"
created: "2026-08-22 15:30:00"
modified: "2026-08-22 15:30:00"
tags: ["system", "roadmap", "pi-agent", "events", "review"]
source: "manual"
status: "active"
---

# Pi Daily Agent Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build multi-source SSH event synchronization, deterministic Git/Token aggregation, and evidence-based weekly/monthly review generation without exposing raw events to Pi Agent context.

**Architecture:** Remote servers append only `git_commit` and session-level `token_usage` records to NDJSON. Focused Node.js modules synchronize, normalize, deduplicate, and aggregate those records into bounded report inputs; Pi Agent reads only the aggregate and writes managed sections in review Markdown.

**Tech Stack:** Node.js ESM and built-in test runner, OpenSSH CLI, POSIX shell hooks, YAML configuration, JSON/NDJSON, Markdown.

**Spec:** `00-系统/规范/16_Pi日常管理Agent第三阶段事件与报告设计.md`

## Global Constraints

- Support multiple remote sources from the first release; initial example is SSH Host `183` and `/nas/users/xxxiang/person/events.ndjson`.
- Remote access is read-only and actual source configuration is machine-local and Git-ignored.
- Accept only `git_commit` and `token_usage`; do not collect conversations, commands, diffs, or file contents.
- Raw events are immutable; normalized data and report inputs are rebuildable.
- Pi Agent reads only the bounded `report-input/<period>.json`, never raw or normalized event streams by default.
- Use `Asia/Shanghai`; weeks are Monday through Sunday and months are calendar months.
- Remote installation must not require a Vault and must be initiated manually by the user.
- No new runtime dependency is required.

## File Structure

- `.thirdspace/schema/remote-event-sources.example.yaml` — versioned, secret-free multi-source configuration example.
- `.thirdspace/schema/daily-agent.yaml` — declares reporting paths, event types, timezone, and permission boundaries.
- `.gitignore` — excludes actual remote-source configuration and generated report inputs.
- `00-系统/Skills/daily-agent/scripts/lib/remote-config.mjs` — strict parser for the intentionally small YAML config subset.
- `00-系统/Skills/daily-agent/scripts/lib/remote-sync.mjs` — injectable SSH reader and atomic raw snapshot writer.
- `00-系统/Skills/daily-agent/scripts/lib/normalizer.mjs` — line validation, deduplication, project mapping, normalized rebuild, and error report.
- `00-系统/Skills/daily-agent/scripts/lib/aggregator.mjs` — period calculation and deterministic Git/Token/task/reading aggregation.
- `00-系统/Skills/daily-agent/scripts/lib/reviews.mjs` — weekly/monthly managed Markdown rendering.
- `00-系统/Skills/daily-agent/scripts/daily-agent.mjs` — exposes `remote-sync`, `events-normalize`, `report-aggregate`, and `review-generate` commands.
- `00-系统/Skills/daily-agent/tests/event-reporting.test.mjs` — isolated Phase 3 module and CLI tests.
- `00-系统/Skills/daily-agent/templates/weekly-review.md` — weekly human-readable report shell.
- `00-系统/Skills/daily-agent/templates/monthly-review.md` — monthly human-readable report shell.
- `00-系统/Skills/daily-agent/references/remote-event-protocol.md` — local consumer contract and safe operating procedure.
- `00-系统/Skills/daily-agent/references/reporting.md` — report trigger, evidence, and regeneration rules.
- `00-系统/运行时/remote-events/README.md` — standalone server installation and troubleshooting guide.
- `00-系统/运行时/remote-events/git-post-commit.sh` — portable Git event producer.
- `00-系统/运行时/remote-events/agent-exit-token.sh` — portable session-level Token event producer.
- `00-系统/运行时/remote-events/events.example.ndjson` — valid producer examples.
- `00-系统/Skills/thirdspace-vault/scripts/thirdspace-vault.mjs` — initializes the new example schema and audits Phase 3 contracts.
- `00-系统/Skills/thirdspace-vault/tests/thirdspace-vault.test.mjs` — template and semantic regression tests.

---

### Task 1: Remote Source Configuration Contract

**Files:**
- Create: `.thirdspace/schema/remote-event-sources.example.yaml`
- Modify: `.thirdspace/schema/daily-agent.yaml`
- Modify: `.gitignore`
- Modify: `00-系统/Skills/thirdspace-vault/scripts/thirdspace-vault.mjs`
- Modify: `00-系统/Skills/thirdspace-vault/tests/thirdspace-vault.test.mjs`

**Interfaces:**
- Consumes: the existing Vault initialization and semantic audit commands.
- Produces: a versioned `sources[]` contract and initialized example file used by `loadRemoteSources(configPath)` in Task 2.

- [ ] **Step 1: Write failing initialization and audit tests**

Add assertions that a fresh `init` includes the example schema, actual local config is ignored, and the source contract contains `source_id`, `ssh_host`, `remote_path`, and `enabled`:

```js
assert.equal(fs.existsSync(path.join(target, ".thirdspace/schema/remote-event-sources.example.yaml")), true);
const ignored = execFileSync("git", ["check-ignore", ".thirdspace/config/remote-event-sources.local.yaml"], {
  cwd: vaultRoot, encoding: "utf8",
}).trim();
assert.equal(ignored, ".thirdspace/config/remote-event-sources.local.yaml");
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test 00-系统/Skills/thirdspace-vault/tests/thirdspace-vault.test.mjs`

Expected: FAIL because the example schema is absent and init does not distribute it.

- [ ] **Step 3: Add the exact machine contract**

Create the example with this public source and document reporting configuration in `daily-agent.yaml`:

```yaml
version: "1.0"
timezone: "Asia/Shanghai"
sources:
  - source_id: "183"
    ssh_host: "183"
    remote_path: "/nas/users/xxxiang/person/events.ndjson"
    enabled: true
```

Add these Daily Agent fields:

```yaml
events:
  remote_types: [git_commit, token_usage]
  normalized_root: ".thirdspace/events/normalized"
reporting:
  timezone: "Asia/Shanghai"
  input_root: ".thirdspace/data/daily-agent/report-input"
  output_root: "02-日记/复盘"
```

Ignore only `.thirdspace/config/remote-event-sources.local.yaml` and `.thirdspace/data/daily-agent/report-input/`. Update init and semantic audit canonical lists rather than creating an unused schema file.

- [ ] **Step 4: Run tests and audits**

Run:

```bash
node --test 00-系统/Skills/thirdspace-vault/tests/thirdspace-vault.test.mjs
node 00-系统/Skills/thirdspace-vault/scripts/thirdspace-vault.mjs audit-subsystems --vault .
```

Expected: all tests pass; audit has `error: 0` and `warning: 0`.

- [ ] **Step 5: Commit**

```bash
git add .thirdspace/schema/remote-event-sources.example.yaml .thirdspace/schema/daily-agent.yaml .gitignore 00-系统/Skills/thirdspace-vault
git commit -m "feat: define remote event source contract"
```

### Task 2: Multi-Source Read-Only Synchronization

**Files:**
- Create: `00-系统/Skills/daily-agent/scripts/lib/remote-config.mjs`
- Create: `00-系统/Skills/daily-agent/scripts/lib/remote-sync.mjs`
- Create: `00-系统/Skills/daily-agent/tests/event-reporting.test.mjs`
- Modify: `00-系统/Skills/daily-agent/scripts/daily-agent.mjs`

**Interfaces:**
- Consumes: `loadRemoteSources(configPath) -> { version: "1.0", sources: RemoteSource[] }`, where `RemoteSource` has string `source_id`, `ssh_host`, `remote_path`, and boolean `enabled`.
- Produces: `syncRemoteSources(context, { configPath, fetchSource? }) -> { succeeded, failed }`; `fetchSource(source) -> string` is injectable in tests and defaults to OpenSSH.

- [ ] **Step 1: Write failing parser and synchronization tests**

Cover multiple enabled sources, a disabled source, one failed source, exact-path validation, atomic replacement, and `agent-state.last_remote_sync` updates:

```js
const result = syncRemoteSources(context, {
  configPath,
  fetchSource(source) {
    if (source.source_id === "broken") throw new Error("unreachable");
    return `${JSON.stringify(validCommit(source.source_id))}\n`;
  },
});
assert.deepEqual(result.succeeded.map((item) => item.source_id), ["183"]);
assert.deepEqual(result.failed.map((item) => item.source_id), ["broken"]);
assert.equal(fs.existsSync(path.join(root, ".thirdspace/events/remote/183/raw/events.ndjson")), true);
```

Also assert rejection of SSH aliases outside `^[A-Za-z0-9._-]+$` and remote paths outside `^/[A-Za-z0-9._/-]+$`.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test 00-系统/Skills/daily-agent/tests/event-reporting.test.mjs`

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement strict config parsing and synchronization**

Implement only the YAML subset used by the template; reject unknown top-level keys and duplicate `source_id`. The default reader must use `execFileSync` without a shell:

```js
execFileSync("ssh", [source.ssh_host, "cat", "--", source.remote_path], {
  encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
});
```

Validate host and path before invocation. Write `<raw>.tmp-sync`, validate that every non-empty line parses as JSON, then rename it to the raw path. On failure remove only the temporary file and retain the prior raw snapshot. Update each source independently in `agent-state.json` through the existing revisioned store.

Expose:

```text
daily-agent.mjs remote-sync --config <absolute-or-vault-relative-path>
```

Default `--config` to `.thirdspace/config/remote-event-sources.local.yaml`; missing config returns an actionable error naming the example schema.

- [ ] **Step 4: Run focused and existing tests**

Run:

```bash
node --test 00-系统/Skills/daily-agent/tests/event-reporting.test.mjs
node --test 00-系统/Skills/daily-agent/tests/daily-agent.test.mjs
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add 00-系统/Skills/daily-agent/scripts 00-系统/Skills/daily-agent/tests/event-reporting.test.mjs
git commit -m "feat: synchronize remote event sources"
```

### Task 3: Event Normalization and Deduplication

**Files:**
- Create: `00-系统/Skills/daily-agent/scripts/lib/normalizer.mjs`
- Modify: `00-系统/Skills/daily-agent/scripts/daily-agent.mjs`
- Modify: `00-系统/Skills/daily-agent/tests/event-reporting.test.mjs`

**Interfaces:**
- Consumes: raw files under `.thirdspace/events/remote/<source-id>/raw/events.ndjson` and `project-index.json.projects[].repo_mappings`.
- Produces: `normalizeEvents(context) -> { accepted, duplicates, rejected, outputFiles, errorReport }` and canonical event objects in `.thirdspace/events/normalized/YYYYMM.ndjson`.

- [ ] **Step 1: Write failing canonicalization tests**

Provide fixtures containing a valid commit, valid Token usage with null counters, duplicate event ID, malformed JSON, mismatched source ID, unknown event type, invalid timestamp, and a repository mapped to a project. Assert:

```js
assert.equal(result.accepted, 2);
assert.equal(result.duplicates, 1);
assert.equal(result.rejected, 4);
assert.equal(normalizedCommit.project_id, "project_research");
assert.deepEqual(normalizedToken.metrics, {
  input_tokens: 100, output_tokens: 20,
  cache_read_tokens: null, cache_write_tokens: null, total_tokens: 120,
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test 00-系统/Skills/daily-agent/tests/event-reporting.test.mjs`

Expected: FAIL because `normalizeEvents` is not exported.

- [ ] **Step 3: Implement a rebuildable normalizer**

Validate common fields and event-specific shapes. Require Git evidence `commit`; require Token `model`, `session_id`, and numeric-or-null counters. Deduplicate on the composite key `${source_id}:${event_id}`. Sort canonical events by timestamp, source, then event ID before writing monthly files atomically.

Write rejected records to `.thirdspace/events/reports/normalization-errors.json` as:

```json
{
  "version": "1.0",
  "generated_at": "2026-08-22T09:00:00+08:00",
  "errors": [{ "source_id": "183", "line": 7, "reason": "invalid JSON" }]
}
```

Never include the rejected raw line in the error report. Rebuilding replaces only generated normalized monthly files and the generated error report, never raw files.

Expose `daily-agent.mjs events-normalize`.

- [ ] **Step 4: Run focused tests twice to prove idempotence**

Run:

```bash
node --test 00-系统/Skills/daily-agent/tests/event-reporting.test.mjs
node --test 00-系统/Skills/daily-agent/tests/event-reporting.test.mjs
```

Expected: both runs pass and normalized event counts remain stable.

- [ ] **Step 5: Commit**

```bash
git add 00-系统/Skills/daily-agent/scripts 00-系统/Skills/daily-agent/tests/event-reporting.test.mjs
git commit -m "feat: normalize remote activity events"
```

### Task 4: Deterministic Report Aggregation

**Files:**
- Create: `00-系统/Skills/daily-agent/scripts/lib/aggregator.mjs`
- Modify: `00-系统/Skills/daily-agent/scripts/daily-agent.mjs`
- Modify: `00-系统/Skills/daily-agent/tests/event-reporting.test.mjs`

**Interfaces:**
- Consumes: normalized events, `tasks.json`, `reading-queue.json`, `project-index.json`, report kind, reference date, and timezone.
- Produces: `resolvePeriod(kind, referenceDate, timezone) -> { id, start, end }` and `aggregateReport(context, { kind, referenceDate, start?, end? }) -> ReportInput`.

- [ ] **Step 1: Write failing boundary and aggregate tests**

Freeze time and assert Monday/Sunday and calendar-month boundaries in `Asia/Shanghai`. Include commits from two repos, Token sessions from two models, a duplicated normalized event, completed and active tasks, processed and pending readings, and an inactive mapped project. Assert the output contains no raw event object:

```js
assert.equal(report.period.id, "2026-W34");
assert.equal(report.git.total.commits, 3);
assert.deepEqual(report.tokens.by_model["model-a"], {
  sessions: 2, input_tokens: 1200, output_tokens: 300,
  cache_read_tokens: 500, cache_write_tokens: 0, total_tokens: 2000,
});
assert.equal(JSON.stringify(report).includes("raw_line"), false);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test 00-系统/Skills/daily-agent/tests/event-reporting.test.mjs`

Expected: FAIL because the aggregator does not exist.

- [ ] **Step 3: Implement period resolution and bounded aggregation**

Use `Intl.DateTimeFormat` for timezone-safe calendar parts. Treat `[start, end)` as the internal interval to prevent boundary duplication. Group Git by `project_id || "unmapped"`, then repo; retain only commit SHA, timestamp, branch, and summary in the evidence list. Group Token by model, treating null as unknown rather than zero; expose a `coverage.missing_token_fields` count.

Include these top-level keys and no others:

```js
{
  version: "1.0", generated_at, period,
  git: { total, by_project },
  tokens: { total_sessions, by_model },
  tasks: { completed, carryover },
  reading: { processed, backlog },
  projects: { active, without_activity },
  coverage: { sources, rejected_events, unmapped_repos, missing_token_fields },
}
```

Write atomically to `.thirdspace/data/daily-agent/report-input/<period.id>.json`. Expose:

```text
daily-agent.mjs report-aggregate --kind weekly --date 2026-08-24
daily-agent.mjs report-aggregate --kind monthly --date 2026-09-01
daily-agent.mjs report-aggregate --start 2026-08-01 --end 2026-08-15
```

- [ ] **Step 4: Run focused tests and inspect one fixture output**

Run:

```bash
node --test 00-系统/Skills/daily-agent/tests/event-reporting.test.mjs
node 00-系统/Skills/daily-agent/scripts/daily-agent.mjs report-aggregate --kind weekly --date 2026-08-24 --vault .
```

Expected: tests pass; command returns the report-input path and summary counts without printing raw events.

- [ ] **Step 5: Commit**

```bash
git add 00-系统/Skills/daily-agent/scripts 00-系统/Skills/daily-agent/tests/event-reporting.test.mjs
git commit -m "feat: aggregate weekly and monthly evidence"
```

### Task 5: Review Rendering with Managed Sections

**Files:**
- Create: `00-系统/Skills/daily-agent/scripts/lib/reviews.mjs`
- Create: `00-系统/Skills/daily-agent/templates/weekly-review.md`
- Create: `00-系统/Skills/daily-agent/templates/monthly-review.md`
- Modify: `00-系统/Skills/daily-agent/scripts/daily-agent.mjs`
- Modify: `00-系统/Skills/daily-agent/tests/event-reporting.test.mjs`

**Interfaces:**
- Consumes: one validated `ReportInput` from Task 4 and optional user-authored text outside managed markers.
- Produces: `renderReview(report) -> string` and `writeReview(context, report) -> { path, updated }` under `02-日记/复盘/`.

- [ ] **Step 1: Write failing creation and regeneration tests**

Assert valid Frontmatter, required sections, evidence links/IDs, explicit missing-data language, and preservation of text outside markers:

```js
const first = writeReview(context, report);
fs.appendFileSync(first.path, "\n## 我的补充\n\n保留这段。\n");
writeReview(context, changedReport);
const markdown = fs.readFileSync(first.path, "utf8");
assert.match(markdown, /## 我的补充\n\n保留这段。/);
assert.equal((markdown.match(/<!-- daily-agent:report:start -->/g) || []).length, 1);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test 00-系统/Skills/daily-agent/tests/event-reporting.test.mjs`

Expected: FAIL because review rendering is absent.

- [ ] **Step 3: Implement deterministic report Markdown**

Use `YYYYMMDD_周报_<period>.md` and `YYYYMMDD_月报_<period>.md` with valid `02-日记` Frontmatter. Manage only content between:

```markdown
<!-- daily-agent:report:start -->
## 总览
## 事项与阅读
## 项目与 Git
## Token 用量
## 数据覆盖
## Agent 评价
<!-- daily-agent:report:end -->
```

The renderer produces a conservative rule-based evaluation: completion/carryover ratio, number of active projects with activity, stale reading count, and coverage warnings. It must not invoke an LLM. This deterministic draft is the evidence-safe input that Pi may later rewrite only inside `## Agent 评价` when the user asks.

Expose `daily-agent.mjs review-generate --kind weekly|monthly --date <date>`. The command aggregates first unless `--input` is supplied, then updates `agent-state.last_weekly_review` or `last_monthly_review`.

- [ ] **Step 4: Run report tests and Vault audit**

Run:

```bash
node --test 00-系统/Skills/daily-agent/tests/event-reporting.test.mjs
node 00-系统/Skills/thirdspace-vault/scripts/thirdspace-vault.mjs audit-subsystems --vault .
```

Expected: tests pass; report Frontmatter creates no audit warnings or errors.

- [ ] **Step 5: Commit**

```bash
git add 00-系统/Skills/daily-agent/scripts 00-系统/Skills/daily-agent/templates 00-系统/Skills/daily-agent/tests/event-reporting.test.mjs
git commit -m "feat: generate evidence-based reviews"
```

### Task 6: Standalone Remote Producer Kit

**Files:**
- Create: `00-系统/运行时/remote-events/README.md`
- Create: `00-系统/运行时/remote-events/git-post-commit.sh`
- Create: `00-系统/运行时/remote-events/agent-exit-token.sh`
- Create: `00-系统/运行时/remote-events/events.example.ndjson`
- Create: `00-系统/Skills/daily-agent/tests/remote-events-runtime.test.mjs`
- Modify: `00-系统/运行时/manifest.yaml`

**Interfaces:**
- Consumes: POSIX shell, Git, an explicit `THIRDSPACE_EVENT_FILE`, and Agent-provided Token environment variables or JSON arguments.
- Produces: append-only `git_commit` and `token_usage` records conforming to Task 3 validation.

- [ ] **Step 1: Write failing black-box producer tests**

Create a temporary Git repository, install/invoke the Git producer with an explicit event path, make a commit, and assert one valid line. Invoke the Token producer twice with the same session ID and assert stable event IDs so normalization deduplicates them:

```js
const lines = fs.readFileSync(eventFile, "utf8").trim().split("\n").map(JSON.parse);
assert.equal(lines[0].event_type, "git_commit");
assert.equal(lines[0].metrics.commits, 1);
assert.equal(tokenLines[0].event_id, tokenLines[1].event_id);
```

- [ ] **Step 2: Run the runtime test and verify RED**

Run: `node --test 00-系统/Skills/daily-agent/tests/remote-events-runtime.test.mjs`

Expected: FAIL because producer scripts do not exist.

- [ ] **Step 3: Implement safe append-only producers**

Both scripts require an explicit absolute `THIRDSPACE_EVENT_FILE`, create its parent with mode `0700`, create the file with mode `0600`, build JSON through an embedded Node process rather than string interpolation, and append one line with a single write. Git metrics come from `git show --numstat --format=`; commit message uses `git log -1 --format=%s` and never includes diff content.

The Token producer accepts:

```text
THIRDSPACE_SOURCE_ID
THIRDSPACE_AGENT
THIRDSPACE_SESSION_ID
THIRDSPACE_MODEL
THIRDSPACE_INPUT_TOKENS
THIRDSPACE_OUTPUT_TOKENS
THIRDSPACE_CACHE_READ_TOKENS
THIRDSPACE_CACHE_WRITE_TOKENS
THIRDSPACE_TOTAL_TOKENS
```

Missing counters serialize as `null`. The README provides installation examples for `/nas/users/xxxiang/person/events.ndjson`, generic Codex/Claude/Pi Exit hooks, permission checks, concurrent append limitations, event ID behavior, and troubleshooting. It explicitly says the kit does not install itself or require a Vault.

- [ ] **Step 4: Run black-box and normalizer tests**

Run:

```bash
node --test 00-系统/Skills/daily-agent/tests/remote-events-runtime.test.mjs
node --test 00-系统/Skills/daily-agent/tests/event-reporting.test.mjs
```

Expected: all producer output passes the consumer validator.

- [ ] **Step 5: Commit**

```bash
git add 00-系统/运行时/remote-events 00-系统/运行时/manifest.yaml 00-系统/Skills/daily-agent/tests/remote-events-runtime.test.mjs
git commit -m "feat: add standalone remote event hooks"
```

### Task 7: Skill Routing, Documentation, and Full Acceptance

**Files:**
- Modify: `00-系统/Skills/daily-agent/SKILL.md`
- Create: `00-系统/Skills/daily-agent/references/remote-event-protocol.md`
- Create: `00-系统/Skills/daily-agent/references/reporting.md`
- Modify: `00-系统/Skills/daily-agent/references/data-contracts.md`
- Modify: `.thirdspace/schema/workspace-tools.yaml`
- Modify: `00-系统/运行时/README.md`
- Modify: `00-系统/规范/13_Pi日常管理Agent设计.md`
- Modify: `00-系统/Skills/thirdspace-vault/tests/thirdspace-vault.test.mjs`

**Interfaces:**
- Consumes: all Phase 3 CLI commands and contracts.
- Produces: intent routing and operator instructions for “同步远端记录”, “生成周报”, and “生成月报”.

- [ ] **Step 1: Write failing distribution and routing tests**

Assert all runtime producer assets, new Daily Agent modules/templates/references, local-config ignore rule, and workspace-tool domain routing exist. Assert the CLI bundle exposes all four commands.

- [ ] **Step 2: Run regression tests and verify RED**

Run: `node --test 00-系统/Skills/thirdspace-vault/tests/thirdspace-vault.test.mjs`

Expected: FAIL until routing and documentation references are synchronized.

- [ ] **Step 3: Document the operational flow and permission boundary**

Update the Skill so the Agent performs:

```text
remote-sync -> events-normalize -> report-aggregate -> review-generate
```

It must print only counts, paths, and bounded aggregate summaries. Document that raw/normalized files are implementation inputs for scripts, not Agent reading targets. Add domain routing for remote sync and weekly/monthly reviews. Mark Phase 3 complete in the parent design only after acceptance passes.

- [ ] **Step 4: Run full fresh acceptance**

Run:

```bash
node --test 00-系统/Skills/daily-agent/tests/*.test.mjs
node --test 00-系统/Skills/thirdspace-vault/tests/thirdspace-vault.test.mjs
node 00-系统/Skills/thirdspace-vault/scripts/thirdspace-vault.mjs audit-subsystems --vault .
node 00-系统/Skills/thirdspace-vault/scripts/thirdspace-vault.mjs audit-workspaces --vault .
node 00-系统/Skills/thirdspace-vault/scripts/thirdspace-vault.mjs audit-skill-locations --vault .
node 00-系统/Skills/thirdspace-vault/scripts/thirdspace-vault.mjs audit-system --vault .
git diff --check
```

Expected: all tests pass; every audit has zero warnings and zero errors; diff check is clean.

- [ ] **Step 5: Record the milestone and commit**

Append one local `phase_completed` event through the Daily Agent event library without committing the ignored event file. Then commit tracked acceptance changes:

```bash
git add 00-系统/Skills/daily-agent .thirdspace/schema/workspace-tools.yaml 00-系统/运行时/README.md 00-系统/规范/13_Pi日常管理Agent设计.md 00-系统/Skills/thirdspace-vault
git commit -m "docs: publish remote reporting workflow"
```

Do not push until the user explicitly requests it.

