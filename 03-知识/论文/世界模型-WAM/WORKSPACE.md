# 论文分类定义：世界模型-WAM

> 本文件是该研究方向下论文的**精细分类定义**，配合 `03-知识/WORKSPACE.md` 的概览使用。
> 新论文先按概览粗匹配，再读本文件做精准匹配。

## 一句话定义

研究如何**构建、预测与表征环境动态**的世界模型（World Model / WAM），包括 latent action 建模、记忆与长期一致性、视频 / 4D 生成式仿真。核心是「模型内部对未来与未见动态的预测与表征」。

## 核心关注

- 世界模型 / WAM 的架构与训练范式
- Latent Action Model（LAM）：从无动作标注的视频中学习动作潜空间
- 记忆机制：长期记忆、持久记忆、3D 记忆、可演化记忆
- 视频 / 4D 生成式世界模型与仿真（含 out-of-sight / 不可见动态）
- 世界模型 latent space 的设计哲学（reconstruction vs semantics）

## 纳入标准

满足以下任一主线即可归入：

- 论文的主贡献是**世界 / 动力学模型本身**（预测未来帧、未来状态、未来 token）。
- 论文聚焦于 **latent action / 动作潜空间** 的学习、对齐或表征（即使服务于下游策略）。
- 论文研究**记忆**在世界模型中的角色（持久化、长期一致性、3D 结构记忆）。
- 论文是**视频 / 4D 生成式仿真**，用生成模型模拟环境动态。
- 论文讨论**世界模型 latent space 的语义性质**（reconstruction 还是 semantics 更有用）。

## 典型主题 / 关键词

`world-model` · `WAM` · `latent-action` · `memory` · `persistent-memory` · `3D-memory` · `video-world-model` · `4D-simulation` · `dynamics-prediction` · `reconstruction` · `out-of-sight`

## 边界与歧义（精准匹配判别规则）

### vs VLA与策略
- 本类侧重「**预测 / 建模世界动态**」本身，哪怕最终服务于策略。
- 若论文核心是 **action synthesis / 策略学习 / intent-action 解耦**，即使用到 world model 作支撑，归 **VLA与策略**。
- 判别问题：论文的卖点是「更准地预测世界」还是「更好地生成动作」？前者本类，后者 VLA与策略。
- 例：WAM4D（4D world action model）若重点在 world-action 的 4D 预测 → 本类；若重点在 action decoding → VLA与策略。当前按「world action model」归本类。

### vs 空间智能
- 本类若涉及空间 / 3D，重点是**世界模型中的几何 / 记忆表征**。
- 若论文重点是**空间理解 benchmark、grounding、空间推理任务本身**（而非用生成模型预测动态），归 **空间智能**。
- 判别问题：论文是「建一个会预测动态的模型」还是「评测 / 提升空间理解能力」？前者本类，后者 空间智能。

### vs 具身智能体
- 本类是**模型 / 表征**层面，不强调「用 agent 范式（代码 / 记忆 / 自我进化）去完成任务」。
- 若论文重点是 agent 的技能记忆 / 自我进化 / 用 LLM 驱动控制，归 **具身智能体**。

## 现有代表论文

- Cosmos 3: Omnimodal World Models for Physical AI
- DexWorldModel: Causal Latent World Modeling
- Learning 3D Persistent Embodied World Models
- LiveWorld: Simulating Out-of-Sight Dynamics in Generative Video World Models
- Reconstruction or Semantics? What Makes a Latent Space Useful for Robotic World Models
- Learning Latent Action World Models In The Wild
- Echo-Infinity（世界模型记忆机制 / 长视频生成）
- WAM4D: Fast 4D World Action Model via Spatial Register Tokens

## 关联类

- 上游常为 **VLA与策略**（WAM 服务于 VLA）；下游评测常借 **空间智能** 的能力。
