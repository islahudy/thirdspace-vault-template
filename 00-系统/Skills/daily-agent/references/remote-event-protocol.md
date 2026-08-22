---
title: "Daily Agent 远端事件协议"
type: "spec"
topic: "system"
workspace: "00-系统"
created: "2026-08-22 00:00:00"
modified: "2026-08-22 00:00:00"
tags: [system, daily-agent, remote-events]
source: "agent"
status: "active"
---

# Remote Event Protocol

## Boundary

Remote hosts do not need a Vault. They run the portable assets in `00-系统/运行时/remote-events/` and append one metadata-only JSON record per line to a host-local file. The producer contract allows `git_commit` and `token_usage`; it forbids prompts, transcripts, tool calls, commands, file names or contents, credentials, and environment dumps.

The remote file is append-only. Corrections use a new event. Producers must not truncate, rotate, upload, or rewrite it. See `00-系统/运行时/remote-events/README.md` for permissions, installation, hook wrappers, and concurrency limitations.

## Local Configuration

Copy `.thirdspace/schema/remote-event-sources.example.yaml` to `.thirdspace/config/remote-event-sources.local.yaml` and edit only the local copy:

```yaml
version: "1.0"
timezone: "Asia/Shanghai"
sources:
  - source_id: "lab-server"
    ssh_host: "lab-server"
    remote_path: "/absolute/path/events.ndjson"
    enabled: true
```

`ssh_host` is an SSH config alias, not a shell command. `remote_path` must be absolute. The local config is ignored by Git and must not contain passwords, private keys, or tokens; authentication stays in the user's SSH configuration.

## Sync and Normalize

Run from the Daily Agent Skill:

```bash
node scripts/daily-agent.mjs remote-sync --vault {VAULT}
node scripts/daily-agent.mjs events-normalize --vault {VAULT}
```

`remote-sync` uses read-only SSH transport, validates each fetched NDJSON snapshot, atomically replaces `.thirdspace/events/remote/<source-id>/raw/events.ndjson`, and records per-source success or failure. A failed source preserves its prior snapshot and does not block other sources.

`events-normalize` validates supported fields, rejects malformed records, deduplicates by `source_id + event_id`, applies `project-index.json` repository mappings, and deterministically rebuilds `.thirdspace/events/normalized/YYYYMM.ndjson`. Rejection metadata goes to `.thirdspace/events/reports/normalization-errors.json` without copying rejected raw lines.

## Agent Output

Raw and normalized files are implementation inputs for these scripts, not Agent reading targets. The Agent must not open them or put their contents into model context. Report only success/failure counts, accepted/duplicate/rejected counts, generated paths, and a short bounded coverage warning. On error, stop and surface a bounded error summary without inspecting or rewriting the event stream.
