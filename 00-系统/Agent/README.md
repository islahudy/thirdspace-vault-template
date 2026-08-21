# ThirdSpace Agent 运行入口

从 vault 根目录的 `AGENTS.md` 开始，按 `.thirdspace/workspace-index.yaml` 识别目标工作区，再依次读取 `.thirdspace/schema/` 下的 canonical 契约、当前 `WORKSPACE.md` 与对应 Skill。

本目录只保存 Agent 入口说明；机器可读 Schema 位于 `.thirdspace/schema/`，生成的审计报告位于 `.thirdspace/reports/`。
