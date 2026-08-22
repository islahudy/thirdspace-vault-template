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
