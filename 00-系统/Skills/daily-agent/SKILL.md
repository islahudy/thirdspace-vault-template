---
name: daily-agent
description: Use when the user starts the day, reviews remaining work, manages priorities or deadlines, checks paper/blog reading backlog, chooses today’s focus, synchronizes remote records, or generates weekly/monthly reviews.
---

# Daily Agent

## Overview

Operate ThirdSpace as a personal research-management assistant. Current state lives in `.thirdspace/data/daily-agent/`; worklogs are snapshots, never the task source of truth.

When an authorized Calendar or Reminder create returns a DTO, persist its `id` as `external_ref.id` and its available `externalId` as `external_ref.external_id`. Supply both locators on later EventKit reads and mutations. Fresh EventKit DTOs remain authoritative; the local reference is never cached Apple state.

## Required Load Order

1. Resolve the Vault and read `.thirdspace/schema/daily-agent.yaml`.
2. Read the four state files under `.thirdspace/data/daily-agent/`.
3. Load `workspace-journal`; load `workspace-inbox`, `workspace-projects`, `worklog`, or `review` only when that part of the request is active.
4. Use `scripts/daily-agent.mjs` for state changes.

## Daily Opening

Run this sequence in order:

1. Call local `opening`.
2. Using the machine's local timezone, calculate `[00:00, next 00:00)` as absolute timestamps and call EventKit `calendar.list` for that interval.
3. Call EventKit `reminder.list` once with `status: "incomplete"` and once with `status: "completed"`; from the completed response retain only Reminders whose `completionDate` is inside the same local-day interval.
4. Collect both EventKit Reminder identifiers linked from the loaded local tasks. For each link absent from the incomplete and today-completed list results by local `id` or a unique `external_id` match, call fresh `reminder.get` with `id` and optional `externalId`.
5. Add every successful `reminder.get` DTO to reconciliation, including a Reminder completed before today. Only a `REMINDER_NOT_FOUND` response confirms a missing ID; any other lookup failure is an unavailable anomaly for manual handling, not a broken reference.
6. Call `classifyReminderUpdates` with the fresh Reminder DTOs and the explicitly confirmed-missing local IDs. Match `external_ref.id` first, then uniquely match `external_ref.external_id` to a DTO `externalId`; never match by title or import an unlinked Apple item.
7. Apply each `complete` entry with `task-transition --status completed --completed-at ...`; only local `inbox`, `active`, or `waiting` tasks are eligible. Never auto-complete a `cancelled` task. A completed Reminder without `completionDate` is an anomaly for manual handling and must not change local state.
8. For every `reopenConfirmations` entry, ask before transitioning the local task back to `active`. Report `brokenRefs` and `anomalies` without repairing, relinking, or mutating them.
9. Present overdue, due-soon, upcoming, stale, waiting, and active local items, then today's Calendar events and Reminders (or a clear unavailable label), before asking about today's focus.
10. Ask which older local items are completed, waiting, or cancelled, and apply confirmed transitions. Cancellation always requires explicit confirmation.
11. Present reading additions, processed items, and candidates discovered by the opening scan.
12. Ask what the user will advance today; create or update tasks from their answer.
13. Ask the user to select 1–3 active focus tasks.
14. Only after selection, call `opening-complete`.

An ordinary `today`/daily-opening flow never calls EventKit `auth.request`. If Calendar or Reminders access fails, label that source unavailable and continue the complete local flow; do not let EventKit failure block `opening` or `opening-complete`.

If `opening` returns `required: false`, do not repeat the dialogue unless the user explicitly asks to re-plan; then pass `--force`. Any Apple agenda included in the current summary must still come from fresh EventKit reads.

## Permission Boundary

| Action | Rule |
|---|---|
| Create/update tasks, confirm completion, enroll explicit `paper/blog`, write plan snapshot | Automatic |
| Complete a linked local task from a freshly completed Reminder | Automatic |
| Reopen a local-completed task after its linked Reminder was reopened | Ask first |
| Mark a merely list-absent Reminder as broken, auto-complete a cancelled task, or use a missing completion timestamp | Never; resolve by ID and report unresolved anomalies for manual handling |
| Detect an uncertain reading candidate | Automatic discovery only |
| Accept/reject a candidate, cancel a task, change project stage, move/archive/publish | Ask first |
| Request Calendar or Reminders authorization during ordinary `today` | Never; report the source unavailable and continue locally |
| Install or configure remote producers, hooks, event paths, SSH aliases, or remote sources | Never automatic; the user must perform it or explicitly confirm the exact action first |
| Delete history, rewrite raw events, change Git history, store secrets | Never |

## Remote Reporting Flow

For “同步远端记录”, “生成周报”, or “生成月报”, preserve this order:

```text
remote-sync -> events-normalize -> report-aggregate -> review-generate
```

Use the scripts as the data plane. Raw files under `.thirdspace/events/remote/` and normalized files under `.thirdspace/events/normalized/` are script inputs, not Agent reading targets. Do not open, quote, summarize, or place those streams in model context.

To the user, print only:

- sync/normalization counts and generated paths;
- generated aggregate/review paths;
- the bounded totals returned by `report-aggregate` (`commits`, `token_sessions`, `completed_tasks`, and `processed_readings`);
- a short bounded coverage warning when sources fail or events are rejected.

Never print event records, raw lines, normalized payloads, prompts, transcripts, tool calls, file contents, or credentials. Stop on command errors and report the bounded stderr message; do not inspect an event stream to repair it.

## Commands

```bash
node scripts/daily-agent.mjs opening --vault {VAULT}
node scripts/daily-agent.mjs project-register --vault {VAULT} --id ID --name NAME --path PATH
node scripts/daily-agent.mjs task-add --vault {VAULT} --title TITLE --priority normal --tags 科研,组会
node scripts/daily-agent.mjs task-add --vault {VAULT} --title TITLE --external-kind reminder --external-id LOCAL_ID --external-external-id SERVER_ID
node scripts/daily-agent.mjs task-transition --vault {VAULT} --id ID --status completed
node scripts/daily-agent.mjs reading-scan --vault {VAULT}
node scripts/daily-agent.mjs reading-confirm --vault {VAULT} --id ID --decision accept
node scripts/daily-agent.mjs opening-complete --vault {VAULT} --focus ID1,ID2
node scripts/daily-agent.mjs remote-sync --vault {VAULT}
node scripts/daily-agent.mjs events-normalize --vault {VAULT}
node scripts/daily-agent.mjs report-aggregate --vault {VAULT} --kind weekly --date YYYY-MM-DD  # save returned `path` as REPORT_INPUT_PATH
node scripts/daily-agent.mjs review-generate --vault {VAULT} --kind weekly --date YYYY-MM-DD --input {REPORT_INPUT_PATH}
```

For `task-add`, EventKit locator flags are a group: omit all three for an unlinked task, or supply both `--external-kind` and `--external-id`; `--external-external-id` is optional only when that required pair is present. Any partial combination is invalid and must not create a task.

All commands return one JSON value. On error, stop and report stderr; do not repair or overwrite damaged state.

## References

- Field definitions: `references/data-contracts.md`
- Conversation contract: `references/daily-opening.md`
- Remote producer, sync, and normalization protocol: `references/remote-event-protocol.md`
- Weekly/monthly aggregation and review workflow: `references/reporting.md`

## Common Mistakes

- Treating the worklog snapshot as the current task list.
- Completing the opening before the user selects focus items.
- Starting EventKit from `daily-agent.mjs`, matching by title, or importing unlinked Apple items.
- Persisting only one identifier from an EventKit create response, or treating `external_id` as cached Apple state rather than an on-demand locator.
- Treating absence from filtered list results as `REMINDER_NOT_FOUND` instead of fetching the linked ID.
- Auto-completing a cancelled task or a Reminder without `completionDate`.
- Calling `auth.request` during an ordinary `today` flow or stopping local planning when EventKit is unavailable.
- Accepting an uncertain reading candidate without confirmation.
- Turning paper reading into ordinary tasks instead of queue items.
- Copying project plans into JSON instead of linking `04-项目` Markdown.
- Reading raw or normalized event streams into Agent context.
- Running `review-generate` before the preceding sync, normalization, and aggregation steps.
