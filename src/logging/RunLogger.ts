import { randomUUID } from "node:crypto";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { HarnessRunInput } from "../harness/HarnessRunner.js";
import { getRunArchitecture, type RunArchitecture, type RunCondition } from "../schemas/runConfig.js";
import type { RunEventRecord, RunEventType } from "./eventTypes.js";
import { redactForLogging, redactText } from "./redact.js";

const execFileAsync = promisify(execFile);

interface RunManifest {
  runId: string;
  startedAt: string;
  condition: RunCondition;
  architecture: RunArchitecture;
  runDirectory: string;
  task: {
    id: string;
    sourcePath: string;
    cwd: string;
  };
  config: {
    sourcePath: string;
    provider: string;
    model: string;
    thinkingLevel: string;
    sessionMode: string;
    agentDir?: string;
    maxInnerTurns?: number;
    maxEstimatedCostUsd?: number;
    outerAgent?: {
      provider: string;
      model: string;
      thinkingLevel: string;
      promptProfile: string;
    };
  };
  gitCommit?: string;
}

export class RunLogger {
  readonly runDirectory: string;
  readonly runId: string;
  readonly startedAt: string;

  private readonly eventsPath: string;
  private readonly stdoutPath: string;
  private readonly stderrPath: string;
  private writeQueue: Promise<void> = Promise.resolve();

  private constructor(
    private readonly manifest: RunManifest
  ) {
    this.runDirectory = manifest.runDirectory;
    this.runId = manifest.runId;
    this.startedAt = manifest.startedAt;
    this.eventsPath = resolve(this.runDirectory, "events.jsonl");
    this.stdoutPath = resolve(this.runDirectory, "stdout.log");
    this.stderrPath = resolve(this.runDirectory, "stderr.log");
  }

  static async create(input: HarnessRunInput): Promise<RunLogger> {
    const startedAt = new Date().toISOString();
    const runId = randomUUID();
    const runDirectory = resolve(
      process.cwd(),
      "runs",
      `${toPathTimestamp(startedAt)}-${slugify(input.config.condition)}-${slugify(input.task.id)}-${runId.slice(0, 8)}`
    );

    await Promise.all([
      mkdir(resolve(runDirectory, "inner_context"), { recursive: true }),
      mkdir(resolve(runDirectory, "checkpoints"), { recursive: true }),
      mkdir(resolve(runDirectory, "outer_agent"), { recursive: true })
    ]);
    await Promise.all([
      writeFile(resolve(runDirectory, "events.jsonl"), "", "utf8"),
      writeFile(resolve(runDirectory, "stdout.log"), "", "utf8"),
      writeFile(resolve(runDirectory, "stderr.log"), "", "utf8")
    ]);

    const manifest: RunManifest = {
      runId,
      startedAt,
      condition: input.config.condition,
      architecture: getRunArchitecture(input.config.condition),
      runDirectory,
      task: {
        id: input.task.id,
        sourcePath: input.task.sourcePath,
        cwd: input.task.cwd
      },
      config: {
        sourcePath: input.config.sourcePath,
        provider: input.config.provider,
        model: input.config.model,
        thinkingLevel: input.config.thinkingLevel,
        sessionMode: input.config.sessionMode,
        agentDir: input.config.agentDir,
        maxInnerTurns: input.config.maxInnerTurns,
        maxEstimatedCostUsd: input.config.maxEstimatedCostUsd,
        outerAgent: input.config.outerAgent
          ? {
              provider: input.config.outerAgent.provider,
              model: input.config.outerAgent.model,
              thinkingLevel: input.config.outerAgent.thinkingLevel,
              promptProfile: input.config.outerAgent.promptProfile
            }
          : undefined
      },
      gitCommit: await getGitCommit()
    };

    const logger = new RunLogger(manifest);
    await logger.writeJsonArtifact("manifest.json", manifest);
    return logger;
  }

  info(message: string): Promise<void> {
    return this.writeStdoutChunk(`${message}\n`);
  }

  error(message: string): Promise<void> {
    return this.writeStderrChunk(`${message}\n`);
  }

  writeStdoutChunk(text: string): Promise<void> {
    const sanitizedText = redactText(text);
    process.stdout.write(sanitizedText);
    return this.enqueue(async () => {
      await appendFile(this.stdoutPath, sanitizedText, "utf8");
    });
  }

  writeStderrChunk(text: string): Promise<void> {
    const sanitizedText = redactText(text);
    process.stderr.write(sanitizedText);
    return this.enqueue(async () => {
      await appendFile(this.stderrPath, sanitizedText, "utf8");
    });
  }

  event(type: RunEventType, payload: Record<string, unknown> = {}): Promise<void> {
    const record: RunEventRecord = redactForLogging({
      timestamp: new Date().toISOString(),
      type,
      ...payload
    });

    return this.enqueue(async () => {
      await appendFile(this.eventsPath, `${JSON.stringify(record)}\n`, "utf8");
    });
  }

  writeJsonArtifact(relativePath: string, value: unknown): Promise<void> {
    const targetPath = this.resolveArtifactPath(relativePath);
    const contents = `${JSON.stringify(redactForLogging(value), null, 2)}\n`;

    return this.enqueue(async () => {
      await mkdir(dirname(targetPath), { recursive: true });
      await writeFile(targetPath, contents, "utf8");
    });
  }

  writeTextArtifact(relativePath: string, text: string): Promise<void> {
    const targetPath = this.resolveArtifactPath(relativePath);
    const sanitizedText = redactText(text);

    return this.enqueue(async () => {
      await mkdir(dirname(targetPath), { recursive: true });
      await writeFile(targetPath, sanitizedText, "utf8");
    });
  }

  async flush(): Promise<void> {
    await this.writeQueue;
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const next = this.writeQueue.then(operation, operation);
    this.writeQueue = next.catch(() => undefined);
    return next;
  }

  private resolveArtifactPath(relativePath: string): string {
    const targetPath = resolve(this.runDirectory, relativePath);
    if (targetPath !== this.runDirectory && !targetPath.startsWith(`${this.runDirectory}/`)) {
      throw new Error(`Artifact path escapes run directory: ${relativePath}`);
    }
    return targetPath;
  }
}

async function getGitCommit(): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: process.cwd()
    });
    const trimmed = stdout.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  } catch {
    return undefined;
  }
}

function slugify(value: string): string {
  const slug = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "task";
}

function toPathTimestamp(value: string): string {
  return value.replace(/[:.]/g, "-");
}
