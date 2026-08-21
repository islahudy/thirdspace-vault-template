# 论文分类定义：VLA与策略

> 本文件是该研究方向下论文的**精细分类定义**，配合 `03-知识/WORKSPACE.md` 的概览使用。
> 新论文先按概览粗匹配，再读本文件做精准匹配。

## 一句话定义

研究 **Vision-Language-Action 模型**的架构、训练与目标——把视觉-语言输入映射为机器人动作，以及策略 / 动作合成、意图-动作解耦。核心是「**生成与控制动作**」。

## 核心关注

- VLA 模型架构与训练方法
- Action synthesis / decoding 设计（action expert、action-only inference）
- 意图（intention / language reasoning）与动作的解耦
- 从人类视频 / 跨本体（cross-embodiment）学策略
- VLA 系统与技术报告（含真实机器人部署）

## 纳入标准

满足以下任一主线即可归入：

- 论文的主贡献是 **VLA 架构 / 训练 / 推理**本身。
- 论文核心是 **action 的生成、解码或解耦**（含 intent-action decoupling via latent world modeling）。
- 论文提出 **human-to-robot / cross-embodiment 策略学习**（统一物理语言、从人类视频学动作）。
- 论文是 **VLA 技术报告 / 系统**（面向真实机器人闭环）。

## 典型主题 / 关键词

`VLA` · `policy` · `action-synthesis` · `intent-action` · `cross-embodiment` · `human-to-robot` · `VLA-training` · `action-expert` · `world-language-action`

## 边界与歧义（精准匹配判别规则）

### vs 世界模型-WAM
- 本类核心是「**动作生成与策略**」，而非世界动态预测。
- 若论文用 world model **仅为支撑 VLA**（WAM 是组件），归本类。
- 判别问题：论文的卖点是「更好地生成动作」还是「更准确地预测世界」？前者本类，后者 世界模型-WAM。
- 例：WLA（World-Language-Action）统一 world prediction 与 language reasoning，重点是 action synthesis → 本类；CLAP 用对比学习对齐人类视频与机器人动作 latent，重点是学可迁移动作表征 → 本类。

### vs 具身智能体
- 本类是**端到端模型 / 策略本身**。
- 若重点是「用 LLM / 代码 / 记忆去驱动 agent 完成任务」的**工程范式**（而非一个 VLA 模型），归 **具身智能体**。
- 判别问题：是一个 VLA 模型，还是一个用代码 / 记忆组织任务的 agent 框架？

### vs 空间智能
- 本类不把空间理解作为主贡献；若论文主打空间 grounding / 空间 benchmark，归 **空间智能**。

## 现有代表论文

- RD-VLA: 循环深度 VLA 模型
- DIAL: Decoupling Intent and Action via Latent World Modeling for End-to-End VLA
- Galaxea G0.5 Technical Report
- UniT: Toward a Unified Physical Language for Human-to-Humanoid Policy Learning and World Modeling
- CLAP: Contrastive Latent Action Pretraining for Learning VLA Models from Human Videos
- WLA: World-Language-Action Model

## 关联类

- 常以 **世界模型-WAM** 为组件（WAM 提供 world latent）；与 **空间智能** 共享 grounding / 感知需求。
