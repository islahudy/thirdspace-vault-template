---
workspace: "00-系统"
type: "spec"
topic: "runtime"
status: "active"
source: "agent"
---

# ThirdSpace 运行时资产

这里保存跨电脑迁移需要的运行时规格。Agent 应该把这里当成 hook、crontab、自动化任务的源头，而不是只依赖本机散落配置。

## 目录

- `hooks/`: Git hook 模板。
- `crontab/`: crontab 模板。
- `automations/`: Codex 或其他 Agent 平台的自动化任务规格。
- `manifest.yaml`: 当前运行时资产索引。

## 初始化

Agent 在新机器上应调用：

```bash
node /Users/shanexxiang/research/my-vault/00-系统/Skills/thirdspace-vault/scripts/thirdspace-vault.mjs install-runtime --vault /Users/shanexxiang/research/my-vault --all
```

这会从 vault 内模板安装全局 Git hook，并注册每日工作日志 crontab。
