import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { appendEvent, makeEventId } from "./events.mjs";
import { mutateState, readState } from "./store.mjs";

const PRIORITIES = new Set(["critical", "high", "normal", "low"]);
const STATUSES = new Set(["inbox", "active", "waiting", "completed", "cancelled"]);

function stateFile(context, name) {
  return path.join(context.vaultRoot, ".thirdspace", "data", "daily-agent", name);
}

function compactTimestamp(timestamp) {
  return new Date(timestamp).toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
}

function normalizedTags(tags = []) {
  return [...new Set(tags.map((tag) => String(tag).trim()).filter(Boolean))];
}

function emit(context, eventType, subjectId, details = {}) {
  return appendEvent(context.vaultRoot, {
    event_id: makeEventId(eventType, subjectId, context.now),
    timestamp: context.now,
    event_type: eventType,
    source_id: "pi-agent",
    subject_id: subjectId,
    ...details,
  });
}

export function registerProject(context, input) {
  const id = String(input.id || "").trim();
  const name = String(input.name || "").trim();
  const relativePath = String(input.path || "").trim();
  if (!id) throw new Error("project id is required");
  if (!name) throw new Error("project name is required");
  if (!(relativePath === "04-项目" || relativePath.startsWith("04-项目/"))) throw new Error("project path must be inside 04-项目");
  if (!fs.existsSync(path.join(context.vaultRoot, relativePath))) throw new Error(`project path not found: ${relativePath}`);
  const file = stateFile(context, "project-index.json");
  const current = readState(file, "projects");
  if (current.projects.some((project) => project.id === id)) throw new Error(`duplicate project id: ${id}`);
  const project = {
    id,
    name,
    path: relativePath,
    status: input.status || "active",
    stage: input.stage || "active",
    repo_mappings: normalizedTags(input.repo_mappings),
    last_activity_at: null,
    last_reviewed_at: null,
  };
  mutateState(file, current.revision, (value) => ({ ...value, projects: [...value.projects, project] }), context.now);
  emit(context, "project_registered", id, { project_path: relativePath });
  return project;
}

export function createTask(context, input) {
  const title = String(input.title || "").trim();
  const priority = input.priority || "normal";
  const status = input.status || "active";
  if (!title) throw new Error("title is required");
  if (!PRIORITIES.has(priority)) throw new Error(`invalid priority: ${priority}`);
  if (!STATUSES.has(status)) throw new Error(`invalid status: ${status}`);
  if (input.project_id) {
    const projects = readState(stateFile(context, "project-index.json"), "projects").projects;
    if (!projects.some((project) => project.id === input.project_id)) throw new Error(`project not found: ${input.project_id}`);
  }
  const file = stateFile(context, "tasks.json");
  const current = readState(file, "tasks");
  const task = {
    id: `task_${compactTimestamp(context.now)}_${crypto.randomBytes(4).toString("hex")}`,
    title,
    status,
    priority,
    due: input.due || null,
    review_after: input.review_after || null,
    tags: normalizedTags(input.tags),
    project_id: input.project_id || null,
    created_at: context.now,
    updated_at: context.now,
    completed_at: status === "completed" ? context.now : null,
    source: input.source || "pi-agent",
  };
  mutateState(file, current.revision, (value) => ({ ...value, tasks: [...value.tasks, task] }), context.now);
  emit(context, "task_created", task.id, { task: { title: task.title, priority, project_id: task.project_id } });
  return task;
}

export function transitionTask(context, id, nextStatus, patch = {}) {
  if (!STATUSES.has(nextStatus)) throw new Error(`invalid status: ${nextStatus}`);
  if (nextStatus === "cancelled" && patch.confirmed !== true) throw new Error("confirmation required for cancellation");
  const file = stateFile(context, "tasks.json");
  const current = readState(file, "tasks");
  const index = current.tasks.findIndex((task) => task.id === id);
  if (index === -1) throw new Error(`task not found: ${id}`);
  const previous = current.tasks[index];
  const task = {
    ...previous,
    ...Object.fromEntries(Object.entries(patch).filter(([key]) => key !== "confirmed")),
    status: nextStatus,
    updated_at: context.now,
    completed_at: nextStatus === "completed" ? context.now : previous.completed_at,
  };
  const tasks = current.tasks.slice();
  tasks[index] = task;
  mutateState(file, current.revision, (value) => ({ ...value, tasks }), context.now);
  emit(context, "task_status_changed", id, { from: previous.status, to: nextStatus });
  return task;
}

export function listOpeningTasks(tasks, now) {
  const groups = { overdue: [], dueSoon: [], upcoming: [], stale: [], waitingForReview: [], active: [] };
  const nowTime = new Date(now).getTime();
  const today = String(now).slice(0, 10);
  const staleBefore = nowTime - 7 * 24 * 60 * 60 * 1000;
  for (const task of tasks) {
    if (task.status === "waiting") {
      if (task.review_after && task.review_after <= today) groups.waitingForReview.push(task);
      continue;
    }
    if (task.status !== "active" && task.status !== "inbox") continue;
    if (task.due && task.due < today) {
      groups.overdue.push(task);
      continue;
    }
    if (task.due) {
      const days = (Date.parse(task.due) - Date.parse(today)) / 86_400_000;
      if (days <= 1) groups.dueSoon.push(task);
      else if (days <= 3) groups.upcoming.push(task);
      else groups.active.push(task);
      continue;
    }
    if (new Date(task.updated_at || task.created_at || now).getTime() < staleBefore) groups.stale.push(task);
    else groups.active.push(task);
  }
  return groups;
}
