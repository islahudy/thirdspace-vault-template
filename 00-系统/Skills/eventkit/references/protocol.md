---
workspace: "00-系统"
type: spec
topic: dev
status: active
---

# EventKit Bridge Protocol

The bridge accepts one UTF-8 JSON request on stdin, reads to EOF, and writes exactly one JSON response plus a newline to stdout. Diagnostics belong on stderr. Every request includes an `action` string and a `params` object, including actions with no parameters:

```json
{"action":"auth.status","params":{}}
```

All timestamps are absolute ISO 8601 strings with an explicit `Z` or numeric offset, for example `2026-08-23T14:00:00+08:00`. Natural-language dates are invalid. For all-day events, set `allDay: true` and still send absolute `start` and `end` instants; `end` must be later than `start`.

## Actions

`Required` lists fields that must be present inside `params`. All other listed fields are optional.

| Action | Required | Optional | Success `data` |
|---|---|---|---|
| `auth.status` | none | none | `AuthorizationSnapshot` |
| `auth.request` | none | none | `AuthorizationSnapshot` |
| `calendar.calendars` | none | none | `CalendarDTO[]` |
| `calendar.list` | `start`, `end` | `calendarIDs: string[]` | `EventDTO[]`, ordered by start |
| `calendar.get` | `id` | none | `EventDTO` |
| `calendar.create` | `title`, `start`, `end` | `allDay`, `calendarID`, `location`, `notes`, `url`, `availability` | created `EventDTO` |
| `calendar.update` | `id` | `title`, `start`, `end`, `allDay`, `calendarID`, `location`, `notes`, `url`, `availability`, `span` | updated `EventDTO` |
| `calendar.delete` | `id` | `span` | `{ "deleted": true }` |
| `reminder.lists` | none | none | `CalendarDTO[]` |
| `reminder.list` | none | `status`, `listIDs: string[]` | `ReminderDTO[]` |
| `reminder.get` | `id` | none | `ReminderDTO` |
| `reminder.create` | `title` | `listID`, `startDate`, `dueDate`, `priority`, `notes` | created `ReminderDTO` |
| `reminder.update` | `id` | `title`, `listID`, `startDate`, `dueDate`, `priority`, `notes` | updated `ReminderDTO` |
| `reminder.delete` | `id` | none | `{ "deleted": true }` |
| `reminder.complete` | `id` | none | completed `ReminderDTO` |
| `reminder.reopen` | `id` | none | reopened `ReminderDTO` |

Field constraints and defaults:

- `id`, `title`, `start`, and `end` required fields are non-empty strings.
- `allDay` is boolean and defaults to `false` on create.
- `url` is an absolute URL with a scheme.
- `availability` is `notSupported`, `free`, `busy`, `tentative`, or `unavailable`; create defaults to `busy`.
- `span` is `thisEvent` or `futureEvents`. It is required by behavior, even though syntactically optional, when updating or deleting a recurring event.
- `status` is `all`, `incomplete`, or `completed`; it defaults to `all`.
- `startDate` and `dueDate` use the same absolute timestamp format as Calendar fields.
- `priority` is an integer and defaults to `0` on create.
- Omitted or `null` optional update fields leave existing values unchanged; the current protocol does not use `null` to clear a field.
- An omitted `calendarID` or `listID` selects the current item location on update, or the system default on create.

## DTOs

### `AuthorizationSnapshot`

```json
{
  "calendar": "fullAccess",
  "reminders": "notDetermined"
}
```

Each state is one of `notDetermined`, `restricted`, `denied`, `writeOnly`, or `fullAccess`.

### `CalendarDTO`

Calendar collections and Reminder lists share this shape:

```json
{
  "id": "CAL-1",
  "title": "Research",
  "writable": true
}
```

### `EventDTO`

```json
{
  "id": "EVT-1",
  "title": "Group meeting",
  "start": "2026-08-23T02:00:00Z",
  "end": "2026-08-23T03:00:00Z",
  "allDay": false,
  "calendar": { "id": "CAL-1", "title": "Research", "writable": true },
  "location": "Room 2",
  "notes": "Weekly sync",
  "url": "https://example.com/meeting",
  "availability": "busy",
  "recurring": false
}
```

`location`, `notes`, and `url` are omitted when unavailable. Returned timestamps are normalized ISO 8601 instants, commonly using `Z`.

### `ReminderDTO`

```json
{
  "id": "REM-1",
  "title": "Read paper",
  "list": { "id": "LIST-1", "title": "Research", "writable": true },
  "completed": false,
  "completionDate": "2026-08-23T04:00:00Z",
  "startDate": "2026-08-22T00:00:00Z",
  "dueDate": "2026-08-25T15:59:00Z",
  "priority": 5,
  "notes": "Focus on section 4"
}
```

`completionDate`, `startDate`, `dueDate`, and `notes` are omitted when unavailable. Completing a Reminder lets EventKit set its completion timestamp; reopening clears it.

## Responses and errors

Success:

```json
{"success":true,"data":{"deleted":true}}
```

Protocol failure:

```json
{
  "success": false,
  "error": {
    "code": "PERMISSION_DENIED",
    "message": "Full access to calendar is required. Run auth.request explicitly.",
    "details": { "resource": "calendar" }
  }
}
```

`error.details` is optional. Bridge protocol error codes are:

| Code | Meaning |
|---|---|
| `PERMISSION_DENIED` | Full access is unavailable for the requested resource. |
| `EVENT_NOT_FOUND` | No Calendar event matches the identifier. |
| `REMINDER_NOT_FOUND` | No Reminder matches the identifier. |
| `CALENDAR_NOT_FOUND` | The requested/default Calendar is unavailable. |
| `REMINDER_LIST_NOT_FOUND` | The requested/default Reminder list is unavailable. |
| `INVALID_DATE` | A timestamp is malformed or lacks an explicit timezone. |
| `INVALID_DATE_RANGE` | Calendar `end` is not later than `start`. |
| `RECURRING_EVENT_REQUIRES_SPAN` | A recurring update/delete omitted `span`. |
| `READ_ONLY_CALENDAR` | The target Calendar or Reminder list is not writable. |
| `SAVE_FAILED` | EventKit could not save the item. |
| `DELETE_FAILED` | EventKit could not delete the item. |
| `EVENTKIT_ERROR` | An unexpected EventKit operation failed. |
| `INVALID_REQUEST` | The action, `params`, field type, or enum value is invalid. |

The Node adapter resolves protocol failures unchanged; callers must inspect `response.success`. Before a protocol response exists, `callEventKit` rejects with an `EventKitAdapterError` whose `code` is:

| Code | Meaning |
|---|---|
| `BRIDGE_NOT_FOUND` | The configured/default executable does not exist. |
| `BRIDGE_TIMEOUT` | The child exceeded its bounded runtime and was killed. |
| `INVALID_BRIDGE_RESPONSE` | Spawn, exit status, output size, JSON, or response-shape validation failed. |

The adapter executable is selected from `THIRDSPACE_EVENTKIT_BRIDGE`, then `scripts/eventkit-bridge/.build/release/eventkit-bridge` relative to this Skill.
