# Daily Opening Conversation Contract

## Exact Sequence

1. Run local `opening`; `daily-agent.mjs` never starts or calls EventKit.
2. Compute today's `[00:00, next 00:00)` bounds in the machine timezone and convert both bounds to absolute ISO 8601 timestamps.
3. Through the EventKit Skill, call `calendar.list` with those bounds.
4. Call `reminder.list` with `status: "incomplete"`, then with `status: "completed"`; keep completed results only when `completionDate` falls inside the local-day bounds.
5. Reconcile the two fresh Reminder sets against the loaded local tasks. Use only EventKit Reminder IDs from `external_ref`; never infer a match from a title, and never import an unlinked Apple item.
6. Apply every `complete` result with `task-transition --vault {VAULT} --id TASK_ID --status completed --completed-at COMPLETION_DATE`.
7. Ask before applying every local reopen with `task-transition --vault {VAULT} --id TASK_ID --status active`. A reopened Apple Reminder is evidence for a confirmation, not authorization to mutate the local task.
8. Report every broken Reminder reference by local task ID and Reminder ID. Do not repair it, search by title, or create a replacement.
9. Present local task groups, today's Calendar events, and Reminders before asking the user to choose today's 1–3 focus tasks.
10. Continue the local status, reading, and today-planning dialogue, then call `opening-complete` only after focus selection.

An ordinary `today` flow never calls `auth.request`, including after `PERMISSION_DENIED`. If Calendar or either Reminder query fails, label that source unavailable and continue the local Daily Agent flow. A Calendar failure does not suppress fresh Reminders, and a Reminders failure does not suppress fresh Calendar events.

## Opening Response Shape

Present a compact briefing in this order:

1. Overdue and due within 24 hours.
2. Other carryovers, waiting reviews, and stale items.
3. Automatic linked-Reminder completions, pending local-reopen confirmations, and broken references.
4. Today's Calendar events and Reminders, or a source-specific unavailable label.
5. Reading additions, processed items, backlog, and uncertain candidates.
6. One question asking what older work changed status.

Apart from the linked-Reminder completion rule above, do not silently infer completion. Apply only the user's stated status changes. Ask again before cancellation.

## Today Planning

After carryover review, ask what the user intends to advance. Convert clear commitments into tasks or updates, then show a proposed focus list. The user must select 1–3 active tasks before `opening-complete` runs.

## Reading Decisions

- Explicit `paper/blog` tags enroll automatically.
- URL heuristics may create candidates automatically.
- Candidate acceptance or rejection requires a user decision.
- The Agent reminds and organizes; it does not read or summarize the paper on the user's behalf.

## Repeat Opening

When today's opening is complete, return the current summary without repeating questions. Fetch any Calendar/Reminders portion fresh rather than reusing an earlier DTO. Only an explicit request such as “重新规划今天” authorizes `opening --force` and another completion snapshot.
