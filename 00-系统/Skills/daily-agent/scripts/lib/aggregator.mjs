import fs from "node:fs";
import path from "node:path";

import { readState } from "./store.mjs";

const TOKEN_COUNTERS = [
  "input_tokens",
  "output_tokens",
  "cache_read_tokens",
  "cache_write_tokens",
  "total_tokens",
];
const MONTHLY_FILE = /^\d{6}\.ndjson$/;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIMESTAMP_WITH_ZONE = /(?:Z|[+-]\d{2}:\d{2})$/;

function pad(value, width = 2) {
  return String(value).padStart(width, "0");
}

function formatter(timezone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
}

function zonedParts(date, timezone) {
  const values = {};
  for (const part of formatter(timezone).formatToParts(date)) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
}

function validCalendarDate(year, month, day) {
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return candidate.getUTCFullYear() === year
    && candidate.getUTCMonth() === month - 1
    && candidate.getUTCDate() === day;
}

function referenceParts(value, timezone) {
  const text = String(value || "");
  const dateMatch = text.match(DATE_ONLY);
  if (dateMatch) {
    const [, year, month, day] = dateMatch.map(Number);
    if (!validCalendarDate(year, month, day)) throw new Error(`invalid reference date: ${text}`);
    return { year, month, day };
  }
  if (!TIMESTAMP_WITH_ZONE.test(text)) throw new Error(`reference date requires an offset: ${text || "missing"}`);
  const instant = new Date(text);
  if (Number.isNaN(instant.getTime())) throw new Error(`invalid reference date: ${text}`);
  const parts = zonedParts(instant, timezone);
  return { year: parts.year, month: parts.month, day: parts.day };
}

function addDays(parts, amount) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + amount));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function midnightEpoch(parts, timezone) {
  const target = Date.UTC(parts.year, parts.month - 1, parts.day);
  let epoch = target;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const observed = zonedParts(new Date(epoch), timezone);
    const observedAsUtc = Date.UTC(
      observed.year, observed.month - 1, observed.day,
      observed.hour, observed.minute, observed.second,
    );
    const adjustment = target - observedAsUtc;
    epoch += adjustment;
    if (adjustment === 0) break;
  }
  const final = zonedParts(new Date(epoch), timezone);
  if (final.year !== parts.year || final.month !== parts.month || final.day !== parts.day
      || final.hour !== 0 || final.minute !== 0 || final.second !== 0) {
    throw new Error(`timezone has no local midnight for ${parts.year}-${pad(parts.month)}-${pad(parts.day)}`);
  }
  return epoch;
}

function offsetText(epoch, timezone) {
  const local = zonedParts(new Date(epoch), timezone);
  const localAsUtc = Date.UTC(
    local.year, local.month - 1, local.day,
    local.hour, local.minute, local.second,
  );
  const offsetMinutes = Math.round((localAsUtc - epoch) / 60_000);
  const sign = offsetMinutes < 0 ? "-" : "+";
  const absolute = Math.abs(offsetMinutes);
  return `${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
}

function boundary(parts, timezone) {
  const epoch = midnightEpoch(parts, timezone);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T00:00:00${offsetText(epoch, timezone)}`;
}

function isoWeek(parts) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - weekday);
  const weekYear = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(weekYear, 0, 1));
  const week = Math.ceil((((date - yearStart) / 86_400_000) + 1) / 7);
  return { year: weekYear, week };
}

export function resolvePeriod(kind, referenceDate, timezone) {
  // Constructing the formatter validates the IANA timezone before date arithmetic.
  formatter(timezone);
  const reference = referenceParts(referenceDate, timezone);
  if (kind === "weekly") {
    const date = new Date(Date.UTC(reference.year, reference.month - 1, reference.day));
    const monday = addDays(reference, -((date.getUTCDay() + 6) % 7));
    const end = addDays(monday, 7);
    const week = isoWeek(monday);
    return {
      id: `${week.year}-W${pad(week.week)}`,
      start: boundary(monday, timezone),
      end: boundary(end, timezone),
    };
  }
  if (kind === "monthly") {
    const start = { year: reference.year, month: reference.month, day: 1 };
    const next = new Date(Date.UTC(reference.year, reference.month, 1));
    const end = { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: 1 };
    return {
      id: `${reference.year}-${pad(reference.month)}`,
      start: boundary(start, timezone),
      end: boundary(end, timezone),
    };
  }
  throw new Error(`unsupported report kind: ${kind || "missing"}`);
}

function customPeriod(start, end, timezone) {
  const startParts = referenceParts(start, timezone);
  const endParts = referenceParts(end, timezone);
  const resolved = {
    id: `${startParts.year}${pad(startParts.month)}${pad(startParts.day)}-${endParts.year}${pad(endParts.month)}${pad(endParts.day)}`,
    start: DATE_ONLY.test(start) ? boundary(startParts, timezone) : new Date(start).toISOString(),
    end: DATE_ONLY.test(end) ? boundary(endParts, timezone) : new Date(end).toISOString(),
  };
  if (Date.parse(resolved.start) >= Date.parse(resolved.end)) throw new Error("report start must be before end");
  return resolved;
}

function atomicWrite(file, value) {
  const temporary = `${file}.tmp-${process.pid}`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
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

function relevantMonths(startTime, endTime) {
  const first = new Date(startTime - 86_400_000);
  const last = new Date(endTime + 86_400_000);
  const cursor = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1));
  const lastMonth = Date.UTC(last.getUTCFullYear(), last.getUTCMonth(), 1);
  const months = new Set();
  while (cursor.getTime() <= lastMonth) {
    months.add(`${cursor.getUTCFullYear()}${pad(cursor.getUTCMonth() + 1)}`);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return months;
}

function normalizedEvents(vaultRoot, start, end) {
  const root = path.join(vaultRoot, ".thirdspace", "events", "normalized");
  if (!fs.existsSync(root)) return [];
  const startTime = Date.parse(start);
  const endTime = Date.parse(end);
  const months = relevantMonths(startTime, endTime);
  const events = [];
  const seen = new Set();
  const files = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && MONTHLY_FILE.test(entry.name) && months.has(entry.name.slice(0, 6)))
    .map((entry) => path.join(root, entry.name))
    .sort();
  for (const file of files) {
    for (const [index, line] of fs.readFileSync(file, "utf8").split(/\r?\n/).entries()) {
      if (!line.trim()) continue;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        throw new Error(`invalid normalized JSON: ${path.basename(file)}:${index + 1}`);
      }
      const timestamp = Date.parse(event.timestamp);
      if (!Number.isFinite(timestamp) || timestamp < startTime || timestamp >= endTime) continue;
      const key = `${event.source_id}:${event.event_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      events.push(event);
    }
  }
  return events.sort((left, right) => (
    Date.parse(left.timestamp) - Date.parse(right.timestamp)
    || String(left.source_id).localeCompare(String(right.source_id))
    || String(left.event_id).localeCompare(String(right.event_id))
  ));
}

function emptyGitSummary() {
  return { commits: 0, files_changed: 0, lines_added: 0, lines_deleted: 0 };
}

function addGitMetrics(summary, event) {
  summary.commits += 1;
  for (const field of ["files_changed", "lines_added", "lines_deleted"]) {
    const value = event.metrics?.[field];
    if (typeof value === "number" && Number.isFinite(value)) summary[field] += value;
  }
}

function gitAggregation(events) {
  const total = emptyGitSummary();
  const groups = new Map();
  for (const event of events.filter((item) => item.event_type === "git_commit")) {
    const projectId = event.project_id || "unmapped";
    const repo = event.repo || "unknown";
    if (!groups.has(projectId)) groups.set(projectId, new Map());
    const repos = groups.get(projectId);
    if (!repos.has(repo)) repos.set(repo, { ...emptyGitSummary(), evidence: [] });
    const repoSummary = repos.get(repo);
    addGitMetrics(total, event);
    addGitMetrics(repoSummary, event);
    repoSummary.evidence.push({
      commit: event.evidence?.commit ?? null,
      timestamp: event.timestamp,
      branch: event.branch ?? null,
      summary: event.summary ?? null,
    });
  }
  const byProject = {};
  for (const projectId of [...groups.keys()].sort()) {
    const project = emptyGitSummary();
    const byRepo = {};
    for (const repo of [...groups.get(projectId).keys()].sort()) {
      const repoSummary = groups.get(projectId).get(repo);
      for (const field of Object.keys(project)) project[field] += repoSummary[field];
      byRepo[repo] = repoSummary;
    }
    byProject[projectId] = { ...project, by_repo: byRepo };
  }
  return { total, by_project: byProject };
}

function tokenAggregation(events) {
  const groups = new Map();
  let missingFields = 0;
  for (const event of events.filter((item) => item.event_type === "token_usage")) {
    if (!groups.has(event.model)) {
      groups.set(event.model, {
        totals: Object.fromEntries(TOKEN_COUNTERS.map((field) => [field, 0])),
        unknown: new Set(),
        sessions: 0,
      });
    }
    const group = groups.get(event.model);
    group.sessions += 1;
    for (const field of TOKEN_COUNTERS) {
      const value = event.metrics?.[field];
      if (value === null || value === undefined) {
        group.unknown.add(field);
        missingFields += 1;
      } else if (typeof value === "number" && Number.isFinite(value)) {
        group.totals[field] += value;
      }
    }
  }
  const byModel = {};
  for (const model of [...groups.keys()].sort()) {
    const group = groups.get(model);
    byModel[model] = { sessions: group.sessions };
    for (const field of TOKEN_COUNTERS) {
      byModel[model][field] = group.unknown.has(field) ? null : group.totals[field];
    }
  }
  return { tokens: { total_sessions: [...groups.values()].reduce((sum, group) => sum + group.sessions, 0), by_model: byModel }, missingFields };
}

function compareBy(fields) {
  return (left, right) => {
    for (const field of fields) {
      const compared = String(left[field] ?? "").localeCompare(String(right[field] ?? ""));
      if (compared) return compared;
    }
    return 0;
  };
}

function projectTask(task) {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    priority: task.priority,
    project_id: task.project_id ?? null,
    due: task.due ?? null,
    completed_at: task.completed_at ?? null,
  };
}

function taskAggregation(tasks, start, end) {
  const inPeriod = (value) => {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) && timestamp >= Date.parse(start) && timestamp < Date.parse(end);
  };
  return {
    completed: tasks.filter((task) => task.status === "completed" && inPeriod(task.completed_at))
      .map(projectTask).sort(compareBy(["completed_at", "id"])),
    carryover: tasks.filter((task) => ["inbox", "active", "waiting"].includes(task.status))
      .map(projectTask).sort(compareBy(["due", "id"])),
  };
}

function projectReading(item) {
  return {
    id: item.id,
    kind: item.kind,
    title: item.title,
    source_path: item.source_path,
    status: item.status,
    added_at: item.added_at,
    processed_at: item.processed_at ?? null,
    output_path: item.output_path ?? null,
  };
}

function readingAggregation(items, start, end) {
  const inPeriod = (value) => {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) && timestamp >= Date.parse(start) && timestamp < Date.parse(end);
  };
  return {
    processed: items.filter((item) => item.status === "processed" && inPeriod(item.processed_at))
      .map(projectReading).sort(compareBy(["processed_at", "id"])),
    backlog: items.filter((item) => ["pending", "reading"].includes(item.status))
      .map(projectReading).sort(compareBy(["added_at", "id"])),
  };
}

function projectProject(project) {
  return { id: project.id, name: project.name, path: project.path, stage: project.stage };
}

function projectAggregation(projects, events) {
  const activity = new Set(events.map((event) => event.project_id).filter(Boolean));
  const active = projects.filter((project) => project.status === "active")
    .map(projectProject).sort(compareBy(["id"]));
  return {
    active,
    without_activity: active.filter((project) => !activity.has(project.id)),
  };
}

function rejectedEventCount(vaultRoot) {
  const file = path.join(vaultRoot, ".thirdspace", "events", "reports", "normalization-errors.json");
  if (!fs.existsSync(file)) return 0;
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  return Array.isArray(value.errors) ? value.errors.length : 0;
}

export function aggregateReport(context, options = {}) {
  if (!context?.vaultRoot || !context.now) throw new Error("vaultRoot and now are required");
  const timezone = options.timezone || context.timezone || "Asia/Shanghai";
  const hasCustomBoundary = options.start !== undefined || options.end !== undefined;
  if (hasCustomBoundary && (!options.start || !options.end)) throw new Error("both report start and end are required");
  const resolved = hasCustomBoundary
    ? customPeriod(options.start, options.end, timezone)
    : resolvePeriod(options.kind, options.referenceDate || context.now, timezone);
  const period = {
    id: resolved.id,
    kind: hasCustomBoundary ? "custom" : options.kind,
    timezone,
    start: resolved.start,
    end: resolved.end,
  };
  const events = normalizedEvents(context.vaultRoot, period.start, period.end);
  const stateRoot = path.join(context.vaultRoot, ".thirdspace", "data", "daily-agent");
  const tasks = readState(path.join(stateRoot, "tasks.json"), "tasks").tasks;
  const reading = readState(path.join(stateRoot, "reading-queue.json"), "items").items;
  const projects = readState(path.join(stateRoot, "project-index.json"), "projects").projects;
  const tokenResult = tokenAggregation(events);
  const report = {
    version: "1.0",
    generated_at: context.now,
    period,
    git: gitAggregation(events),
    tokens: tokenResult.tokens,
    tasks: taskAggregation(tasks, period.start, period.end),
    reading: readingAggregation(reading, period.start, period.end),
    projects: projectAggregation(projects, events),
    coverage: {
      sources: [...new Set(events.map((event) => event.source_id))].sort(),
      rejected_events: rejectedEventCount(context.vaultRoot),
      unmapped_repos: [...new Set(events.filter((event) => !event.project_id && event.repo).map((event) => event.repo))].sort(),
      missing_token_fields: tokenResult.missingFields,
    },
  };
  atomicWrite(path.join(stateRoot, "report-input", `${period.id}.json`), report);
  return report;
}
