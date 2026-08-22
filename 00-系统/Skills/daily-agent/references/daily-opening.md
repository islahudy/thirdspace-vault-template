# Daily Opening Conversation Contract

## Opening Response Shape

Present a compact briefing in this order:

1. Overdue and due within 24 hours.
2. Other carryovers, waiting reviews, and stale items.
3. Reading additions, processed items, backlog, and uncertain candidates.
4. One question asking what older work changed status.

Do not silently infer completion. Apply only the user's stated status changes. Ask again before cancellation.

## Today Planning

After carryover review, ask what the user intends to advance. Convert clear commitments into tasks or updates, then show a proposed focus list. The user must select 1–3 active tasks before `opening-complete` runs.

## Reading Decisions

- Explicit `paper/blog` tags enroll automatically.
- URL heuristics may create candidates automatically.
- Candidate acceptance or rejection requires a user decision.
- The Agent reminds and organizes; it does not read or summarize the paper on the user's behalf.

## Repeat Opening

When today's opening is complete, return the current summary without repeating questions. Only an explicit request such as “重新规划今天” authorizes `opening --force` and another completion snapshot.
