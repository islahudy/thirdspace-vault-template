---
title: "Pi 日常管理 Agent 第一阶段实施计划"
type: "spec"
topic: "system"
workspace: "00-系统"
created: "2026-08-22 00:00:00"
modified: "2026-08-22 00:00:00"
tags: ["system", "spec", "pi-agent", "implementation-plan"]
source: "manual"
status: "active"
---

# Pi Daily Management Agent Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the manually triggered Phase 1 Pi daily-management core for persistent tasks, reading-queue intake, daily opening, plan snapshots, and auditable state changes.

**Architecture:** Store current state in four versioned JSON files under `.thirdspace/data/daily-agent/`, and store immutable changes as append-only NDJSON events. Implement the behavior in a dedicated `daily-agent` Skill with focused JavaScript modules; keep `thirdspace-vault.mjs` responsible only for initialization and subsystem audit integration.

**Tech Stack:** Node.js ESM, Node built-in test runner, JSON/NDJSON, YAML control-plane files, Markdown worklogs.

**Spec:** `00-系统/规范/13_Pi日常管理Agent设计.md`

## Global Constraints

- Phase 1 is manually triggered; scheduled execution, SSH sync, Dashboard changes, report generation, and Wiki MCP publishing are outside this plan.
- Project Markdown remains the source of truth for project goals, plans, milestones, and progress; JSON stores only project indexes and linked tasks.
- Dashboard and Pi Agent will eventually share the state files, so every state file includes `version`, `revision`, and `updated_at`.
- Every state mutation must use an atomic temporary-file rename and append an immutable event.
- Clear `paper` and `blog` tags are auto-enrolled; uncertain reading candidates require confirmation.
- Daily logs contain only a plan snapshot, never the complete task store.
- No operation in this phase deletes history, moves content across workspaces, modifies project prose, or publishes externally.
- Invalid or unsupported JSON stops the write and returns a recoverable error; it must never be silently overwritten.
- New Markdown files use `YYYYMMDD_主题.md` and valid ThirdSpace Frontmatter.

## File Map

Create:

- `.thirdspace/schema/daily-agent.yaml` — machine-readable enums, file locations, reminder policy, and permission boundary.
- `.thirdspace/data/daily-agent/tasks.json` — current ordinary tasks and project-linked tasks.
- `.thirdspace/data/daily-agent/reading-queue.json` — current paper/blog queue and confirmation candidates.
- `.thirdspace/data/daily-agent/project-index.json` — project path/index records only.
- `.thirdspace/data/daily-agent/agent-state.json` — daily-opening and recovery state.
- `00-系统/Skills/daily-agent/SKILL.md` — Pi Agent operating protocol and triggers.
- `00-系统/Skills/daily-agent/references/data-contracts.md` — human-readable field contracts.
- `00-系统/Skills/daily-agent/references/daily-opening.md` — exact conversation and mutation sequence.
- `00-系统/Skills/daily-agent/scripts/lib/store.mjs` — validated JSON reads and atomic revisioned writes.
- `00-系统/Skills/daily-agent/scripts/lib/events.mjs` — deterministic event IDs and NDJSON append.
- `00-系统/Skills/daily-agent/scripts/lib/tasks.mjs` — task creation, querying, and transitions.
- `00-系统/Skills/daily-agent/scripts/lib/reading.mjs` — Inbox discovery and queue reconciliation.
- `00-系统/Skills/daily-agent/scripts/lib/opening.mjs` — opening summary and plan snapshot orchestration.
- `00-系统/Skills/daily-agent/scripts/daily-agent.mjs` — JSON-output CLI used by Pi Agent.
- `00-系统/Skills/daily-agent/tests/daily-agent.test.mjs` — end-to-end and module contract tests.

Modify:

- `00-系统/Skills/thirdspace-vault/scripts/thirdspace-vault.mjs` — initialize Phase 1 schema/state and audit their presence/validity.
- `00-系统/Skills/thirdspace-vault/tests/thirdspace-vault.test.mjs` — lock initialization and semantic-audit behavior.
- `.thirdspace/schema/workspace-tools.yaml` — route daily-management intent to `daily-agent`.
- `00-系统/Skills/README.md` — list the new canonical domain Skill.
- `00-系统/Agent/README.md` — define first-manual-open behavior.
- `00-系统/规范/08_全局路由与Hook事件采集规范.md` — align task/reading/daily-plan events with the global event protocol.
- `00-系统/规范/09_工作区工具框架与渐进加载规范.md` — document progressive loading of `daily-agent`.

---

### Task 1: Canonical Daily-Agent Schema and Initialized State

**Files:**

- Create: `.thirdspace/schema/daily-agent.yaml`
- Create: `.thirdspace/data/daily-agent/tasks.json`
- Create: `.thirdspace/data/daily-agent/reading-queue.json`
- Create: `.thirdspace/data/daily-agent/project-index.json`
- Create: `.thirdspace/data/daily-agent/agent-state.json`
- Modify: `00-系统/Skills/thirdspace-vault/scripts/thirdspace-vault.mjs`
- Test: `00-系统/Skills/thirdspace-vault/tests/thirdspace-vault.test.mjs`

**Interfaces:**

- Produces: state file paths and exact enums consumed by every later task.
- Produces: `init --vault <path>` creating all four valid state files without overwriting existing data.

- [ ] **Step 1: Extend the initializer test and assert the exact initial JSON**

Add a test that initializes a temporary Vault and asserts:

```js
test("init creates canonical daily-agent state without overwriting it", () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "thirdspace-daily-agent-"));
  try {
    run("init", "--vault", target);
    const root = path.join(target, ".thirdspace/data/daily-agent");
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, "tasks.json"), "utf8")), {
      version: "1.0", revision: 0, updated_at: null, tasks: [],
    });
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, "reading-queue.json"), "utf8")), {
      version: "1.0", revision: 0, updated_at: null, items: [], candidates: [], dismissed_source_paths: [],
    });
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, "project-index.json"), "utf8")), {
      version: "1.0", revision: 0, updated_at: null, projects: [],
    });
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, "agent-state.json"), "utf8")), {
      version: "1.0", revision: 0, updated_at: null,
      last_manual_checkin: null, last_daily_opening: null,
      last_weekly_review: null, last_monthly_review: null,
      last_remote_sync: {}, pending_confirmations: [],
    });
    fs.writeFileSync(path.join(root, "tasks.json"), '{"version":"1.0","revision":7,"updated_at":null,"tasks":[]}\n');
    run("init", "--vault", target);
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, "tasks.json"), "utf8")).revision, 7);
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
node --test 00-系统/Skills/thirdspace-vault/tests/thirdspace-vault.test.mjs
```

Expected: FAIL because `daily-agent.yaml` and the four state files do not exist.

- [ ] **Step 3: Add the canonical schema**

Define these exact contracts in `.thirdspace/schema/daily-agent.yaml`:

```yaml
version: "1.0"
state_root: ".thirdspace/data/daily-agent"
files:
  tasks: "tasks.json"
  reading_queue: "reading-queue.json"
  project_index: "project-index.json"
  agent_state: "agent-state.json"
task:
  status_values: [inbox, active, waiting, completed, cancelled]
  priority_values: [critical, high, normal, low]
reading:
  kind_values: [paper, blog]
  status_values: [pending, reading, processed, skipped]
  auto_tags: [paper, blog]
  stale_after_days: 7
opening:
  due_soon_hours: 24
  upcoming_days: 3
permissions:
  auto: [create_task, update_task, confirm_completion, enroll_tagged_reading, write_daily_plan, append_event]
  confirm: [cancel_task, enroll_candidate, change_project_stage, move_workspace, archive_project, publish_external]
  deny: [delete_history, rewrite_raw_event, modify_git_history, store_secret]
```

- [ ] **Step 4: Initialize files with `writeIfMissing`**

Add `daily-agent.yaml` to the canonical schema copy list and create the four initial JSON values exactly as asserted. Reuse `writeIfMissing`; do not introduce an overwrite flag.

- [ ] **Step 5: Run the focused suite and verify GREEN**

Run the same Node test command. Expected: all tests PASS.

- [ ] **Step 6: Commit the schema and initialization slice**

```bash
git add .thirdspace/schema/daily-agent.yaml .thirdspace/data/daily-agent \
  00-系统/Skills/thirdspace-vault/scripts/thirdspace-vault.mjs \
  00-系统/Skills/thirdspace-vault/tests/thirdspace-vault.test.mjs
git commit -m "feat: initialize daily agent state"
```

---

### Task 2: Safe State Store and Immutable Events

**Files:**

- Create: `00-系统/Skills/daily-agent/scripts/lib/store.mjs`
- Create: `00-系统/Skills/daily-agent/scripts/lib/events.mjs`
- Create: `00-系统/Skills/daily-agent/tests/daily-agent.test.mjs`

**Interfaces:**

- Produces: `readState(file, expectedCollection): object`.
- Produces: `mutateState(file, expectedRevision, mutator, now): object`.
- Produces: `appendEvent(vaultRoot, event): { path, event }`.
- Produces: `makeEventId(kind, subjectId, timestamp): string`.

- [ ] **Step 1: Write failing tests for validation, atomic revision, and event append**

Tests must assert:

```js
assert.throws(() => readState(invalidFile, "tasks"), /invalid JSON/);
assert.throws(() => readState(wrongVersionFile, "tasks"), /unsupported version/);
assert.throws(() => mutateState(tasksFile, 3, value => value, now), /revision conflict/);
const next = mutateState(tasksFile, 0, value => ({ ...value, tasks: [{ id: "task_1" }] }), now);
assert.equal(next.revision, 1);
assert.equal(next.updated_at, now);
assert.deepEqual(JSON.parse(fs.readFileSync(tasksFile, "utf8")), next);
const appended = appendEvent(vaultRoot, {
  event_id: "task_created:task_1:20260822T090000Z",
  timestamp: now,
  event_type: "task_created",
  source_id: "pi-agent",
  subject_id: "task_1",
});
assert.equal(JSON.parse(fs.readFileSync(appended.path, "utf8").trim()).event_id, appended.event.event_id);
```

- [ ] **Step 2: Run the new suite and verify RED**

```bash
node --test 00-系统/Skills/daily-agent/tests/daily-agent.test.mjs
```

Expected: FAIL because both modules are missing.

- [ ] **Step 3: Implement `store.mjs`**

`readState` must reject missing collections, non-object roots, invalid JSON, and versions other than `1.0`. `mutateState` must compare revisions, call the pure mutator, increment revision, set `updated_at`, write `<file>.tmp-<pid>`, and rename it over the target. It must remove only its own temporary file after a failed rename.

- [ ] **Step 4: Implement `events.mjs`**

`appendEvent` validates the five required fields from the test, selects `.thirdspace/events/local/YYYYMMDD.ndjson` from the timestamp, creates the directory, and appends one compact JSON object plus `\n`. `makeEventId` returns a deterministic colon-separated ID using normalized kind, subject ID, and UTC timestamp.

- [ ] **Step 5: Run the suite and verify GREEN**

Run the new suite twice to prove append and temporary-file behavior remain stable. Expected: all tests PASS both times.

- [ ] **Step 6: Commit the storage boundary**

```bash
git add 00-系统/Skills/daily-agent/scripts/lib/store.mjs \
  00-系统/Skills/daily-agent/scripts/lib/events.mjs \
  00-系统/Skills/daily-agent/tests/daily-agent.test.mjs
git commit -m "feat: add revisioned daily agent storage"
```

---

### Task 3: Task Lifecycle and Queries

**Files:**

- Create: `00-系统/Skills/daily-agent/scripts/lib/tasks.mjs`
- Modify: `00-系统/Skills/daily-agent/tests/daily-agent.test.mjs`

**Interfaces:**

- Consumes: `readState`, `mutateState`, `appendEvent`, `makeEventId` from Task 2.
- Produces: `createTask(context, input): task`.
- Produces: `transitionTask(context, id, nextStatus, patch): task`.
- Produces: `listOpeningTasks(tasks, now): { overdue, dueSoon, upcoming, stale, waitingForReview, active }`.
- Produces: `registerProject(context, input): project` for linking an existing `04-项目` directory without copying its prose.

- [ ] **Step 1: Add failing lifecycle tests**

Cover these exact behaviors:

```js
const task = createTask(context, {
  title: "提交合作材料", priority: "high", due: "2026-08-25",
  tags: ["横向", "合作"], project_id: null,
});
assert.equal(task.status, "active");
assert.equal(task.source, "pi-agent");
assert.equal(readEvents(context.vaultRoot).at(-1).event_type, "task_created");
assert.throws(() => createTask(context, { title: "", priority: "normal" }), /title is required/);
assert.throws(() => createTask(context, { title: "x", priority: "urgent" }), /invalid priority/);
const completed = transitionTask(context, task.id, "completed", {});
assert.ok(completed.completed_at);
assert.equal(readEvents(context.vaultRoot).at(-1).event_type, "task_status_changed");
assert.throws(() => transitionTask(context, task.id, "cancelled", {}), /confirmation required/);
const project = registerProject(context, {
  id: "project_thirdspace", name: "ThirdSpace",
  path: "04-项目/产品系统/20260822_ThirdSpace", status: "active", stage: "active",
});
assert.equal(project.path, "04-项目/产品系统/20260822_ThirdSpace");
assert.throws(() => createTask(context, {
  title: "无效项目任务", priority: "normal", project_id: "project_missing",
}), /project not found/);
```

Create dated fixtures and assert that `listOpeningTasks` puts each item into only the appropriate reminder group, with overdue taking precedence over due-soon and stale.

- [ ] **Step 2: Run the focused task tests and verify RED**

```bash
node --test --test-name-pattern="task" 00-系统/Skills/daily-agent/tests/daily-agent.test.mjs
```

Expected: FAIL because `tasks.mjs` is missing.

- [ ] **Step 3: Implement task validation and IDs**

Validate statuses and priorities against the Phase 1 enum values. Generate IDs as `task_<UTC compact timestamp>_<8 lowercase hex characters>`. Normalize tags by trimming, removing blanks, and preserving first-seen order. `registerProject` must reject paths outside `04-项目`, missing directories, and duplicate IDs; task creation must reject an unresolved non-null `project_id`.

- [ ] **Step 4: Implement transitions and reminder precedence**

Allow ordinary automatic transitions to `active`, `waiting`, and `completed`. Require `patch.confirmed === true` for `cancelled`. Set `completed_at` only on completion; set `review_after` only for waiting tasks. Query order is overdue, due within 24 hours, due within 3 days, waiting ready for review, stale active, remaining active.

- [ ] **Step 5: Run the full daily-agent suite and verify GREEN**

```bash
node --test 00-系统/Skills/daily-agent/tests/daily-agent.test.mjs
```

Expected: all tests PASS.

- [ ] **Step 6: Commit the task lifecycle**

```bash
git add 00-系统/Skills/daily-agent/scripts/lib/tasks.mjs \
  00-系统/Skills/daily-agent/tests/daily-agent.test.mjs
git commit -m "feat: manage persistent daily tasks"
```

---

### Task 4: Inbox Reading Discovery and Reconciliation

**Files:**

- Create: `00-系统/Skills/daily-agent/scripts/lib/reading.mjs`
- Modify: `00-系统/Skills/daily-agent/tests/daily-agent.test.mjs`

**Interfaces:**

- Consumes: storage and event functions from Task 2.
- Produces: `scanReadingInbox(context): { added, candidates, processed, unchanged }`.
- Produces: `confirmReadingCandidate(context, candidateId, decision): object`.

- [ ] **Step 1: Add failing Inbox fixtures and assertions**

Create temporary Inbox Markdown files with valid Frontmatter:

- `tags: [paper, agent]`, `status: draft` must become `kind: paper`, `status: pending`.
- `tags: [blog]`, `status: draft` must become `kind: blog`, `status: pending`.
- no paper/blog tag but an arXiv URL must become a candidate, not an item.
- `tags: [paper]`, `status: processed` must become or remain `status: processed`.
- a general temporary thought must remain unchanged.

Assert repeated scans do not duplicate records and use `source_path` as the stable reconciliation key.

- [ ] **Step 2: Run reading tests and verify RED**

```bash
node --test --test-name-pattern="reading" 00-系统/Skills/daily-agent/tests/daily-agent.test.mjs
```

Expected: FAIL because `reading.mjs` is missing.

- [ ] **Step 3: Implement safe Frontmatter discovery**

Scan Markdown under `01-收件箱` only. Parse `title`, `tags`, `status`, `url`, and `source_url` without modifying Inbox files. Treat exact normalized tags `paper` and `blog` as authoritative. Treat `arxiv.org`, `doi.org`, common scholarly publisher URLs, and article-like HTTP URLs as candidate signals only.

- [ ] **Step 4: Implement reconciliation and confirmation**

Use one record per `source_path`. Auto-add tagged items and append `reading_added`. Put uncertain matches into `candidates`. A confirmed accept moves the candidate to `items`. Reject removes it, stores its `source_path` in `dismissed_source_paths`, and appends a decision event so a later scan does not recreate it. When Inbox status becomes `processed`, update the queue item and append `reading_processed`.

- [ ] **Step 5: Run the full daily-agent suite and verify GREEN**

Expected: all tests PASS, including a second scan with zero duplicates.

- [ ] **Step 6: Commit the reading queue**

```bash
git add 00-系统/Skills/daily-agent/scripts/lib/reading.mjs \
  00-系统/Skills/daily-agent/tests/daily-agent.test.mjs
git commit -m "feat: maintain paper and blog reading queue"
```

---

### Task 5: Daily Opening Summary and Plan Snapshot

**Files:**

- Create: `00-系统/Skills/daily-agent/scripts/lib/opening.mjs`
- Modify: `00-系统/Skills/daily-agent/tests/daily-agent.test.mjs`

**Interfaces:**

- Consumes: `listOpeningTasks`, `scanReadingInbox`, `mutateState`, and `appendEvent`.
- Produces: `prepareOpening(context): OpeningSummary` without marking the opening complete.
- Produces: `completeOpening(context, input): { state, worklogPath, event }`.

- [ ] **Step 1: Write failing opening tests**

Assert that `prepareOpening` returns:

```js
{
  required: true,
  date: "2026-08-22",
  tasks: { overdue: [], dueSoon: [], upcoming: [], stale: [], waitingForReview: [], active: [] },
  reading: { added: [], candidates: [], processed: [], unchanged: [] },
  prompts: {
    completionReview: "昨天及更早的事项中，哪些已经完成、取消或需要等待？",
    todayPlan: "今天准备推进什么？请选择 1～3 个今日重点。"
  }
}
```

After `completeOpening(context, { focusTaskIds: [id] })`, assert:

- the worklog contains `## 今日重点` and `## 今日计划快照` exactly once;
- `last_daily_opening` equals `2026-08-22`;
- a `daily_plan_created` event exists;
- a second `prepareOpening` returns `{ required: false, date: "2026-08-22" }` unless `force: true`.

- [ ] **Step 2: Run opening tests and verify RED**

```bash
node --test --test-name-pattern="opening" 00-系统/Skills/daily-agent/tests/daily-agent.test.mjs
```

Expected: FAIL because `opening.mjs` is missing.

- [ ] **Step 3: Implement read-only opening preparation**

`prepareOpening` must scan and summarize but never set `last_daily_opening`. This preserves the distinction between showing prompts and completing the conversation.

- [ ] **Step 4: Implement idempotent snapshot completion**

`completeOpening` validates 1–3 distinct active focus task IDs, uses the existing worklog naming helper or the canonical `YYYYMMDD_工作日志_周X.md` rule, replaces only the managed contents beneath `## 今日重点` and `## 今日计划快照`, and leaves all other sections untouched. It then updates agent state and appends `daily_plan_created`.

- [ ] **Step 5: Run the full daily-agent suite and verify GREEN**

Expected: all tests PASS, including repeat completion without duplicate headings.

- [ ] **Step 6: Commit the daily opening**

```bash
git add 00-系统/Skills/daily-agent/scripts/lib/opening.mjs \
  00-系统/Skills/daily-agent/tests/daily-agent.test.mjs
git commit -m "feat: add idempotent daily opening flow"
```

---

### Task 6: Pi-Facing CLI and Skill Protocol

**Files:**

- Create: `00-系统/Skills/daily-agent/scripts/daily-agent.mjs`
- Create: `00-系统/Skills/daily-agent/SKILL.md`
- Create: `00-系统/Skills/daily-agent/references/data-contracts.md`
- Create: `00-系统/Skills/daily-agent/references/daily-opening.md`
- Modify: `00-系统/Skills/daily-agent/tests/daily-agent.test.mjs`
- Modify: `.thirdspace/schema/workspace-tools.yaml`

**Interfaces:**

- Produces CLI commands: `opening`, `project-register`, `task-add`, `task-transition`, `reading-scan`, `reading-confirm`, `opening-complete`.
- All commands accept `--vault <path>` and print exactly one JSON value to stdout; errors go to stderr and exit non-zero.

- [ ] **Step 1: Add failing CLI tests**

Use `execFileSync(process.execPath, [cli, command, ...args])` and assert:

```js
assert.equal(runCli("opening", "--vault", target).required, true);
const created = runCli("task-add", "--vault", target, "--title", "准备组会", "--priority", "high", "--tags", "科研,组会");
assert.equal(created.task.title, "准备组会");
const project = runCli("project-register", "--vault", target, "--id", "project_research", "--name", "研究项目", "--path", "04-项目/研究验证/20260822_研究项目");
assert.equal(project.project.id, "project_research");
assert.equal(runCli("reading-scan", "--vault", target).added.length, 1);
assert.equal(runCli("opening-complete", "--vault", target, "--focus", created.task.id).state.last_daily_opening, "2026-08-22");
```

Inject time with `THIRDSPACE_NOW=2026-08-22T09:00:00+08:00` in tests so results are deterministic.

- [ ] **Step 2: Run CLI tests and verify RED**

```bash
node --test --test-name-pattern="CLI" 00-系统/Skills/daily-agent/tests/daily-agent.test.mjs
```

Expected: FAIL because the CLI is missing.

- [ ] **Step 3: Implement argument parsing and command dispatch**

Resolve the Vault by walking upward to `.thirdspace/workspace-index.yaml` when `--vault` is absent. Parse comma-separated tags and focus IDs. Use `THIRDSPACE_NOW` only when present; otherwise use the system clock. Do not add network access or SSH behavior.

- [ ] **Step 4: Write the Skill and references**

`SKILL.md` must state that the Skill is loaded for daily opening, remaining work, priorities, deadlines, reading backlog, or daily planning. Its required sequence is `opening` → ask completion review → apply confirmed transitions → ask today plan → create/update tasks → confirm 1–3 focus items → `opening-complete`.

`data-contracts.md` documents every Phase 1 field and enum. `daily-opening.md` contains the exact user-facing sequence, including the rule that uncertain reading candidates and cancellation require confirmation.

- [ ] **Step 5: Route the Skill**

Add `daily-agent` to `.thirdspace/schema/workspace-tools.yaml` under journal-related domain routing with triggers `今日计划`, `遗留事项`, `待办`, `DDL`, `阅读积压`, `开始今天`, and `日常管理`.

- [ ] **Step 6: Run the full daily-agent suite and verify GREEN**

Expected: all module and CLI tests PASS.

- [ ] **Step 7: Commit the Pi-facing interface**

```bash
git add 00-系统/Skills/daily-agent .thirdspace/schema/workspace-tools.yaml
git commit -m "feat: expose daily management skill to Pi agent"
```

---

### Task 7: Semantic Audit, Documentation, and Full Acceptance

**Files:**

- Modify: `00-系统/Skills/thirdspace-vault/scripts/thirdspace-vault.mjs`
- Modify: `00-系统/Skills/thirdspace-vault/tests/thirdspace-vault.test.mjs`
- Modify: `00-系统/Skills/README.md`
- Modify: `00-系统/Agent/README.md`
- Modify: `00-系统/规范/08_全局路由与Hook事件采集规范.md`
- Modify: `00-系统/规范/09_工作区工具框架与渐进加载规范.md`

**Interfaces:**

- Consumes all Phase 1 files and commands.
- Produces `audit-subsystems` errors for missing, invalid, unsupported, or internally inconsistent daily-agent state.

- [ ] **Step 1: Add failing audit tests**

Create initialized temporary Vaults and independently corrupt:

- `tasks.json` with invalid JSON;
- `reading-queue.json` with `version: "2.0"`;
- a task with priority `urgent`;
- duplicate task IDs;
- a reading item with missing `source_path`;
- a `project_id` that does not exist in `project-index.json`.

For each fixture assert `audit-subsystems` returns at least one `severity: "error"` whose path identifies the exact state file and whose message identifies the violated contract.

- [ ] **Step 2: Run thirdspace-vault tests and verify RED**

```bash
node --test 00-系统/Skills/thirdspace-vault/tests/thirdspace-vault.test.mjs
```

Expected: FAIL because semantic audit does not yet validate daily-agent state.

- [ ] **Step 3: Implement daily-agent semantic audit**

Read `.thirdspace/schema/daily-agent.yaml`, validate all four files, enforce unique IDs and enums, require project references to resolve, and add maintenance items for every error. Do not repair state during audit.

- [ ] **Step 4: Synchronize human-facing documentation**

- Add `daily-agent` to `00-系统/Skills/README.md` as the daily-management orchestration Skill.
- Update `00-系统/Agent/README.md` with the first-manual-open rule and explicit re-plan entry.
- Update specification 08 with the Phase 1 event types and immutable correction rule.
- Update specification 09 with the `daily-agent` progressive-loading rule.
- Update each modified specification's `modified` timestamp.

- [ ] **Step 5: Run complete acceptance**

```bash
node --test 00-系统/Skills/daily-agent/tests/daily-agent.test.mjs
node --test 00-系统/Skills/thirdspace-vault/tests/thirdspace-vault.test.mjs
node 00-系统/Skills/thirdspace-vault/scripts/thirdspace-vault.mjs audit-system --vault .
node 00-系统/Skills/thirdspace-vault/scripts/thirdspace-vault.mjs audit-workspaces --vault .
node 00-系统/Skills/thirdspace-vault/scripts/thirdspace-vault.mjs audit-skill-locations --vault .
node 00-系统/Skills/thirdspace-vault/scripts/thirdspace-vault.mjs audit-subsystems --vault .
git diff --check
```

Expected: both test suites pass; every audit has zero warning and zero error; `git diff --check` prints nothing.

- [ ] **Step 6: Record the architectural event**

```bash
node 00-系统/Skills/thirdspace-vault/scripts/thirdspace-vault.mjs record-agent-event \
  --vault . \
  --decision "建立 Pi 日常管理 Agent 第一阶段核心" \
  --reason "统一事项、阅读队列、每日开场和可追溯事件" \
  --artifact "00-系统/Skills/daily-agent/SKILL.md" \
  --importance high
```

- [ ] **Step 7: Commit the acceptance slice**

```bash
git add 00-系统/Skills/thirdspace-vault \
  00-系统/Skills/README.md \
  00-系统/Agent/README.md \
  00-系统/规范/08_全局路由与Hook事件采集规范.md \
  00-系统/规范/09_工作区工具框架与渐进加载规范.md
git commit -m "test: audit daily agent contracts"
```

The working tree must be clean except for ignored local event and worklog files. Do not push unless the user explicitly requests it during execution.
