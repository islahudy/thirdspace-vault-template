---
title: "Pi 日常管理 Agent EventKit 集成设计"
type: "spec"
topic: "system"
workspace: "00-系统"
created: "2026-08-22 00:00:00"
modified: "2026-08-23 15:30:00"
tags: ["system", "spec", "pi-agent", "eventkit", "daily-management"]
source: "agent"
status: "active"
---

# Pi 日常管理 Agent EventKit 集成设计

## 1. 目标

为 Pi Agent 增加 macOS Calendar 与 Reminders 集成，使其能够：

1. 在每日 `today` 开场中读取当天 Calendar Event 和相关 Reminder，并纳入今日判断。
2. 根据用户明确指令创建或编辑 Calendar Event。
3. 根据用户明确指令创建或编辑 Reminder。
4. 获取 Reminder 的最新完成状态，并更新存在明确关联的本地任务。

本集成以 `docs/design/reminder_design.md` 的 EventKit Bridge 接口说明为基础。

## 2. MVP 边界

MVP 不实现传统同步系统。EventKit 是 Apple Calendar/Reminders 的统一事实源：

- 每次查询都重新 fetch。
- 每次修改都直接 save。
- 不缓存 `EKEvent`、`EKReminder` 或 `EKCalendar` 对象。
- 不监听 `EKEventStoreChangedNotification`。
- 不运行后台任务或长驻 daemon。
- 不实现冲突合并、增量同步、HTTP 服务、GUI 或自然语言时间解析。

用户在 Calendar.app 或 Reminders.app 中的修改，会在 Pi 下一次查询时通过 EventKit 自然可见。只有未来引入长驻进程或内存缓存时，才需要设计缓存失效和更复杂的同步策略。

## 3. 总体架构

```text
Pi Agent
├── daily-agent Skill
│   └── tasks.json / reading queue / daily opening
└── eventkit Skill
    └── Node adapter
        └── Swift eventkit-bridge
            └── Apple EventKit
                ├── Calendar.app
                └── Reminders.app
```

采用“独立 Swift Bridge + Pi Skill 编排”：

- Swift Bridge 只执行结构化 EventKit 操作，不负责对话、自然语言理解或今日计划。
- `eventkit` Skill 是 Pi 的领域入口，负责调用策略、确认边界和错误处理。
- `daily-agent` Skill 编排本地开场与 EventKit 实时读取，但现有 `daily-agent.mjs` 保持跨平台，不直接依赖 macOS EventKit。

CLI 是 Skill 内部实现，不作为用户入口。

## 4. 组件

### 4.1 EventKit Skill

Canonical 路径：

```text
00-系统/Skills/eventkit/
├── SKILL.md
├── references/
│   └── protocol.md
└── scripts/
    ├── eventkit-adapter.mjs
    └── eventkit-bridge/
        ├── Package.swift
        ├── Info.plist
        ├── Sources/
        └── Tests/
```

`SKILL.md` 定义：

- Calendar/Reminder 读写的触发条件。
- Todo 的目标路由规则。
- 外部修改权限和确认策略。
- `today` 中的读取与降级行为。

### 4.2 Swift EventKit Bridge

Bridge 使用 Swift、macOS EventKit 和统一 JSON 协议，提供：

- `auth.status`、`auth.request`
- `calendar.calendars`
- `calendar.list`、`calendar.get`、`calendar.create`、`calendar.update`、`calendar.delete`
- `reminder.lists`
- `reminder.list`、`reminder.get`、`reminder.create`、`reminder.update`、`reminder.delete`
- `reminder.complete`、`reminder.reopen`

stdout 只输出一个 JSON 响应，日志只写 stderr。时间输入统一使用带时区的 ISO 8601；Bridge 不解析“明天”“下午”等自然语言。

每个命令均执行：

```text
create EKEventStore → request/check access → fetch → operate → save → return JSON
```

一次命令内复用同一个 `EKEventStore`；跨命令不缓存 EventKit 对象。

### 4.3 Node Adapter

`eventkit-adapter.mjs` 是 Pi 与 Swift 可执行文件之间的薄适配层，负责：

- 将结构化请求写入 Bridge。
- 解析单一 JSON 响应。
- 设置有限超时。
- 拒绝损坏或混杂日志的 stdout。
- 将进程错误转换为稳定的机器错误。

Adapter 不保存 Calendar 或 Reminder 数据。

### 4.4 Daily Agent

更新 `daily-agent/SKILL.md` 与 `references/daily-opening.md`，把 EventKit 实时读取加入开场编排。EventKit 不可用时，现有 Daily Agent 本地流程仍可独立完成。

## 5. Todo 路由

当用户新增 Todo 时，Pi 按以下规则选择 Apple 对象：

- 有明确开始和结束时间：写入 Calendar Event。
- 只有截止时间或没有具体时段：写入 Reminder。
- 无法可靠判断：先询问用户。

自然语言解析由 Pi 完成；Bridge 只接收绝对时间和结构化字段。

创建 Apple 对象时，必须先创建或更新 `tasks.json` 中的本地任务，但不预写定位符；再创建 Calendar Event 或 Reminder。只有 Apple save 返回后，才使用 `task-link-eventkit` 把真实返回的双定位符附加或替换到已存在任务：

```json
{
  "external_ref": {
    "provider": "eventkit",
    "kind": "reminder",
    "id": "LOCAL-ABC123",
    "external_id": "SERVER-ABC123"
  }
}
```

`external_ref.id` 是 EventKit 的本地 identifier，`external_ref.external_id` 是可选的 server-provided identifier。两者仅用于精确定位，不构成缓存或同步数据库。Calendar/Reminder 的当前内容始终以最新 EventKit fetch 为准。后续读写先尝试本地 `id`；仅当本地 ID 失效时使用 `external_id` 查找。候选为零时返回 not-found，候选多于一个时返回歧义错误且不修改任何 Apple 对象。

若 Apple 侧写入失败：

- 保留已经成功创建的本地任务。
- 不保存虚假的 `external_ref`。
- 不运行 `task-link-eventkit`，所以本地任务保持 unlinked。
- 明确报告 Apple 侧失败，并允许用户重试。

## 6. Today 数据流

Pi 执行 `today` 时按以下顺序编排：

1. 调用现有 `daily-agent opening`，读取本地任务与阅读队列。
2. 查询本地当天 `00:00` 至次日 `00:00` 的 Calendar Events。
3. 单独查询未完成 Reminders；查询当天完成 Reminders 时，将本地日精确 `[00:00, 次日 00:00)` 的两个绝对时间作为 `completionStart` / `completionEnd` 传入 EventKit 已完成谓词，不先读取无界历史再在 Node 侧过滤。
4. 按 `external_ref.id` 优先检查已关联本地任务的当前状态；本地 ID 失效时才使用唯一 `external_ref.external_id` 匹配。
5. 合并展示本地任务、Calendar 时间块和 Reminder。
6. 继续现有旧事项确认、今日推进事项收集和 1～3 个重点选择。
7. 用户确认重点后调用 `opening-complete`。

EventKit 查询失败不会阻止步骤 1、6、7；Pi 必须明确标记简报缺少的外部数据源。

### 6.1 Reminder 完成状态

- 关联 Reminder 已完成：自动将本地任务转换为 `completed`，并优先采用 EventKit 返回的 `completionDate` 作为完成时间。
- Reminder 被重新打开但本地任务已经完成：不自动重开，提示用户确认。
- EventKit 本地 ID 失效：使用可选 external ID 做请求内 fallback；只有唯一同类候选才接受。零候选才视为 not-found，多候选视为歧义并禁止自动选择。两个定位符都无法唯一解析时，不删除本地任务，只报告关联失效或歧义。
- Apple App 中新建但无本地关联的 Event/Reminder：作为实时上下文展示，不自动复制到 `tasks.json`。

## 7. 编辑与确认策略

- 用户明确要求创建、普通编辑、完成或重新打开时，Pi 可直接执行对应操作。
- 更新和删除优先使用 EventKit 本地 identifier，本地查找 miss 后才使用 external identifier；external 匹配必须唯一，不以标题或时间作为唯一定位条件。
- 缺少 identifier 时，Pi 先列出候选并要求用户确认目标。
- 删除 Calendar Event 或 Reminder 必须明确确认。
- 循环 Calendar Event 的更新与删除必须指定 `thisEvent` 或 `futureEvents`；缺失时返回 `RECURRING_EVENT_REQUIRES_SPAN`，不得默认修改整个系列。
- 不因本地任务删除或取消而静默删除 Apple 对象。

## 8. 权限

需要：

- Calendar Full Access，用于 `today` 查询和读写。
- Reminders Full Access，用于查询、读写和完成状态。

Swift 产物必须包含：

```xml
<key>NSCalendarsFullAccessUsageDescription</key>
<string>Allow Pi Agent to read and manage calendar events.</string>

<key>NSRemindersFullAccessUsageDescription</key>
<string>Allow Pi Agent to read and manage reminders.</string>
```

首次授权是明确的初始化动作。普通 `today` 只检查权限，不应反复主动触发系统授权弹窗。

## 9. 错误处理

Bridge 至少提供以下稳定错误码：

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
BRIDGE_NOT_FOUND
BRIDGE_TIMEOUT
INVALID_BRIDGE_RESPONSE
```

降级规则：

- Calendar 或 Reminders 未授权：继续本地开场，说明缺少的权限和修复入口。
- Bridge 缺失、启动失败、超时或返回损坏 JSON：拒绝该次外部结果，继续本地开场。
- 对象不存在：保留本地任务，报告关联失效。
- 批量读取或修改返回逐项结果，不把部分成功表述为整体成功。
- MVP 不实现 `tasks.json` 与 EventKit 之间的跨系统事务回滚。

## 10. Schema 与控制面更新

实施时同步更新：

- `.thirdspace/schema/daily-agent.yaml`：加入 EventKit 外部输入、`external_ref` 契约和降级策略。
- `.thirdspace/schema/workspace-tools.yaml`：在 `02-日记` 的领域 Skill 中注册 `eventkit` 及触发词。
- `00-系统/Skills/daily-agent/SKILL.md`：加入 `today` 的 EventKit 编排。
- `00-系统/Skills/daily-agent/references/daily-opening.md`：定义外部数据在开场中的展示顺序与失败行为。
- `00-系统/Skills/daily-agent/references/data-contracts.md`：定义 `external_ref`。
- `00-系统/Agent/README.md`：说明 Pi 每日开场会读取 Calendar/Reminders。

本机授权状态、编译产物路径和其他机器相关信息不得写入可同步 Schema，也不得存储秘密。

## 11. 测试

### 11.1 Swift 单元测试

- ISO 8601 与全天事件日期处理。
- DTO 编解码和字段校验。
- Calendar/Reminder 路由与默认列表选择。
- EventKit 错误到稳定错误码的映射。
- 循环事件 span 校验。

EventKit framework 调用通过协议边界隔离，使纯逻辑无需真实用户日历即可测试。

### 11.2 Node Adapter 测试

使用假的 Bridge 进程验证：

- 正常 JSON 请求与响应。
- 非零退出码。
- 超时终止。
- 空 stdout、损坏 JSON 和 stdout 混入日志。
- stderr 不进入 Agent 的结构化数据。

### 11.3 Daily Agent 测试

- `today` 同时呈现本地任务、Calendar 和 Reminder。
- EventKit 权限失败时本地开场仍可完成。
- 关联 Reminder 完成后，本地任务转换为完成。
- Reminder 重开不会静默复活已完成任务。
- 无关联 Apple 对象不会自动写入 `tasks.json`。
- 外部写入失败不会产生无效 `external_ref`。
- 已完成 Reminder 查询的绝对完成时间边界进入 store predicate，不读取无界完成历史。
- 任务定位符在 Apple save 成功后才附加，并保存本地与 external 两种 identifier。

### 11.4 macOS 手工验收

覆盖 `docs/design/reminder_design.md` 中的九个 MVP 场景：读取、创建、Apple→Pi 修改、Pi→Apple 修改、Reminder 创建、Apple 完成、Pi 完成、重开和循环事件 span。

## 12. 验收标准

1. `today` 每次重新读取当天 Calendar 和相关 Reminders。
2. EventKit 不可用时，现有 Daily Agent 流程仍正常工作并清楚提示数据缺失。
3. Pi 能创建、读取和编辑 Calendar Event 与 Reminder。
4. Pi 能读取、完成和重新打开 Reminder。
5. 带 `external_ref` 的本地任务能根据最新 Reminder 完成状态安全更新。
6. Apple App 中的修改在下一次查询中可见，不依赖后台同步。
7. 不缓存 EventKit 对象，不引入 daemon、HTTP 服务或独立 Todo 数据库。
8. 自动化测试通过，并完成真实 macOS 权限和 App 联动验收。

## 13. 后续方向

以下内容不属于 MVP：

- 长驻 daemon 与 `EKEventStoreChangedNotification`。
- 后台主动刷新。
- 跨设备冲突解决。
- 自动 time blocking 或自动日程重排。
- Calendar/Reminder 内容的长期本地缓存。
