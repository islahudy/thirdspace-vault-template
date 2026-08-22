import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { appendEvent, makeEventId } from "./events.mjs";
import { mutateState, readState } from "./store.mjs";

function queueFile(context) {
  return path.join(context.vaultRoot, ".thirdspace", "data", "daily-agent", "reading-queue.json");
}

function walkMarkdown(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return walkMarkdown(full);
    return entry.isFile() && entry.name.endsWith(".md") ? [full] : [];
  });
}

function parseScalar(value) {
  return value.trim().replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
}

function parseFrontmatter(markdown) {
  if (!markdown.startsWith("---\n")) return {};
  const end = markdown.indexOf("\n---", 4);
  if (end === -1) return {};
  const meta = {};
  for (const line of markdown.slice(4, end).split("\n")) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    const value = match[2].trim();
    meta[match[1]] = value.startsWith("[") && value.endsWith("]")
      ? value.slice(1, -1).split(",").map(parseScalar).filter(Boolean)
      : parseScalar(value);
  }
  return meta;
}

function readingId(sourcePath) {
  return `reading_${crypto.createHash("sha256").update(sourcePath).digest("hex").slice(0, 12)}`;
}

function candidateKind(url) {
  return /arxiv\.org|doi\.org|acm\.org|ieee\.org|springer\.com|sciencedirect\.com/i.test(url) ? "paper" : "blog";
}

function isCandidateUrl(url) {
  return /^https?:\/\//i.test(url) && (/arxiv\.org|doi\.org|acm\.org|ieee\.org|springer\.com|sciencedirect\.com/i.test(url) || /\/(blog|article|post|paper)\b/i.test(url));
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

export function scanReadingInbox(context) {
  const file = queueFile(context);
  const current = readState(file, "items");
  if (!Array.isArray(current.candidates) || !Array.isArray(current.dismissed_source_paths)) throw new Error("invalid reading queue collections");
  const items = structuredClone(current.items);
  const candidates = structuredClone(current.candidates);
  const dismissed = new Set(current.dismissed_source_paths);
  const result = { added: [], candidates: [], processed: [], unchanged: [] };
  let changed = false;

  for (const markdownFile of walkMarkdown(path.join(context.vaultRoot, "01-收件箱"))) {
    const sourcePath = path.relative(context.vaultRoot, markdownFile);
    const meta = parseFrontmatter(fs.readFileSync(markdownFile, "utf8"));
    const tags = Array.isArray(meta.tags) ? meta.tags.map((tag) => tag.toLowerCase()) : [];
    const explicitKind = tags.includes("paper") ? "paper" : tags.includes("blog") ? "blog" : null;
    const url = meta.url || meta.source_url || "";
    const existing = items.find((item) => item.source_path === sourcePath);
    if (existing) {
      if (meta.status === "processed" && existing.status !== "processed") {
        existing.status = "processed";
        existing.processed_at = context.now;
        result.processed.push(existing);
        emit(context, "reading_processed", existing.id, { source_path: sourcePath });
        changed = true;
      } else result.unchanged.push(existing);
      continue;
    }
    if (explicitKind) {
      const item = {
        id: readingId(sourcePath), kind: explicitKind, title: meta.title || path.basename(markdownFile, ".md"),
        source_path: sourcePath, url: url || null, tags, status: meta.status === "processed" ? "processed" : "pending",
        added_at: context.now, processed_at: meta.status === "processed" ? context.now : null, output_path: meta.output_path || null,
      };
      items.push(item);
      if (item.status === "processed") result.processed.push(item);
      else result.added.push(item);
      emit(context, item.status === "processed" ? "reading_processed" : "reading_added", item.id, { source_path: sourcePath });
      changed = true;
      continue;
    }
    if (isCandidateUrl(url) && !dismissed.has(sourcePath) && !candidates.some((candidate) => candidate.source_path === sourcePath)) {
      const candidate = {
        id: readingId(sourcePath), kind: candidateKind(url), title: meta.title || path.basename(markdownFile, ".md"),
        source_path: sourcePath, url, tags, detected_at: context.now,
      };
      candidates.push(candidate);
      result.candidates.push(candidate);
      emit(context, "reading_candidate_created", candidate.id, { source_path: sourcePath });
      changed = true;
    }
  }
  if (changed) {
    mutateState(file, current.revision, (value) => ({ ...value, items, candidates, dismissed_source_paths: [...dismissed] }), context.now);
  }
  return result;
}

export function confirmReadingCandidate(context, candidateId, decision) {
  if (!new Set(["accept", "reject"]).has(decision)) throw new Error(`invalid reading decision: ${decision}`);
  const file = queueFile(context);
  const current = readState(file, "items");
  const candidate = current.candidates.find((item) => item.id === candidateId);
  if (!candidate) throw new Error(`reading candidate not found: ${candidateId}`);
  const candidates = current.candidates.filter((item) => item.id !== candidateId);
  const dismissed = new Set(current.dismissed_source_paths);
  const items = current.items.slice();
  if (decision === "accept") {
    items.push({ ...candidate, status: "pending", added_at: context.now, processed_at: null, output_path: null });
  } else dismissed.add(candidate.source_path);
  mutateState(file, current.revision, (value) => ({ ...value, items, candidates, dismissed_source_paths: [...dismissed] }), context.now);
  emit(context, decision === "accept" ? "reading_added" : "reading_candidate_rejected", candidate.id, { source_path: candidate.source_path });
  return decision === "accept" ? items.at(-1) : { ...candidate, dismissed: true };
}
