# ThirdSpace Agent 运行入口

从 vault 根目录的 `AGENTS.md` 开始，按 `.thirdspace/workspace-index.yaml` 识别目标工作区，再依次读取 `.thirdspace/schema/` 下的 canonical 契约、当前 `WORKSPACE.md` 与对应 Skill。

本目录只保存 Agent 入口说明；机器可读 Schema 位于 `.thirdspace/schema/`，生成的审计报告位于 `.thirdspace/reports/`。

## 每日主动开场

用户当天第一次主动打开 Agent，并表达“开始今天”“今日计划”“遗留事项”或“阅读积压”等意图时，加载 `daily-agent` Skill。先运行每日开场回顾，等待用户确认旧事项状态和 1～3 个今日重点，再完成计划快照。

若当天已经完成开场，不重复提问；只有用户明确要求“重新规划今天”时才强制重开。
