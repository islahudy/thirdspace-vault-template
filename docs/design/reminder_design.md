
# Pi Agent × macOS Calendar / Reminders EventKit Bridge 实现说明

## 1. 目标

实现一个运行在 macOS 本机的轻量级 Bridge，使 Pi Agent 能够通过命令行调用 Apple EventKit，实现：

1. Pi Agent 执行 `today` 时读取当天 Calendar 事件，并纳入今日计划。
2. Pi Agent 可以创建、修改、删除 Calendar 事件。
3. Pi Agent 可以创建、修改、删除 Reminders。
4. Pi Agent 可以读取 Reminder 当前是否完成。
5. Pi Agent 可以修改 Reminder 的完成状态。
6. 用户在 macOS Calendar / Reminders App 中手工进行的修改，应能被 Pi 在后续读取时看到。
7. Pi 写入的数据，也应立即出现在 Apple Calendar / Reminders 中。

不自行实现 Calendar 或 Todo 数据库。

整体架构：

```text
User
  │
  ▼
Pi Agent
  │
  │ JSON / CLI
  ▼
eventkit-bridge
  │
  ▼
Apple EventKit / EKEventStore
  │
  ├── Calendar.app
  └── Reminders.app
```

`EKEventStore` 是 EventKit 访问 Calendar 和 Reminders 的统一入口。Apple 官方明确说明，它负责访问用户的 Calendar events 和 reminders。citeturn567933search3turn505854search7

---

# 2. 技术选型

推荐：

```text
Language: Swift
Platform: macOS
Framework: EventKit
Interface: CLI + JSON
```

第一版不要做：

```text
HTTP Server
GUI
SQLite
后台同步数据库
复杂自然语言解析
```

自然语言理解全部由 Pi 完成。

Bridge 只负责：

```text
structured request
        ↓
EventKit operation
        ↓
structured JSON response
```

---

# 3. 权限

由于 Pi 既需要读取 Calendar，又需要写入 Calendar，因此 Calendar 必须申请 Full Access，而不是 Write Only。

使用：

```swift
let eventStore = EKEventStore()

eventStore.requestFullAccessToEvents { granted, error in
    ...
}

eventStore.requestFullAccessToReminders { granted, error in
    ...
}
```

Apple 当前 EventKit 将权限明确区分为：

```text
Calendar:
requestWriteOnlyAccessToEvents()
requestFullAccessToEvents()

Reminders:
requestFullAccessToReminders()
```

Full Access Calendar 可以读写；Write Only Calendar 只能创建事件，不满足 `today` 查询需求。citeturn567933search3turn567933search6turn567933search7

应用需要配置权限说明：

```xml
<key>NSCalendarsFullAccessUsageDescription</key>
<string>Allow Pi Agent to read and manage calendar events.</string>

<key>NSRemindersFullAccessUsageDescription</key>
<string>Allow Pi Agent to read and manage reminders.</string>
```

Apple 要求应用在访问 EventKit 数据前提供对应的 usage description。citeturn567933search3turn567933search7

建议提供：

```bash
eventkit-bridge auth status
eventkit-bridge auth request
```

输出：

```json
{
  "calendar": "fullAccess",
  "reminders": "fullAccess"
}
```

---

# 4. EventKit Store 生命周期

核心：

```swift
final class EventStoreManager {
    static let shared = EventStoreManager()

    let store = EKEventStore()

    private init() {}
}
```

尽量复用同一个 `EKEventStore`。

不要为一次操作中涉及的多个 EventKit 对象反复构造不同 `EKEventStore`。

Apple 也特别提示，不应在其他 EventKit 对象仍然存活时过早释放对应的 event store。citeturn567933search6

---

# 5. Calendar：读取事件

## 5.1 Today 查询

Pi 的：

```text
/today
```

应首先调用：

```text
calendar.list
```

并指定当天完整时间范围。

例如：

```json
{
  "action": "calendar.list",
  "start": "2026-08-22T00:00:00+09:00",
  "end": "2026-08-23T00:00:00+09:00"
}
```

Bridge 内部：

```swift
let predicate = eventStore.predicateForEvents(
    withStart: startDate,
    end: endDate,
    calendars: nil
)

let events = eventStore.events(matching: predicate)
```

Apple 官方要求使用：

```text
predicateForEvents(withStart:end:calendars:)
        ↓
events(matching:)
```

进行时间范围查询。

`calendars: nil` 表示所有用户可访问 Calendar。citeturn567933search0

注意：Apple 明确指出返回结果不保证按时间顺序，因此 Bridge 应自行按 `startDate` 排序。citeturn567933search0

输出建议：

```json
{
  "events": [
    {
      "id": "xxxxxxxx",
      "title": "Group Meeting",
      "start": "2026-08-22T10:00:00+09:00",
      "end": "2026-08-22T11:00:00+09:00",
      "allDay": false,
      "calendar": {
        "id": "xxxx",
        "title": "Work"
      },
      "location": null,
      "notes": null,
      "url": null,
      "availability": "busy",
      "recurring": false
    }
  ]
}
```

---

# 6. Calendar：创建事件

使用：

```swift
let event = EKEvent(eventStore: eventStore)

event.title = ...
event.startDate = ...
event.endDate = ...
event.calendar = ...

try eventStore.save(
    event,
    span: .thisEvent,
    commit: true
)
```

Apple 官方支持通过 `EKEvent(eventStore:)` 创建 Event，然后设置：

```text
title
startDate
endDate
calendar
alarms
recurrenceRules
```

最后调用：

```text
save(_:span:commit:)
```

保存。citeturn567933search2

CLI：

```bash
eventkit-bridge calendar create --json '...'
```

输入：

```json
{
  "title": "Run cuDSS benchmark",
  "start": "2026-08-23T14:00:00+09:00",
  "end": "2026-08-23T17:00:00+09:00",
  "calendar": "Research",
  "notes": "Benchmark GPU solver"
}
```

输出：

```json
{
  "success": true,
  "event": {
    "id": "...",
    "title": "Run cuDSS benchmark"
  }
}
```

---

# 7. Calendar：编辑事件

Pi 必须保存 EventKit 返回的：

```text
eventIdentifier
```

读取单个事件：

```swift
guard let event = eventStore.event(
    withIdentifier: eventID
) else {
    ...
}
```

修改：

```swift
event.title = ...
event.startDate = ...
event.endDate = ...

try eventStore.save(
    event,
    span: .thisEvent,
    commit: true
)
```

Apple 官方支持通过 `event(withIdentifier:)` 根据之前取得的 identifier 获取 Event。citeturn567933search0

建议 API：

```text
calendar.get
calendar.update
```

例如：

```json
{
  "action": "calendar.update",
  "id": "ABC123",
  "changes": {
    "start": "2026-08-23T15:00:00+09:00",
    "end": "2026-08-23T18:00:00+09:00"
  }
}
```

---

# 8. Calendar：删除事件

使用：

```swift
try eventStore.remove(
    event,
    span: .thisEvent,
    commit: true
)
```

Apple 官方对应 API：

```text
remove(_:span:commit:)
```

保存和删除都会由 EventKit 同步到事件所属 Calendar，例如 iCloud、CalDAV、Exchange 等。citeturn567933search2

---

# 9. Recurring Event

循环事件不能简单当普通 Event 修改。

EventKit 使用：

```swift
EKSpan.thisEvent
EKSpan.futureEvents
```

`.thisEvent`：

```text
只修改当前 occurrence
```

`.futureEvents`：

```text
修改当前 occurrence 以及之后的 occurrence
```

Apple 官方明确规定这一行为。citeturn567933search2turn567933search10

所以 Update/Delete API 应支持：

```json
{
  "span": "thisEvent"
}
```

或者：

```json
{
  "span": "futureEvents"
}
```

第一版中：

如果发现事件属于 recurring event，而 Pi 未指定 span：

```text
不要默认修改整个系列。
```

Bridge 返回：

```json
{
  "success": false,
  "error": {
    "code": "RECURRING_EVENT_REQUIRES_SPAN"
  }
}
```

让 Agent 明确选择。

---

# 10. Reminders：读取

读取所有 Reminder：

```swift
let predicate =
    eventStore.predicateForReminders(in: nil)

eventStore.fetchReminders(
    matching: predicate
) { reminders in
    ...
}
```

Apple 官方提供三类 predicate：

```text
predicateForReminders(in:)
predicateForIncompleteReminders(...)
predicateForCompletedReminders(...)
```

然后使用：

```text
fetchReminders(matching:completion:)
```

异步读取。citeturn567933search0turn567933search4

建议：

```text
reminder.list
```

支持：

```json
{
  "status": "all"
}
```

```json
{
  "status": "incomplete"
}
```

```json
{
  "status": "completed"
}
```

---

# 11. Reminder 数据结构

输出至少包括：

```json
{
  "id": "ABC123",
  "title": "Read CHOLMOD paper",
  "list": "Research",
  "completed": false,
  "completionDate": null,
  "startDate": null,
  "dueDate": "2026-08-25T23:59:00+09:00",
  "priority": 1,
  "notes": null
}
```

Pi 最关心：

```text
id
title
completed
completionDate
dueDate
list
priority
```

---

# 12. Reminder：创建

使用：

```swift
let reminder = EKReminder(eventStore: eventStore)

reminder.title = ...
reminder.calendar = ...

reminder.dueDateComponents = ...

try eventStore.save(
    reminder,
    commit: true
)
```

Reminder 的：

```text
title
calendar
```

需要设置。

Reminder 的 calendar 实际对应 Reminders App 中的某一个 List。citeturn567933search2

例如：

```json
{
  "action": "reminder.create",
  "title": "Read CHOLMOD paper",
  "list": "Research",
  "due": "2026-08-25T23:59:00+09:00",
  "priority": 1
}
```

---

# 13. Reminder：修改

根据：

```text
calendarItemIdentifier
```

读取：

```swift
eventStore.calendarItem(
    withIdentifier: id
)
```

然后转换为：

```swift
EKReminder
```

修改：

```swift
reminder.title = ...
reminder.dueDateComponents = ...
reminder.priority = ...
```

保存：

```swift
try eventStore.save(
    reminder,
    commit: true
)
```

Apple 官方指出，可以通过 `calendarItem(withIdentifier:)` 根据 identifier 获取 Reminder 或 Event。citeturn567933search0

---

# 14. Reminder：完成状态

这是本项目非常重要的一部分。

`EKReminder` 本身有：

```text
isCompleted
completionDate
```

修改完成状态：

```swift
reminder.isCompleted = true
try eventStore.save(reminder, commit: true)
```

Apple 官方说明：

当 reminder 的 completed 属性设为 `true` 时，EventKit 会自动设置 `completionDate` 为当前时间。citeturn567933search2

因此建议提供：

```text
reminder.complete
reminder.reopen
```

例如：

```json
{
  "action": "reminder.complete",
  "id": "ABC123"
}
```

Bridge：

```swift
reminder.isCompleted = true
```

重新打开：

```swift
reminder.isCompleted = false
```

然后保存。

---

# 15. 双向编辑的真正含义

本项目不应该实现传统意义上的：

```text
Pi Database ↔ Apple Database
```

因为没有必要。

正确架构应该是：

```text
             ┌──────────────┐
             │  EventKit    │
             │ Source of    │
             │   Truth      │
             └──────┬───────┘
                    ▲
            ┌───────┴───────┐
            │               │
       Pi Agent        Apple Apps
```

即：

## 用户 → Apple App

用户：

```text
Calendar.app
把“组会”从 10:00 改为 11:00
```

EventKit 数据随之改变。

下一次 Pi：

```text
calendar.list(today)
```

得到：

```text
11:00 组会
```

## Pi → Apple App

Pi：

```text
calendar.update(...)
```

调用 EventKit：

```text
save()
```

Apple Calendar 随即显示新的内容。

Reminders 同理。

Apple 官方指出，EventKit 保存和删除操作会同步到底层 Calendar 数据源，包括 CalDAV、Exchange 等。citeturn567933search2

所以：

```text
不要在 Pi 中缓存 Calendar / Reminder 状态作为 authoritative state。
```

---

# 16. 如何保证读取到用户刚刚修改的数据

这是双向编辑中最重要的实现细节。

Apple 提供：

```text
EKEventStoreChangedNotification
```

当 Calendar 或 Reminder 数据库发生：

```text
add
modify
delete
```

时，EventKit Store 会发送 change notification。citeturn505854search0turn505854search1

Apple 明确建议：

收到 notification 后，之前读取的：

```text
EKEvent
EKReminder
EKCalendar
```

都可能已经 stale。

因此应：

```text
重新 fetch
```

而不是继续使用旧对象。citeturn505854search0turn505854search1

监听：

```swift
NotificationCenter.default.addObserver(
    forName: .EKEventStoreChanged,
    object: eventStore,
    queue: nil
) { _ in

    // invalidate cache
}
```

但是本项目第一版甚至可以更简单。

因为 Bridge 是 CLI：

```text
Pi call
    ↓
new query
    ↓
EventKit
```

只要每次 `calendar.list` / `reminder.list` 都重新 fetch，就已经能够很好地满足：

```text
Apple App → Pi
```

双向修改。

因此 MVP 建议：

```text
不要缓存 EKEvent / EKReminder 对象。
```

每次操作：

```text
fetch → operate → save
```

即可。

如果以后把 Bridge 改成长驻 daemon，再实现 `EKEventStoreChangedNotification`。

---

# 17. Today Workflow

Pi `/today` 推荐执行：

```text
/today
   │
   ├── calendar.list(
   │       today 00:00,
   │       tomorrow 00:00
   │   )
   │
   ├── reminder.list(
   │       incomplete
   │   )
   │
   ▼
Pi Agent reasoning
   │
   ▼
Today's Plan
```

例如 Bridge 返回：

```json
{
  "calendar": [
    {
      "title": "Group Meeting",
      "start": "10:00",
      "end": "11:00"
    }
  ],
  "reminders": [
    {
      "title": "Run benchmark",
      "due": "2026-08-22",
      "completed": false
    }
  ]
}
```

Pi 再负责：

```text
理解优先级
识别 deadline
发现时间冲突
生成今日计划
```

这些逻辑不属于 EventKit Bridge。

---

# 18. 推荐 CLI

MVP：

```text
eventkit-bridge auth status
eventkit-bridge auth request

eventkit-bridge calendar list
eventkit-bridge calendar get
eventkit-bridge calendar create
eventkit-bridge calendar update
eventkit-bridge calendar delete

eventkit-bridge reminder list
eventkit-bridge reminder get
eventkit-bridge reminder create
eventkit-bridge reminder update
eventkit-bridge reminder delete
eventkit-bridge reminder complete
eventkit-bridge reminder reopen
```

建议所有命令同时支持：

```text
--json
```

---

# 19. 建议统一 JSON Protocol

请求：

```json
{
  "action": "calendar.create",
  "params": {
    "title": "Run benchmark",
    "start": "2026-08-23T14:00:00+09:00",
    "end": "2026-08-23T17:00:00+09:00"
  }
}
```

成功：

```json
{
  "success": true,
  "data": {
    "id": "ABC123"
  }
}
```

失败：

```json
{
  "success": false,
  "error": {
    "code": "CALENDAR_NOT_FOUND",
    "message": "Calendar Research does not exist."
  }
}
```

stdout：

```text
只输出 JSON
```

stderr：

```text
debug/log
```

这样 Pi 调用非常容易。

---

# 20. Identifier 使用原则

Calendar：

```text
EKEvent.eventIdentifier
```

Reminder：

```text
EKCalendarItem.calendarItemIdentifier
```

这些 ID 应返回给 Pi。

不要让 Pi 使用：

```text
title
start time
```

作为唯一定位条件。

例如：

```text
“组会”
```

可能一天有两个。

更新/删除必须优先使用 identifier。

---

# 21. 不建议长期缓存 identifier 对应对象

可以缓存：

```text
String identifier
```

不要缓存：

```text
EKEvent instance
EKReminder instance
```

Apple 明确指出：

Calendar 数据库改变之后，之前 fetch 的 Event/Reminder 对象可能变得 stale，应重新 fetch。citeturn505854search0turn505854search1

---

# 22. Calendar List / Reminder List

Bridge 应支持列出可用 Calendar 和 Reminder List：

```text
calendar.calendars
reminder.lists
```

内部可通过：

```swift
eventStore.calendars(for: .event)
eventStore.calendars(for: .reminder)
```

Pi 创建内容之前可以知道：

```text
Work
Research
Personal
```

等目标位置。

如果用户未指定：

Calendar：

```text
defaultCalendarForNewEvents
```

Reminder：

```text
defaultCalendarForNewReminders()
```

---

# 23. 删除策略

任何：

```text
create
update
delete
complete
reopen
```

必须来自用户明确要求或 Pi 已经根据用户授权策略确认的操作。

Apple 官方明确要求：应用修改用户 Calendar 数据库之前，应有用户明确指令，不应无指示修改 Calendar 数据。citeturn567933search2

因此 Agent 层应承担操作确认策略。

Bridge 本身不用弹确认窗口。

---

# 24. 时间处理

所有 CLI 时间：

```text
ISO 8601
```

例如：

```text
2026-08-23T14:00:00+09:00
```

不要在 Bridge 中解析：

```text
tomorrow
下午
下周五
晚点
```

这些由 Pi 转为绝对时间。

Bridge 只接受确定时间。

---

# 25. All-day Event

Calendar create/update 支持：

```json
{
  "allDay": true
}
```

对应：

```swift
event.isAllDay = true
```

对于 all-day event，应避免强行附加本地小时。

---

# 26. MVP Error Codes

至少定义：

```text
PERMISSION_DENIED

EVENT_NOT_FOUND
REMINDER_NOT_FOUND

CALENDAR_NOT_FOUND
REMINDER_LIST_NOT_FOUND

INVALID_DATE
INVALID_DATE_RANGE

RECURRING_EVENT_REQUIRES_SPAN

READ_ONLY_CALENDAR

SAVE_FAILED
DELETE_FAILED

EVENTKIT_ERROR
```

---

# 27. 推荐代码结构

```text
eventkit-bridge/
│
├── Package.swift
│
└── Sources/
    └── EventKitBridge/
        │
        ├── main.swift
        │
        ├── EventStoreManager.swift
        │
        ├── PermissionService.swift
        │
        ├── CalendarService.swift
        │
        ├── ReminderService.swift
        │
        ├── Models/
        │   ├── EventDTO.swift
        │   ├── ReminderDTO.swift
        │   └── ResponseDTO.swift
        │
        ├── CLI/
        │   └── Commands.swift
        │
        └── Utils/
            └── DateParser.swift
```

---

# 28. CalendarService

主要方法：

```swift
listEvents(start:end:calendarIDs:)

getEvent(id:)

createEvent(request:)

updateEvent(id:changes:span:)

deleteEvent(id:span:)
```

---

# 29. ReminderService

主要方法：

```swift
listReminders(status:listIDs:)

getReminder(id:)

createReminder(request:)

updateReminder(id:changes:)

deleteReminder(id:)

setCompleted(id:completed:)
```

---

# 30. Pi Adapter

Pi extension 只需要包装：

```typescript
calendarList(...)
calendarCreate(...)
calendarUpdate(...)
calendarDelete(...)

reminderList(...)
reminderCreate(...)
reminderUpdate(...)
reminderDelete(...)
reminderComplete(...)
```

内部：

```text
spawn eventkit-bridge
```

然后：

```text
JSON.parse(stdout)
```

即可。

---

# 31. MVP 验收测试

## Test 1 — Pi 读取 Calendar

Calendar App 创建：

```text
10:00–11:00 Group Meeting
```

执行：

```bash
eventkit-bridge calendar list ...
```

必须返回：

```text
Group Meeting
10:00
11:00
```

---

## Test 2 — Pi 创建 Calendar Event

Bridge：

```text
create "Run Benchmark"
```

Calendar App 中应立即出现。

---

## Test 3 — Apple → Pi 修改

Calendar App：

```text
Run Benchmark
14:00 → 15:00
```

重新：

```text
calendar list
```

必须返回：

```text
15:00
```

不得返回缓存的 14:00。

---

## Test 4 — Pi → Apple 修改

Pi：

```text
calendar.update
15:00 → 16:00
```

Calendar App 中应显示：

```text
16:00
```

---

## Test 5 — Reminder 创建

Pi 创建：

```text
Read CHOLMOD paper
```

Reminders App 中必须出现。

---

## Test 6 — Apple 完成 Reminder

用户在 Reminders App 中勾选：

```text
Read CHOLMOD paper
```

Pi 再调用：

```text
reminder.list
```

必须得到：

```json
{
  "completed": true
}
```

---

## Test 7 — Pi 完成 Reminder

Pi：

```text
reminder.complete
```

Reminders App 应显示已完成。

---

## Test 8 — Reopen

Pi：

```text
reminder.reopen
```

Reminders App 应重新显示未完成。

---

## Test 9 — Recurring Event

创建循环事件。

Pi 修改其中一个 occurrence。

Bridge 必须区分：

```text
thisEvent
futureEvents
```

不能静默修改整个系列。

---

# 32. MVP 的核心原则

整个系统最重要的一点：

```text
EventKit = Source of Truth
```

而不是：

```text
Pi database = Source of Truth
```

因此：

```text
Calendar App
       │
       ▼
   EventKit
       ▲
       │
      Pi
```

以及：

```text
Reminders App
       │
       ▼
   EventKit
       ▲
       │
      Pi
```

本身就是双向的。

Pi 不需要自己做 Apple Calendar 数据同步。

Pi 只需要：

```text
每次读取 → EventKit fetch

每次修改 → EventKit save
```

Apple EventKit 负责把这些变化同步到底层 iCloud / CalDAV / Exchange 等 Calendar source。citeturn567933search2

---

# 33. 第一阶段明确不要实现

不要做：

```text
长期 Calendar cache
长期 Reminder cache
自己的 Todo DB
Cloud sync
冲突解决系统
HTTP server
GUI App
复杂 NLP
自动 time blocking
自动任务排序
```

这些都不是 EventKit Bridge 的职责。

第一阶段目标只是：

```text
Pi
 ↕
EventKit Bridge
 ↕
Calendar + Reminders
```

可靠工作。

---

# 34. Apple 官方 API 依据

主要参考：

- EventKit / `EKEventStore`：Calendar 和 Reminder 的统一访问入口。citeturn567933search3turn505854search7
- Accessing the Event Store：Full Calendar / Reminder 权限。citeturn567933search6
- Retrieving Events and Reminders：predicate、event lookup、Reminder fetch。citeturn567933search0
- Creating Events and Reminders：创建、修改、保存和删除。citeturn567933search2
- `predicateForReminders(in:)`：Reminder 查询。citeturn567933search4
- Updating with Notifications：外部修改后的数据刷新规则。citeturn505854search0turn505854search1
- `EKSpan.futureEvents`：循环 Event 修改语义。citeturn567933search10
