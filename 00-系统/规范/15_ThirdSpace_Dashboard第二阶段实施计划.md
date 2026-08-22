---
title: "ThirdSpace Dashboard 第二阶段实施计划"
type: "spec"
topic: "system"
workspace: "00-系统"
created: "2026-08-22 00:00:00"
modified: "2026-08-22 00:00:00"
tags: ["system", "spec", "dashboard", "daily-agent", "implementation-plan"]
source: "manual"
status: "active"
---

# ThirdSpace Dashboard Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Dashboard's worklog-based Todo implementation with a maintainable source build that reads and edits Daily Agent tasks and displays the paper/blog reading backlog.

**Architecture:** Restore the Obsidian plugin as JavaScript source bundled by esbuild. Keep state validation, immutable updates, task grouping, and reading summaries in pure ESM modules tested with Node; the Obsidian adapter performs revision checks, atomic replacement, and event append through Vault APIs.

**Tech Stack:** Obsidian Plugin API, JavaScript ESM, esbuild, Node built-in test runner, JSON/NDJSON.

**Spec:** `00-系统/规范/13_Pi日常管理Agent设计.md`

## Global Constraints

- `.thirdspace/data/daily-agent/*.json` remains the only current-state source of truth.
- The Dashboard never writes complete task lists into daily worklogs.
- Every Dashboard mutation validates version/revision, atomically replaces the JSON file, and appends an immutable local event.
- Phase 2 supports task creation and editing of status, priority, DDL, tags, and project association.
- Cancellation requires a second explicit confirmation; history deletion is unavailable.
- Reading is display-only in Phase 2: show counts, stale items, and links to Inbox source files.
- Existing workspace cards, activity heatmap, today worklog, recent files, and quick actions remain available.
- `main.js` remains committed as the distributable artifact, but edits originate in `src/`.

## File Map

Create:

- `.obsidian/plugins/thirdspace-dashboard/package.json` — build and test commands with pinned esbuild/Obsidian dev dependencies.
- `.obsidian/plugins/thirdspace-dashboard/package-lock.json` — reproducible dependency graph.
- `.obsidian/plugins/thirdspace-dashboard/src/state.mjs` — pure state validation and revisioned mutation preparation.
- `.obsidian/plugins/thirdspace-dashboard/src/models.mjs` — pure task grouping/filtering and reading backlog summaries.
- `.obsidian/plugins/thirdspace-dashboard/src/main.mjs` — Obsidian view, modals, Vault adapter, and event writes.
- `.obsidian/plugins/thirdspace-dashboard/tests/dashboard.test.mjs` — pure contract tests.

Modify:

- `.obsidian/plugins/thirdspace-dashboard/main.js` — generated bundle.
- `.obsidian/plugins/thirdspace-dashboard/styles.css` — task metadata, filters, dialogs, and reading card styles.
- `.obsidian/plugins/thirdspace-dashboard/manifest.json` — version bump to `0.2.0` and Daily Agent description.
- `00-系统/运行时/manifest.yaml` — plugin version update.
- `00-系统/运行时/README.md` — Dashboard data-source documentation.
- `00-系统/Skills/init-vault/SKILL.md` — initialization acceptance includes Daily Agent Dashboard state.
- `00-系统/规范/13_Pi日常管理Agent设计.md` — mark Dashboard phase as implemented without changing architecture.

---

### Task 1: Restore a Reproducible Plugin Source Build

**Files:**

- Create: `.obsidian/plugins/thirdspace-dashboard/package.json`
- Create: `.obsidian/plugins/thirdspace-dashboard/src/main.mjs`
- Create: `.obsidian/plugins/thirdspace-dashboard/tests/dashboard.test.mjs`
- Modify: `.obsidian/plugins/thirdspace-dashboard/main.js`

**Interfaces:**

- Produces: `npm run build` bundling `src/main.mjs` to `main.js` as CommonJS with `obsidian` external.
- Produces: `npm test` running `node --test tests/*.test.mjs`.

- [ ] Write a failing test that imports `src/main.mjs` only through a build smoke check and asserts `package.json` exposes `build` and `test` scripts.
- [ ] Run `npm test`; verify RED because the source/build files do not exist.
- [ ] Create `package.json` with scripts `build: esbuild src/main.mjs --bundle --external:obsidian --format=cjs --platform=browser --outfile=main.js` and `test: node --test tests/*.test.mjs`, with exact dev dependencies `esbuild` and `obsidian` resolved into the lockfile by `npm install`.
- [ ] Move the existing Dashboard behavior into readable `src/main.mjs`: workspace cards, activity counts, worklog preview, quick actions, recent files, and heatmap may be simplified internally but must remain visible.
- [ ] Run `npm test` and `npm run build`; verify GREEN and a loadable CommonJS `main.js` containing `require("obsidian")`.
- [ ] Commit with `git commit -m "build: restore dashboard source pipeline"`.

---

### Task 2: Daily-Agent State Adapter and Event Writes

**Files:**

- Create: `.obsidian/plugins/thirdspace-dashboard/src/state.mjs`
- Modify: `.obsidian/plugins/thirdspace-dashboard/src/main.mjs`
- Modify: `.obsidian/plugins/thirdspace-dashboard/tests/dashboard.test.mjs`

**Interfaces:**

- Produces: `parseState(text, collection): object` rejecting invalid JSON, unsupported versions, invalid revisions, and missing collections.
- Produces: `prepareMutation(current, expectedRevision, mutate, now): object` returning revision + 1 state without I/O.
- Produces in `main.mjs`: `DailyAgentStore.read(name, collection)`, `DailyAgentStore.mutate(name, collection, mutate, event)`, and `DailyAgentStore.appendEvent(event)` using `app.vault.adapter`.

- [ ] Add failing pure tests for invalid JSON/version/revision, missing collection, revision conflict, and incremented `revision/updated_at`.
- [ ] Run the focused state tests and verify RED.
- [ ] Implement `state.mjs` without Obsidian imports.
- [ ] Implement `DailyAgentStore`: read the latest state, write `.tmp-dashboard`, rename atomically, clean only its temporary file on failure, then append compact NDJSON to `.thirdspace/events/local/YYYYMMDD.ndjson`.
- [ ] Ensure a failed event append reports an Obsidian Notice but does not roll back the already committed state; the next audit can detect the missing event.
- [ ] Run tests/build and commit with `git commit -m "feat: add dashboard daily agent store"`.

---

### Task 3: Task Dashboard and Editing

**Files:**

- Create: `.obsidian/plugins/thirdspace-dashboard/src/models.mjs`
- Modify: `.obsidian/plugins/thirdspace-dashboard/src/main.mjs`
- Modify: `.obsidian/plugins/thirdspace-dashboard/styles.css`
- Modify: `.obsidian/plugins/thirdspace-dashboard/tests/dashboard.test.mjs`

**Interfaces:**

- Produces: `groupTasks(tasks, today): { overdue, today, upcoming, waiting, active, completed }` with one group per task.
- Produces: `filterTasks(tasks, { tag, projectId, showCompleted }): task[]`.
- Produces Dashboard controls that mutate the exact Task 1 JSON fields and append `task_created`, `task_status_changed`, or `task_updated`.

- [ ] Add failing tests for grouping precedence, tag/project filters, hidden completed tasks, and stable priority ordering `critical/high/normal/low`.
- [ ] Run model tests and verify RED.
- [ ] Implement `models.mjs` as pure functions.
- [ ] Replace `TODAY'S TODOS` with `TASKS`: sections for overdue/today/upcoming/waiting/active, metadata chips for priority/DDL/tags/project, tag/project filters, and a completed visibility toggle.
- [ ] Add a task modal for title, priority, due date, comma-separated tags, and optional project; add an edit modal for the same fields and status.
- [ ] Require a second modal confirmation before `cancelled`; completion, waiting, and active transitions remain one action.
- [ ] Run tests/build and commit with `git commit -m "feat: manage daily tasks from dashboard"`.

---

### Task 4: Reading Backlog Card

**Files:**

- Modify: `.obsidian/plugins/thirdspace-dashboard/src/models.mjs`
- Modify: `.obsidian/plugins/thirdspace-dashboard/src/main.mjs`
- Modify: `.obsidian/plugins/thirdspace-dashboard/styles.css`
- Modify: `.obsidian/plugins/thirdspace-dashboard/tests/dashboard.test.mjs`

**Interfaces:**

- Produces: `summarizeReading(state, now, staleDays): { pending, reading, processed, stale, candidates }`.
- Produces a read-only Dashboard card whose item click opens `source_path` through the Obsidian workspace.

- [ ] Add failing tests showing pending/reading/processed counts, candidate count, and stale items older than 7 days.
- [ ] Run reading-model tests and verify RED.
- [ ] Implement `summarizeReading` and render `READING QUEUE` with counts, up to five stale items, candidate reminder, and an Inbox link.
- [ ] Treat missing/invalid reading state as a visible warning card rather than an empty queue.
- [ ] Run tests/build and commit with `git commit -m "feat: show reading backlog in dashboard"`.

---

### Task 5: Distribution, Documentation, and Acceptance

**Files:**

- Modify: `.obsidian/plugins/thirdspace-dashboard/manifest.json`
- Modify: `.obsidian/plugins/thirdspace-dashboard/main.js`
- Modify: `00-系统/运行时/manifest.yaml`
- Modify: `00-系统/运行时/README.md`
- Modify: `00-系统/Skills/init-vault/SKILL.md`
- Modify: `00-系统/规范/13_Pi日常管理Agent设计.md`
- Modify: `00-系统/Skills/thirdspace-vault/tests/thirdspace-vault.test.mjs`

**Interfaces:**

- Produces the versioned `0.2.0` distributable plugin and initialization/audit guarantees.

- [ ] Add failing Vault tests asserting plugin source/build files exist, manifest version is `0.2.0`, and bundled `main.js` references `.thirdspace/data/daily-agent/tasks.json` and `reading-queue.json`.
- [ ] Run the Vault suite and verify RED.
- [ ] Update manifests and docs; state that worklog Todo storage is retired and Dashboard current state comes from Daily Agent JSON.
- [ ] Run `npm test` and `npm run build` inside the plugin directory.
- [ ] Run both Vault Node suites plus `audit-system`, `audit-workspaces`, `audit-skill-locations`, `audit-subsystems`, and `git diff --check`.
- [ ] Open Obsidian if available and manually verify Dashboard load, task creation/edit/completion, cancellation confirmation, filters, reading warning/card, and preserved workspace/activity/worklog/recent sections. If Obsidian is unavailable, report manual UI verification as pending rather than claiming it passed.
- [ ] Record a major Agent event and commit with `git commit -m "chore: publish dashboard daily agent integration"`.

Do not push until the user explicitly requests it.
