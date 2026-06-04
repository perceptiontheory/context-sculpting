import { InnerSessionController } from "./InnerSessionController.js";
import { OuterAgentClient } from "./OuterAgentClient.js";
import {
  getRunArchitecture,
  usesOuterHarness,
  type LoadedRunConfig
} from "../schemas/runConfig.js";
import type { LoadedTaskSpec } from "../tasks/loadTaskSpec.js";
import { RunLogger } from "../logging/RunLogger.js";
import { MetricsCollector } from "../logging/MetricsCollector.js";
import type { TriggeredGuardrail } from "./InnerSessionController.js";

export interface HarnessRunInput {
  task: LoadedTaskSpec;
  config: LoadedRunConfig;
}

export interface HarnessRunOutput {
  runId: string;
  runDirectory: string;
  summaryPath: string;
  status: "success" | "error";
  taskId: string;
  condition: LoadedRunConfig["condition"];
  guardrail?: TriggeredGuardrail;
}

export class HarnessRunError extends Error {
  constructor(
    message: string,
    readonly output: HarnessRunOutput
  ) {
    super(message);
    this.name = "HarnessRunError";
  }
}

export class HarnessRunner {
  async run(input: HarnessRunInput): Promise<HarnessRunOutput> {
    const startedAt = Date.now();
    const logger = await RunLogger.create(input);
    const metrics = new MetricsCollector();
    let controller: InnerSessionController | undefined;
    const summaryPath = `${logger.runDirectory}/summary.json`;

    await logger.info(
      `[harness] starting task=${input.task.id} condition=${input.config.condition} cwd=${input.task.cwd}`
    );
    await logger.info(`[harness] run_dir=${logger.runDirectory}`);
    await logger.event("run_started", {
      runId: logger.runId,
      condition: input.config.condition,
      architecture: getRunArchitecture(input.config.condition),
      taskId: input.task.id,
      cwd: input.task.cwd,
      provider: input.config.provider,
      model: input.config.model
    });

    try {
      const outerAgent = usesOuterHarness(input.config)
        ? new OuterAgentClient(input.config.outerAgent!, logger, metrics)
        : undefined;
      controller = await InnerSessionController.create(input, logger, metrics, outerAgent);
      const result = await controller.run();
      const durationMs = Date.now() - startedAt;
      const endedAt = new Date().toISOString();
      const summary = metrics.buildRunSummary({
        input,
        logger,
        status: "success",
        endedAt,
        durationMs,
        turnCount: result.turnCount,
        checkpointCount: result.checkpointCount,
        latestCheckpointId: result.latestCheckpointId,
        finalSnapshotPath: result.finalSnapshotPath,
        finalStats: result.finalStats,
        checkpoints: result.checkpoints,
        termination: result.termination,
        guardrail: result.guardrail
      });

      await logger.info("[harness] run completed");
      await logger.event("run_finished", {
        status: "success",
        condition: input.config.condition,
        durationMs,
        turnCount: result.turnCount,
        checkpointCount: result.checkpointCount,
        latestCheckpointId: result.latestCheckpointId,
        finalSnapshotPath: result.finalSnapshotPath,
        sessionStats: result.finalStats,
        termination: result.termination
      });
      await logger.writeJsonArtifact("summary.json", summary);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      const durationMs = Date.now() - startedAt;
      const endedAt = new Date().toISOString();
      const summary = metrics.buildRunSummary({
        input,
        logger,
        status: "error",
        endedAt,
        durationMs,
        error: message,
        stack,
        turnCount: controller ? undefined : 0,
        checkpointCount: controller ? undefined : 0,
        checkpoints: controller ? undefined : [],
        guardrail: controller?.triggeredGuardrail
      });

      await logger.error(`[harness] run failed: ${message}`);
      await logger.event("error", {
        scope: "HarnessRunner",
        message,
        stack
      });
      await logger.event("run_finished", {
        status: "error",
        condition: input.config.condition,
        durationMs,
        error: message
      });
      await logger.writeJsonArtifact("summary.json", summary);
      throw new HarnessRunError(message, {
        runId: logger.runId,
        runDirectory: logger.runDirectory,
        summaryPath,
        status: "error",
        taskId: input.task.id,
        condition: input.config.condition
      });
    } finally {
      controller?.dispose();
      await logger.flush();
    }

    return {
      runId: logger.runId,
      runDirectory: logger.runDirectory,
      summaryPath,
      status: "success",
      taskId: input.task.id,
      condition: input.config.condition,
      guardrail: controller?.triggeredGuardrail
    };
  }
}
