# 论文分类定义：空间智能

> 本文件是该研究方向下论文的**精细分类定义**，配合 `03-知识/WORKSPACE.md` 的概览使用。
> 新论文先按概览粗匹配，再读本文件做精准匹配。

## 一句话定义

研究 **3D / 空间理解、空间感知与推理、相关 benchmark 与 grounding**，尤其是 embodied 场景下的空间能力。核心是「**理解空间**」（而非用生成模型预测动态）。

## 核心关注

- 3D 视觉理解 / 空间推理
- 空间记忆与长程空间 benchmark（room-tour、embodied spatial）
- Vision-Language Grounding（目标检测、并行框解码、指代）
- 多视角 3D 重建
- 在线 / 流式 3D 空间理解（incremental geometry priors）
- 主动感知与 perception-action loop

## 纳入标准

满足以下任一主线即可归入：

- 论文主贡献是**空间 / 3D 理解或推理能力**（模型或评测）。
- 论文提出 **空间 / 具身 spatial benchmark**（评测长程空间记忆、空间关系、主动感知）。
- 论文主打 **vision-language grounding / 检测 / 指代**。
- 论文是 **多视角 3D 重建**或**在线 3D 空间理解**。

## 典型主题 / 关键词

`spatial` · `3D` · `benchmark` · `grounding` · `multi-view` · `3D-reconstruction` · `embodied-spatial` · `perception-action-loop` · `spatial-memory` · `active-perception`

## 边界与歧义（精准匹配判别规则）

### vs 世界模型-WAM
- 本类是「**空间理解 / 感知 / 评测**」任务，而非用生成模型预测动态。
- 若论文重点是**空间记忆的 benchmark** 而非 world model 本身 → 本类。
- 判别问题：论文是「评测 / 提升空间理解」还是「建一个会预测动态的模型」？前者本类，后者 世界模型-WAM。
- 例：LongSpace（long-horizon spatial memory benchmark）→ 本类；ESI-Bench（embodied spatial intelligence）→ 本类。

### vs VLA与策略
- 本类不把动作生成作为主贡献。
- 若论文主打空间 grounding 用于支撑 VLA，但核心是 grounding 能力本身 → 本类；若核心是 VLA → VLA与策略。

### vs 具身智能体
- 本类是**空间能力 / 模型**，而非 agent 的执行范式（代码 / 记忆 / 自我进化）。
- 判别问题：论文贡献是「空间理解模型 / benchmark」还是「agent 的任务执行机制」？

## 现有代表论文

- SpatialBench: Is Your Spatial Foundation Model an All-Round Player?
- ESI-Bench: Towards Embodied Spatial Intelligence that Closes the Perception-Action Loop
- Stream3D-VLM: Online 3D Spatial Understanding with Incremental Geometry Priors
- DéjàView: 循环 Transformer 多视角 3D 重建
- LocateAnything: Fast and High-Quality Vision-Language Grounding with Parallel Box Decoding
- LongSpace: 长程空间记忆 Benchmark

## 关联类

- 为 **VLA与策略** 与 **世界模型-WAM** 提供空间 / 感知基础；常作为它们的输入或评测维度。
