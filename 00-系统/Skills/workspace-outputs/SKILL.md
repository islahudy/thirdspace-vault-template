---
name: workspace-outputs
description: Use when maintaining ThirdSpace `06-输出`, articles, decks, publish-ready assets, or output lifecycle states.
triggers:
  - "文章"
  - "PPT"
  - "组会"
  - "学术汇报"
---

# Workspace Outputs Skill

## 工作区

`{VAULT}/06-输出`

## 规则来源

先读 `{VAULT}/06-输出/WORKSPACE.md`。

## 文件创建

- 文章写入 `文章/YYYYMMDD_文章标题.md`。
- PPT 说明写入 `PPT/YYYYMMDD_PPT主题.md`。

## 自治维护回路

1. 判断输出类型：文章或 PPT（组会/学术汇报）。
2. 补 `workspace=06-输出`、`type=article|deck`、`status=draft|review|published|archived`。
3. 记录来源关系：`sources`、`project` 或上游知识笔记。
4. 发布后更新状态为 `published`，需要归档时流转到 `99-归档`。
5. 如果只是素材或原始研究，回流到 `03-知识`、`04-项目` 或 `05-资源`。

## 审计项

- 成品是否缺来源关系。
- `draft`、`review`、`published`、`archived` 状态是否混乱。
- 是否混入原始素材或系统规范。
- Markdown 是否缺 Frontmatter。

## 修复策略

- 可自动修复：补 `workspace/type/status`、创建缺失输出目录。
- 写队列：建议补 `sources`、`project` 或发布状态。
- 必须 trace：发布后归档或回流项目。
