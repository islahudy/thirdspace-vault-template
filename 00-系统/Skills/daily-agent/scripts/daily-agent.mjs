#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

import { aggregateReport } from "./lib/aggregator.mjs";
import { completeOpening, prepareOpening } from "./lib/opening.mjs";
import { normalizeEvents } from "./lib/normalizer.mjs";
import { confirmReadingCandidate, scanReadingInbox } from "./lib/reading.mjs";
import { syncRemoteSources } from "./lib/remote-sync.mjs";
import { validateReportInput, writeReview } from "./lib/reviews.mjs";
import { mutateState } from "./lib/store.mjs";
import { createTask, registerProject, transitionTask } from "./lib/tasks.mjs";

function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      args._.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) args[key] = true;
    else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

function resolveVault(start) {
  let current = path.resolve(start || process.cwd());
  while (true) {
    if (fs.existsSync(path.join(current, ".thirdspace", "workspace-index.yaml"))) return current;
    const parent = path.dirname(current);
    if (parent === current) throw new Error("ThirdSpace vault not found");
    current = parent;
  }
}

function csv(value) {
  return value ? String(value).split(",").map((item) => item.trim()).filter(Boolean) : [];
}

function contextFor(args) {
  return {
    vaultRoot: args.vault ? path.resolve(args.vault) : resolveVault(args.cwd),
    now: process.env.THIRDSPACE_NOW || new Date().toISOString(),
    force: args.force === true,
  };
}

function readReportInput(file) {
  try {
    return validateReportInput(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`invalid report input JSON: ${file}`);
    throw error;
  }
}

function updateReviewTimestamp(context, kind) {
  const field = kind === "weekly" ? "last_weekly_review" : "last_monthly_review";
  const stateFile = path.join(context.vaultRoot, ".thirdspace", "data", "daily-agent", "agent-state.json");
  let current;
  try {
    current = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`invalid JSON: ${stateFile}`);
    throw error;
  }
  if (!current || current.version !== "1.0" || !Number.isInteger(current.revision)) throw new Error(`invalid agent state: ${stateFile}`);
  mutateState(stateFile, current.revision, (state) => ({ ...state, [field]: context.now }), context.now);
}

function dispatch(args) {
  const command = args._[0];
  const context = contextFor(args);
  if (command === "opening") return prepareOpening(context);
  if (command === "project-register") return { project: registerProject(context, {
    id: args.id, name: args.name, path: args.path, status: args.status, stage: args.stage,
    repo_mappings: csv(args.repos),
  }) };
  if (command === "task-add") return { task: createTask(context, {
    title: args.title, priority: args.priority, due: args.due, tags: csv(args.tags),
    project_id: args["project-id"], status: args.status, review_after: args["review-after"],
  }) };
  if (command === "task-transition") return { task: transitionTask(context, args.id, args.status, {
    confirmed: args.confirmed === true,
    due: args.due,
    review_after: args["review-after"],
  }) };
  if (command === "reading-scan") return scanReadingInbox(context);
  if (command === "reading-confirm") return { item: confirmReadingCandidate(context, args.id, args.decision) };
  if (command === "opening-complete") return completeOpening(context, { focusTaskIds: csv(args.focus) });
  if (command === "remote-sync") {
    const configPath = args.config || ".thirdspace/config/remote-event-sources.local.yaml";
    const resolvedConfig = path.isAbsolute(configPath) ? configPath : path.join(context.vaultRoot, configPath);
    if (!fs.existsSync(resolvedConfig)) {
      throw new Error(`remote source config not found: ${resolvedConfig}; copy .thirdspace/schema/remote-event-sources.example.yaml to .thirdspace/config/remote-event-sources.local.yaml`);
    }
    return syncRemoteSources(context, { configPath: resolvedConfig });
  }
  if (command === "events-normalize") return normalizeEvents(context);
  if (command === "report-aggregate") {
    const report = aggregateReport(context, {
      kind: args.kind,
      referenceDate: args.date,
      start: args.start,
      end: args.end,
      timezone: args.timezone,
    });
    return {
      path: path.join(context.vaultRoot, ".thirdspace", "data", "daily-agent", "report-input", `${report.period.id}.json`),
      summary: {
        commits: report.git.total.commits,
        token_sessions: report.tokens.total_sessions,
        completed_tasks: report.tasks.completed.length,
        processed_readings: report.reading.processed.length,
      },
    };
  }
  if (command === "review-generate") {
    if (!["weekly", "monthly"].includes(args.kind)) throw new Error("review-generate requires --kind weekly|monthly");
    const inputPath = args.input && (path.isAbsolute(args.input) ? args.input : path.join(context.vaultRoot, args.input));
    const report = inputPath
      ? readReportInput(inputPath)
      : aggregateReport(context, { kind: args.kind, referenceDate: args.date, timezone: args.timezone });
    if (report.period.kind !== args.kind) throw new Error(`report kind mismatch: expected ${args.kind}, found ${report.period.kind}`);
    const written = writeReview(context, report);
    updateReviewTimestamp(context, args.kind);
    return { ...written, period: report.period.id };
  }
  throw new Error(`unknown command: ${command || "missing"}`);
}

try {
  const result = dispatch(parseArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
