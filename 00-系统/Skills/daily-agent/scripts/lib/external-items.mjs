export function classifyReminderUpdates(tasks, reminders) {
  const remindersById = new Map(reminders.map((reminder) => [reminder.id, reminder]));
  const result = { complete: [], reopenConfirmations: [], brokenRefs: [] };

  for (const task of tasks) {
    const reference = task.external_ref;
    if (reference?.provider !== "eventkit" || reference.kind !== "reminder") continue;

    const reminder = remindersById.get(reference.id);
    if (!reminder) {
      result.brokenRefs.push({ taskId: task.id, reminderId: reference.id });
      continue;
    }
    if (reminder.completed && task.status !== "completed") {
      result.complete.push({ taskId: task.id, completedAt: reminder.completionDate });
    } else if (!reminder.completed && task.status === "completed") {
      result.reopenConfirmations.push({ taskId: task.id, reminderId: reference.id });
    }
  }

  return result;
}
