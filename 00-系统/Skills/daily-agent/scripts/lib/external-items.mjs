const COMPLETABLE_STATUSES = new Set(["inbox", "active", "waiting"]);

export function classifyReminderUpdates(tasks, reminders, options = {}) {
  const remindersById = new Map(reminders.map((reminder) => [reminder.id, reminder]));
  const confirmedMissingReminderIds = new Set(options.confirmedMissingReminderIds ?? []);
  const result = {
    complete: [], reopenConfirmations: [], brokenRefs: [], anomalies: [],
  };

  for (const task of tasks) {
    const reference = task.external_ref;
    if (reference?.provider !== "eventkit" || reference.kind !== "reminder") continue;

    const reminder = remindersById.get(reference.id);
    if (!reminder) {
      if (confirmedMissingReminderIds.has(reference.id)) {
        result.brokenRefs.push({ taskId: task.id, reminderId: reference.id });
      }
      continue;
    }
    if (reminder.completed && COMPLETABLE_STATUSES.has(task.status)) {
      if (typeof reminder.completionDate !== "string" || reminder.completionDate.trim() === "") {
        result.anomalies.push({
          taskId: task.id,
          reminderId: reference.id,
          code: "MISSING_COMPLETION_DATE",
        });
        continue;
      }
      result.complete.push({ taskId: task.id, completedAt: reminder.completionDate });
    } else if (!reminder.completed && task.status === "completed") {
      result.reopenConfirmations.push({ taskId: task.id, reminderId: reference.id });
    }
  }

  return result;
}
