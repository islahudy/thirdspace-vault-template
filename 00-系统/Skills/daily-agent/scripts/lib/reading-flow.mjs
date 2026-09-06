import fs from "node:fs";
import path from "node:path";

import { appendEvent, makeEventId } from "./events.mjs";
import { scanReadingInbox } from "./reading.mjs";
import { mutateState, readState } from "./store.mjs";

// ---------------------------------------------------------------------------
// Reading flow helpers: inject placeholder / render checklist / migrate.
// All paths are vault-relative. State mutation goes through `mutateState` so
// that revision checks and atomic replacement follow the existing contract.
// ---------------------------------------------------------------------------

const PAPER_TEMPLATE = `<!-- reading-placeholder:paper -->

## Summary

<!-- 主人在阅读原文后用 1-2 句话提炼核心问题与方法 -->

## Key Points

- 
- 

## Review

<!-- 主人在阅读原文后在本块内自由编辑 -->

## My Takeaways

- 与现有研究/项目的关联：
- 可验证 / 可应用的点：

---
`;

const BLOG_TEMPLATE = `<!-- reading-placeholder:blog -->

## Summary

<!-- 主人在阅读原文后用 1 句话提炼核心洞察 -->

## Key Points

- 
- 

## Review

<!-- 主人在阅读原文后在本块内自由编辑 -->

## Action Items

- 

---
`;

const CHECKLIST_HEADINGS = ["## paper（待阅读）", "## blog（待阅读）"];

function queueFile(context) {
  return path.join(context.vaultRoot, ".thirdspace", "data", "daily-agent", "reading-queue.json");
}

function splitFrontmatter(markdown) {
  if (!markdown.startsWith("---\n")) return { meta: null, body: markdown };
  const end = markdown.indexOf("\n---", 4);
  if (end === -1) return { meta: null, body: markdown };
  return { meta: markdown.slice(0, end + 4), body: markdown.slice(end + 4) };
}

function parseScalar(value) {
  return value.trim().replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
}

function parseFrontmatter(markdown) {
  if (!markdown.startsWith("---\n")) return {};
  const end = markdown.indexOf("\n---", 4);
  if (end === -1) return {};
  const lines = markdown.slice(4, end).split("\n");
  const meta = {};
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    const key = match[1];
    const value = match[2].trim();
    if (value === "") {
      const list = [];
      while (i + 1 < lines.length) {
        const itemMatch = lines[i + 1].match(/^\s*-\s*(.*)$/);
        if (!itemMatch) break;
        list.push(parseScalar(itemMatch[1]));
        i += 1;
      }
      meta[key] = list.length > 0 ? list : "";
      continue;
    }
    meta[key] = value.startsWith("[") && value.endsWith("]")
      ? value.slice(1, -1).split(",").map(parseScalar).filter(Boolean)
      : parseScalar(value);
  }
  return meta;
}

function todayStamp(now) {
  return String(now).slice(0, 10);
}

function todayCompact(now) {
  return todayStamp(now).replaceAll("-", "");
}

function weekdayChinese(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][d.getUTCDay()];
}

function sanitizedTitle(title) {
  return String(title || "")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function emit(context, type, subjectId, details = {}) {
  appendEvent(context.vaultRoot, {
    event_id: makeEventId(type, subjectId, context.now),
    timestamp: context.now,
    event_type: type,
    source_id: "pi-agent",
    subject_id: subjectId,
    ...details,
  });
}

function templateFor(kind) {
  return kind === "paper" ? PAPER_TEMPLATE : BLOG_TEMPLATE;
}

// ---------------------------------------------------------------------------
// Inject placeholders
// ---------------------------------------------------------------------------

export function injectNotePlaceholders(context, _options = {}) {
  const queuePath = queueFile(context);
  const current = readState(queuePath, "items");
  const items = current.items || [];
  const result = { injected: [], skipped: [], missing_source: [] };

  for (const item of items) {
    if (item.status !== "pending" && item.status !== "reading") {
      result.skipped.push({ id: item.id, reason: `status=${item.status}` });
      continue;
    }
    const fullPath = path.join(context.vaultRoot, item.source_path);
    if (!fs.existsSync(fullPath)) {
      result.missing_source.push({ id: item.id, source_path: item.source_path });
      continue;
    }
    const original = fs.readFileSync(fullPath, "utf8");
    const sentinel = `<!-- reading-placeholder:${item.kind} -->`;
    if (original.includes(sentinel)) {
      result.skipped.push({ id: item.id, reason: "already injected" });
      continue;
    }
    const { meta, body } = splitFrontmatter(original);
    if (!meta) {
      result.skipped.push({ id: item.id, reason: "no frontmatter" });
      continue;
    }
    const template = templateFor(item.kind);
    const injected = `${meta}\n${template}${body}`;
    fs.writeFileSync(fullPath, injected, "utf8");
    result.injected.push({ id: item.id, source_path: item.source_path, kind: item.kind });
    emit(context, "reading_placeholder_injected", item.id, {
      source_path: item.source_path,
      kind: item.kind,
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Render checklist
// ---------------------------------------------------------------------------

function checklistPath(context, date) {
  const compact = date.replaceAll("-", "");
  return path.join(context.vaultRoot, "02-阅读清单", `${compact}_阅读清单.md`);
}

function initialChecklist(context, date) {
  const created = String(context.now).replace("T", " ");
  const compact = date.replaceAll("-", "");
  const weekday = weekdayChinese(date);
  return `---
title: "${compact} 阅读清单"
type: "board"
topic: "reading"
workspace: "02-阅读清单"
created: "${created}"
modified: "${created}"
tags: ["reading", "checklist"]
source: "agent"
status: "active"
---

# ${date} 阅读清单（${weekday}）

> 处理说明：点击标题进入原文阅读；读完后在原文 frontmatter 设置 \`status: processed\`，再回到本清单打勾，或直接运行 \`reading-migrate\`。

## paper（待阅读）

## blog（待阅读）

---
`;
}

function replaceSection(markdown, heading, lines) {
  const content = `${heading}\n\n${lines.join("\n")}\n`;
  const start = markdown.indexOf(`${heading}\n`);
  if (start === -1) return `${markdown.trimEnd()}\n\n${content}`;
  const next = markdown.indexOf("\n## ", start + heading.length);
  const tail = next === -1 ? "" : `\n${markdown.slice(next + 1).replace(/^\n+/, "")}`;
  return `${markdown.slice(0, start)}${content}${tail}`;
}

function parseExistingChecks(markdown) {
  const result = new Map();
  for (const heading of CHECKLIST_HEADINGS) {
    const start = markdown.indexOf(`${heading}\n`);
    if (start === -1) continue;
    const next = markdown.indexOf("\n## ", start + heading.length);
    const block = next === -1 ? markdown.slice(start) : markdown.slice(start, next);
    const lineRe = /^-\s+\[( |x|X)\]\s+\[\[([^|\]]+)(?:\|[^\]]+)?\]\]/gm;
    let m;
    while ((m = lineRe.exec(block)) !== null) {
      result.set(m[2], m[1].toLowerCase() === "x");
    }
  }
  return result;
}

export function renderReadingList(context, options = {}) {
  const date = options.date || todayStamp(context.now);
  const queuePath = queueFile(context);
  const current = readState(queuePath, "items");
  const items = (current.items || []).filter(
    (it) => it.status === "pending" || it.status === "reading",
  );

  const file = checklistPath(context, date);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const markdown = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : initialChecklist(context, date);
  const checks = parseExistingChecks(markdown);

  const renderItem = (it) => {
    const checked = checks.get(it.source_path) ? "x" : " ";
    return `- [${checked}] [[${it.source_path}|${it.title}]]`;
  };
  const papers = items.filter((it) => it.kind === "paper");
  const blogs = items.filter((it) => it.kind === "blog");
  const paperLines = papers.length ? papers.map(renderItem) : ["_（暂无）_"];
  const blogLines = blogs.length ? blogs.map(renderItem) : ["_（暂无）_"];

  let rebuilt = replaceSection(markdown, "## paper（待阅读）", paperLines);
  rebuilt = replaceSection(rebuilt, "## blog（待阅读）", blogLines);
  fs.writeFileSync(file, rebuilt, "utf8");

  emit(context, "reading_list_rendered", date, {
    paper_count: papers.length,
    blog_count: blogs.length,
    checklist_path: path.relative(context.vaultRoot, file),
  });
  return {
    path: path.relative(context.vaultRoot, file),
    paper_count: papers.length,
    blog_count: blogs.length,
  };
}

// ---------------------------------------------------------------------------
// Migrate processed items
// ---------------------------------------------------------------------------

function destinationPath(context, item, _now) {
  const safe = sanitizedTitle(item.title || path.basename(item.source_path, ".md"));
  const dir = path.join(context.vaultRoot, "03-知识", "论文笔记");
  let candidate = path.join(dir, `${safe}.md`);
  if (!fs.existsSync(candidate)) return candidate;
  for (let i = 1; i < 100; i += 1) {
    candidate = path.join(dir, `${safe}-${i}.md`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  throw new Error("too many duplicate destinations");
}

function quoteYaml(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function todayDateOnly(now) {
  return String(now).slice(0, 10);
}

function buildThirdSpaceFrontmatter(originalMeta, sourcePath, kind, now) {
  const createdRaw = originalMeta.created ? String(originalMeta.created) : String(now);
  const created = createdRaw.slice(0, 10);
  const modified = todayDateOnly(now);
  const title = originalMeta.title || path.basename(sourcePath, ".md");
  const tags = Array.isArray(originalMeta.tags)
    ? originalMeta.tags.slice()
    : originalMeta.tags
      ? [String(originalMeta.tags)]
      : [];
  for (const t of ["reading", kind]) if (!tags.includes(t)) tags.push(t);

  const lines = [
    "---",
    `title: ${quoteYaml(title)}`,
    `type: "note"`,
    `topic: "reading"`,
    `workspace: "03-知识"`,
    `created: ${created}`,
    `modified: ${modified}`,
    `reviewed_at: null`,
    `status: "active"`,
    `tags: [${tags.map(quoteYaml).join(", ")}]`,
  ];
  for (const k of ["author", "published", "url", "source", "description"]) {
    const v = originalMeta[k];
    if (v === undefined || v === null || v === "") continue;
    lines.push(`${k}: ${quoteYaml(v)}`);
  }
  lines.push("origin:");
  lines.push(`  source_workspace: "01-收件箱"`);
  lines.push(`  source_subdir: "网页剪藏"`);
  lines.push(`  source_path: ${quoteYaml(sourcePath)}`);
  lines.push(`  migrated_at: ${modified}`);
  lines.push("---");
  return lines.join("\n");
}

function stripInjectedPlaceholder(body) {
  // The injected placeholder template ends with the user-editable
  // Summary / Key Points / Review / My Takeaways sections. Stripping
  // anything past the marker would discard the owner's reading notes,
  // so we now keep the body verbatim. The HTML comment marker stays
  // as a harmless breadcrumb identifying the section as agent-injected.
  return body;
}

function rebuildWithThirdSpaceFrontmatter(originalMarkdown, originalMeta, sourcePath, kind, now) {
  const thirdSpace = buildThirdSpaceFrontmatter(originalMeta, sourcePath, kind, now);
  if (originalMarkdown.startsWith("---\n")) {
    const end = originalMarkdown.indexOf("\n---", 4);
    if (end !== -1) {
      const body = originalMarkdown.slice(end + 4);
      const cleaned = stripInjectedPlaceholder(body);
      return `${thirdSpace}\n${cleaned.trimStart() ? `\n${cleaned.trimStart()}` : ""}`;
    }
  }
  return `${thirdSpace}\n${originalMarkdown}`;
}

function sourceStatus(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const md = fs.readFileSync(filePath, "utf8");
  return parseFrontmatter(md).status || null;
}

export function migrateProcessedItems(context, options = {}) {
  const date = options.date || todayStamp(context.now);
  const dryRun = options.dryRun === true;
  const queuePath = queueFile(context);
  const current = readState(queuePath, "items");
  const items = (current.items || []).slice();

  const checklistFile = checklistPath(context, date);
  const checks = fs.existsSync(checklistFile)
    ? parseExistingChecks(fs.readFileSync(checklistFile, "utf8"))
    : new Map();

  const plan = [];
  const skipped = [];
  let changed = false;

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (item.status !== "pending" && item.status !== "reading") {
      skipped.push({ id: item.id, reason: `status=${item.status}` });
      continue;
    }
    const sourcePath = path.join(context.vaultRoot, item.source_path);
    if (!fs.existsSync(sourcePath)) {
      skipped.push({ id: item.id, reason: "source missing" });
      continue;
    }
    const srcStatus = sourceStatus(sourcePath);
    const checked = checks.get(item.source_path) === true;
    if (!checked && srcStatus !== "processed") {
      skipped.push({ id: item.id, reason: "not marked" });
      continue;
    }

    const original = fs.readFileSync(sourcePath, "utf8");
    const originalMeta = parseFrontmatter(original);
    const target = destinationPath(context, item, context.now);
    const rebuilt = rebuildWithThirdSpaceFrontmatter(
      original,
      originalMeta,
      item.source_path,
      item.kind,
      context.now,
    );
    plan.push({
      id: item.id,
      source_path: item.source_path,
      target_path: path.relative(context.vaultRoot, target),
      kind: item.kind,
      title: item.title,
    });
    if (dryRun) continue;

    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, rebuilt, "utf8");
    fs.unlinkSync(sourcePath);

    items[i] = {
      ...item,
      status: "processed",
      processed_at: context.now,
      output_path: path.relative(context.vaultRoot, target),
    };
    changed = true;
    emit(context, "reading_migrated", item.id, {
      source_path: item.source_path,
      target_path: path.relative(context.vaultRoot, target),
      kind: item.kind,
    });
  }

  if (changed && !dryRun) {
    mutateState(queuePath, current.revision, (state) => ({ ...state, items }), context.now);
  }

  return { dry_run: dryRun, migrated: plan, skipped };
}

// ---------------------------------------------------------------------------
// Composed `reading-scan` flow: scan inbox + inject placeholders + render list.
// Shared by the CLI `reading-scan` command and the `/today` opening flow so
// that scanning, note scaffolding, and the checklist stay in lockstep.
// ---------------------------------------------------------------------------

export function runReadingScanFlow(context, options = {}) {
  const scan = scanReadingInbox(context);
  const inject = injectNotePlaceholders(context);
  const list = renderReadingList(context, { date: options.date });
  return { ...scan, inject, checklist: list };
}
