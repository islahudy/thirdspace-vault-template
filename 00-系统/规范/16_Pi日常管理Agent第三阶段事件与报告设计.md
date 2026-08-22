---
title: "Pi 日常管理 Agent 第三阶段：事件与报告设计"
type: "spec"
topic: "system"
workspace: "00-系统"
created: "2026-08-22 15:00:00"
modified: "2026-08-22 15:00:00"
tags: ["system", "spec", "pi-agent", "events", "review"]
source: "manual"
status: "active"
---

# Pi 日常管理 Agent 第三阶段：事件与报告设计

## 1. 目标与范围

第三阶段为 Pi 日常管理 Agent 增加多远端事件同步、确定性聚合和周报/月报生成能力。服务器只采集 Git commit 与 Agent 会话 Token 总量；本机负责拉取、校验、去重、归一化和聚合。Pi Agent 默认只读取限定周期的聚合结果，不读取逐条原始事件。

首个实际远端来源使用本机 SSH Config 中的 Host `183`，事件文件为 `/nas/users/xxxiang/person/events.ndjson`。系统从第一版起支持多个远端来源。

不在本阶段实现定时运行、组织 Wiki 发布、远端自动安装和 Agent 工作流水采集。

## 2. 核心原则

- 远端只采集，本机统一聚合，聚合规则只有一个事实源。
- 原始事件不可人工改写；归一化数据和报告输入可以重建。
- Agent 上下文只接收周期摘要，不接收完整 NDJSON。
- 同步失败可恢复，重复拉取不产生重复统计。
- 事实与评价分离；评价必须能追溯到聚合证据。
- SSH 密码、私钥、访问令牌和认证材料不得写入 Vault。

## 3. 总体架构

```text
服务器 Git Hook ───────┐
服务器 Agent Exit Hook ├─> events.ndjson
                       │
本机 remote-event-sync <── SSH
     │
     ├─> remote/<source-id>/raw/events.ndjson
     ├─> normalized/YYYYMM.ndjson
     └─> report-input/<period>.json
                         │
                         v
                 Pi Agent 生成周报/月报
```

远端事件文件采用 NDJSON，一行一个 JSON 对象，只允许追加。Git Hook 写入 `git_commit`；Codex、Claude Code、Pi 等 Agent 的 Exit Hook 在会话结束时写入一条 `token_usage` 汇总。

## 4. 配置

仓库保存无秘密的配置模板：

```text
.thirdspace/schema/remote-event-sources.example.yaml
```

每台本机保存实际配置：

```text
.thirdspace/config/remote-event-sources.local.yaml
```

本机配置必须被 Git 忽略。每个来源包含：

```yaml
sources:
  - source_id: "183"
    ssh_host: "183"
    remote_path: "/nas/users/xxxiang/person/events.ndjson"
    enabled: true
```

`ssh_host` 只引用用户已有的 SSH Config alias。配置和事件中均不保存认证信息。

## 5. 远端事件协议

### 5.1 公共字段

每个事件必须包含：

```json
{
  "schema_version": "1.0",
  "event_id": "183:git:commit-sha",
  "timestamp": "2026-08-22T10:30:00+08:00",
  "event_type": "git_commit",
  "source_id": "183"
}
```

`event_id` 在所有同步周期内稳定且唯一。时间必须包含时区。

### 5.2 Git commit

`git_commit` 记录：仓库标识、分支、commit SHA、提交信息、改动文件数、增加行和删除行。它不记录文件正文或 diff。

```json
{
  "event_type": "git_commit",
  "repo": "research-code",
  "branch": "main",
  "summary": "完成数据预处理模块",
  "metrics": {
    "commits": 1,
    "files_changed": 6,
    "lines_added": 120,
    "lines_deleted": 35
  },
  "evidence": { "commit": "commit-sha" }
}
```

### 5.3 Token 用量

`token_usage` 由 Agent Exit Hook 在会话退出时追加，一次会话一条。它只保存整体用量，不保存对话、命令和文件操作。

```json
{
  "event_type": "token_usage",
  "model": "example-model",
  "session_id": "stable-session-id",
  "repo": "research-code",
  "metrics": {
    "input_tokens": 1000,
    "output_tokens": 300,
    "cache_read_tokens": null,
    "cache_write_tokens": null,
    "total_tokens": 1300
  }
}
```

Agent 无法提供的计数字段写 `null`。事件 ID 由 `source_id`、Agent、稳定会话 ID 组合产生，避免重复执行 Exit Hook 时重复统计。

## 6. 本机组件

### 6.1 remote-event-sync

读取本机来源配置，通过 SSH 只读获取远端 NDJSON。每个来源独立处理；一个来源失败不阻塞其他来源。内容先写临时文件，完成基础校验后再更新本地 raw 副本和同步状态。

原始副本路径：

```text
.thirdspace/events/remote/<source-id>/raw/events.ndjson
```

同步结果写入 `agent-state.json` 的 `last_remote_sync`，至少保存成功时间、状态和错误摘要。

### 6.2 event-normalizer

逐行解析 raw 事件，校验版本、必填字段、时间、事件类型和 ID，并以 `source_id + event_id` 去重。仓库标识按照 `project-index.json` 的 `repo_mappings` 补充 `project_id`。

合法事件写入：

```text
.thirdspace/events/normalized/YYYYMM.ndjson
```

损坏行、未知事件类型和冲突 ID 写入机器可读错误报告，包含来源、行号和原因；它们不进入统计，也不妨碍其他合法事件继续处理。

### 6.3 report-aggregator

聚合器接收报告类型、周期起止时间和时区，读取 normalized 事件及 Daily Agent 当前状态，输出限定周期的精简输入：

```text
.thirdspace/data/daily-agent/report-input/<period>.json
```

输出包含：

- Commit 按项目和仓库组织的简洁列表，以及 commits、files changed、lines added、lines deleted 汇总。
- Token 按模型汇总的会话数及 input、output、cache read、cache write、total。
- 周期内完成事项、当前遗留事项、阅读处理量和阅读积压。
- 项目活动、无活动项目和数据缺失提示。
- 支撑每项统计的事件 ID 或 Daily Agent 对象 ID。

相同或高度相关的提交可以在列表中归组，但必须保留 commit 证据 ID。聚合过程是确定性的，不调用语言模型。

### 6.4 review-generator

Pi Agent 只读取 `report-input/<period>.json` 和报告模板，生成周报或月报。事实部分直接来自聚合结果；评价部分围绕完成度、聚焦程度、积压、项目推进和数据覆盖度给出简短判断。证据不足时明确标记缺少数据，不推测用户行为。

## 7. 报告周期与输出

统一使用 `Asia/Shanghai`：

- 周报：周一 00:00:00 至周日 23:59:59。
- 月报：自然月第一天 00:00:00 至最后一天 23:59:59。
- 默认生成刚结束的完整周期，也允许显式指定日期范围。
- 第一版由用户手动触发，定时巡检留到第四阶段。

报告输出到：

```text
02-日记/复盘/
```

报告包括事项完成与遗留、阅读情况、项目活动、Git 统计、Token 用量、关键事实和简短评价。同一周期重新生成时只替换 Agent 管理区域，不覆盖用户人工补充内容。

## 8. 远端安装资产

远端部署材料位于：

```text
00-系统/运行时/remote-events/
```

至少包含：

- 可复制的 NDJSON 事件协议与示例。
- Git post-commit Hook 安装脚本或模板。
- Codex 等 Agent 的 Exit Hook 配置示例。
- Token 字段适配说明；不可用字段写 `null`。
- 文件权限、并发追加、稳定事件 ID、重复调用和常见错误排查。

安装说明不得要求服务器存在完整 Vault，也不得自动修改服务器。用户在对应机器上按说明主动安装。

## 9. 安全与失败恢复

- SSH 同步只读取配置的精确文件路径，不执行远端写操作。
- 不在 Vault 中保存 SSH 密钥、密码、访问令牌或 Agent 对话内容。
- Raw 原始副本不可由 Agent 重写；normalized 和 report-input 可从 raw 重建。
- 同步、归一化和聚合均支持重复执行，并以事件 ID 保证幂等。
- 单个来源不可达、文件不存在或部分行损坏时，保留上次成功状态并报告局部失败。
- 报告生成前必须校验周期边界、时区、输入版本与聚合完成状态。

## 10. 验收标准

- 支持多个远端来源，并能使用 `183:/nas/users/xxxiang/person/events.ndjson` 配置。
- 一个来源失败时，其他来源仍能完成同步。
- 重复同步和重复 Exit Hook 不产生重复统计。
- 损坏行、重复 ID、未知模型和缺失 Token 字段可以安全降级。
- Commit 按仓库和项目生成汇总列表及改动统计。
- Token 按模型汇总会话数和总用量。
- Pi Agent 不需要读取 raw 或 normalized 逐条事件即可生成报告。
- 周报与月报包含任务、阅读、项目、Git、Token、数据覆盖提示和评价。
- 远端安装说明可用于没有 Vault 的 Codex 等 Agent 环境。
- 现有 Daily Agent、Dashboard 和 Vault 审计继续通过。
