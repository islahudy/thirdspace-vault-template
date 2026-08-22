const PRIORITY_ORDER = { critical: 0, high: 1, normal: 2, low: 3 };

function prioritySort(left, right) {
  return (PRIORITY_ORDER[left.priority] ?? 2) - (PRIORITY_ORDER[right.priority] ?? 2)
    || String(left.due || "9999-99-99").localeCompare(String(right.due || "9999-99-99"));
}

export function filterTasks(tasks, { tag = "", projectId = "", showCompleted = false } = {}) {
  return tasks.filter((task) => {
    if (!showCompleted && task.status === "completed") return false;
    if (tag && !(task.tags || []).includes(tag)) return false;
    if (projectId && task.project_id !== projectId) return false;
    return true;
  });
}

export function groupTasks(tasks, today) {
  const groups = { overdue: [], today: [], upcoming: [], waiting: [], active: [], completed: [] };
  for (const task of tasks) {
    if (task.status === "completed" || task.status === "cancelled") groups.completed.push(task);
    else if (task.status === "waiting") groups.waiting.push(task);
    else if (task.due && task.due < today) groups.overdue.push(task);
    else if (task.due === today) groups.today.push(task);
    else if (task.due && task.due > today) groups.upcoming.push(task);
    else groups.active.push(task);
  }
  for (const values of Object.values(groups)) values.sort(prioritySort);
  return groups;
}
