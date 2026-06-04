#!/usr/bin/env node

import { spawn } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { HarnessRunner, HarnessRunError, type HarnessRunOutput } from "../harness/HarnessRunner.js";
import { loadRunConfig } from "../schemas/runConfig.js";
import { loadTaskSpec, type LoadedTaskSpec } from "../tasks/loadTaskSpec.js";

interface DemoRunSpec {
  id: string;
  task: string;
  config: string;
  notes?: string;
}

interface DemoMatrix {
  id: string;
  description?: string;
  runs: DemoRunSpec[];
}

interface VerificationResult {
  command: string[];
  cwd: string;
  expectedExitCode: number;
  exitCode: number | null;
  passed: boolean;
  stdoutPath: string;
  stderrPath: string;
  resultPath: string;
}

interface DemoRunResult {
  id: string;
  taskPath: string;
  configPath: string;
  runDirectory?: string;
  summaryPath?: string;
  workspaceSnapshotPath?: string;
  status: "success" | "error";
  error?: string;
  notes?: string;
  verification?: VerificationResult;
}

function printUsage(): void {
  console.error(
    [
      "Usage: context-sculpting-demo --matrix <matrix.json>",
      "",
      "Example:",
      "  npm run demo -- --matrix examples/demo/demo-matrix-core.json"
    ].join("\n")
  );
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      matrix: { type: "string" },
      help: { type: "boolean", short: "h" }
    },
    allowPositionals: false
  });

  if (values.help) {
    printUsage();
    return;
  }

  if (!values.matrix) {
    printUsage();
    throw new Error("The --matrix argument is required.");
  }

  const matrixPath = path.resolve(values.matrix);
  const matrix = await loadDemoMatrix(matrixPath);
  const suiteDirectory = await createSuiteDirectory(matrix.id);
  const resultsPath = path.join(suiteDirectory, "results.json");
  const results: DemoRunResult[] = [];

  await writeJson(path.join(suiteDirectory, "matrix.json"), {
    sourcePath: matrixPath,
    ...matrix
  });

  for (const run of matrix.runs) {
    const taskPath = path.resolve(path.dirname(matrixPath), run.task);
    const configPath = path.resolve(path.dirname(matrixPath), run.config);
    const task = await loadTaskSpec(taskPath);
    const config = await loadRunConfig(configPath);
    const runner = new HarnessRunner();

    await resetTaskWorkspace(task);

    process.stdout.write(
      `[demo] run=${run.id} task=${task.id} condition=${config.condition} taskPath=${taskPath}\n`
    );

    let harnessOutput: HarnessRunOutput | undefined;
    let result: DemoRunResult;

    try {
      try {
        harnessOutput = await runner.run({ task, config });
        result = {
          id: run.id,
          taskPath,
          configPath,
          runDirectory: harnessOutput.runDirectory,
          summaryPath: harnessOutput.summaryPath,
          status: harnessOutput.status,
          notes: run.notes
        };
      } catch (error) {
        if (error instanceof HarnessRunError) {
          harnessOutput = error.output;
          result = {
            id: run.id,
            taskPath,
            configPath,
            runDirectory: error.output.runDirectory,
            summaryPath: error.output.summaryPath,
            status: error.output.status,
            error: error.message,
            notes: run.notes
          };
        } else {
          throw error;
        }
      }

      if (harnessOutput && task.verification) {
        result.verification = await runVerification(task, harnessOutput.runDirectory);
      }

      if (harnessOutput) {
        result.workspaceSnapshotPath = await captureWorkspaceSnapshot(
          task.cwd,
          harnessOutput.runDirectory
        );
      }

      results.push(result);
      await writeJson(resultsPath, {
        matrixId: matrix.id,
        completedRuns: results.length,
        results
      });
    } finally {
      await resetTaskWorkspace(task);
    }
  }

  process.stdout.write(`[demo] suite_dir=${suiteDirectory}\n`);
  process.stdout.write(`[demo] results=${resultsPath}\n`);
}

async function loadDemoMatrix(matrixPath: string): Promise<DemoMatrix> {
  const raw = JSON.parse(await readFile(matrixPath, "utf8")) as unknown;

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`Demo matrix ${matrixPath} is not a JSON object.`);
  }

  const record = raw as Record<string, unknown>;

  if (typeof record.id !== "string" || record.id.length === 0) {
    throw new Error(`Demo matrix ${matrixPath} is missing a non-empty "id" string.`);
  }

  if (record.description !== undefined && typeof record.description !== "string") {
    throw new Error(`Demo matrix ${matrixPath} has a non-string "description" field.`);
  }

  if (!Array.isArray(record.runs) || record.runs.length === 0) {
    throw new Error(`Demo matrix ${matrixPath} must define a non-empty "runs" array.`);
  }

  const runs = record.runs.map((value, index) => parseDemoRunSpec(value, matrixPath, index));

  return {
    id: record.id,
    description: record.description,
    runs
  };
}

function parseDemoRunSpec(value: unknown, matrixPath: string, index: number): DemoRunSpec {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Demo matrix ${matrixPath} has a non-object runs[${index}] entry.`);
  }

  const record = value as Record<string, unknown>;

  if (typeof record.id !== "string" || record.id.length === 0) {
    throw new Error(`Demo matrix ${matrixPath} is missing runs[${index}].id.`);
  }

  if (typeof record.task !== "string" || record.task.length === 0) {
    throw new Error(`Demo matrix ${matrixPath} is missing runs[${index}].task.`);
  }

  if (typeof record.config !== "string" || record.config.length === 0) {
    throw new Error(`Demo matrix ${matrixPath} is missing runs[${index}].config.`);
  }

  if (record.notes !== undefined && typeof record.notes !== "string") {
    throw new Error(`Demo matrix ${matrixPath} has an invalid runs[${index}].notes value.`);
  }

  return {
    id: record.id,
    task: record.task,
    config: record.config,
    notes: record.notes
  };
}

async function createSuiteDirectory(matrixId: string): Promise<string> {
  const startedAt = new Date().toISOString().replace(/[:.]/g, "-");
  const suiteDirectory = path.resolve(
    process.cwd(),
    "runs",
    "demo-suites",
    `${startedAt}-${slugify(matrixId)}`
  );
  await mkdir(suiteDirectory, { recursive: true });
  return suiteDirectory;
}

async function runVerification(
  task: LoadedTaskSpec,
  runDirectory: string
): Promise<VerificationResult> {
  const verificationDirectory = path.join(runDirectory, "verification");
  const stdoutPath = path.join(verificationDirectory, "stdout.log");
  const stderrPath = path.join(verificationDirectory, "stderr.log");
  const resultPath = path.join(verificationDirectory, "result.json");

  await mkdir(verificationDirectory, { recursive: true });

  const result = await executeCommand(task.verification!.command, {
    cwd: task.verification!.cwd
  });

  await writeFile(stdoutPath, result.stdout, "utf8");
  await writeFile(stderrPath, result.stderr, "utf8");

  const verificationResult: VerificationResult = {
    command: task.verification!.command,
    cwd: task.verification!.cwd,
    expectedExitCode: task.verification!.expectedExitCode,
    exitCode: result.exitCode,
    passed: result.exitCode === task.verification!.expectedExitCode,
    stdoutPath,
    stderrPath,
    resultPath
  };

  await writeJson(resultPath, verificationResult);
  return verificationResult;
}

async function resetTaskWorkspace(task: LoadedTaskSpec): Promise<void> {
  if (!task.resetWorkspaceFrom) {
    return;
  }

  await rm(task.cwd, { recursive: true, force: true });
  await cp(task.resetWorkspaceFrom, task.cwd, { recursive: true });
}

async function captureWorkspaceSnapshot(taskCwd: string, runDirectory: string): Promise<string> {
  const snapshotPath = path.join(runDirectory, "workspace_final");
  await rm(snapshotPath, { recursive: true, force: true });
  await cp(taskCwd, snapshotPath, { recursive: true });
  return snapshotPath;
}

async function executeCommand(
  command: string[],
  input: { cwd: string }
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command[0]!, command.slice(1), {
      cwd: input.cwd,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolve({
        exitCode,
        stdout,
        stderr
      });
    });
  });
}

async function writeJson(targetPath: string, value: unknown): Promise<void> {
  await writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function slugify(value: string): string {
  const slug = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "demo";
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
