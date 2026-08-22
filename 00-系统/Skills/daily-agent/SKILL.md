---
name: daily-agent
description: Use when the user starts the day, reviews remaining work, manages priorities or deadlines, checks paper/blog reading backlog, chooses today’s focus, synchronizes remote records, or generates weekly/monthly reviews.
---

# Daily Agent

## Overview

Operate ThirdSpace as a personal research-management assistant. Current state lives in `.thirdspace/data/daily-agent/`; worklogs are snapshots, never the task source of truth.

## Required Load Order

1. Resolve the Vault and read `.thirdspace/schema/daily-agent.yaml`.
2. Read the four state files under `.thirdspace/data/daily-agent/`.
3. Load `workspace-journal`; load `workspace-inbox`, `workspace-projects`, `worklog`, or `review` only when that part of the request is active.
4. Use `scripts/daily-agent.mjs` for state changes.

## Daily Opening

Run this sequence in order:

1. Call `opening` and present overdue, due-soon, upcoming, stale, waiting, and active items.
2. Ask which older items are completed, waiting, or cancelled.
3. Apply confirmed transitions. Cancellation always requires explicit confirmation.
4. Present reading additions, processed items, and candidates discovered by the opening scan.
5. Ask what the user will advance today; create or update tasks from their answer.
6. Ask the user to select 1–3 active focus tasks.
7. Only after selection, call `opening-complete`.

If `opening` returns `required: false`, do not repeat the flow unless the user explicitly asks to re-plan; then pass `--force`.

## Permission Boundary

| Action | Rule |
|---|---|
| Create/update tasks, confirm completion, enroll explicit `paper/blog`, write plan snapshot | Automatic |
| Detect an uncertain reading candidate | Automatic discovery only |
| Accept/reject a candidate, cancel a task, change project stage, move/archive/publish | Ask first |
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
node scripts/daily-agent.mjs task-transition --vault {VAULT} --id ID --status completed
node scripts/daily-agent.mjs reading-scan --vault {VAULT}
node scripts/daily-agent.mjs reading-confirm --vault {VAULT} --id ID --decision accept
node scripts/daily-agent.mjs opening-complete --vault {VAULT} --focus ID1,ID2
node scripts/daily-agent.mjs remote-sync --vault {VAULT}
node scripts/daily-agent.mjs events-normalize --vault {VAULT}
node scripts/daily-agent.mjs report-aggregate --vault {VAULT} --kind weekly --date YYYY-MM-DD
node scripts/daily-agent.mjs review-generate --vault {VAULT} --kind weekly --date YYYY-MM-DD
```

All commands return one JSON value. On error, stop and report stderr; do not repair or overwrite damaged state.

## References

- Field definitions: `references/data-contracts.md`
- Conversation contract: `references/daily-opening.md`
- Remote producer, sync, and normalization protocol: `references/remote-event-protocol.md`
- Weekly/monthly aggregation and review workflow: `references/reporting.md`

## Common Mistakes

- Treating the worklog snapshot as the current task list.
- Completing the opening before the user selects focus items.
- Accepting an uncertain reading candidate without confirmation.
- Turning paper reading into ordinary tasks instead of queue items.
- Copying project plans into JSON instead of linking `04-项目` Markdown.
- Reading raw or normalized event streams into Agent context.
- Running `review-generate` before the preceding sync, normalization, and aggregation steps.
