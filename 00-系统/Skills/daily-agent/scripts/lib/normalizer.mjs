import fs from "node:fs";
import path from "node:path";

import { readState } from "./store.mjs";

const COMMON_FIELDS = ["event_id", "timestamp", "event_type", "source_id", "subject_id"];
const REMOTE_TYPES = new Set(["git_commit", "token_usage"]);
const TOKEN_COUNTERS = [
  "input_tokens",
  "output_tokens",
  "cache_read_tokens",
  "cache_write_tokens",
  "total_tokens",
];
const MONTHLY_FILE = /^\d{6}\.ndjson$/;
const TIMESTAMP_WITH_ZONE = /^(\d{4})-(\d{2})-(\d{2})T.+(?:Z|[+-]\d{2}:\d{2})$/;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isNullableNumber(value) {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function isValidTimestamp(value) {
  const match = value.match(TIMESTAMP_WITH_ZONE);
  if (!match) return false;
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const daysInMonth = [31, (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth[month - 1] && !Number.isNaN(Date.parse(value));
}

function atomicWrite(file, content) {
  const temporary = `${file}.tmp-${process.pid}`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    fs.writeFileSync(temporary, content, "utf8");
    fs.renameSync(temporary, file);
  } catch (error) {
    try {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    } catch {
      // Preserve the original write error.
    }
    throw error;
  }
}

function projectMappings(vaultRoot) {
  const file = path.join(vaultRoot, ".thirdspace", "data", "daily-agent", "project-index.json");
  if (!fs.existsSync(file)) return new Map();
  const projects = readState(file, "projects").projects;
  const mappings = new Map();
  for (const project of projects) {
    if (!isNonEmptyString(project?.id) || !Array.isArray(project.repo_mappings)) continue;
    for (const repo of project.repo_mappings) {
      if (isNonEmptyString(repo) && !mappings.has(repo)) mappings.set(repo, project.id);
    }
  }
  return mappings;
}

function commonValidation(event, sourceId) {
  if (!isPlainObject(event)) return "event must be an object";
  if (event.schema_version !== "1.0") return "unsupported schema_version";
  for (const field of COMMON_FIELDS) {
    if (!isNonEmptyString(event[field])) return `invalid ${field}`;
  }
  if (event.source_id !== sourceId) return "source_id does not match raw source";
  if (!REMOTE_TYPES.has(event.event_type)) return "unsupported event_type";
  if (!isValidTimestamp(event.timestamp)) return "invalid timestamp";
  return null;
}

function normalizeGitCommit(event, projectId) {
  if (!isPlainObject(event.evidence) || !isNonEmptyString(event.evidence.commit)) return { reason: "git_commit evidence.commit is required" };
  if (Object.hasOwn(event, "repo") && !isNonEmptyString(event.repo)) return { reason: "invalid repo" };
  if (Object.hasOwn(event, "branch") && !isNonEmptyString(event.branch)) return { reason: "invalid branch" };
  if (Object.hasOwn(event, "summary") && !isNonEmptyString(event.summary)) return { reason: "invalid summary" };
  if (Object.hasOwn(event, "metrics") && !isPlainObject(event.metrics)) return { reason: "invalid metrics" };
  return {
    event: {
      schema_version: "1.0",
      event_id: event.event_id,
      timestamp: event.timestamp,
      event_type: event.event_type,
      source_id: event.source_id,
      subject_id: event.subject_id,
      repo: event.repo ?? null,
      branch: event.branch ?? null,
      summary: event.summary ?? null,
      metrics: event.metrics ?? null,
      evidence: { commit: event.evidence.commit },
      project_id: projectId ?? null,
    },
  };
}

function normalizeTokenUsage(event, projectId) {
  if (!isNonEmptyString(event.model)) return { reason: "token_usage model is required" };
  if (!isNonEmptyString(event.session_id)) return { reason: "token_usage session_id is required" };
  if (Object.hasOwn(event, "repo") && !isNonEmptyString(event.repo)) return { reason: "invalid repo" };
  if (!isPlainObject(event.metrics)) return { reason: "token_usage metrics are required" };
  for (const counter of TOKEN_COUNTERS) {
    if (!Object.hasOwn(event.metrics, counter) || !isNullableNumber(event.metrics[counter])) {
      return { reason: `invalid token metric: ${counter}` };
    }
  }
  return {
    event: {
      schema_version: "1.0",
      event_id: event.event_id,
      timestamp: event.timestamp,
      event_type: event.event_type,
      source_id: event.source_id,
      subject_id: event.subject_id,
      repo: event.repo ?? null,
      model: event.model,
      session_id: event.session_id,
      metrics: Object.fromEntries(TOKEN_COUNTERS.map((counter) => [counter, event.metrics[counter]])),
      project_id: projectId ?? null,
    },
  };
}

function canonicalEvent(event, sourceId, mappings) {
  const commonError = commonValidation(event, sourceId);
  if (commonError) return { reason: commonError };
  const projectId = mappings.get(event.repo);
  if (event.event_type === "git_commit") return normalizeGitCommit(event, projectId);
  return normalizeTokenUsage(event, projectId);
}

function sourceDirectories(vaultRoot) {
  const root = path.join(vaultRoot, ".thirdspace", "events", "remote");
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function removePriorMonthlyOutputs(root, currentFiles) {
  if (!fs.existsSync(root)) return;
  const current = new Set(currentFiles.map((file) => path.resolve(file)));
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isFile() && MONTHLY_FILE.test(entry.name)) {
      const file = path.join(root, entry.name);
      if (!current.has(path.resolve(file))) fs.unlinkSync(file);
    }
  }
}

export function normalizeEvents(context) {
  if (!context?.vaultRoot || !context.now) throw new Error("vaultRoot and now are required");
  const mappings = projectMappings(context.vaultRoot);
  const normalizedRoot = path.join(context.vaultRoot, ".thirdspace", "events", "normalized");
  const reportPath = path.join(context.vaultRoot, ".thirdspace", "events", "reports", "normalization-errors.json");
  const errors = [];
  const events = [];
  const seen = new Set();
  let duplicates = 0;

  for (const sourceId of sourceDirectories(context.vaultRoot)) {
    const rawPath = path.join(context.vaultRoot, ".thirdspace", "events", "remote", sourceId, "raw", "events.ndjson");
    if (!fs.existsSync(rawPath)) continue;
    const lines = fs.readFileSync(rawPath, "utf8").split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      if (!line.trim()) continue;
      let rawEvent;
      try {
        rawEvent = JSON.parse(line);
      } catch {
        errors.push({ source_id: sourceId, line: index + 1, reason: "invalid JSON" });
        continue;
      }
      const result = canonicalEvent(rawEvent, sourceId, mappings);
      if (result.reason) {
        errors.push({ source_id: sourceId, line: index + 1, reason: result.reason });
        continue;
      }
      const key = `${result.event.source_id}:${result.event.event_id}`;
      if (seen.has(key)) {
        duplicates += 1;
        continue;
      }
      seen.add(key);
      events.push(result.event);
    }
  }

  events.sort((left, right) => (
    Date.parse(left.timestamp) - Date.parse(right.timestamp)
    || left.source_id.localeCompare(right.source_id)
    || left.event_id.localeCompare(right.event_id)
  ));
  const byMonth = new Map();
  for (const event of events) {
    const month = event.timestamp.slice(0, 7).replace("-", "");
    const group = byMonth.get(month) || [];
    group.push(event);
    byMonth.set(month, group);
  }
  const outputFiles = [...byMonth.keys()].sort().map((month) => path.join(normalizedRoot, `${month}.ndjson`));
  for (const file of outputFiles) {
    const month = path.basename(file, ".ndjson");
    atomicWrite(file, `${byMonth.get(month).map((event) => JSON.stringify(event)).join("\n")}\n`);
  }
  removePriorMonthlyOutputs(normalizedRoot, outputFiles);
  atomicWrite(reportPath, `${JSON.stringify({ version: "1.0", generated_at: context.now, errors }, null, 2)}\n`);

  return {
    accepted: events.length,
    duplicates,
    rejected: errors.length,
    outputFiles,
    errorReport: reportPath,
  };
}
