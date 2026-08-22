---
title: "Standalone Remote Event Producer Kit"
type: "spec"
topic: "system"
workspace: "00-系统"
created: "2026-08-22"
modified: "2026-08-22"
tags: ["daily-agent", "remote-events", "runtime"]
source: "agent"
status: "active"
---

# Standalone Remote Event Producer Kit

This directory is a copy-only kit for producing append-only `git_commit` and session-level `token_usage` NDJSON on a remote server. It does not install itself, modify Git or Agent configuration, contact another machine, or require a ThirdSpace Vault. The server needs POSIX `sh` and Node.js; the Git producer also needs Git.

The scripts record metadata and aggregate counters only. They never record diffs, file contents, conversations, commands, credentials, or environment dumps. `events.example.ndjson` contains one valid record of each type.

## Prepare a private destination

Run these commands yourself on the target server. The event path must be explicit and absolute; there is no default or Vault lookup.

```sh
install -d -m 700 /nas/users/xxxiang/person
touch /nas/users/xxxiang/person/events.ndjson
chmod 600 /nas/users/xxxiang/person/events.ndjson

install -d -m 700 "$HOME/.local/lib/thirdspace-remote-events"
install -m 700 git-post-commit.sh agent-exit-token.sh "$HOME/.local/lib/thirdspace-remote-events/"
```

Both producers require the event file's immediate parent to already be mode `0700`, or create a missing parent with that mode. They create or repair the event file to mode `0600`, reject a symlink event file, and reject a parent that is a symlink. A path directly below the filesystem root is rejected; use a dedicated private directory.

Verify permissions with either GNU or BSD/macOS `stat`:

```sh
stat -c '%a %n' /nas/users/xxxiang/person /nas/users/xxxiang/person/events.ndjson 2>/dev/null \
  || stat -f '%Lp %N' /nas/users/xxxiang/person /nas/users/xxxiang/person/events.ndjson
```

Expected modes are `700` for the directory and `600` for the file.

## Git post-commit hook

Set a safe source ID containing only letters, digits, `.`, `_`, or `-`. The producer reads the current commit with `git log -1 --format=%s` and `git show --numstat --format=`. It emits counts, the commit SHA, branch, repository name, and subject; it does not emit filenames or diff content.

Create a repository-local `.git/hooks/post-commit` wrapper yourself:

```sh
#!/bin/sh
export THIRDSPACE_EVENT_FILE=/nas/users/xxxiang/person/events.ndjson
export THIRDSPACE_SOURCE_ID=183
exec "$HOME/.local/lib/thirdspace-remote-events/git-post-commit.sh"
```

Then run `chmod 700 .git/hooks/post-commit`. The stable Git event ID is `source_id:git:full_commit_sha`, so collecting the same commit again is deduplicated by the normalizer.

## Agent Exit Token hook

The Token producer requires `source_id`, Agent name, and a stable session ID. A missing model becomes `unknown`; missing counters become JSON `null`. It accepts the following environment variables:

```text
THIRDSPACE_EVENT_FILE
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

Example environment-driven wrapper:

```sh
#!/bin/sh
export THIRDSPACE_EVENT_FILE=/nas/users/xxxiang/person/events.ndjson
export THIRDSPACE_SOURCE_ID=183
export THIRDSPACE_AGENT=codex
# The Agent integration must provide a stable ID and its final session totals.
export THIRDSPACE_SESSION_ID="$AGENT_SESSION_ID"
export THIRDSPACE_MODEL="$AGENT_MODEL"
export THIRDSPACE_INPUT_TOKENS="$AGENT_INPUT_TOKENS"
export THIRDSPACE_OUTPUT_TOKENS="$AGENT_OUTPUT_TOKENS"
export THIRDSPACE_TOTAL_TOKENS="$AGENT_TOTAL_TOKENS"
exec "$HOME/.local/lib/thirdspace-remote-events/agent-exit-token.sh"
```

Alternatively, pass one JSON object as the first argument. Canonical counters may be top-level or under `metrics` or `usage`; explicitly set environment variables take precedence.

```sh
THIRDSPACE_EVENT_FILE=/nas/users/xxxiang/person/events.ndjson \
  "$HOME/.local/lib/thirdspace-remote-events/agent-exit-token.sh" \
  '{"source_id":"183","agent":"claude","session_id":"stable-session-id","model":"example-model","metrics":{"input_tokens":1000,"output_tokens":300,"total_tokens":1300}}'
```

Codex, Claude Code, and Pi hook configuration formats vary by version. Configure each product's session/Exit hook to call one of the wrappers above after mapping its final session JSON or environment variables to these canonical fields. Do not pass transcripts, prompts, command logs, tool input, or file content. Test the wrapper directly before enabling it in an Agent.

The command portion of three generic Exit wrappers differs only by the explicit Agent label; in each case `"$payload"` is the final-session JSON supplied by that Agent's hook runner:

```sh
# Codex Exit wrapper
THIRDSPACE_AGENT=codex exec "$HOME/.local/lib/thirdspace-remote-events/agent-exit-token.sh" "$payload"

# Claude Code Exit wrapper
THIRDSPACE_AGENT=claude-code exec "$HOME/.local/lib/thirdspace-remote-events/agent-exit-token.sh" "$payload"

# Pi Exit wrapper
THIRDSPACE_AGENT=pi exec "$HOME/.local/lib/thirdspace-remote-events/agent-exit-token.sh" "$payload"
```

Each wrapper must also export the absolute `THIRDSPACE_EVENT_FILE` and its `THIRDSPACE_SOURCE_ID`. The JSON must contain `session_id`; reusing a process ID or generating a new ID during Exit retries defeats deduplication.

The Token event ID contains `source_id`, the `token` type, and a SHA-256 digest of `[source_id, agent, session_id]`. The same Agent session therefore produces the same ID on repeated Exit-hook calls; the local normalizer keeps only one. Different Agent names keep otherwise identical session IDs distinct.

## Append and concurrency behavior

Each script serializes one compact JSON object in Node.js, adds one newline, opens the file with append mode, and issues one write. This prevents shell interpolation and protects ordinary local-filesystem appends from interleaving. It is not a distributed locking protocol: NFS, SMB, unusual filesystems, very large records, or many concurrent writers may not preserve append atomicity. For those cases, serialize hook execution with a host-local lock or write one file per producer and merge them before synchronization.

The scripts are append-only and never rewrite, truncate, rotate, or upload the event file. Rotation and retention are operator responsibilities; preserve complete NDJSON lines.

## Troubleshooting

- `THIRDSPACE_EVENT_FILE must be an explicit absolute path`: export the full server path; relative paths and implicit Vault defaults are intentionally unsupported.
- `parent must have mode 0700`: run `chmod 700` on the dedicated immediate parent, then retry. Do not point the producer at `/`, `/tmp`, or a shared directory.
- `must match [A-Za-z0-9._-]+`: choose a source ID compatible with the local remote-source configuration.
- `must be a non-negative safe integer`: map the Agent's final numeric counter, or leave the field unset so it becomes `null`.
- `unable to read Git metadata`: run the Git producer from inside the committed repository after `HEAD` exists.
- Duplicate lines after a retried hook are expected. Keep the raw append-only file; stable IDs make normalization idempotent.
- To inspect shape without exposing other server data, run `tail -n 1 "$THIRDSPACE_EVENT_FILE" | node -e 'let s=""; process.stdin.on("data", b => s += b).on("end", () => JSON.parse(s))'` and check the exit status.
