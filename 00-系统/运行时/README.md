---
workspace: "00-系统"
type: "spec"
topic: "system"
status: "active"
source: "agent"
---

# ThirdSpace 运行时资产

这里保存跨电脑迁移需要的运行时规格。Agent 应该把这里当成 hook、crontab、自动化任务的源头，而不是只依赖本机散落配置。

## 目录

- `hooks/`：Git hook 模板。
- `crontab/`：crontab 模板。
- `automations/`：Codex 或其他 Agent 平台的自动化任务规格。
- `remote-events/`：远端 Git/Agent Exit 事件生产器、示例和服务器端安装说明。
- `manifest.yaml`：当前运行时资产索引（路径无关，无硬编码绝对路径）。

## Apple EventKit 本地 Bridge

EventKit Skill 的 Swift Bridge 只支持 macOS 14 及以上。源码随 vault 分发，发布可执行文件必须在每台 Mac 上本地构建；`eventkit-bridge/.build/` 不是可分发资产，不应由 Git 跟踪。在 vault 根目录执行：

```bash
bash 00-系统/Skills/eventkit/scripts/build-bridge.sh
node 00-系统/Skills/eventkit/scripts/eventkit-adapter.mjs call \
  --json '{"action":"auth.status","params":{}}'
node 00-系统/Skills/eventkit/scripts/eventkit-adapter.mjs call \
  --json '{"action":"auth.request","params":{}}'
```

第一条命令构建 release Bridge 并检查 Calendar/Reminders 用途声明。先用 `auth.status` 只检查状态；`auth.request` 会触发 macOS 系统授权，仅能在用户当场并明确同意后运行。普通 `today`/每日开场流程永远不运行 `auth.request`；权限不可用时标记 Calendar 或 Reminders 来源不可用，并继续本地任务流程。

默认可执行文件是 `00-系统/Skills/eventkit/scripts/eventkit-bridge/.build/release/eventkit-bridge`。需要使用其他本地构建时，传入其绝对路径：

```bash
export THIRDSPACE_EVENTKIT_BRIDGE="/absolute/path/to/eventkit-bridge"
```

macOS 会按可执行文件的身份和路径保存 Calendar/Reminders 授权。重新构建、移动 Bridge 或切换 `THIRDSPACE_EVENTKIT_BRIDGE` 后，授权可能需要更新。如果返回 `PERMISSION_DENIED`：

1. 停止 Calendar/Reminders 读写，不要自动重试 `auth.request`。
2. 请用户在“系统设置 → 隐私与安全性 → 日历”和“提醒事项”中检查对应 Bridge 的完全访问权限。
3. 如果条目缺失或指向旧构建，在用户明确同意后为当前 Bridge 重新运行 `auth.request`，再次检查 `auth.status`。

## 初始化（新机器）

在 vault 根目录执行：

```bash
# 1. 解析 vault 根（如果不在 vault 内）
VAULT=$(node {SKILLS}/thirdspace-vault/scripts/thirdspace-vault.mjs resolve-vault --cwd "$PWD")

# 2. 安装运行时（git hook + crontab）
node {SKILLS}/thirdspace-vault/scripts/thirdspace-vault.mjs install-runtime --vault "$VAULT" --all

# 3. 验收
ls "$VAULT/.thirdspace"
cat "$VAULT/.thirdspace/workspace-index.yaml"
```

`{SKILLS}` = ThirdSpace skills 根目录（vault 内相对路径 `./00-系统/Skills`，即 `{VAULT}/00-系统/Skills`）。

## 远端事件与报告

1. 按 `remote-events/README.md` 将生产器复制到远端主机；生产器只追加元数据和聚合计数。
2. 在本机从 `.thirdspace/schema/remote-event-sources.example.yaml` 复制出 `.thirdspace/config/remote-event-sources.local.yaml`，填写 SSH alias 和绝对远端路径。该文件仅留在本机。
3. 由 Daily Agent 按 `remote-sync -> events-normalize -> report-aggregate -> review-generate` 执行；把 `report-aggregate` 返回的 `path` 传给 `review-generate --input <path>`，不重新聚合。

NDJSON 原始副本和归一化流只是脚本输入，不是 Agent 读取目标。Agent 只向用户展示计数、生成路径和有界聚合摘要。单个远端来源失败时保留其他来源结果，并在报告中标记覆盖缺口。

## Obsidian 插件

插件随 vault 版本控制（`.obsidian/plugins/thirdspace-dashboard/`）。当前 `0.2.0` 直接读取 Daily Agent 的事项与阅读队列，并保留可复现的源码、测试和构建配置。初始化后在 Obsidian 中：设置 → 第三方插件 → 启用 ThirdSpace Dashboard。

## 规格引用

- `manifest.yaml`：资产索引 + 安装命令
- `{VAULT}/.thirdspace/schema/event-capture.yaml`：Agent 事件采集规格
- `{VAULT}/.thirdspace/schema/workspace-tools.yaml`：工作区→Skill 绑定
