import path from "node:path";
import { exportTasksCsv } from "./export-tasks.js";
import { completeTask, loadTaskStore, saveTaskStore } from "./task-store.js";

function main(argv) {
  const [command, fileArg, ...rest] = argv;

  if (!command || !fileArg) {
    throw new Error("Usage: node src/cli.js <complete|export> <store-file> [args]");
  }

  const filePath = path.resolve(process.cwd(), fileArg);
  const store = loadTaskStore(filePath);

  if (command === "complete") {
    const taskId = rest[0];
    if (!taskId) {
      throw new Error("The complete command requires a task ID.");
    }

    const updated = completeTask(store, taskId);
    if (!updated) {
      process.stdout.write(`Task ${taskId} not found.\n`);
      process.exitCode = 1;
      return;
    }

    saveTaskStore(filePath, store);
    process.stdout.write(`Completed task ${taskId}.\n`);
    return;
  }

  if (command === "export") {
    const pendingOnly = rest.includes("--pending");
    process.stdout.write(`${exportTasksCsv(store, { pendingOnly })}\n`);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main(process.argv.slice(2));
