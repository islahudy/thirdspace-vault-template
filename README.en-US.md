# ThirdSpace Vault Template

A knowledge base operating system template that can be cloned and used directly.

📖 **[Complete Usage Manual → MANUAL.md](./MANUAL.md)**

## Design Philosophy

- **Agent-native**: All knowledge base operations are driven by AI Agents, requiring no manual maintenance
- **Fully Agent Compatible**: Supports all mainstream Agents including Claude Code, Cursor, Windsurf, OpenCode, Codex, Amp, Roo Code, Goose, Gemini CLI, etc. Skills are built into the vault and are automatically completed by the Agent during initialization, requiring no external tools
- **Self-contained**: The presence of `.thirdspace/workspace-index.yaml` in the vault root directory signifies "this is a knowledge base", requiring no external configuration
- **Path-independent**: Anyone can clone to any directory and use it directly, with no hardcoded absolute paths
- **Progressive loading**: Skills are loaded on demand, daily operations don't waste tokens

## Quick Start

### 1. Clone or Use Template

```bash
# Method A: Directly clone
git clone https://github.com/zzyong24/thirdspace-vault-template my-vault
cd my-vault

# Method B: Click "Use this template" above to create your own repo
```

### 2. Initialize (Completed by Agent)

Open any AI Agent in the vault directory and say:

> Help me initialize this knowledge base

The Agent reads `CLAUDE.md` / `AGENTS.md` → loads the `init-vault` Skill → based on the current environment (OS, Agent platform), automatically completes:
- Structure validation
- Hook installation (git hook / Agent stop hook)
- Scheduled task registration
- Skill global registration

### 3. Enable Obsidian Plugin (Optional)

Open the vault directory with Obsidian:
- Settings → Third-party plugins → Turn off safe mode → Enable **ThirdSpace Dashboard**

The plugin provides: workspace file statistics, GitHub snake heatmap, Todos management, quick operation panel.

---

## Directory Structure

```
.thirdspace/              ← vault root anchor + schema specification
00-系统/
  Skills/                 ← Agent Skill definitions (thirdspace-vault + 16 general Skills)
  规范/                   ← Frontmatter, workspace, routing and other specification documents
  运行时/                 ← hook script templates (git hook, Claude stop hook, crontab)
01-收件箱/                ← Entrance for all unclassified content
02-日记/                  ← Work logs, reflections, reviews, Todos
03-知识/                  ← Knowledge cards, topic notes
04-项目/                  ← Roadmap, project documents
05-资源/                  ← Images, attachments
06-输出/                  ← Externally published content
99-归档/                  ← Archived content
.obsidian/plugins/        ← ThirdSpace Dashboard plugin
```

## Skill System

| Skill | Trigger Scenario |
|-------|---------|
| `thirdspace-vault` | Any knowledge base operation (main Skill) |
| `init-vault` | "initialize" / "setup" / first use |
| `workspace-*` | Automatically loaded when entering corresponding workspace |
| `worklog` | Work log related |
| `review` | Weekly report / Monthly report / Review |
| `reflect` | Reflection |
| `lifeos` | Interpersonal events / Character portraits |
| `article` | Writing articles / Publishing |
| `knowledge` | Knowledge organization |

## Personalization

After cloning, modify as needed:
- `.thirdspace/workspace-index.yaml`: Adjust workspace names and descriptions
- `00-系统/Skills/thirdspace-vault/SKILL.md`: Add your trigger words
- Various workspace `WORKSPACE.md`: Define your workspace specifications

## License

MIT
