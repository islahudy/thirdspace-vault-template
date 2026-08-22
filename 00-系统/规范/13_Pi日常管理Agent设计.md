---
title: "Pi 日常管理 Agent 设计"
type: "spec"
topic: "system"
workspace: "00-系统"
created: "2026-08-22 00:00:00"
modified: "2026-08-22 18:18:00"
tags: ["system", "spec", "pi-agent", "daily-management"]
source: "manual"
status: "active"
---

# Pi 日常管理 Agent 设计

## 1. 目标与边界

以 Pi Agent 为执行引擎，为 ThirdSpace Vault 增加一个长期运行的个人科研运营助手。它负责事项维护、阅读积压提醒、行为证据汇总、周报月报和未来的 Wiki 提交，不负责写代码、推进项目正文或代替用户阅读论文。

第一版由用户手动启动。所有状态和接口同时为未来的“手动交互 + 定时巡检”模式预留扩展能力。

## 2. 核心原则

- 当前状态与历史事件分离：JSON 回答“现在是什么”，NDJSON 回答“过去发生了什么”。
- 项目 Markdown 是目标、规划、里程碑和进度正文的事实源；结构化数据只保存项目索引和 Todo。
- Dashboard 与 Pi Agent 共享同一份结构化状态，不维护两套 Todo。
- 日记只保存每日计划快照、行为摘要和复盘，不保存完整任务库。
- 本地和远端行为统一为可去重、可追溯的事件。
- 自动执行低风险维护；语义变更、跨区移动、归档和外部发布必须确认。
- 所有报告结论尽可能链接到任务、项目、Inbox 文件或事件证据。

## 3. 总体架构

```text
Pi Agent / ThirdSpace Dashboard
             |
             v
.thirdspace/data/daily-agent/       当前状态
             |
             +----> .thirdspace/events/      历史事件
             |                 ^
             |                 |
             |        本机 Hook + SSH 远端事件
             v
02-日记/工作日志与复盘/             人类可读快照和报告
             |
             v
未来的组织 Wiki MCP Adapter
```

## 4. 当前状态文件

机器状态统一位于：

```text
.thirdspace/data/daily-agent/
├── tasks.json
├── reading-queue.json
├── project-index.json
└── agent-state.json
```

这些文件可以随 Vault 同步，但不得包含 SSH 密码、私钥、访问令牌或其他本机秘密。

### 4.1 普通事项与项目 Todo

`tasks.json` 同时保存普通事项和项目 Todo。科研、学习、横向、生活等分类使用 `tags` 表达，不设不可扩展的主分类枚举。

```json
{
  "version": "1.0",
  "revision": 1,
  "updated_at": "2026-08-22T09:00:00+08:00",
  "tasks": [
    {
      "id": "task_01...",
      "title": "提交合作材料",
      "status": "active",
      "priority": "high",
      "due": "2026-08-25",
      "review_after": null,
      "tags": ["横向", "合作"],
      "project_id": null,
      "created_at": "2026-08-22T09:00:00+08:00",
      "updated_at": "2026-08-22T09:00:00+08:00",
      "completed_at": null,
      "source": "pi-agent"
    }
  ]
}
```

任务状态机：

```text
inbox -> active -> completed
              \-> waiting
              \-> cancelled
```

优先级为 `critical`、`high`、`normal`、`low`。DDL 可以为空。项目 Todo 通过非空 `project_id` 关联项目。

### 4.2 论文/Blog 待阅读

`reading-queue.json` 是长期维护的阅读列表，不把“阅读某篇论文”建模为普通事项。

```json
{
  "version": "1.0",
  "revision": 1,
  "updated_at": "2026-08-22T09:00:00+08:00",
  "items": [
    {
      "id": "reading_01...",
      "kind": "paper",
      "title": "示例论文",
      "source_path": "01-收件箱/网页剪藏/20260822_示例论文.md",
      "url": "https://example.com/paper",
      "tags": ["paper", "agent"],
      "status": "pending",
      "added_at": "2026-08-22T09:00:00+08:00",
      "processed_at": null,
      "output_path": null
    }
  ]
}
```

阅读状态机：

```text
pending -> reading -> processed
                   \-> skipped
```

带 `paper` 或 `blog` 标签的 Inbox 内容自动加入。没有明确标签但疑似属于阅读材料的内容只进入待确认候选。已带 `status: processed` 或有效 `output_path` 的内容可以建议退出待阅读状态。

### 4.3 项目索引

`project-index.json` 只连接项目 Markdown、项目 Todo 和行为事件，不复制项目正文。

```json
{
  "version": "1.0",
  "projects": [
    {
      "id": "project_thirdspace",
      "name": "ThirdSpace",
      "path": "04-项目/产品系统/项目目录",
      "status": "active",
      "stage": "active",
      "repo_mappings": ["agent-tooling"],
      "last_activity_at": null,
      "last_reviewed_at": null
    }
  ]
}
```

项目核心规划、里程碑、进度和复盘仍由 `04-项目/<分类>/<项目>/` 内的 Markdown 表达。

### 4.4 Agent 运行状态

`agent-state.json` 保存开场、报告和远端同步的恢复点：

```json
{
  "version": "1.0",
  "last_manual_checkin": null,
  "last_daily_opening": null,
  "last_weekly_review": null,
  "last_monthly_review": null,
  "last_remote_sync": {},
  "pending_confirmations": []
}
```

它用于避免一天重复开场，并为未来定时巡检、失败恢复和并发检测提供状态。

## 5. 每日开场

第一版由用户主动打开 Pi Agent 触发。若 `last_daily_opening` 不是当天，执行完整开场：

1. 展示遗留、逾期、临近 DDL 和长期无活动事项。
2. 询问昨天及更早的事项中哪些已经完成、取消或进入等待。
3. 更新任务状态并追加状态变化事件。
4. 扫描 Inbox 和阅读队列。
5. 展示新增、正在阅读、滞留超过 7 天和待确认的阅读材料。
6. 询问今天准备推进什么，新增或激活对应事项。
7. 与用户确认 1～3 个今日重点。
8. 将今日重点和计划快照写入当天工作日志。
9. 更新 `last_daily_opening`。

当天再次打开 Agent 时不重复完整开场，只提供显式的“重新规划今天”入口。未来的定时任务只巡检，不冒充用户主动开场。

### 5.1 提醒策略

- 已逾期：每天重点提醒。
- 未来 24 小时到期：重点提醒。
- 未来 3 天到期：普通提醒。
- 无 DDL 且长期 `active`：进入遗忘预警。
- `waiting`：到 `review_after` 后重新提示。
- 阅读材料滞留超过 7 天：进入阅读积压提醒。

### 5.2 日志快照

工作日志只记录当日承诺：

```markdown
## 今日重点

- ...

## 今日计划快照

- [high] ...
- [normal] ...
```

该内容是历史快照，不作为任务事实源，也不从日志反向同步任务状态。

## 6. 本地与远端行为事件

事件目录分层：

```text
.thirdspace/events/
├── local/YYYYMMDD.ndjson
├── remote/<source-id>/raw/events.ndjson
└── normalized/YYYYMM.ndjson
```

- `local` 保存本机 Hook 和日常管理状态变化。
- `remote/.../raw` 保存通过 SSH 拉取的远端原始副本，不进行人工修改。
- `normalized` 保存校验、去重和补项目映射后的统一事件。

统一事件格式：

```json
{
  "schema_version": "1.0",
  "event_id": "lab-server:git:commit-sha",
  "timestamp": "2026-08-22T10:30:00+08:00",
  "event_type": "git_commit",
  "source_id": "lab-server",
  "device": "server-a",
  "repo": "research-code",
  "project_id": "project_research",
  "summary": "完成数据预处理模块",
  "metrics": {
    "commits": 1,
    "files_changed": 6,
    "lines_added": 120,
    "lines_deleted": 35,
    "input_tokens": null,
    "output_tokens": null
  },
  "evidence": {
    "commit": "commit-sha",
    "branch": "main"
  }
}
```

第一版事件类型包括：

- `task_created`
- `task_status_changed`
- `daily_plan_created`
- `reading_added`
- `reading_processed`
- `git_commit`
- `agent_session`
- `token_usage`
- `project_progress`
- `remote_sync`

所有导入以 `event_id` 去重。原始事件不可重写；修正通过新事件表达。

## 7. SSH 远端同步

远端服务器不需要 Vault，只维护一个追加式 NDJSON 文件：

```text
/var/lib/thirdspace/events.ndjson
```

每个 Hook 只追加一行 JSON。Git Hook 记录提交、文件和代码行指标；Token 指标由远端 AI 工具或 Agent Hook 单独写入。

服务器地址保存在 Vault 内本机私有配置，仓库到项目的映射由 `project-index.json` 维护：

```text
.thirdspace/config/remote-event-sources.local.yaml
```

```yaml
version: "1.0"
timezone: "Asia/Shanghai"
sources:
  - source_id: lab-server
    ssh_host: lab-server
    remote_path: /var/lib/thirdspace/events.ndjson
    enabled: true
```

实际配置由 `.thirdspace/schema/remote-event-sources.example.yaml` 复制而来，不纳入 Git，不保存 SSH 密码、私钥或 Token。

同步流程：

1. 通过本机 SSH 配置读取远端文件。
2. 保存原始副本。
3. 逐行校验 JSON，隔离损坏行。
4. 按 `source_id + event_id` 去重。
5. 根据 `repo_projects` 补 `project_id`。
6. 写入 normalized 事件流并更新同步游标。

单个服务器不可访问时不阻断报告生成；报告必须明确标注该来源数据缺失。

远端事件处理是脚本数据面：`.thirdspace/events/remote/` 的原始副本和 `.thirdspace/events/normalized/` 的归一化流都不得由 Agent 直接读取、摘要或放入模型上下文。Agent 只调用命令，向用户展示计数、路径和有界摘要。

## 8. 周报与月报

报告写入 `02-日记/复盘/`，遵守 `YYYYMMDD_主题.md` 命名：

```text
20260824_2026年第34周复盘.md
20260831_2026年08月月复盘.md
```

周报包括：

1. 本周计划与实际完成。
2. 各项目进度、行为证据和遗留事项。
3. 论文/Blog 新增、处理和积压变化。
4. Git commit、代码增删和活跃仓库。
5. Agent session 与 Token 使用量。
6. 逾期、等待和长期无活动事项。
7. 下周建议重点。
8. 基于证据的评价。

评价维度包括推进度、聚焦度、阅读维护、项目健康和风险。缺失的数据必须标记为未知，不得按零活动解释。

月报分析完成量、积压量、计划兑现率、项目阶段、阅读吞吐、Git/Agent 活动和 Token 趋势，并总结主要成果、反复阻塞和下月建议。月报不是周报的机械拼接。

生成时严格执行：

```text
remote-sync -> events-normalize -> report-aggregate -> review-generate
```

`report-aggregate` 只生成有界 `ReportInput`，排除原始行、Prompt、Transcript、文件内容和任意事件字段；`review-generate` 由脚本读取该输入并保留受管标记外的用户文字。Agent 只输出计数、生成路径、commit/Token session/完成事项/已处理阅读的有界合计，以及简短覆盖缺口警告。

## 9. 自治权限

### 9.1 自动执行

- 新增和更新普通事项、优先级、DDL 与 tags。
- 更新阅读队列并自动收录明确带 `paper/blog` 标签的内容。
- 将用户明确确认完成的事项标记为 `completed`。
- 生成每日计划快照。
- 拉取、校验、去重和规范化远端事件。
- 生成周报和月报草稿。
- 执行不改变内容语义的 Frontmatter 修复。

### 9.2 必须确认

- 将疑似阅读材料加入正式队列。
- 修改项目阶段、核心规划或里程碑。
- 跨工作区移动文件。
- 将事项标记为 `cancelled`。
- 归档项目。
- 向组织 Wiki 提交内容。
- 发布任何对外内容。

### 9.3 禁止自动执行

- 删除历史事项或事件。
- 重写远端原始事件。
- 修改 Git 历史。
- 保存 SSH 密钥、密码或访问令牌。
- 代替用户阅读论文、写代码或推进项目正文。

## 10. Dashboard 改造

ThirdSpace Dashboard 保留为人类可视化入口，Todo 数据源从工作日志的 `## 今日Todo` 迁移到 `.thirdspace/data/daily-agent/tasks.json`。

第一版 Dashboard 支持：

- 查看今日重点、遗留和逾期事项。
- 新增普通事项。
- 修改状态、优先级、DDL 和 tags。
- 按项目查看项目 Todo。
- 显示阅读队列数量和滞留提醒。
- 打开对应项目或 Inbox 文件。

Dashboard 和 Pi Agent 写入 JSON 时必须读取最新 revision、校验 schema、修改目标记录、原子替换文件并追加状态变化事件。

当前仓库已恢复最小源码、测试与构建结构，以生成物方式提交 `main.js`。Dashboard `0.2.0` 已接入 Daily Agent 的事项与阅读队列，任务状态变化会同步写入结构化状态并追加事件。

## 11. Pi Agent Skill

新增日常管理主 Skill：

```text
00-系统/Skills/daily-agent/
├── SKILL.md
├── references/
│   ├── data-contracts.md
│   ├── daily-opening.md
│   ├── reporting.md
│   └── remote-event-protocol.md
├── templates/
│   ├── weekly-review.md
│   └── monthly-review.md
└── scripts/
    └── daily-agent.mjs
```

Pi Agent 启动后加载 `daily-agent`，再按意图渐进加载 `workspace-inbox`、`workspace-journal`、`workspace-projects`、`worklog` 和 `review`。

## 12. Wiki MCP 扩展

第一版只保留接口，不绑定具体组织 Wiki：

```text
publish_candidate
-> 用户确认
-> wiki adapter
-> 返回 page_id/url
-> 写入发布事件
```

Wiki 发布必须始终需要用户确认。以后实现 MCP Adapter 时不得改变任务、阅读和报告的核心数据结构。

## 13. 实施阶段

### 第一阶段：日常管理核心

- 定义机器 Schema 和初始状态文件。
- 创建 `daily-agent` Skill。
- 实现任务、阅读队列、项目索引和开场状态操作。
- 扫描带 `paper/blog` 标签的 Inbox。
- 实现每日开场和计划快照。
- 为所有状态变化追加事件。

### 第二阶段：Dashboard

- [x] 恢复插件源码与构建结构。
- [x] 将 Todo 数据源迁移到 `tasks.json`。
- [x] 增加优先级、DDL、tags、项目 Todo 和阅读积压界面。

### 第三阶段：事件与报告

- [x] 实现远端事件协议、SSH 拉取、去重和归一化。
- [x] 实现周报、月报模板与证据聚合。
- [x] 发布 Daily Agent 意图路由、运维文档和受限上下文边界。

第三阶段已于 2026-08-22 通过完整验收：Daily Agent 与分发测试全部通过，`audit-subsystems`、`audit-workspaces`、`audit-skill-locations`、`audit-system` 均为零警告、零错误，`git diff --check` 通过。

### 第四阶段：自动化与外部连接

- 增加定时巡检和并发控制。
- 实现组织 Wiki MCP Adapter。

## 14. 第一阶段验收标准

- 用户手动启动一次完整每日开场。
- Agent 能展示和更新遗留事项、优先级、DDL、tags 与项目关联。
- Agent 能自动识别带 `paper/blog` 标签的 Inbox 内容。
- Agent 能生成正式阅读队列和待确认候选。
- Agent 能询问今日计划并写入当天计划快照。
- 当天第二次启动不会重复完整开场。
- 所有结构化状态变化都有事件记录。
- Agent 不修改项目正文、不跨工作区移动文件、不删除历史。
- 数据文件损坏时停止写入并给出可恢复错误，不静默覆盖。
