# 04-项目 工作区规范

## 用途

管理正在推进的研究与工程项项目。

## 允许

- 项目计划
- 项目素材索引
- 需求文档
- 脚本草稿
- 局部 AGENTS.md 或 CLAUDE.md
- 项目内 `.codex/skills/`，用于维护该项目独有流程

## 禁止

- 全局知识库规范
- 无项目归属的长期知识笔记

## 命名

项目不预设分类目录；每个项目直接建一级目录并自行维护说明：

```text
04-项目/YYYYMMDDHHMM_项目名/
```

项目目录使用 `YYYYMMDDHHMM_项目名/`。历史项目目录若只有日期没有时分，可以先保留，后续重命名必须通过分类审计和迁移 trace。项目内文档可使用 `brief.md`、`plan.md`、`assets.md`、`review.md`。

复杂项目允许保留 `_assets/`、`_template/`、`research/`、`renders/` 等内部结构；这些目录属于项目运行上下文，不按全库一层目录规则强制打散。旧 prompt 入口不得留在项目资产中，必须迁入 Skill references 或归档。

## Frontmatter

项目内核心 Markdown 必须包含 `project` 与 `stage` 字段；`project_type` / `project_category` 不作为枚举约束，项目维度自行写入 `tags` 或项目内说明文档。

分类规则以 `.thirdspace/schema/frontmatter.yaml` 的 `conditional_fields.project` 为准。

## 子 Skill

使用 `workspace-projects`。
