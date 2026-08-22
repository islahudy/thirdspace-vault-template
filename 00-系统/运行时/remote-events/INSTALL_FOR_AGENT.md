---
title: "Remote Events Agent Installation Contract"
type: "spec"
topic: "system"
workspace: "00-系统"
created: "2026-08-22"
modified: "2026-08-22"
tags: ["daily-agent", "remote-events", "installation"]
source: "agent"
status: "active"
---

# Remote Events Agent Installation Contract

## 给执行安装的 Agent

用户会把本文件交给服务器上的 Codex、Claude Code 或其他编码 Agent，并要求“参考本说明安装”。该请求授权你在当前服务器内检查环境、提出具体安装方案，并在说明的边界内配置 Hook；它不授权你连接其他机器、安装 Vault、保存凭据、调用外部模型 API或改变事件协议。

安装期间可以正常使用当前 Agent 完成一次配置工作。安装后的 Hook 必须只运行本地 Shell、Node.js 和 Git 命令，不得调用语言模型、OpenAI/Anthropic API 或启动新的 Agent，因此日常采集不得产生额外 Token 消耗。

## 最终目标

将当前服务器上的两类事实追加到一个私有 NDJSON 文件：

- `git_commit`：commit SHA、时间、仓库、分支、提交标题、文件数和增删行数。
- `token_usage`：一次 Agent 会话退出时，按模型记录该会话的整体 Token 计数。

不得记录 diff、文件名、文件正文、对话、prompt、命令、工具输入、凭据或环境变量转储。

本服务器的推荐参数是：

```text
source_id: 183
event_file: /nas/users/xxxiang/person/events.ndjson
producer_dir: ~/.local/lib/thirdspace-remote-events
```

最终事件必须由同目录中的 `git-post-commit.sh` 和 `agent-exit-token.sh` 生成。不要复制它们的 JSON 生成逻辑到新的 Hook 中；产品适配器只负责把 Hook 输入映射到生产脚本接受的环境变量或安全 stdin。

## 不可改变的契约

1. `events.ndjson` 一行一个 JSON，只追加，不重写、不轮转、不删除历史。
2. 目录权限为 `0700`，事件文件权限为 `0600`。
3. `THIRDSPACE_EVENT_FILE` 必须是明确的绝对路径。
4. `THIRDSPACE_SOURCE_ID` 使用 `183`；完整值 `.` 和 `..` 禁止。
5. Git event ID 必须保持 `source_id:git:full_commit_sha`。
6. Token event ID 必须由稳定的 Agent 会话 ID 生成；Hook 重试不能生成新 ID。
7. 无法取得的 Token 字段写 `null`，不得估算或调用模型补全。
8. Vendor 的完整 Hook JSON 只能通过 stdin 传递，不得放进进程参数。
9. 适配器必须对字段做白名单映射；不得将原始 payload 追加到事件文件。
10. 修改已有 Hook 配置前必须备份或使用产品提供的合并机制，不得静默覆盖其他 Hook。

## 安装前检查

先只读检查并向用户简要报告：

```sh
uname -a
command -v node && node --version
command -v git && git --version
command -v codex && codex --version || true
command -v claude && claude --version || true
```

然后确认：

- 本说明、`git-post-commit.sh`、`agent-exit-token.sh` 位于同一个安装包目录。
- `/nas/users/xxxiang/person/` 是用户指定的私有目录，不是共享可写目录或符号链接。
- 需要采集 Git commit 的仓库清单；不要扫描并修改所有仓库。
- 当前 Codex/Claude Code 版本实际支持的 SessionEnd、Stop、Exit 或等价 Hook 机制和配置位置。
- 现有配置中是否已经存在同类 Hook。

不要凭记忆假设某个产品的 Hook JSON 格式。优先查看当前版本的 `--help`、内置配置说明或官方文档，再选择具体配置。若当前版本没有可靠的会话结束 Hook，停止该产品的 Token Hook 安装并报告限制；Git Hook 仍可独立安装。

## 安装步骤

### 1. 安装生产脚本

使用等价的安全文件操作完成：

```sh
install -d -m 700 /nas/users/xxxiang/person
touch /nas/users/xxxiang/person/events.ndjson
chmod 600 /nas/users/xxxiang/person/events.ndjson

install -d -m 700 "$HOME/.local/lib/thirdspace-remote-events"
install -m 700 git-post-commit.sh agent-exit-token.sh \
  "$HOME/.local/lib/thirdspace-remote-events/"
```

安装后验证生产脚本与事件目录不是符号链接，权限符合契约。

### 2. 配置指定仓库的 Git Hook

只为用户指定的仓库配置 `post-commit`。Wrapper 的语义必须等价于：

```sh
#!/bin/sh
export THIRDSPACE_EVENT_FILE=/nas/users/xxxiang/person/events.ndjson
export THIRDSPACE_SOURCE_ID=183
exec "$HOME/.local/lib/thirdspace-remote-events/git-post-commit.sh"
```

如果仓库已经有 `post-commit`：

- 优先保留原文件并追加一个可识别、可卸载的 ThirdSpace 调用块；或
- 创建链式 wrapper，先保留原行为，再执行 ThirdSpace producer。

不得丢弃或覆盖原 Hook。记录每个修改过的仓库和备份路径。

### 3. 配置 Codex/Claude Code 会话结束 Hook

根据当前已安装版本自行选择正式支持的会话结束事件，例如 SessionEnd、Stop 或 Exit。Hook 的触发脚本负责：

1. 从产品提供的 stdin、环境变量或 transcript 路径确定稳定 `session_id`。
2. 读取产品已经记录的 usage 数字并按模型求和；这是本地确定性解析，禁止请求模型计算。
3. 构造最小白名单对象，或将 vendor payload 通过 stdin 交给生产脚本。
4. 调用：

```sh
THIRDSPACE_EVENT_FILE=/nas/users/xxxiang/person/events.ndjson \
THIRDSPACE_SOURCE_ID=183 \
THIRDSPACE_AGENT=<codex-or-claude-code> \
"$HOME/.local/lib/thirdspace-remote-events/agent-exit-token.sh" --stdin
```

生产脚本支持的白名单字段为：

```text
source_id, agent, session_id, model, repo,
input_tokens, output_tokens, cache_read_tokens,
cache_write_tokens, total_tokens
```

计数可以位于顶层、`metrics` 或 `usage`。如果 Hook payload 不含最终 Token 总量，但提供 transcript 路径，可写一个小型本地解析器逐行读取结构化 usage 并求和；解析器不得把 transcript 内容复制到输出。如果该产品既不提供总量也不提供可解析记录，仍可写 Token event，但未知计数必须为 `null`，并在安装报告中说明。

### 4. 保留安装记录

在用户配置目录保存一份不含秘密的安装记录，例如：

```text
~/.config/thirdspace-remote-events/install-manifest.json
```

至少记录：安装时间、source ID、event file、脚本路径、修改的仓库、修改的 Agent 配置、备份位置和卸载步骤。不得记录 Hook payload、Token、SSH 密钥或账号凭据。

## 必须执行的验收

### 权限和基本格式

```sh
stat -c '%a %n' /nas/users/xxxiang/person /nas/users/xxxiang/person/events.ndjson
tail -n 1 /nas/users/xxxiang/person/events.ndjson | \
  node -e 'let s="";process.stdin.on("data",b=>s+=b).on("end",()=>JSON.parse(s))'
```

期望目录 `700`、文件 `600`，最后一行可以解析为 JSON。

### Git 事件

在用户允许的测试仓库创建一个无敏感内容的测试 commit，确认只新增一条 `git_commit`，且事件中没有文件名或 diff。若不允许创建测试 commit，直接在现有仓库手动调用 producer，并明确说明测试范围受限。

### Token 事件

用虚构、无敏感内容的最小 JSON 直接测试适配器/producer，确认产生一条 `token_usage`。使用相同 `session_id` 再执行一次，确认两条 raw 记录的 `event_id` 相同，以便本机归一化去重。

### 无模型调用

检查所有新增 Hook 和适配器：不得出现 `codex`、`claude`、`curl` 到模型 API、OpenAI/Anthropic SDK 调用或任何启动 Agent 的命令。产品名只允许出现在配置事件名、Agent 标签和说明文字中。

## 完成时回复用户

安装完成后只报告：

- 安装/修改的文件和配置路径。
- 启用的 Git 仓库与 Agent Hook 类型。
- 事件文件权限及两类测试结果。
- 能采集和不能采集的 Token 字段。
- 备份位置和准确卸载步骤。
- 任何版本限制、并发/NFS 风险或尚未验证的项目。

不要在回复中粘贴真实事件、Hook payload、transcript、凭据或完整环境变量。

## 失败与停止条件

遇到以下情况时停止相关安装并询问用户，不要自行扩大权限：

- 目标目录是符号链接、共享可写或无法设置为 `0700`。
- 事件文件不是普通文件或无法设置为 `0600`。
- 需要覆盖无法安全合并的现有 Hook。
- 当前产品版本没有可确认的会话结束 Hook。
- 需要 root 权限、修改系统级配置或连接另一台机器。
- 唯一可行方案需要调用模型/API、读取秘密或把 transcript 写入事件文件。

更详细的事件协议、手动示例和排错说明见同目录 `README.md`。
