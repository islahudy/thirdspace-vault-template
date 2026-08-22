---
title: "Daily Agent 数据契约"
type: "spec"
topic: "system"
workspace: "00-系统"
created: "2026-08-22 00:00:00"
modified: "2026-08-22 00:00:00"
tags: [system, daily-agent, data-contracts]
source: "agent"
status: "active"
---

# Daily Agent Data Contracts

## State Files

Every file contains `version: "1.0"`, an integer `revision`, and `updated_at`. Writers compare the current revision and atomically replace the file.

| File | Collection | Purpose |
|---|---|---|
| `tasks.json` | `tasks` | Ordinary and project-linked tasks |
| `reading-queue.json` | `items`, `candidates`, `dismissed_source_paths` | Paper/blog queue and candidate decisions |
| `project-index.json` | `projects` | Links to existing `04-项目` directories |
| `agent-state.json` | `pending_confirmations` | Opening/report/sync recovery points |

## Task

Required: `id`, `title`, `status`, `priority`, `tags`, `created_at`, `updated_at`, `source`.

- Status: `inbox | active | waiting | completed | cancelled`
- Priority: `critical | high | normal | low`
- Optional: `due`, `review_after`, `project_id`, `completed_at`
- `project_id` must resolve in `project-index.json`.
- Cancellation requires explicit confirmation.

## Reading Item

Required: `id`, `kind`, `title`, `source_path`, `status`, `tags`, `added_at`.

- Kind: `paper | blog`
- Status: `pending | reading | processed | skipped`
- `source_path` is the reconciliation key.
- Optional: `url`, `processed_at`, `output_path`.
- Rejected candidate paths stay in `dismissed_source_paths`.

## Project Index

Required: `id`, `name`, `path`, `status`, `stage`, `repo_mappings`. `path` must resolve under `04-项目`. Project goals, plans, milestones, and progress remain in Markdown.

## Event

Required: `schema_version`, `event_id`, `timestamp`, `event_type`, `source_id`, `subject_id`. Events append to `.thirdspace/events/local/YYYYMMDD.ndjson`; corrections are new events, never rewrites.

Remote producers append only `git_commit` and `token_usage` records. `remote-sync` replaces the local raw snapshot at `.thirdspace/events/remote/<source-id>/raw/events.ndjson`; `events-normalize` validates, deduplicates by `source_id + event_id`, applies repository mappings, and rebuilds `.thirdspace/events/normalized/YYYYMM.ndjson`.

Raw and normalized NDJSON are private script inputs. They are never Agent reading targets and must not be copied into prompts, chat responses, reports, or worklogs.

## Report Input

`report-aggregate` writes a bounded `version: "1.0"` object under `.thirdspace/data/daily-agent/report-input/<period-id>.json`. It contains only the period, aggregate Git/Token metrics, projected task/reading/project fields, and coverage counts. It excludes raw lines, file contents, prompts, transcripts, and arbitrary event fields.

Report inputs are generated local state and remain ignored by Git. The Agent consumes only the CLI-returned path and bounded summary, then passes that exact path to `review-generate --input <path>`; the generator reads the saved report input as a script implementation detail without reaggregation.

See `remote-event-protocol.md` for producer and normalization rules, and `reporting.md` for weekly/monthly generation.
