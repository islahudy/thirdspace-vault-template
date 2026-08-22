import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const START_MARKER = "<!-- daily-agent:report:start -->";
const END_MARKER = "<!-- daily-agent:report:end -->";
const REQUIRED_SECTIONS = ["总览", "事项与阅读", "项目与 Git", "Token 用量", "数据覆盖", "Agent 评价"];

function count(text, value) {
  return text.split(value).length - 1;
}

function escapeText(value) {
  return String(value ?? "").replace(/([\\`*_{}[\]<>()#+!|])/g, "\\$1");
}

function asFiniteNumber(value, field) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`invalid ReportInput ${field}`);
  return value;
}

function asArray(value, field) {
  if (!Array.isArray(value)) throw new Error(`invalid ReportInput ${field}`);
  return value;
}

function dateInTimezone(value, timezone) {
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) throw new Error(`invalid report timestamp: ${value || "missing"}`);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(instant);
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${values.year}${values.month}${values.day}`;
}

function reviewInfo(report) {
  const kind = report.period.kind;
  if (kind === "weekly") return { label: "周报", template: "weekly-review.md" };
  if (kind === "monthly") return { label: "月报", template: "monthly-review.md" };
  throw new Error(`unsupported review kind: ${kind || "missing"}`);
}

function reviewDate(report) {
  const end = Date.parse(report.period.end);
  if (!Number.isFinite(end)) throw new Error("invalid ReportInput period.end");
  return dateInTimezone(new Date(end - 1).toISOString(), report.period.timezone);
}

function relativeLink(vaultPath, label) {
  const normalized = String(vaultPath || "").replaceAll("\\", "/");
  if (!/^(?:0[1-6]|99)-[^/]+\/.+/.test(normalized) || normalized.split("/").includes("..")) {
    return `\`${escapeText(label)}\``;
  }
  const markdownPath = normalized.replace(/[()\s]/g, (character) => encodeURIComponent(character));
  return `[${escapeText(label)}](../../${markdownPath})`;
}

function tokenValue(value) {
  return value === null || value === undefined ? "未知" : String(value);
}

function staleReadingCount(report) {
  const generatedAt = Date.parse(report.generated_at);
  return report.reading.backlog.filter((item) => {
    const addedAt = Date.parse(item.added_at);
    return Number.isFinite(addedAt) && generatedAt - addedAt >= 7 * 24 * 60 * 60 * 1000;
  }).length;
}

function renderOverview(report) {
  const completed = report.tasks.completed.length;
  const carryover = report.tasks.carryover.length;
  const denominator = completed + carryover;
  const ratio = denominator === 0 ? "无可计算事项" : `${((completed / denominator) * 100).toFixed(1)}%`;
  const activeWithActivity = report.projects.active.length - report.projects.without_activity.length;
  return [
    `- 周期：\`${report.period.id}\`（${report.period.start} 至 ${report.period.end}）。`,
    `- 任务：完成 ${completed} 项，遗留 ${carryover} 项；完成率 ${ratio}。`,
    `- 项目：${activeWithActivity} / ${report.projects.active.length} 个活跃项目有周期内活动。`,
    `- 阅读：积压 ${report.reading.backlog.length} 项，其中超过 7 天 ${staleReadingCount(report)} 项。`,
  ].join("\n");
}

function renderWorkItems(report) {
  const lines = [];
  lines.push("### 已完成事项");
  if (report.tasks.completed.length === 0) lines.push("- 本周期没有已完成事项记录。");
  for (const item of report.tasks.completed) lines.push(`- \`${escapeText(item.id)}\`：${escapeText(item.title)}。`);
  lines.push("\n### 遗留事项");
  if (report.tasks.carryover.length === 0) lines.push("- 当前没有遗留事项。");
  for (const item of report.tasks.carryover) lines.push(`- \`${escapeText(item.id)}\`：${escapeText(item.title)}（状态：${escapeText(item.status)}）。`);
  lines.push("\n### 阅读");
  if (report.reading.processed.length === 0) lines.push("- 本周期没有已处理阅读记录。");
  for (const item of report.reading.processed) lines.push(`- ${relativeLink(item.source_path, item.title)}（\`${escapeText(item.id)}\`，已处理）。`);
  if (report.reading.backlog.length === 0) lines.push("- 当前没有阅读积压。");
  for (const item of report.reading.backlog) lines.push(`- ${relativeLink(item.source_path, item.title)}（\`${escapeText(item.id)}\`，${item.status === "reading" ? "阅读中" : "待处理"}）。`);
  return lines.join("\n");
}

function renderProjectsAndGit(report) {
  const lines = [];
  lines.push("### 活跃项目");
  if (report.projects.active.length === 0) lines.push("- 当前没有活跃项目。");
  const inactive = new Set(report.projects.without_activity.map((project) => project.id));
  for (const project of report.projects.active) {
    lines.push(`- ${relativeLink(project.path, project.name)}（\`${escapeText(project.id)}\`，${inactive.has(project.id) ? "本周期未见活动" : "有活动"}）。`);
  }
  lines.push("\n### Git 证据");
  lines.push(`- 汇总：${report.git.total.commits} 次提交，${report.git.total.files_changed} 个文件变更，新增 ${report.git.total.lines_added} 行，删除 ${report.git.total.lines_deleted} 行。`);
  for (const [projectId, project] of Object.entries(report.git.by_project).sort(([left], [right]) => left.localeCompare(right))) {
    for (const [repo, summary] of Object.entries(project.by_repo).sort(([left], [right]) => left.localeCompare(right))) {
      for (const evidence of summary.evidence) {
        const commit = evidence.commit ? `\`${escapeText(evidence.commit)}\`` : "未提供提交 ID";
        lines.push(`- \`${escapeText(projectId)}\` / \`${escapeText(repo)}\`：${commit}（${escapeText(evidence.timestamp)}；${escapeText(evidence.summary || "无摘要")}）。`);
      }
    }
  }
  if (report.git.total.commits === 0) lines.push("- 本周期没有 Git 提交事件。");
  return lines.join("\n");
}

function renderTokens(report) {
  if (report.tokens.total_sessions === 0) return "- 本周期未采集 Token 使用会话。";
  const lines = [`- 共采集 ${report.tokens.total_sessions} 个 Token 使用会话。`];
  for (const [model, values] of Object.entries(report.tokens.by_model).sort(([left], [right]) => left.localeCompare(right))) {
    lines.push(`- \`${escapeText(model)}\`：${values.sessions} 会话，输入 ${tokenValue(values.input_tokens)}，输出 ${tokenValue(values.output_tokens)}，缓存读取 ${tokenValue(values.cache_read_tokens)}，缓存写入 ${tokenValue(values.cache_write_tokens)}，合计 ${tokenValue(values.total_tokens)}。`);
  }
  return lines.join("\n");
}

function renderCoverage(report) {
  const lines = [report.coverage.sources.length === 0
    ? "- 本周期没有纳入报告的事件来源。"
    : `- 已纳入来源：${report.coverage.sources.map((source) => `\`${escapeText(source)}\``).join("、")}。`];
  if (report.coverage.missing_token_fields > 0) lines.push(`- Token 字段缺失 ${report.coverage.missing_token_fields} 项，相关统计不完整。`);
  if (report.coverage.rejected_events > 0) lines.push(`- 归一化拒绝 ${report.coverage.rejected_events} 条事件，结论需结合该缺口阅读。`);
  if (report.coverage.unmapped_repos.length > 0) lines.push(`- 未映射仓库：${report.coverage.unmapped_repos.map((repo) => `\`${escapeText(repo)}\``).join("、")}。`);
  if (lines.length === 1 && report.coverage.sources.length > 0) lines.push("- 当前聚合未报告数据覆盖缺口。");
  return lines.join("\n");
}

function renderEvaluation(report) {
  const completed = report.tasks.completed.length;
  const carryover = report.tasks.carryover.length;
  const total = completed + carryover;
  const ratio = total === 0 ? null : completed / total;
  const activeWithActivity = report.projects.active.length - report.projects.without_activity.length;
  const assessment = ratio === null
    ? "没有足够任务状态记录，无法计算完成率。"
    : ratio >= 0.7
      ? "任务完成率达到 70% 以上。"
      : "任务完成率低于 70%，应优先复核遗留事项。";
  const coverage = report.coverage.missing_token_fields + report.coverage.rejected_events + report.coverage.unmapped_repos.length;
  return [
    `- 任务判断：${assessment}`,
    `- 项目判断：${activeWithActivity} 个活跃项目有活动，${report.projects.without_activity.length} 个未见活动。`,
    `- 阅读判断：积压 ${report.reading.backlog.length} 项，超期 ${staleReadingCount(report)} 项。`,
    coverage > 0 ? "- 数据判断：存在覆盖缺口，以上结论仅基于已聚合证据。" : "- 数据判断：当前聚合未报告覆盖缺口。",
    "- 本段为确定性规则草稿；仅在用户明确要求时，Pi 才可在本节内改写措辞。",
  ].join("\n");
}

export function validateReportInput(report) {
  if (!report || typeof report !== "object" || Array.isArray(report) || report.version !== "1.0") throw new Error("invalid ReportInput");
  if (!report.period || typeof report.period !== "object" || !String(report.period.id || "") || !String(report.period.timezone || "")) throw new Error("invalid ReportInput period");
  reviewInfo(report);
  dateInTimezone(report.generated_at, report.period.timezone);
  if (!report.git || !report.git.total || !report.git.by_project || !report.tokens || !report.tasks || !report.reading || !report.projects || !report.coverage) throw new Error("invalid ReportInput sections");
  for (const [value, field] of [
    [report.git.total.commits, "git.total.commits"], [report.git.total.files_changed, "git.total.files_changed"],
    [report.git.total.lines_added, "git.total.lines_added"], [report.git.total.lines_deleted, "git.total.lines_deleted"],
    [report.tokens.total_sessions, "tokens.total_sessions"], [report.coverage.rejected_events, "coverage.rejected_events"],
    [report.coverage.missing_token_fields, "coverage.missing_token_fields"],
  ]) asFiniteNumber(value, field);
  for (const [value, field] of [
    [report.tasks.completed, "tasks.completed"], [report.tasks.carryover, "tasks.carryover"],
    [report.reading.processed, "reading.processed"], [report.reading.backlog, "reading.backlog"],
    [report.projects.active, "projects.active"], [report.projects.without_activity, "projects.without_activity"],
    [report.coverage.sources, "coverage.sources"], [report.coverage.unmapped_repos, "coverage.unmapped_repos"],
  ]) asArray(value, field);
  return report;
}

export function renderReview(report) {
  validateReportInput(report);
  const info = reviewInfo(report);
  const template = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "templates", info.template), "utf8");
  const values = {
    overview: renderOverview(report),
    work_items: renderWorkItems(report),
    projects_and_git: renderProjectsAndGit(report),
    tokens: renderTokens(report),
    coverage: renderCoverage(report),
    evaluation: renderEvaluation(report),
  };
  const rendered = template.replace(/{{(overview|work_items|projects_and_git|tokens|coverage|evaluation)}}/g, (_match, key) => values[key]);
  if (count(rendered, START_MARKER) !== 1 || count(rendered, END_MARKER) !== 1 || REQUIRED_SECTIONS.some((section) => !rendered.includes(`## ${section}`))) {
    throw new Error("invalid review template");
  }
  return rendered.trimEnd();
}

function frontmatter(report, timestamp) {
  const info = reviewInfo(report);
  return [
    "---",
    `title: "${info.label}：${report.period.id}"`,
    'type: "review"',
    'topic: "work"',
    'workspace: "02-日记"',
    `created: "${timestamp}"`,
    `modified: "${timestamp}"`,
    'status: "active"',
    "---",
  ].join("\n");
}

function replaceManagedSection(existing, managed) {
  const starts = count(existing, START_MARKER);
  const ends = count(existing, END_MARKER);
  if (starts !== ends || starts > 1) throw new Error("invalid managed review markers");
  if (starts === 1) {
    const start = existing.indexOf(START_MARKER);
    const end = existing.indexOf(END_MARKER, start) + END_MARKER.length;
    if (end <= start) throw new Error("invalid managed review markers");
    return existing.slice(0, start) + managed + existing.slice(end);
  }
  const match = existing.match(/^---\n[\s\S]*?\n---\n?/);
  if (match) return `${match[0].trimEnd()}\n\n${managed}\n\n${existing.slice(match[0].length).trimStart()}`.trimEnd() + "\n";
  return `${managed}\n\n${existing.trimStart()}`.trimEnd() + "\n";
}

export function writeReview(context, report) {
  if (!context?.vaultRoot || !context.now) throw new Error("vaultRoot and now are required");
  validateReportInput(report);
  const info = reviewInfo(report);
  const outputDir = path.join(context.vaultRoot, "02-日记", "复盘");
  const filename = `${reviewDate(report)}_${info.label}_${report.period.id}.md`;
  const output = path.join(outputDir, filename);
  const managed = renderReview(report);
  const next = fs.existsSync(output)
    ? replaceManagedSection(fs.readFileSync(output, "utf8"), managed)
    : `${frontmatter(report, context.now)}\n\n${managed}\n`;
  const previous = fs.existsSync(output) ? fs.readFileSync(output, "utf8") : null;
  fs.mkdirSync(outputDir, { recursive: true });
  if (previous !== next) fs.writeFileSync(output, next, "utf8");
  return { path: output, updated: previous !== next };
}
