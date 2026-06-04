export function exportTasksCsv(store, options = {}) {
  const pendingOnly = options.pendingOnly === true;
  const tasks = store.tasks
    .filter((task) => (pendingOnly ? task.status !== "done" : true))
    .slice()
    .sort((left, right) => left.title.localeCompare(right.title));

  const lines = ["id,title,state"];
  for (const task of tasks) {
    lines.push(`${escapeCsvCell(String(task.id))},${escapeCsvCell(task.title)},${escapeCsvCell(task.status)}`);
  }

  return lines.join("\n");
}

function escapeCsvCell(value) {
  if (/[,"\n]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }

  return value;
}
