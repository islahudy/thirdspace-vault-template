---
title: "Pi 日常管理 Agent EventKit 集成实施计划"
type: "roadmap"
topic: "system"
workspace: "00-系统"
created: "2026-08-22 00:00:00"
modified: "2026-08-23 15:30:00"
tags: ["system", "roadmap", "pi-agent", "eventkit", "implementation-plan"]
source: "agent"
status: "draft"
---

# Pi Daily Agent EventKit Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Pi Agent Skill backed by a Swift EventKit CLI so `today` can read current Calendar/Reminders data and explicit Todo commands can safely create, edit, complete, reopen, or delete Apple items.

**Architecture:** Keep the existing Daily Agent data plane platform-independent. Add a standalone Swift CLI under the `eventkit` Skill, wrap it with a Node adapter, and let Pi orchestrate `daily-agent opening` plus fresh EventKit queries. Store an optional local EventKit identifier and secondary external identifier on linked tasks; attach them only after Apple save succeeds, use the external identifier solely as an ambiguity-safe fallback, bound completed Reminder fetches in EventKit, and never cache EventKit objects or run a background synchronizer.

**Tech Stack:** Swift 6 / Swift Package Manager, macOS 14+ EventKit, Node.js ESM, `node:test`, Swift Testing/XCTest, YAML and Markdown control-plane contracts.

**Spec:** `00-系统/规范/18_Pi日常管理Agent_EventKit集成设计.md`

## Global Constraints

- Runtime target is Pi Agent on macOS, not Codex.
- EventKit is the Apple-side source of truth: every query fetches again and every mutation saves directly.
- Do not add a daemon, HTTP server, GUI, SQLite database, background synchronization, object cache, or natural-language parser.
- `eventkit-bridge` stdout contains exactly one JSON response; diagnostics go to stderr.
- All Bridge time inputs are absolute ISO 8601 values with an explicit timezone.
- Calendar and Reminder mutations require an explicit user instruction; deletion always requires confirmation.
- Recurring Calendar updates/deletes require `thisEvent` or `futureEvents`.
- EventKit failure degrades `today` to the existing local opening instead of failing it.
- Apple create follows `create/update local task -> save Apple item -> task-link-eventkit`; Apple failure leaves the local task unlinked.
- Completed Reminder reads for Daily Opening pass the exact absolute local-day range into EventKit's completed predicate.
- Do not store secrets, TCC authorization state, Calendar contents, Reminder contents, or compiled binaries in the vault.
- Use `apply_patch` for source edits, TDD for each behavior change, and commit only the files named by each task.

## Planned File Structure

```text
00-系统/Skills/eventkit/
├── SKILL.md                              # Pi triggers, routing, confirmation, and degradation rules
├── references/protocol.md                # Stable JSON actions, DTOs, and error codes
├── scripts/eventkit-adapter.mjs          # Spawn/timeout/JSON validation boundary
├── scripts/build-bridge.sh               # Reproducible local release build
├── scripts/eventkit-bridge/
│   ├── Package.swift                     # macOS executable and test targets
│   ├── Info.plist                        # EventKit TCC usage strings embedded at link time
│   ├── Sources/EventKitBridge/
│   │   ├── main.swift                    # stdin request → dispatcher → stdout response
│   │   ├── Protocol.swift                # Codable request/response/error DTOs
│   │   ├── DateCodec.swift               # ISO 8601 and all-day conversion
│   │   ├── EventStoreClient.swift        # EventKit-facing protocol and live implementation
│   │   ├── PermissionService.swift       # authorization status/request
│   │   ├── CalendarService.swift         # event lists and CRUD
│   │   ├── ReminderService.swift         # reminder lists, CRUD, complete/reopen
│   │   └── Dispatcher.swift              # action validation and service routing
│   └── Tests/EventKitBridgeTests/
│       ├── ProtocolTests.swift
│       ├── DateCodecTests.swift
│       ├── CalendarServiceTests.swift
│       ├── ReminderServiceTests.swift
│       └── DispatcherTests.swift
└── tests/
    ├── fixtures/fake-bridge.mjs           # deterministic child process for adapter tests
    └── eventkit-adapter.test.mjs

00-系统/Skills/daily-agent/
├── SKILL.md
├── references/data-contracts.md
├── references/daily-opening.md
├── scripts/lib/external-items.mjs         # pure local/Reminder association decisions
└── tests/daily-agent.test.mjs

.thirdspace/schema/daily-agent.yaml
.thirdspace/schema/workspace-tools.yaml
00-系统/Agent/README.md
00-系统/运行时/README.md
00-系统/运行时/manifest.yaml
```

---

### Task 1: Extend the local task contract for EventKit references

**Files:**
- Modify: `00-系统/Skills/daily-agent/tests/daily-agent.test.mjs`
- Modify: `00-系统/Skills/daily-agent/scripts/lib/tasks.mjs`
- Modify: `00-系统/Skills/daily-agent/scripts/daily-agent.mjs`
- Modify: `00-系统/Skills/daily-agent/references/data-contracts.md`
- Modify: `.thirdspace/schema/daily-agent.yaml`

**Interfaces:**
- Produces: `ExternalRef = { provider: "eventkit", kind: "calendar" | "reminder", id: string, external_id?: string }`.
- Produces: backward-compatible `task-add` locator flags plus `task-link-eventkit --id TASK_ID --external-kind KIND --external-id LOCAL_ID [--external-external-id SERVER_ID]` for post-save attachment or replacement.
- Produces: `task-transition --completed-at ISO8601` for preserving EventKit completion time.

- [ ] **Step 1: Add failing task contract tests**

Add tests that create one linked task and reject malformed links:

```js
test("task creation stores a validated EventKit reference", () => {
  const root = fixtureVault();
  const context = testContext(root);
  const task = createTask(context, {
    title: "Submit report",
    external_ref: { provider: "eventkit", kind: "reminder", id: "REM-1" },
  });
  assert.deepEqual(task.external_ref, {
    provider: "eventkit", kind: "reminder", id: "REM-1",
  });
});

test("task creation rejects incomplete EventKit references", () => {
  const root = fixtureVault();
  assert.throws(
    () => createTask(testContext(root), {
      title: "Broken", external_ref: { provider: "eventkit", kind: "reminder", id: "" },
    }),
    /invalid external_ref/,
  );
});

test("completion accepts the EventKit completion timestamp", () => {
  const root = fixtureVault();
  const context = testContext(root);
  const task = createTask(context, { title: "Linked" });
  const completed = transitionTask(context, task.id, "completed", {
    completed_at: "2026-08-22T08:30:00+08:00",
  });
  assert.equal(completed.completed_at, "2026-08-22T08:30:00+08:00");
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
node --test --test-name-pattern="EventKit reference|completion timestamp" 00-系统/Skills/daily-agent/tests/daily-agent.test.mjs
```

Expected: FAIL because `createTask` ignores `external_ref` and `transitionTask` ignores `completed_at`.

- [ ] **Step 3: Implement validation and CLI plumbing**

Add a focused validator to `tasks.mjs`:

```js
function normalizeExternalRef(value) {
  if (value == null) return undefined;
  if (value.provider !== "eventkit"
      || !new Set(["calendar", "reminder"]).has(value.kind)
      || typeof value.id !== "string"
      || value.id.trim() === "") {
    throw new Error("invalid external_ref");
  }
  return { provider: "eventkit", kind: value.kind, id: value.id.trim() };
}
```

Persist the normalized value only when present. When completing, use `options.completed_at || context.now`; reject `completed_at` unless `Date.parse(value)` is finite. In `daily-agent.mjs`, construct the reference only when both `--external-kind` and `--external-id` are present and pass `--completed-at` through task transitions.

- [ ] **Step 4: Document the exact field in both contracts**

Add this optional task field to `data-contracts.md` and `.thirdspace/schema/daily-agent.yaml`:

```yaml
external_ref:
  provider_values: [eventkit]
  kind_values: [calendar, reminder]
  required_fields: [provider, kind, id]
```

State explicitly that it is a locator, not cached Apple state.

- [ ] **Step 5: Run the Daily Agent suite**

Run:

```bash
node --test 00-系统/Skills/daily-agent/tests/daily-agent.test.mjs
```

Expected: all tests PASS.

- [ ] **Step 6: Commit the task contract**

```bash
git add .thirdspace/schema/daily-agent.yaml \
  00-系统/Skills/daily-agent/scripts/daily-agent.mjs \
  00-系统/Skills/daily-agent/scripts/lib/tasks.mjs \
  00-系统/Skills/daily-agent/tests/daily-agent.test.mjs \
  00-系统/Skills/daily-agent/references/data-contracts.md
git commit -m "feat: add EventKit references to daily tasks"
```

---

### Task 2: Create the Swift JSON protocol and date boundary

**Files:**
- Create: `00-系统/Skills/eventkit/scripts/eventkit-bridge/Package.swift`
- Create: `00-系统/Skills/eventkit/scripts/eventkit-bridge/Info.plist`
- Create: `00-系统/Skills/eventkit/scripts/eventkit-bridge/Sources/EventKitBridge/Protocol.swift`
- Create: `00-系统/Skills/eventkit/scripts/eventkit-bridge/Sources/EventKitBridge/DateCodec.swift`
- Create: `00-系统/Skills/eventkit/scripts/eventkit-bridge/Tests/EventKitBridgeTests/ProtocolTests.swift`
- Create: `00-系统/Skills/eventkit/scripts/eventkit-bridge/Tests/EventKitBridgeTests/DateCodecTests.swift`

**Interfaces:**
- Produces: `BridgeRequest { action: String, params: JSONValue? }`.
- Produces: `BridgeResponse.success(Encodable)` and `BridgeResponse.failure(BridgeError)`.
- Produces: `BridgeErrorCode` containing every code from the design spec.
- Produces: `DateCodec.parseInstant(_:)`, `DateCodec.formatInstant(_:)`, and all-day component helpers.

- [ ] **Step 1: Scaffold the Swift package with test targets**

Set `.macOS(.v14)` and create one executable target plus one test target. Embed `Info.plist` at link time so the CLI executable owns the TCC usage descriptions:

```swift
// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "eventkit-bridge",
  platforms: [.macOS(.v14)],
  products: [.executable(name: "eventkit-bridge", targets: ["EventKitBridge"])],
  targets: [
    .executableTarget(
      name: "EventKitBridge",
      linkerSettings: [.unsafeFlags([
        "-Xlinker", "-sectcreate", "-Xlinker", "__TEXT", "-Xlinker", "__info_plist",
        "-Xlinker", "Info.plist",
      ])]
    ),
    .testTarget(name: "EventKitBridgeTests", dependencies: ["EventKitBridge"]),
  ]
)
```

Before accepting this linker path, run `swift build` from the package directory. If SwiftPM resolves `Info.plist` relative to the package root differently, use the verified package-relative path and assert the final binary with `otool -s __TEXT __info_plist .build/debug/eventkit-bridge`.

- [ ] **Step 2: Write failing protocol and date tests**

Cover request decoding, success/error encoding, timezone-required input, invalid input, and an all-day date round trip:

```swift
@Test func rejectsTimestampWithoutTimezone() throws {
  #expect(throws: BridgeFailure.self) {
    try DateCodec.parseInstant("2026-08-22T10:00:00")
  }
}

@Test func errorResponseUsesStableShape() throws {
  let response = BridgeResponse.failure(.init(code: .invalidDate, message: "bad date"))
  let object = try JSONSerialization.jsonObject(with: JSONEncoder().encode(response)) as! [String: Any]
  #expect(object["success"] as? Bool == false)
  #expect((object["error"] as? [String: Any])?["code"] as? String == "INVALID_DATE")
}
```

- [ ] **Step 3: Run tests and verify RED**

Run:

```bash
cd 00-系统/Skills/eventkit/scripts/eventkit-bridge
swift test
```

Expected: FAIL because the protocol and date types do not exist.

- [ ] **Step 4: Implement minimal Codable protocol types**

Define `JSONValue`, `BridgeRequest`, `BridgeResponse`, `BridgeError`, `BridgeFailure`, and this exact raw-string enum:

```swift
enum BridgeErrorCode: String, Codable {
  case permissionDenied = "PERMISSION_DENIED"
  case eventNotFound = "EVENT_NOT_FOUND"
  case reminderNotFound = "REMINDER_NOT_FOUND"
  case calendarNotFound = "CALENDAR_NOT_FOUND"
  case reminderListNotFound = "REMINDER_LIST_NOT_FOUND"
  case invalidDate = "INVALID_DATE"
  case invalidDateRange = "INVALID_DATE_RANGE"
  case recurringEventRequiresSpan = "RECURRING_EVENT_REQUIRES_SPAN"
  case readOnlyCalendar = "READ_ONLY_CALENDAR"
  case saveFailed = "SAVE_FAILED"
  case deleteFailed = "DELETE_FAILED"
  case eventKitError = "EVENTKIT_ERROR"
  case invalidRequest = "INVALID_REQUEST"
}
```

Use `ISO8601DateFormatter` with internet date-time options and reject inputs lacking `Z` or a terminal `±HH:MM` offset before parsing.

- [ ] **Step 5: Add and verify the embedded usage descriptions**

`Info.plist` must contain `NSCalendarsFullAccessUsageDescription` and `NSRemindersFullAccessUsageDescription` with the strings from the design spec. Run:

```bash
swift build
otool -s __TEXT __info_plist .build/debug/eventkit-bridge
swift test
```

Expected: the plist section contains both keys and all Swift tests PASS.

- [ ] **Step 6: Commit the protocol boundary**

```bash
git add 00-系统/Skills/eventkit/scripts/eventkit-bridge
git commit -m "feat: define EventKit bridge protocol"
```

---

### Task 3: Implement Calendar service behavior behind a testable store protocol

**Files:**
- Create: `00-系统/Skills/eventkit/scripts/eventkit-bridge/Sources/EventKitBridge/EventStoreClient.swift`
- Create: `00-系统/Skills/eventkit/scripts/eventkit-bridge/Sources/EventKitBridge/CalendarService.swift`
- Create: `00-系统/Skills/eventkit/scripts/eventkit-bridge/Tests/EventKitBridgeTests/CalendarServiceTests.swift`

**Interfaces:**
- Consumes: `BridgeFailure`, `BridgeErrorCode`, and `DateCodec` from Task 2.
- Produces: `EventStoreClient` methods for calendars, event range fetch, identifier lookup, save, and remove.
- Produces: `CalendarService.list`, `.get`, `.create`, `.update`, and `.delete`.
- Produces: `EventDTO`, `CalendarDTO`, `CalendarCreateRequest`, and `CalendarUpdateRequest`.

- [ ] **Step 1: Write a fake store and failing Calendar tests**

Tests must prove:

- list sorts by start date even when the fake store returns reverse order;
- create uses the requested writable calendar or the default calendar;
- invalid `end <= start` returns `INVALID_DATE_RANGE`;
- update and delete use identifier lookup;
- a recurring item without span returns `RECURRING_EVENT_REQUIRES_SPAN`;
- `thisEvent` and `futureEvents` map to the corresponding EventKit span;
- a read-only target returns `READ_ONLY_CALENDAR`.

Use a fake value model rather than real user calendars:

```swift
@Test func listSortsEventsByStartDate() throws {
  let store = FakeEventStore(events: [.at("11:00"), .at("09:00")])
  let result = try CalendarService(store: store).list(
    .init(start: instant("2026-08-22T00:00:00+08:00"),
          end: instant("2026-08-23T00:00:00+08:00"), calendarIDs: nil)
  )
  #expect(result.map(\.title) == ["09:00", "11:00"])
}
```

- [ ] **Step 2: Run Calendar tests and verify RED**

Run:

```bash
swift test --filter CalendarServiceTests
```

Expected: FAIL because the store protocol and Calendar service do not exist.

- [ ] **Step 3: Implement the narrow store abstraction**

Keep EventKit types inside `LiveEventStoreClient`. Services operate on focused mutable record handles exposed by the protocol. Implement live methods with:

```swift
let predicate = store.predicateForEvents(withStart: start, end: end, calendars: calendars)
return store.events(matching: predicate)
```

Use `event(withIdentifier:)`, `save(_:span:commit: true)`, and `remove(_:span:commit: true)` for mutation. Never retain fetched handles after one request finishes.

- [ ] **Step 4: Implement Calendar DTO mapping and service validation**

Return identifier, title, start, end, all-day flag, calendar ID/title, location, notes, URL, availability, and recurrence flag. Resolve update/delete span with:

```swift
enum RecurrenceSpan: String, Codable { case thisEvent, futureEvents }
```

If `hasRecurrenceRules == true` and span is absent, throw `.recurringEventRequiresSpan` before save/remove.

- [ ] **Step 5: Run Calendar and full Swift tests**

Run:

```bash
swift test --filter CalendarServiceTests
swift test
```

Expected: all tests PASS without reading or modifying the user's calendars.

- [ ] **Step 6: Commit Calendar support**

```bash
git add 00-系统/Skills/eventkit/scripts/eventkit-bridge/Sources/EventKitBridge/EventStoreClient.swift \
  00-系统/Skills/eventkit/scripts/eventkit-bridge/Sources/EventKitBridge/CalendarService.swift \
  00-系统/Skills/eventkit/scripts/eventkit-bridge/Tests/EventKitBridgeTests/CalendarServiceTests.swift
git commit -m "feat: add EventKit calendar service"
```

---

### Task 4: Implement Reminder service and completion state

**Files:**
- Create: `00-系统/Skills/eventkit/scripts/eventkit-bridge/Sources/EventKitBridge/ReminderService.swift`
- Create: `00-系统/Skills/eventkit/scripts/eventkit-bridge/Tests/EventKitBridgeTests/ReminderServiceTests.swift`
- Modify: `00-系统/Skills/eventkit/scripts/eventkit-bridge/Sources/EventKitBridge/EventStoreClient.swift`

**Interfaces:**
- Consumes: the store and protocol boundary from Tasks 2–3.
- Produces: `ReminderService.list`, `.get`, `.create`, `.update`, `.delete`, and `.setCompleted`.
- Produces: `ReminderDTO { id, title, list, completed, completionDate, startDate, dueDate, priority, notes }`.

- [ ] **Step 1: Write failing Reminder tests**

Cover all/incomplete/completed predicates, list filtering, default list selection, identifier lookup, save/delete error mapping, completion, and reopening:

```swift
@Test func completeSetsCompletedAndReturnsLatestDTO() async throws {
  let store = FakeEventStore(reminders: [.incomplete(id: "REM-1")])
  let result = try await ReminderService(store: store)
    .setCompleted(id: "REM-1", completed: true)
  #expect(result.completed == true)
  #expect(store.savedReminderIDs == ["REM-1"])
}

@Test func missingReminderUsesStableError() async {
  let store = FakeEventStore()
  await #expect(throws: BridgeFailure.self) {
    try await ReminderService(store: store).get(id: "missing")
  }
}
```

- [ ] **Step 2: Run Reminder tests and verify RED**

Run:

```bash
swift test --filter ReminderServiceTests
```

Expected: FAIL because `ReminderService` and reminder store methods do not exist.

- [ ] **Step 3: Add async Reminder fetch methods to the store**

Wrap EventKit callback fetching in checked continuation:

```swift
func fetchReminders(matching predicate: NSPredicate) async throws -> [EKReminder] {
  try await withCheckedThrowingContinuation { continuation in
    store.fetchReminders(matching: predicate) { reminders in
      continuation.resume(returning: reminders ?? [])
    }
  }
}
```

Live predicates must use `predicateForReminders`, `predicateForIncompleteReminders`, or `predicateForCompletedReminders` according to the exact request status.

- [ ] **Step 4: Implement Reminder CRUD and completion**

Resolve lists using `calendars(for: .reminder)` and `defaultCalendarForNewReminders()`. Retrieve by `calendarItem(withIdentifier:) as? EKReminder`. For completion:

```swift
reminder.isCompleted = completed
try store.save(reminder, commit: true)
```

Return the DTO created after save so `completionDate` reflects EventKit's actual value.

- [ ] **Step 5: Run Reminder and full Swift tests**

Run:

```bash
swift test --filter ReminderServiceTests
swift test
```

Expected: all tests PASS without accessing real reminders.

- [ ] **Step 6: Commit Reminder support**

```bash
git add 00-系统/Skills/eventkit/scripts/eventkit-bridge/Sources/EventKitBridge/EventStoreClient.swift \
  00-系统/Skills/eventkit/scripts/eventkit-bridge/Sources/EventKitBridge/ReminderService.swift \
  00-系统/Skills/eventkit/scripts/eventkit-bridge/Tests/EventKitBridgeTests/ReminderServiceTests.swift
git commit -m "feat: add EventKit reminder service"
```

---

### Task 5: Add permissions, dispatch, and the executable JSON boundary

**Files:**
- Create: `00-系统/Skills/eventkit/scripts/eventkit-bridge/Sources/EventKitBridge/PermissionService.swift`
- Create: `00-系统/Skills/eventkit/scripts/eventkit-bridge/Sources/EventKitBridge/Dispatcher.swift`
- Create: `00-系统/Skills/eventkit/scripts/eventkit-bridge/Sources/EventKitBridge/main.swift`
- Create: `00-系统/Skills/eventkit/scripts/eventkit-bridge/Tests/EventKitBridgeTests/DispatcherTests.swift`

**Interfaces:**
- Consumes: service methods from Tasks 3–4.
- Produces: `BridgeDispatcher.dispatch(_ request: BridgeRequest) async -> BridgeResponse`.
- Produces: executable behavior: one stdin JSON object in, one stdout JSON object out, exit `0` for protocol success or failure responses, exit `2` only when no response can be encoded.

- [ ] **Step 1: Write failing dispatcher tests**

Add table-driven tests for every supported action:

```swift
let actions = [
  "auth.status", "auth.request",
  "calendar.calendars", "calendar.list", "calendar.get", "calendar.create",
  "calendar.update", "calendar.delete",
  "reminder.lists", "reminder.list", "reminder.get", "reminder.create",
  "reminder.update", "reminder.delete", "reminder.complete", "reminder.reopen",
]
```

Assert an unknown action returns `INVALID_REQUEST`, permission denial returns `PERMISSION_DENIED`, and service failures retain their exact error code.

- [ ] **Step 2: Run dispatcher tests and verify RED**

Run:

```bash
swift test --filter DispatcherTests
```

Expected: FAIL because dispatcher and permission services do not exist.

- [ ] **Step 3: Implement authorization behavior**

Map current statuses to `notDetermined`, `restricted`, `denied`, `writeOnly`, and `fullAccess`. `auth.request` calls:

```swift
try await eventStore.requestFullAccessToEvents()
try await eventStore.requestFullAccessToReminders()
```

Guard availability for macOS 14 and keep the package minimum at macOS 14. Ordinary data actions check access and never trigger a permission prompt themselves.

- [ ] **Step 4: Implement dispatch and executable I/O**

`main.swift` must read stdin to EOF, decode one `BridgeRequest`, await dispatch, and encode exactly one `BridgeResponse` plus a trailing newline. Catch decoding and unexpected errors and return structured failure JSON. Use `FileHandle.standardError` only for diagnostics.

- [ ] **Step 5: Verify JSON boundary and plist in the built binary**

Run:

```bash
swift test
swift build
printf '%s' '{"action":"unknown","params":{}}' | .build/debug/eventkit-bridge
otool -s __TEXT __info_plist .build/debug/eventkit-bridge
```

Expected: tests PASS; the executable prints one `INVALID_REQUEST` JSON response; the binary contains both TCC usage keys.

- [ ] **Step 6: Commit executable behavior**

```bash
git add 00-系统/Skills/eventkit/scripts/eventkit-bridge/Sources/EventKitBridge \
  00-系统/Skills/eventkit/scripts/eventkit-bridge/Tests/EventKitBridgeTests/DispatcherTests.swift
git commit -m "feat: add EventKit bridge dispatcher"
```

---

### Task 6: Build the Node adapter and Pi EventKit Skill

**Files:**
- Create: `00-系统/Skills/eventkit/tests/fixtures/fake-bridge.mjs`
- Create: `00-系统/Skills/eventkit/tests/eventkit-adapter.test.mjs`
- Create: `00-系统/Skills/eventkit/scripts/eventkit-adapter.mjs`
- Create: `00-系统/Skills/eventkit/scripts/build-bridge.sh`
- Create: `00-系统/Skills/eventkit/references/protocol.md`
- Create: `00-系统/Skills/eventkit/SKILL.md`

**Interfaces:**
- Consumes: the stdin/stdout protocol from Task 5.
- Produces: `callEventKit(request, { executable, timeoutMs }) -> Promise<BridgeResponse>`.
- Produces CLI: `node eventkit-adapter.mjs call --json REQUEST`.
- Produces Pi guidance for Todo routing and explicit-mutation confirmation.

- [ ] **Step 1: Write a deterministic fake Bridge and failing adapter tests**

The fixture accepts modes through `FAKE_BRIDGE_MODE`: `success`, `protocol-error`, `invalid-json`, `stderr`, `exit`, and `hang`. Tests must assert:

```js
test("adapter parses one successful response", async () => {
  const response = await callEventKit(
    { action: "calendar.list", params: {} },
    { executable: fixtureBridge, timeoutMs: 500 },
  );
  assert.equal(response.success, true);
});

test("adapter rejects stdout containing non-JSON logs", async () => {
  await assert.rejects(
    callWithMode("invalid-json"),
    (error) => error.code === "INVALID_BRIDGE_RESPONSE",
  );
});

test("adapter terminates a hung bridge", async () => {
  await assert.rejects(
    callWithMode("hang", { timeoutMs: 50 }),
    (error) => error.code === "BRIDGE_TIMEOUT",
  );
});
```

- [ ] **Step 2: Run adapter tests and verify RED**

Run:

```bash
node --test 00-系统/Skills/eventkit/tests/eventkit-adapter.test.mjs
```

Expected: FAIL because the adapter does not exist.

- [ ] **Step 3: Implement the adapter with bounded process behavior**

Use `spawn` with piped stdio, send one serialized request, collect bounded stdout/stderr, and kill on timeout. Default executable resolution order:

1. `THIRDSPACE_EVENTKIT_BRIDGE` environment variable.
2. `scripts/eventkit-bridge/.build/release/eventkit-bridge` relative to the Skill.

Reject responses without boolean `success`; expose `BRIDGE_NOT_FOUND`, `BRIDGE_TIMEOUT`, and `INVALID_BRIDGE_RESPONSE`. Do not print stderr content on successful responses.

- [ ] **Step 4: Add a reproducible local build script**

`build-bridge.sh` resolves its own directory, runs `swift build -c release --package-path <package>`, verifies both usage-description keys using `otool`, and prints only the final executable path. It must not copy the binary into Git-tracked paths.

- [ ] **Step 5: Write the Skill and protocol reference**

`SKILL.md` must require this Todo routing:

```text
explicit start + end → Calendar
due only or no time block → Reminder
ambiguous → ask once before writing
```

It must also require identifiers for update/delete, confirmation for deletion, span choice for recurrence, fresh fetch on every read, and local-only degradation. `protocol.md` must enumerate all actions, required params, DTOs, and error shapes without referring readers back to the design document for missing fields.

- [ ] **Step 6: Run Node and Swift suites**

Run:

```bash
node --test 00-系统/Skills/eventkit/tests/eventkit-adapter.test.mjs
swift test --package-path 00-系统/Skills/eventkit/scripts/eventkit-bridge
```

Expected: all tests PASS.

- [ ] **Step 7: Commit the Pi-facing EventKit Skill**

```bash
git add 00-系统/Skills/eventkit
git commit -m "feat: add Pi EventKit skill adapter"
```

---

### Task 7: Integrate fresh EventKit context into the Daily Opening contract

**Files:**
- Create: `00-系统/Skills/daily-agent/scripts/lib/external-items.mjs`
- Modify: `00-系统/Skills/daily-agent/tests/daily-agent.test.mjs`
- Modify: `00-系统/Skills/daily-agent/SKILL.md`
- Modify: `00-系统/Skills/daily-agent/references/daily-opening.md`
- Modify: `.thirdspace/schema/workspace-tools.yaml`
- Modify: `00-系统/Agent/README.md`

**Interfaces:**
- Consumes: `ReminderDTO` from the EventKit protocol and `ExternalRef` from Task 1.
- Produces: `classifyReminderUpdates(tasks, reminders) -> { complete, reopenConfirmations, brokenRefs }`.
- Produces: Pi sequence `opening → calendar.list → reminder.list → reconcile → user dialogue → opening-complete`.

- [ ] **Step 1: Add failing pure reconciliation tests**

Add exact cases for completion, reopen confirmation, missing IDs, and unlinked Apple items:

```js
test("linked completed reminder proposes local completion", () => {
  const result = classifyReminderUpdates(
    [{ id: "task-1", status: "active", external_ref: {
      provider: "eventkit", kind: "reminder", id: "REM-1",
    }}],
    [{ id: "REM-1", completed: true, completionDate: "2026-08-22T08:30:00+08:00" }],
  );
  assert.deepEqual(result.complete, [{
    taskId: "task-1", completedAt: "2026-08-22T08:30:00+08:00",
  }]);
});

test("reopened reminder requires confirmation", () => {
  const result = classifyReminderUpdates(
    [{ id: "task-1", status: "completed", external_ref: {
      provider: "eventkit", kind: "reminder", id: "REM-1",
    }}],
    [{ id: "REM-1", completed: false, completionDate: null }],
  );
  assert.deepEqual(result.reopenConfirmations.map(x => x.taskId), ["task-1"]);
});
```

- [ ] **Step 2: Run reconciliation tests and verify RED**

Run:

```bash
node --test --test-name-pattern="linked completed reminder|reopened reminder|broken EventKit" 00-系统/Skills/daily-agent/tests/daily-agent.test.mjs
```

Expected: FAIL because `external-items.mjs` does not exist.

- [ ] **Step 3: Implement pure classification without external I/O**

Index fetched reminders by identifier. Only inspect tasks whose `external_ref.provider` is `eventkit` and `kind` is `reminder`. Return:

```js
{
  complete: [{ taskId, completedAt }],
  reopenConfirmations: [{ taskId, reminderId }],
  brokenRefs: [{ taskId, reminderId }],
}
```

Do not mutate tasks, import unlinked reminders, or infer matches by title.

- [ ] **Step 4: Update the exact Pi opening sequence**

`daily-agent/SKILL.md` and `daily-opening.md` must say:

1. Run local `opening`.
2. Compute local-day bounds with the machine timezone and call `calendar.list` for `[00:00, next 00:00)`.
3. Call `reminder.list` for incomplete reminders without completion bounds, then call it for completed reminders with the exact absolute local-day `completionStart` and `completionEnd` so EventKit applies the bounded predicate.
4. Apply `complete` entries using `task-transition --status completed --completed-at ...`.
5. Ask before applying reopen entries; only report broken references.
6. Present Calendar events and Reminders before asking for today's 1–3 focus tasks.
7. If either EventKit query fails, label that source unavailable and continue the local flow.

Pi must not run `auth.request` automatically during `today`.

- [ ] **Step 5: Register routing and update the Agent entrypoint**

Add `eventkit` under `02-日记.domain` in `workspace-tools.yaml` with triggers including `日历`, `提醒事项`, `calendar`, `reminder`, `新增todo`, and `today`. Update `00-系统/Agent/README.md` so the daily opening explicitly loads both `daily-agent` and `eventkit` when available.

- [ ] **Step 6: Run the Daily Agent suite**

Run:

```bash
node --test 00-系统/Skills/daily-agent/tests/daily-agent.test.mjs
```

Expected: all tests PASS.

- [ ] **Step 7: Commit Daily Agent orchestration**

```bash
git add .thirdspace/schema/workspace-tools.yaml \
  00-系统/Agent/README.md \
  00-系统/Skills/daily-agent/SKILL.md \
  00-系统/Skills/daily-agent/references/daily-opening.md \
  00-系统/Skills/daily-agent/scripts/lib/external-items.mjs \
  00-系统/Skills/daily-agent/tests/daily-agent.test.mjs
git commit -m "feat: add EventKit context to daily opening"
```

---

### Task 8: Add runtime installation guidance and complete real macOS acceptance

**Files:**
- Modify: `00-系统/运行时/README.md`
- Modify: `00-系统/运行时/manifest.yaml`
- Create: `.thirdspace/reports/20260822_EventKit集成验收.md`

**Interfaces:**
- Consumes: release build script and all Bridge actions.
- Produces: reproducible install/auth instructions and a machine-specific acceptance report without private event contents.

- [ ] **Step 1: Document build, authorization, and recovery**

Add exact commands:

```bash
bash 00-系统/Skills/eventkit/scripts/build-bridge.sh
node 00-系统/Skills/eventkit/scripts/eventkit-adapter.mjs call \
  --json '{"action":"auth.status","params":{}}'
node 00-系统/Skills/eventkit/scripts/eventkit-adapter.mjs call \
  --json '{"action":"auth.request","params":{}}'
```

Explain System Settings → Privacy & Security → Calendars/Reminders recovery, the `THIRDSPACE_EVENTKIT_BRIDGE` override, and that authorization is per executable identity/path and may need renewal after rebuilding.

- [ ] **Step 2: Register the runtime asset**

Add the EventKit Skill source, local build command, permissions, and supported platform to `00-系统/运行时/manifest.yaml`. Do not register `.build/` artifacts as distributable files.

- [ ] **Step 3: Run all automated verification**

Run:

```bash
node --test 00-系统/Skills/daily-agent/tests/*.test.mjs
node --test 00-系统/Skills/eventkit/tests/*.test.mjs
swift test --package-path 00-系统/Skills/eventkit/scripts/eventkit-bridge
node 00-系统/Skills/thirdspace-vault/scripts/thirdspace-vault.mjs audit-subsystems --vault . --write-report
git diff --check
```

Expected: all test commands PASS; the audit reports no new subsystem drift; `git diff --check` produces no output.

- [ ] **Step 4: Request authorization and run the nine manual acceptance scenarios**

With the user present, run the design spec scenarios in a dedicated test Calendar and Reminder list:

1. Calendar read.
2. Pi-created Calendar Event appears in Calendar.app.
3. Calendar.app edit appears on the next fetch.
4. Pi edit appears in Calendar.app.
5. Pi-created Reminder appears in Reminders.app.
6. Apple-completed Reminder returns `completed: true`.
7. Pi completion appears in Reminders.app.
8. Pi reopen appears in Reminders.app.
9. Recurring Event refuses mutation without a span and honors the chosen span.

Use obviously temporary titles prefixed `ThirdSpace Acceptance —`. Delete test items only after explicit user confirmation.

- [ ] **Step 5: Write the bounded acceptance report**

Create `.thirdspace/reports/20260822_EventKit集成验收.md` with required Frontmatter and this result table:

```markdown
| Scenario | Result | Evidence |
|---|---|---|
| Calendar read | pass/fail | command + bounded identifier |
| Calendar create | pass/fail | visible in Calendar.app |
| Apple → Pi edit | pass/fail | fresh fetch observed |
| Pi → Apple edit | pass/fail | visible in Calendar.app |
| Reminder create | pass/fail | visible in Reminders.app |
| Apple completion | pass/fail | completed boolean observed |
| Pi completion | pass/fail | visible in Reminders.app |
| Reminder reopen | pass/fail | visible in Reminders.app |
| Recurrence span | pass/fail | missing span rejected; selected span applied |
```

Do not copy private titles, notes, locations, URLs, attendees, or unrelated Calendar/Reminder data into the report.

- [ ] **Step 6: Commit runtime docs and acceptance evidence**

```bash
git add 00-系统/运行时/README.md \
  00-系统/运行时/manifest.yaml \
  .thirdspace/reports/20260822_EventKit集成验收.md
git commit -m "docs: verify Pi EventKit integration"
```

---

## Final-review contract amendment

This amendment is part of numbered plan 19 and supersedes earlier single-identifier or locally filtered examples without renumbering the specification set.

- Local task durability comes first. Create or update the local task without a locator, save the Apple item, then run validated `task-link-eventkit` with the returned `id` and optional `externalId`. The pure attachment transform preserves all task fields except `updated_at` and `external_ref`; the state operation appends one bounded event. Apple failure leaves the task unlinked, while linked `task-add` stays backward compatible.
- `external_ref.id` and `external_ref.external_id` carry EventKit's local and server-provided identifiers respectively. Reads and mutations try local ID first, then accept exactly one expected-type external match. Zero matches retain not-found; multiple matches return an ambiguity error without mutation.
- `reminder.list` carries optional absolute `completionStart` and `completionEnd` through dispatcher, request/query, store protocol, and live EventKit. Either both form a strictly increasing pair or the request fails before fetch. Daily Opening uses the exact local-day `[00:00, next 00:00)` pair for the completed query and keeps the incomplete query separate.
- `task-transition` omits absent CLI patch fields, preserves stored `due` and `review_after`, removes stale `completed_at` when leaving `completed`, and still accepts a validated EventKit completion timestamp when completing.
- The Node adapter accepts only the exclusive Bridge response union and normalizes synchronous spawn argument failures to `EventKitAdapterError(INVALID_BRIDGE_RESPONSE)`. Swift keeps EventKit handles main-actor confined, exposes `EventRecord.id` read-only through its protocol, and documents the one-shot `ReminderFetchBatch @unchecked Sendable` ownership hop.

The final wave is accepted only after focused RED/GREEN evidence, full Node and Swift suites, strict-concurrency and release builds, subsystem-audit baseline comparison, `git diff --check`, and confirmation that no `.build` artifact is tracked.

---

## Final Verification

- [ ] Run `git status --short` and confirm only unrelated pre-existing user changes remain.
- [ ] Run `git log --oneline -8` and confirm each task produced its intended focused commit.
- [ ] Run all Node and Swift tests once more from the vault root.
- [ ] Run `audit-subsystems --write-report` once more after documentation edits.
- [ ] Confirm the final `today` response clearly distinguishes local tasks, Calendar time blocks, Reminders, and unavailable sources.
- [ ] Confirm no `.build/` directory, binary, private Calendar data, Reminder data, or TCC state is tracked by Git.
