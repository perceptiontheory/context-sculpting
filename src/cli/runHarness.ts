#!/usr/bin/env node

import { parseArgs } from "node:util";
import { HarnessRunner } from "../harness/HarnessRunner.js";
import { loadRunConfig } from "../schemas/runConfig.js";
import { loadTaskSpec } from "../tasks/loadTaskSpec.js";

function printUsage(): void {
  console.error(
    [
      "Usage: context-sculpting --task <task.json> --config <run-config.json>",
      "",
      "Examples:",
      "  npm run dev -- --task examples/tasks/minimal.json --config examples/configs/minimal.json",
      "  npm run start -- --task examples/tasks/minimal.json --config examples/configs/minimal.json"
    ].join("\n")
  );
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      task: { type: "string" },
      config: { type: "string" },
      help: { type: "boolean", short: "h" }
    },
    allowPositionals: false
  });

  if (values.help) {
    printUsage();
    return;
  }

  if (!values.task || !values.config) {
    printUsage();
    throw new Error("Both --task and --config are required.");
  }

  const task = await loadTaskSpec(values.task);
  const config = await loadRunConfig(values.config);
  const runner = new HarnessRunner();

  await runner.run({ task, config });
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});

