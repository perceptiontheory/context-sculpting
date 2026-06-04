import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { exportTasksCsv } from "../src/export-tasks.js";
import { completeTask, loadTaskStore, saveTaskStore } from "../src/task-store.js";

const FIXTURE_PATH = path.resolve("data/tasks.json");

test("loadTaskStore preserves stable ids and nextId from disk", () => {
  const store = loadTaskStore(FIXTURE_PATH);

  assert.equal(store.nextId, 4);
  assert.deepEqual(
    store.tasks.map((task) => task.id),
    ["1", "2", "3"]
  );
});

test("completeTask updates the task matching the provided id", () => {
  const store = loadTaskStore(FIXTURE_PATH);
  const completed = completeTask(store, "2");

  assert.equal(completed, true);
  assert.equal(store.tasks.find((task) => task.id === "2")?.status, "done");
  assert.equal(store.tasks.find((task) => task.id === "3")?.status, "pending");
});

test("exportTasksCsv preserves store order and uses the status header", () => {
  const store = loadTaskStore(FIXTURE_PATH);
  const csv = exportTasksCsv(store, { pendingOnly: true });

  assert.equal(
    csv,
    ["id,title,status", "2,Draft agenda,pending", "3,Send invites,pending"].join("\n")
  );
});

test("cli export prints the pending-task csv from the stored data", () => {
  const result = spawnSync("node", ["src/cli.js", "export", "data/tasks.json", "--pending"], {
    cwd: path.resolve("."),
    encoding: "utf8"
  });

  assert.equal(result.status, 0);
  assert.equal(
    result.stdout.trim(),
    ["id,title,status", "2,Draft agenda,pending", "3,Send invites,pending"].join("\n")
  );
});

test("cli complete mutates the target task in place", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "context-sculpting-coding-"));
  const tempStorePath = path.join(tempDir, "tasks.json");
  const store = loadTaskStore(FIXTURE_PATH);

  saveTaskStore(tempStorePath, store);
  const result = spawnSync("node", ["src/cli.js", "complete", tempStorePath, "3"], {
    cwd: path.resolve("."),
    encoding: "utf8"
  });

  assert.equal(result.status, 0);

  const savedStore = JSON.parse(readFileSync(tempStorePath, "utf8"));
  assert.equal(savedStore.tasks.find((task) => task.id === "3")?.status, "done");
});
