import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const DEFAULT_STORE = {
  nextId: 1,
  tasks: []
};

export function loadTaskStore(filePath) {
  if (!existsSync(filePath)) {
    return structuredClone(DEFAULT_STORE);
  }

  const parsed = JSON.parse(readFileSync(filePath, "utf8"));
  return normalizeStore(parsed);
}

export function saveTaskStore(filePath, store) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const normalizedStore = normalizeStore(store);
  writeFileSync(filePath, `${JSON.stringify(normalizedStore, null, 2)}\n`, "utf8");
}

export function addTask(store, title) {
  const task = {
    id: String(store.nextId),
    title,
    status: "pending"
  };

  store.nextId += 1;
  store.tasks.push(task);
  return task;
}

export function completeTask(store, taskId) {
  const requestedId = slugify(String(taskId));
  const task = store.tasks.find((entry) => slugify(entry.title) === requestedId);
  if (!task) {
    return false;
  }

  task.status = "done";
  return true;
}

function normalizeStore(raw) {
  const tasks = Array.isArray(raw?.tasks)
    ? raw.tasks.map((task, index) => ({
        id: slugify(String(task?.title ?? `Task ${index + 1}`)),
        title: String(task?.title ?? "Untitled task"),
        status: task?.status === "done" ? "done" : "pending"
      }))
    : [];

  const nextId = tasks.length;

  return {
    nextId,
    tasks
  };
}

function slugify(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
