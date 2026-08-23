---
name: eventkit
description: Use when Pi handles Apple Calendar events, Apple Reminders, macOS EventKit, scheduled Todo time blocks, due-only Todos, or today's live Apple agenda.
workspace: "00-系统"
type: skill
topic: tools
status: active
---

# EventKit

Use the local EventKit bridge as the source of truth for Apple Calendar and Reminders. Invoke its Node adapter internally; do not ask the user to operate the CLI.

Read [references/protocol.md](references/protocol.md) before constructing a request or interpreting a response. Internally call:

```bash
node {SKILL_DIR}/scripts/eventkit-adapter.mjs call --json REQUEST
```

## Todo routing

Route before any write:

| User intent | Destination |
|---|---|
| Explicit start and end | Calendar event |
| Due date/time only, or no time block | Reminder |
| Ambiguous schedule versus deadline | Ask once before writing |

Ask a concrete Calendar/Reminder choice. Do not write until the answer establishes the destination.

## Mutation boundary

Create, update, delete, complete, and reopen only from an explicit user instruction. A Pi suggestion is not authorization.

- Always confirm deletion immediately before calling `calendar.delete` or `reminder.delete`.
- Update and delete by the returned EventKit `id`, never by title or time. If the identifier is missing, fetch fresh candidates and ask the user to disambiguate.
- Before changing or deleting a recurring Calendar event, ask whether the scope is `thisEvent` or `futureEvents`, then pass that `span`. Never infer the recurrence span.
- Treat permission requests as system authorization changes: inspect `auth.status`, explain the local access, and call `auth.request` only after explicit consent.

## Reads and freshness

Fetch from EventKit on every read. Do not answer from a prior response, cached DTO, or linked local task. Store identifiers only as locators, never Calendar/Reminder contents or authorization state.

For today's agenda, calculate explicit local-day boundaries with their timezone, call `calendar.list` for that interval, and call `reminder.list` with the required status. Reason over the fresh responses only after both calls return.

## Failures and local-only degradation

- A response with `success: false` is an expected protocol failure. Report its code and bounded message; do not rewrite it as success.
- On `PERMISSION_DENIED`, do not request access silently. Follow the authorization rule above.
- On `BRIDGE_NOT_FOUND`, `BRIDGE_TIMEOUT`, or `INVALID_BRIDGE_RESPONSE`, state that local Apple Calendar/Reminders access is unavailable and omit that source from the result.
- EventKit access is local macOS only. Do not substitute a remote service, a vault cache, or invented state, and never claim a write occurred after degradation. Other independent Daily Agent work may continue with the missing Apple coverage stated explicitly.

## Common mistakes

- Turning a deadline into a Calendar time block without an explicit start and end.
- Treating a title such as “Group meeting” as a unique identifier.
- Reusing an earlier list response after the user edits Calendar or Reminders directly.
- Updating a recurring event without a confirmed span.
- Showing bridge CLI mechanics as the normal user workflow.
