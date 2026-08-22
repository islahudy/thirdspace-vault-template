---
title: "Daily Agent 周报月报流程"
type: "spec"
topic: "system"
workspace: "00-系统"
created: "2026-08-22 00:00:00"
modified: "2026-08-22 00:00:00"
tags: [system, daily-agent, reporting]
source: "agent"
status: "active"
---

# Weekly and Monthly Reporting

## Required Flow

For remote synchronization and both review kinds, execute the complete flow in this order:

```text
remote-sync -> events-normalize -> report-aggregate -> review-generate
```

Example weekly run:

```bash
node scripts/daily-agent.mjs remote-sync --vault {VAULT}
node scripts/daily-agent.mjs events-normalize --vault {VAULT}
node scripts/daily-agent.mjs report-aggregate --vault {VAULT} --kind weekly --date YYYY-MM-DD  # save returned `path` as REPORT_INPUT_PATH
node scripts/daily-agent.mjs review-generate --vault {VAULT} --kind weekly --date YYYY-MM-DD --input {REPORT_INPUT_PATH}
```

Use the exact `path` returned by `report-aggregate` as `REPORT_INPUT_PATH`; do not run aggregation again inside the review step. Use `monthly` for both report commands to generate a monthly review. `report-aggregate` also supports a bounded custom interval with `--start YYYY-MM-DD --end YYYY-MM-DD`; `review-generate` accepts only `weekly` or `monthly`.

## Script Data Plane

`report-aggregate` reads normalized events and the four Daily Agent state files inside the script. It writes `.thirdspace/data/daily-agent/report-input/<period-id>.json`, containing projected fields, aggregate metrics, and coverage counts only. Raw event records, raw lines, arbitrary event fields, and private task/reading fields are excluded.

`review-generate --input <path>` reads that exact bounded input and updates only the managed block in `02-日记/复盘/`. User text outside the managed markers is preserved. Weekly and monthly runs update only their matching timestamp in `agent-state.json`.

Neither raw/normalized NDJSON nor saved report-input JSON is an Agent reading target. The Agent orchestrates the commands and uses their return values; scripts own file parsing.

## User-Facing Result

Print only:

- sync and normalization counts, plus generated paths;
- the aggregate-input and Markdown paths;
- the bounded aggregate totals: commits, Token sessions, completed tasks, and processed readings;
- a concise bounded coverage warning for failed sources, rejected records, or no included event source.

Do not print event records, evidence payloads, prompts, transcripts, file contents, or credentials. A source failure is unknown coverage, never zero activity.

## Output Contract

Weekly periods use Monday inclusive through the following Monday exclusive in the configured timezone. Monthly periods use the calendar month. Generated filenames follow `YYYYMMDD_周报_<period>.md` or `YYYYMMDD_月报_<period>.md` under `02-日记/复盘/` and include valid ThirdSpace frontmatter.
