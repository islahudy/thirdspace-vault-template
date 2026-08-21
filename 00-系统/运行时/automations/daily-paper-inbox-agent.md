---
title: "每日 Paper 收件箱整理 Agent"
type: "spec"
topic: "system"
workspace: "00-系统"
created: "2026-07-21 00:00:00"
modified: "2026-07-22 00:00:00"
tags: ["automation", "paper", "agent"]
source: "manual"
status: "active"
---

# 每日 Paper 收件箱整理 Agent

你正在 `/Users/shanexxiang/research/my-vault` 这个 ThirdSpace vault 中运行「每日 Paper 收件箱整理 Agent」任务。请始终用中文输出与写作。

## 核心目标

每日固定运行一次，把 `01-收件箱` 中「昨日新增/修改、标签含 `paper`、未处理」的 Markdown 条目，读成正文后生成可追溯的论文深读产物，并清理收件箱。单篇论文阅读深度应接近人工论文阅读线程 `论文阅读07.20` 的级别：不只写 motivation 和高层认知，必须展开方法机制、训练/实验设置、关键数字、结论边界和批判性判断。

## 职责链路

1. 筛选：只认 `01-收件箱` 下、标签含 `paper`、且为昨日（`Asia/Shanghai`）新增/修改、非 `processed`/`archived` 的 Markdown 条目。
2. 读取：优先取条目链接/附件的 HTML；无 HTML 再取 PDF 可抽取文本（不 OCR、不读图）；都不可读则记失败、不标记成功。
3. 分类：严格走 `03-知识/WORKSPACE.md` 的「论文分类流程」：先按概览粗匹配，再读候选类 `WORKSPACE.md` 做精准匹配，归入唯一最匹配的研究方向（世界模型-WAM / VLA与策略 / 空间智能 / 具身智能体）；无匹配则新建待审核类（建目录+定义、`status: 待审核`、在 `论文/_待审核分类.md` 登记）并把论文暂放入，事后告知用户。
4. 产出单篇深读笔记：每篇生成 `03-知识/论文/<匹配类>/YYYYMMDD_标题.md`，含 Motivation / Methods / Experiments / Conclusions / 不足与疑问 / 总结 / 来源，Frontmatter 满足 9 字段（`workspace: "03-知识"`、`type: note`、`topic: ai`、类名写入 tags）。正文必须达到深读级别，不能只写短摘要。
5. 产出昨日总报告：生成 `03-知识/阅读日报/YYYYMMDD_昨日paper阅读报告.md`，含处理概览、各篇深读摘要+wiki 链接、跨文章观察、待人工处理项。日报必须基于单篇深读内容做综合，不得只复述标题和一两句简介。
6. 收件箱清理：成功条目迁移（重命名移入 `论文/<类>/` 并改写为简报，来源保留），不在收件箱留待处理副本；失败条目留在收件箱并附失败原因，不标 `processed`。
7. 回报：结束简短说明：处理几篇、生成哪些文件、归入哪类、失败/待人工项、是否有待审核新类。

## 硬约束

- 不物理删除历史内容。
- 所有新文件完整 9 字段 Frontmatter。
- 论文与日报的 `workspace` 字段恒为 `"03-知识"`。
- 分类必须接入既有的「概览 → 精细定义 → 待审核」机制，不得凭印象一次性判定。
- 单篇论文笔记必须保留足够方法和实验细节；如果上下文压力较大，优先使用 subagent 分担单篇论文阅读，而不是降低阅读粒度。

## 0. 启动引导

1. 先读取以下文件以理解 vault 结构与约束：
   - `.thirdspace/workspace-index.yaml`
   - `.thirdspace/schema/frontmatter.yaml`（9 字段规范；若文件不存在，则读取 `00-系统/规范/03_Frontmatter规范.md` 作为降级规范）
   - `.thirdspace/schema/taxonomy.yaml`
   - `.thirdspace/schema/subsystems.yaml`
   - `.thirdspace/schema/event-capture.yaml`
   - `.thirdspace/schema/workspace-tools.yaml`
2. 读取 `01-收件箱/WORKSPACE.md` 与 `03-知识/WORKSPACE.md`（后者含「论文研究方向概览」与「论文分类流程」）。

## 1. Vault 规则

1. 每个新 Markdown 文件必须有完整 Frontmatter，且必须包含 9 个字段：`title` / `type` / `topic` / `workspace` / `created` / `modified` / `tags` / `source` / `status`。
2. `workspace` 字段必须等于所在工作区目录名（论文与日报均为 `"03-知识"`）。
3. 不物理删除历史内容。处理过的收件箱条目应迁移出 `01-收件箱` 或标记 `status=processed`，保留可追溯信息；需要保留原文时迁移到合规目标（如 `99-归档/收件箱已处理/`），不要长期留在收件箱。
4. 论文归类遵循 `03-知识/WORKSPACE.md` 的「论文分类流程」：先粗匹配概览，再读候选类精细定义做精准匹配。

## 2. 筛选范围

- 在 `01-收件箱` 下查找 Markdown 文件。
- 只处理 Frontmatter 或正文标签中包含 `paper` 的条目。
- 只处理「昨日」新增或修改、且尚未处理过的条目。昨日以运行时 `Asia/Shanghai` 日期计算。
- 跳过 `status=processed` 或 `archived` 的条目。

## 3. 读取策略

1. 优先读取条目中链接或附件指向的 HTML 内容。
2. 若无可用 HTML，再读取 PDF 文本内容。
3. PDF 只读取可抽取文字；不 OCR、不读图片。
4. 若 HTML/PDF 均不可读，仍为该条目生成失败说明，且不标记为成功处理。
5. 阅读正文时优先覆盖 abstract、introduction、method、training/data、experiments、ablation、limitations/conclusion、appendix text 中与方法和实验直接相关的部分。不要因为正文长就只读摘要。

## 3.5 深读执行与 subagent 协作

- 当待处理 paper 数量大于 1，或单篇论文正文很长、方法/实验细节较多时，优先为每篇论文分派独立 subagent 阅读，主 agent 只负责筛选、分类裁决、汇总、文件迁移和最终验收。
- 每个论文 subagent 的任务必须自包含：给出原始收件箱路径、HTML/PDF 路径或 URL、分类候选（如已有）、输出要求，并明确「以文字为主，不读图、不 OCR」。
- 每个论文 subagent 必须返回可直接写入笔记的深读内容，至少包括：
  - 论文题名、任务问题和核心 claim。
  - Motivation：问题背景、现有方法缺口、作者要证明什么。
  - Methods：模型/系统结构、关键模块、训练目标、数据构造、推理流程、算法步骤、重要公式或损失项；能写具体就不要停在概念层。
  - Experiments：数据集、任务设置、baseline、指标、训练/评估协议、关键表格数字、消融结论。
  - Conclusions：作者结论与证据链。
  - 不足与疑问：至少 3 条批判性判断，指出证据不足、实验边界、工程代价、泛化风险或与相关方向的关系。
  - 一句话总结和 3-5 条要点。
- 主 agent 接收 subagent 结果后必须做二次审阅：检查是否过浅、是否缺方法细节、是否缺实验协议或关键数字；如果缺失，应回到正文补读或要求对应 subagent 补充。
- 如果当前运行环境没有可用 subagent 工具，则按论文逐篇顺序处理；每篇都要先完成深读笔记，再进入下一篇，不能为了完成日报而压缩单篇阅读质量。

## 4. 论文分类

对每篇待处理 paper，按 `03-知识/WORKSPACE.md` 的「论文分类流程」归类：

1. 粗匹配：读 `03-知识/WORKSPACE.md` 的「研究方向概览」表格，按一句话定义 + 关键信号选出 1~N 个候选类。
2. 精准匹配：依次读候选类目录下的 `WORKSPACE.md`（如 `03-知识/论文/世界模型-WAM/WORKSPACE.md`），重点看「边界与歧义（vs 兄弟类的判别规则）」，裁决出唯一最匹配类。
3. 无匹配则新建待审核类：
   - 新建 `03-知识/论文/<新类名>/` 目录，写入 `WORKSPACE.md`（含该类精细定义）。
   - 该 `WORKSPACE.md` 的 frontmatter 标 `status: 待审核`。
   - 把本篇简报暂放入该类目录。
   - 在 `03-知识/论文/_待审核分类.md` 登记：新类名、定义摘要、提出日期、状态=待审核。
   - 在最终回复中明确告知用户有新类待审核。

分类结果（类名）同时写入简报 frontmatter 的 `tags`。

## 5. 单篇深读笔记输出

- 每篇 paper 生成一个 Markdown 深读笔记，放入 `03-知识/论文/<匹配类>/`，文件名 `YYYYMMDD_论文标题.md`（日期为运行当天）。
- Frontmatter 至少包含：

```yaml
---
title: "{论文标题}"
type: "note"
topic: "ai"
workspace: "03-知识"
created: "YYYY-MM-DD HH:MM:SS"
modified: "YYYY-MM-DD HH:MM:SS"
tags: ["ai", "paper", "{匹配类名}"]
source: "{继承收件箱条目的 source，或 web/import}"
status: "active"
---
```

- 正文必须包含：`Motivation`、`Methods`、`Experiments`、`Conclusions`、`不足与疑问`、`总结`、`来源`。
- 正文深度要求：
  - `Methods` 不能少于方法机制级别描述，必须写清模型/系统结构、关键模块、训练目标、数据构造、推理流程、算法步骤、重要公式或损失项中能从正文获取的内容。
  - `Experiments` 不能只说「效果更好」，必须写清数据集、任务设置、baseline、指标、训练/评估协议、关键数字和消融结论。
  - `不足与疑问` 不能只写泛泛局限，必须结合实验设计、数据规模、指标选择、真实部署、泛化边界或工程成本提出判断。
  - 允许标注「正文未说明」或「信息不足」，但不能用猜测补细节。
  - 目标阅读粒度参考人工线程 `论文阅读07.20` 中每篇论文的水平：方法细节、实验数字和结论边界都要可复用。
- 来源必须写明原始收件箱文件路径，以及 HTML/PDF 路径或 URL。

## 6. 昨日总报告输出

- 生成一个 Markdown 文件，放入 `03-知识/阅读日报/`，文件名 `YYYYMMDD_昨日paper阅读报告.md`（日期为运行当天）。
- Frontmatter 至少包含 9 字段，可额外包含 `report_for`：

```yaml
---
title: "昨日 paper 阅读报告"
type: "note"
topic: "ai"
workspace: "03-知识"
created: "YYYY-MM-DD HH:MM:SS"
modified: "YYYY-MM-DD HH:MM:SS"
tags: ["ai", "paper", "日报"]
source: "agent"
status: "active"
report_for: "YYYY-MM-DD"
---
```

- 报告内容：
  - 昨日处理概览：处理数量、成功数量、失败数量。
  - 文章摘要：每篇一段深读摘要，并用 wiki-link `[[YYYYMMDD_论文标题]]` 链接到对应单篇笔记。每段至少交代核心问题、关键方法、最重要实验结论和主要不足。
  - 跨文章观察：共同问题、方法趋势、实验范式、数据/评估缺口、值得追踪的方向。这里必须做横向比较，不能只是把单篇总结复制一遍。
  - 待人工处理：不可读、信息缺失、需补链接的条目。
- 日报质量要求：如果当天成功处理多篇论文，必须额外写出「共同趋势」「相互差异」「对后续阅读/研究的启发」三类综合观察；如果只有一篇，也要基于该文给出更深入的后续追踪问题。

## 7. 收件箱清理

- 成功处理：将收件箱条目迁移为论文深读笔记，重命名为 `YYYYMMDD_论文标题.md` 并移动到 `03-知识/论文/<匹配类>/`，内容改写为第 5 节的结构化深读笔记；原始链接/来源保留在「来源」字段。收件箱中不得再保留该条目的 `draft`/`active` 待处理副本。
- 若需保留原始收件箱文件原文，可额外将其移入 `99-归档/收件箱已处理/` 并标 `status=processed`、记录简报路径，但不允许长期留在 `01-收件箱`。
- 失败条目：保留在 `01-收件箱`，补充简短失败原因（如追加 `processing_note` 或注明 frontmatter），不标记 `processed`，方便人工修复。

## 8. 验收

- 检查生成文件 Frontmatter 是否完整、含 9 字段、`workspace` 正确。
- 检查 `01-收件箱` 中成功处理的 paper 已不在 `draft`/`active` 待处理状态（已迁移或标记 `processed`）。
- 检查每篇简报是否落入正确的研究方向子目录；若创建了待审核类，确认已在 `_待审核分类.md` 登记。
- 检查每篇深读笔记是否达到深读标准：方法机制、实验协议、关键数字、结论边界和不足判断都存在；如果过浅，必须补读后再验收。
- 检查日报是否基于单篇深读做综合：不能只有简短列表，必须包含跨文章观察或后续追踪问题。
- 最终回复简短说明：处理了几篇、生成了哪些文件、分别归入哪类、哪些失败或需人工处理、是否有待审核新类。
