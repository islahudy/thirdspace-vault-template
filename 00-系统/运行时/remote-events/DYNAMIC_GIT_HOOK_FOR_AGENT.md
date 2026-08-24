---
title: "Dynamic Git Hook Scope Supplement"
type: "spec"
topic: "system"
workspace: "00-系统"
created: "2026-08-23"
modified: "2026-08-23"
tags: ["daily-agent", "remote-events", "git-hooks"]
source: "agent"
status: "active"
---

# Dynamic Git Hook Scope Supplement

This is a supplement to `INSTALL_FOR_AGENT.md`. It only describes the dynamic Git hook scope used for remote event collection. Do not copy the producer protocol, event schema, permissions, or Agent token hook rules from this file; those remain defined by `INSTALL_FOR_AGENT.md` and `README.md`.

## Goal

Do not maintain a fixed list of repositories. Install one user-level Git hook entry point on the current server, then decide at commit time whether the current repository belongs to `islahudy`.

This makes newly cloned repositories work automatically once their remote points at the user's GitHub owner.

## Scope Rule

A repository is in scope only when at least one configured remote URL matches owner `islahudy`.

Accepted URL shapes:

```text
git@github.com:islahudy/*
ssh://git@github.com/islahudy/*
https://github.com/islahudy/*
http://github.com/islahudy/*
git://github.com/islahudy/*
```

The hook must read local Git config only. Do not run `git fetch`, `git ls-remote`, `gh`, `curl`, SSH, or any command that connects to another machine.

## Why Not Fixed Repository Hooks

Per-repository `.git/hooks/post-commit` installation only covers repositories known at install time. It misses repositories cloned later, and it forces future maintenance.

The dynamic approach uses:

```sh
git config --global core.hooksPath "$HOME/.local/lib/thirdspace-remote-events/git-hooks"
```

Git then runs the same `post-commit` hook for all repositories used by this Unix account. The hook exits without writing anything unless the local remote URL owner is `islahudy`.

## Commit-Time Decision

The global `post-commit` hook should implement this sequence:

1. Read `git remote -v`.
2. Extract remote URLs.
3. Match URLs against the owner patterns above.
4. If no match, exit `0` without writing an event.
5. If matched, call the installed `git-post-commit.sh` producer with:

```sh
THIRDSPACE_EVENT_FILE=/nas/users/xxxiang/person/events.ndjson
THIRDSPACE_SOURCE_ID=183
```

The producer remains responsible for JSON shape and Git metadata. The dynamic hook is only a scope gate.

## Existing Hooks

Before setting `core.hooksPath`, check the existing global value:

```sh
git config --global --show-origin --get core.hooksPath
```

If it already exists, back up the owning config file and either:

- merge the existing global hook behavior into the new hook path, or
- stop and ask the user if the behavior cannot be safely chained.

Because a global `core.hooksPath` bypasses repository-local `.git/hooks`, the dynamic `post-commit` hook should also look for an executable `.git/hooks/post-commit` in the current repository and run it first. Use a guard environment variable such as `THIRDSPACE_SKIP_LOCAL_POST_COMMIT=1` to avoid recursion.

Do not overwrite or discard an existing hook silently.

## Push Is Not The Trigger

Do not use "after successful push" as the default decision point.

Git has a standard `pre-push` hook, but no standard `post-push` hook. Implementing a reliable "after push success" trigger requires wrapping the `git` command itself, which is more invasive and can change normal Git behavior. The safer default is commit-time collection plus local remote-owner filtering.

## Verification

On each server, verify both sides of the filter with local-only test repositories:

1. Create a temporary repository with remote `https://github.com/islahudy/thirdspace-hook-test.git`.
2. Make a harmless local commit and confirm exactly one `git_commit` event was appended.
3. Create a second temporary repository with a non-`islahudy` remote.
4. Make a harmless local commit and confirm no new `git_commit` event was appended.

The positive event must not contain filenames, diff content, file bodies, credentials, commands, or environment dumps.

## Installed Shape On This Server

This server uses:

```text
core.hooksPath = ~/.local/lib/thirdspace-remote-events/git-hooks
post-commit   = ~/.local/lib/thirdspace-remote-events/git-hooks/post-commit
producer      = ~/.local/lib/thirdspace-remote-events/git-post-commit.sh
event file    = /nas/users/xxxiang/person/events.ndjson
source id     = 183
owner filter  = islahudy
```

Use the same shape on other servers unless the user explicitly chooses a different `source_id` or event file path.
