# 论文分类定义：具身智能体

> 本文件是该研究方向下论文的**精细分类定义**，配合 `03-知识/WORKSPACE.md` 的概览使用。
> 新论文先按概览粗匹配，再读本文件做精准匹配。

## 一句话定义

研究用 **LLM / 代码 / VLM / 记忆机制**驱动 embodied agent 完成任务或自我进化的**工程范式与方法**。核心是「**agent 如何组织与执行任务**」（而非单个端到端模型）。

## 核心关注

- Coding agents for robotics（代码即策略、代码生成控制）
- VLM agent 的视觉技能记忆 / 自我进化（self-evolving skill memory）
- Language-model programs for embodied control
- Agent 的技能获取、复用与演化机制

## 纳入标准

满足以下任一主线即可归入：

- 论文主贡献是 **coding agent / 代码生成**用于机器人操作或 benchmark。
- 论文提出 **VLM agent 的技能记忆 / 自我进化**机制。
- 论文是「用 LLM / 程序 / 记忆去**组织与驱动** embodied 任务」的范式，而非一个 VLA 模型。

## 典型主题 / 关键词

`coding-agent` · `Code-as-Policies` · `VLM-agent` · `skill-memory` · `self-evolving` · `embodied-agent` · `language-model-programs` · `robot-manipulation`

## 边界与歧义（精准匹配判别规则）

### vs VLA与策略
- 本类强调「**agent 范式**（代码 / 记忆 / 自我进化）」而非端到端 VLA 模型。
- 判别问题：是一个 VLA 模型，还是一个用代码 / 记忆组织任务的 agent 框架？
- 例：Code as Policies（LLM 生成代码控制）→ 本类；CaP-X（coding agents benchmark for robot manipulation）→ 本类。

### vs 世界模型-WAM
- 本类是**任务执行 / 记忆机制**层面，不聚焦世界动态预测。
- 若论文重点是 agent 的视觉技能记忆演化 → 本类；若重点是 world model 表征 → 世界模型-WAM。
- 例：AtlasVA（Self-Evolving Visual Skill Memory for VLM Agents）→ 本类。

### vs 空间智能
- 本类不聚焦空间理解；若论文主贡献是空间 grounding / 空间 benchmark → 空间智能。

## 现有代表论文

- Code as Policies: Language Model Programs for Embodied Control
- CaP-X: Benchmarking and Improving Coding Agents for Robot Manipulation
- AtlasVA: Self-Evolving Visual Skill Memory for Teacher-Free VLM Agents

## 关联类

- 常与 **VLA与策略** 互补：VLA 提供底层策略，本类提供上层的任务组织 / 技能记忆。
