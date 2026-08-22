import fs from "node:fs";
import path from "node:path";

import { appendEvent, makeEventId } from "./events.mjs";
import { scanReadingInbox } from "./reading.mjs";
import { mutateState, readState } from "./store.mjs";
import { listOpeningTasks } from "./tasks.mjs";

function stateFile(context, name) {
  return path.join(context.vaultRoot, ".thirdspace", "data", "daily-agent", name);
}

function dateOf(context) {
  return String(context.now).slice(0, 10);
}

function worklogPath(context) {
  const date = dateOf(context);
  const compact = date.replaceAll("-", "");
  const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const weekday = weekdays[new Date(`${date}T00:00:00Z`).getUTCDay()];
  return path.join(context.vaultRoot, "02-日记", "工作日志", `${compact}_工作日志_${weekday}.md`);
}

function initialWorklog(context) {
  const created = String(context.now).replace("T", " ");
  return `---
title: "${dateOf(context).replaceAll("-", "")} 工作日志"
type: "worklog"
topic: "work"
workspace: "02-日记"
created: "${created}"
modified: "${created}"
tags: ["worklog", "work", "daily-agent"]
source: "agent"
status: "active"
---

# ${dateOf(context)} 工作日志

## 今日重点

## 今日计划快照

## Git 提交

## 重点记录

## 关键决策

## 问题与风险

## 明日计划
`;
}

function replaceSection(markdown, heading, lines) {
  const content = `${heading}\n\n${lines.join("\n")}\n`;
  const start = markdown.indexOf(`${heading}\n`);
  if (start === -1) return `${markdown.trimEnd()}\n\n${content}`;
  const next = markdown.indexOf("\n## ", start + heading.length);
  return next === -1 ? `${markdown.slice(0, start)}${content}` : `${markdown.slice(0, start)}${content}${markdown.slice(next + 1)}`;
}

export function prepareOpening(context) {
  const date = dateOf(context);
  const agentState = readState(stateFile(context, "agent-state.json"), "pending_confirmations");
  if (!context.force && agentState.last_daily_opening === date) return { required: false, date };
  const tasks = readState(stateFile(context, "tasks.json"), "tasks").tasks;
  return {
    required: true,
    date,
    tasks: listOpeningTasks(tasks, context.now),
    reading: scanReadingInbox(context),
    prompts: {
      completionReview: "昨天及更早的事项中，哪些已经完成、取消或需要等待？",
      todayPlan: "今天准备推进什么？请选择 1～3 个今日重点。",
    },
  };
}

export function completeOpening(context, input) {
  const focusTaskIds = [...new Set(input.focusTaskIds || [])];
  if (focusTaskIds.length < 1 || focusTaskIds.length > 3) throw new Error("opening requires 1 to 3 focus tasks");
  const taskState = readState(stateFile(context, "tasks.json"), "tasks");
  const focusTasks = focusTaskIds.map((id) => {
    const task = taskState.tasks.find((candidate) => candidate.id === id);
    if (!task) throw new Error(`focus task not found: ${id}`);
    if (!new Set(["active", "inbox"]).has(task.status)) throw new Error(`focus task is not active: ${id}`);
    return task;
  });
  const file = worklogPath(context);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let markdown = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : initialWorklog(context);
  markdown = replaceSection(markdown, "## 今日重点", focusTasks.map((task) => `- ${task.title}`));
  markdown = replaceSection(markdown, "## 今日计划快照", focusTasks.map((task) => `- [${task.priority}] ${task.title}`));
  fs.writeFileSync(file, markdown, "utf8");

  const statePath = stateFile(context, "agent-state.json");
  const current = readState(statePath, "pending_confirmations");
  const date = dateOf(context);
  const state = mutateState(statePath, current.revision, (value) => ({
    ...value,
    last_manual_checkin: context.now,
    last_daily_opening: date,
  }), context.now);
  const event = appendEvent(context.vaultRoot, {
    event_id: makeEventId("daily_plan_created", date, context.now),
    timestamp: context.now,
    event_type: "daily_plan_created",
    source_id: "pi-agent",
    subject_id: date,
    focus_task_ids: focusTaskIds,
    worklog_path: path.relative(context.vaultRoot, file),
  }).event;
  return { state, worklogPath: file, event };
}
