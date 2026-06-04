import type { HarnessRunInput } from "../harness/HarnessRunner.js";
import type { CheckpointSummary } from "../harness/CheckpointStore.js";
import type {
  ProjectedInnerContext,
  ProjectedMessage,
  ProjectedSessionStats
} from "../harness/ContextProjector.js";
import type { RunLogger } from "./RunLogger.js";
import type { OuterTermination } from "../schemas/outerDecision.js";
import { getRunArchitecture, usesOuterHarness } from "../schemas/runConfig.js";
import type { Usage } from "@mariozechner/pi-ai";
import type { TriggeredGuardrail } from "../harness/InnerSessionController.js";

interface UsageTotals {
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
}

interface ContextSample {
  label: string;
  path: string;
  turnNumber?: number;
  capturedAt: string;
  messageCount: number;
  tokens: number;
  cumulativeCost: number;
  contextTokens?: number;
  contextWindow?: number;
  contextPercent?: number;
  contextHash?: string;
}

interface TurnMetric {
  turnNumber: number;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  hasPendingContinuation?: boolean;
  toolResultCount?: number;
  assistantStopReason?: string;
  usage?: UsageTotals;
  contextAfterTurn?: {
    messageCount: number;
    tokens: number;
    cumulativeCost: number;
    contextTokens?: number;
    contextWindow?: number;
    contextPercent?: number;
  };
}

interface OuterInvocationMetric {
  turnNumber: number;
  provider: string;
  model: string;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  success: boolean;
  action?: string;
  operationLabel?: string;
  stopReason?: string;
  usage?: UsageTotals;
  failureMessage?: string;
}

interface DurationSummary {
  count: number;
  totalMs: number;
  avgMs: number;
  minMs?: number;
  maxMs?: number;
}

export interface BuildRunSummaryInput {
  input: HarnessRunInput;
  logger: RunLogger;
  status: "success" | "error";
  endedAt: string;
  durationMs: number;
  turnCount?: number;
  checkpointCount?: number;
  latestCheckpointId?: string;
  finalSnapshotPath?: string;
  finalStats?: ProjectedSessionStats;
  checkpoints?: CheckpointSummary[];
  termination?: OuterTermination;
  guardrail?: TriggeredGuardrail;
  error?: string;
  stack?: string;
}

export class MetricsCollector {
  private readonly contextSamples: ContextSample[] = [];
  private readonly turnMetrics = new Map<number, TurnMetric>();
  private readonly turnStarts = new Map<number, number>();
  private readonly outerStarts = new Map<number, { startedAtMs: number; startedAt: string; provider: string; model: string }>();
  private readonly outerInvocations: OuterInvocationMetric[] = [];
  private readonly actionCounts = new Map<string, number>();
  private readonly operationLabelCounts = new Map<string, number>();
  private readonly checkpointKinds = new Map<string, number>();
  private outerDecisionFailureCount = 0;
  private toolCallsStarted = 0;
  private toolCallsFinished = 0;
  private toolCallErrorCount = 0;
  private rewriteAppliedCount = 0;
  private rewriteFailureCount = 0;
  private rollbackAppliedCount = 0;
  private rollbackFailureCount = 0;
  private terminationRequestedCount = 0;
  private readonly outerUsageTotals = createEmptyUsageTotals();

  noteInnerTurnStarted(turnNumber: number): void {
    const now = Date.now();
    this.turnStarts.set(turnNumber, now);

    const existing = this.turnMetrics.get(turnNumber) ?? { turnNumber };
    existing.startedAt = new Date(now).toISOString();
    this.turnMetrics.set(turnNumber, existing);
  }

  noteInnerTurnFinished(input: {
    turnNumber: number;
    snapshot: ProjectedInnerContext;
    assistantMessage: ProjectedMessage;
    toolResultCount: number;
    hasPendingContinuation: boolean;
  }): void {
    const endedAtMs = Date.now();
    const metric = this.turnMetrics.get(input.turnNumber) ?? { turnNumber: input.turnNumber };
    const startedAtMs = this.turnStarts.get(input.turnNumber);
    metric.endedAt = new Date(endedAtMs).toISOString();
    metric.durationMs = startedAtMs !== undefined ? endedAtMs - startedAtMs : undefined;
    metric.hasPendingContinuation = input.hasPendingContinuation;
    metric.toolResultCount = input.toolResultCount;
    metric.assistantStopReason =
      typeof input.assistantMessage.stopReason === "string"
        ? input.assistantMessage.stopReason
        : undefined;
    metric.usage = extractProjectedUsage(input.assistantMessage);
    metric.contextAfterTurn = toContextSampleData(input.snapshot);
    this.turnMetrics.set(input.turnNumber, metric);
  }

  noteToolCallStarted(): void {
    this.toolCallsStarted += 1;
  }

  noteToolCallFinished(isError: boolean): void {
    this.toolCallsFinished += 1;
    if (isError) {
      this.toolCallErrorCount += 1;
    }
  }

  noteContextSnapshot(input: {
    label: string;
    path: string;
    snapshot: ProjectedInnerContext;
    turnNumber?: number;
    contextHash?: string;
  }): void {
    const contextUsage = extractContextUsage(input.snapshot.stats.contextUsage);
    this.contextSamples.push({
      label: input.label,
      path: input.path,
      turnNumber: input.turnNumber,
      capturedAt: input.snapshot.capturedAt,
      messageCount: input.snapshot.messages.length,
      tokens: input.snapshot.stats.tokens.total,
      cumulativeCost: input.snapshot.stats.cost,
      contextTokens: contextUsage.tokens,
      contextWindow: contextUsage.contextWindow,
      contextPercent: contextUsage.percent,
      contextHash: input.contextHash
    });
  }

  noteOuterInvocationStarted(turnNumber: number, provider: string, model: string): void {
    const startedAtMs = Date.now();
    this.outerStarts.set(turnNumber, {
      startedAtMs,
      startedAt: new Date(startedAtMs).toISOString(),
      provider,
      model
    });
  }

  noteOuterInvocationFinished(input: {
    turnNumber: number;
    success: boolean;
    action?: string;
    operationLabel?: string;
    usage?: Usage;
    stopReason?: string;
    failureMessage?: string;
  }): void {
    const started = this.outerStarts.get(input.turnNumber);
    const endedAtMs = Date.now();
    const metric: OuterInvocationMetric = {
      turnNumber: input.turnNumber,
      provider: started?.provider ?? "unknown",
      model: started?.model ?? "unknown",
      startedAt: started?.startedAt ?? new Date(endedAtMs).toISOString(),
      endedAt: new Date(endedAtMs).toISOString(),
      durationMs: started ? endedAtMs - started.startedAtMs : undefined,
      success: input.success,
      action: input.action,
      operationLabel: input.operationLabel,
      stopReason: input.stopReason,
      usage: input.usage ? fromUsage(input.usage) : undefined,
      failureMessage: input.failureMessage
    };

    if (metric.usage) {
      accumulateUsageTotals(this.outerUsageTotals, metric.usage);
    }

    if (input.action) {
      incrementCounter(this.actionCounts, input.action);
    }

    if (input.operationLabel) {
      incrementCounter(this.operationLabelCounts, input.operationLabel);
    }

    if (!input.success) {
      this.outerDecisionFailureCount += 1;
    }

    this.outerInvocations.push(metric);
    this.outerStarts.delete(input.turnNumber);
  }

  noteRewriteApplied(): void {
    this.rewriteAppliedCount += 1;
  }

  noteRewriteFailed(): void {
    this.rewriteFailureCount += 1;
  }

  noteRollbackApplied(): void {
    this.rollbackAppliedCount += 1;
  }

  noteRollbackFailed(): void {
    this.rollbackFailureCount += 1;
  }

  noteCheckpointCreated(checkpoint: CheckpointSummary): void {
    incrementCounter(this.checkpointKinds, checkpoint.kind);
  }

  noteTerminationRequested(): void {
    this.terminationRequestedCount += 1;
  }

  getCurrentEstimatedCostUsd(): number {
    const innerUsage = summarizeTurnUsages(this.turnMetrics.values());
    const combined = addUsageTotals(innerUsage, this.outerUsageTotals);
    return combined.cost.total;
  }

  buildRunSummary(input: BuildRunSummaryInput): Record<string, unknown> {
    const accumulatedInnerUsage = summarizeTurnUsages(this.turnMetrics.values());
    const innerUsage = input.finalStats
      ? usageTotalsFromProjectedSessionStats(input.finalStats, accumulatedInnerUsage)
      : accumulatedInnerUsage;
    const combinedUsage = addUsageTotals(innerUsage, this.outerUsageTotals);
    const contextPeakByTokens = findPeakContextSample(this.contextSamples, (sample) => sample.contextTokens ?? sample.tokens);
    const contextPeakByMessages = findPeakContextSample(this.contextSamples, (sample) => sample.messageCount);
    const initialContextSample = this.contextSamples.find((sample) => sample.label === "initial");
    const finalContextSample =
      findLastContextSample(this.contextSamples, (sample) => sample.label === "final") ??
      this.contextSamples.at(-1);

    return {
      schemaVersion: 1,
      status: input.status,
      run: {
        runId: input.logger.runId,
        condition: input.input.config.condition,
        architecture: getRunArchitecture(input.input.config.condition),
        taskId: input.input.task.id,
        cwd: input.input.task.cwd,
        startedAt: input.logger.startedAt,
        endedAt: input.endedAt,
        durationMs: input.durationMs,
        limits: {
          maxInnerTurns: input.input.config.maxInnerTurns,
          maxEstimatedCostUsd: input.input.config.maxEstimatedCostUsd
        },
        models: {
          inner: {
            provider: input.input.config.provider,
            model: input.input.config.model,
            thinkingLevel: input.input.config.thinkingLevel
          },
          outer: usesOuterHarness(input.input.config)
            ? {
                provider: input.input.config.outerAgent!.provider,
                model: input.input.config.outerAgent!.model,
                thinkingLevel: input.input.config.outerAgent!.thinkingLevel,
                promptProfile: input.input.config.outerAgent!.promptProfile
              }
            : undefined
        }
      },
      outcome: {
        finalSnapshotPath: input.finalSnapshotPath,
        latestCheckpointId: input.latestCheckpointId,
        termination: input.termination,
        guardrail: input.guardrail,
        error: input.error,
        stack: input.stack
      },
      counts: {
        turns: input.turnCount ?? this.turnMetrics.size,
        toolCallsStarted: this.toolCallsStarted,
        toolCallsFinished: this.toolCallsFinished,
        toolCallErrors: this.toolCallErrorCount,
        outerInvocations: this.outerInvocations.length,
        checkpoints: input.checkpointCount ?? input.checkpoints?.length ?? 0,
        contextSnapshots: this.contextSamples.length
      },
      usage: {
        inner: innerUsage,
        outer: this.outerUsageTotals,
        combined: combinedUsage
      },
      timings: {
        runDurationMs: input.durationMs,
        innerTurns: summarizeDurations(this.turnMetrics.values(), (metric) => metric.durationMs),
        outerInvocations: summarizeDurations(this.outerInvocations, (metric) => metric.durationMs)
      },
      context: {
        final: finalContextSample,
        peakByContextTokens: contextPeakByTokens,
        peakByMessageCount: contextPeakByMessages,
        growth:
          initialContextSample && finalContextSample
            ? {
                messageDelta: finalContextSample.messageCount - initialContextSample.messageCount,
                tokenDelta: finalContextSample.tokens - initialContextSample.tokens,
                cumulativeCostDelta:
                  finalContextSample.cumulativeCost - initialContextSample.cumulativeCost,
                contextTokenDelta:
                  finalContextSample.contextTokens !== undefined &&
                  initialContextSample.contextTokens !== undefined
                    ? finalContextSample.contextTokens - initialContextSample.contextTokens
                    : undefined,
                contextPercentDelta:
                  finalContextSample.contextPercent !== undefined &&
                  initialContextSample.contextPercent !== undefined
                    ? finalContextSample.contextPercent - initialContextSample.contextPercent
                    : undefined
              }
            : undefined,
        samples: this.contextSamples
      },
      interventions: {
        actionCounts: mapToObject(this.actionCounts),
        operationLabelCounts: mapToObject(this.operationLabelCounts),
        outerDecisionFailures: this.outerDecisionFailureCount,
        rewriteAppliedCount: this.rewriteAppliedCount,
        rewriteFailureCount: this.rewriteFailureCount,
        rollbackAppliedCount: this.rollbackAppliedCount,
        rollbackFailureCount: this.rollbackFailureCount,
        terminationRequestedCount: this.terminationRequestedCount,
        checkpointKinds: mapToObject(this.checkpointKinds)
      },
      turns: Array.from(this.turnMetrics.values()).sort((left, right) => left.turnNumber - right.turnNumber),
      outer: this.outerInvocations,
      checkpoints: input.checkpoints ?? [],
      finalInnerSessionStats: input.finalStats
    };
  }
}

function createEmptyUsageTotals(): UsageTotals {
  return {
    tokens: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0
    },
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0
    }
  };
}

function fromUsage(usage: Usage): UsageTotals {
  return {
    tokens: {
      input: usage.input,
      output: usage.output,
      cacheRead: usage.cacheRead,
      cacheWrite: usage.cacheWrite,
      total: usage.totalTokens
    },
    cost: {
      input: usage.cost.input,
      output: usage.cost.output,
      cacheRead: usage.cost.cacheRead,
      cacheWrite: usage.cost.cacheWrite,
      total: usage.cost.total
    }
  };
}

function extractProjectedUsage(message: ProjectedMessage): UsageTotals | undefined {
  const usage = asRecord(message.usage);
  const cost = asRecord(usage?.cost);

  if (!usage) {
    return undefined;
  }

  return {
    tokens: {
      input: asNumber(usage.input),
      output: asNumber(usage.output),
      cacheRead: asNumber(usage.cacheRead),
      cacheWrite: asNumber(usage.cacheWrite),
      total: asNumber(usage.totalTokens)
    },
    cost: {
      input: asNumber(cost?.input),
      output: asNumber(cost?.output),
      cacheRead: asNumber(cost?.cacheRead),
      cacheWrite: asNumber(cost?.cacheWrite),
      total: asNumber(cost?.total)
    }
  };
}

function usageTotalsFromProjectedSessionStats(
  stats: ProjectedSessionStats,
  fallback: UsageTotals
): UsageTotals {
  return {
    tokens: {
      input: stats.tokens.input,
      output: stats.tokens.output,
      cacheRead: stats.tokens.cacheRead,
      cacheWrite: stats.tokens.cacheWrite,
      total: stats.tokens.total
    },
    cost: {
      input: fallback.cost.input,
      output: fallback.cost.output,
      cacheRead: fallback.cost.cacheRead,
      cacheWrite: fallback.cost.cacheWrite,
      total: stats.cost
    }
  };
}

function addUsageTotals(left: UsageTotals, right: UsageTotals): UsageTotals {
  return {
    tokens: {
      input: left.tokens.input + right.tokens.input,
      output: left.tokens.output + right.tokens.output,
      cacheRead: left.tokens.cacheRead + right.tokens.cacheRead,
      cacheWrite: left.tokens.cacheWrite + right.tokens.cacheWrite,
      total: left.tokens.total + right.tokens.total
    },
    cost: {
      input: left.cost.input + right.cost.input,
      output: left.cost.output + right.cost.output,
      cacheRead: left.cost.cacheRead + right.cost.cacheRead,
      cacheWrite: left.cost.cacheWrite + right.cost.cacheWrite,
      total: left.cost.total + right.cost.total
    }
  };
}

function accumulateUsageTotals(target: UsageTotals, value: UsageTotals): void {
  target.tokens.input += value.tokens.input;
  target.tokens.output += value.tokens.output;
  target.tokens.cacheRead += value.tokens.cacheRead;
  target.tokens.cacheWrite += value.tokens.cacheWrite;
  target.tokens.total += value.tokens.total;
  target.cost.input += value.cost.input;
  target.cost.output += value.cost.output;
  target.cost.cacheRead += value.cost.cacheRead;
  target.cost.cacheWrite += value.cost.cacheWrite;
  target.cost.total += value.cost.total;
}

function toContextSampleData(snapshot: ProjectedInnerContext): {
  messageCount: number;
  tokens: number;
  cumulativeCost: number;
  contextTokens?: number;
  contextWindow?: number;
  contextPercent?: number;
} {
  const contextUsage = extractContextUsage(snapshot.stats.contextUsage);

  return {
    messageCount: snapshot.messages.length,
    tokens: snapshot.stats.tokens.total,
    cumulativeCost: snapshot.stats.cost,
    contextTokens: contextUsage.tokens,
    contextWindow: contextUsage.contextWindow,
    contextPercent: contextUsage.percent
  };
}

function extractContextUsage(value: unknown): {
  tokens?: number;
  contextWindow?: number;
  percent?: number;
} {
  const record = asRecord(value);
  if (!record) {
    return {};
  }

  return {
    tokens: asOptionalNumber(record.tokens),
    contextWindow: asOptionalNumber(record.contextWindow),
    percent: asOptionalNumber(record.percent)
  };
}

function summarizeDurations<T>(
  values: Iterable<T>,
  getDuration: (value: T) => number | undefined
): DurationSummary {
  const durations = Array.from(values, getDuration).filter(
    (duration): duration is number => typeof duration === "number" && Number.isFinite(duration)
  );

  if (durations.length === 0) {
    return {
      count: 0,
      totalMs: 0,
      avgMs: 0
    };
  }

  const totalMs = durations.reduce((sum, duration) => sum + duration, 0);

  return {
    count: durations.length,
    totalMs,
    avgMs: totalMs / durations.length,
    minMs: Math.min(...durations),
    maxMs: Math.max(...durations)
  };
}

function summarizeTurnUsages(turns: Iterable<TurnMetric>): UsageTotals {
  const totals = createEmptyUsageTotals();

  for (const turn of turns) {
    if (turn.usage) {
      accumulateUsageTotals(totals, turn.usage);
    }
  }

  return totals;
}

function findPeakContextSample(
  samples: ContextSample[],
  score: (sample: ContextSample) => number | undefined
): ContextSample | undefined {
  let best: ContextSample | undefined;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const sample of samples) {
    const currentScore = score(sample);
    if (currentScore === undefined || !Number.isFinite(currentScore)) {
      continue;
    }

    if (!best || currentScore > bestScore) {
      best = sample;
      bestScore = currentScore;
    }
  }

  return best;
}

function findLastContextSample(
  samples: ContextSample[],
  predicate: (sample: ContextSample) => boolean
): ContextSample | undefined {
  for (let index = samples.length - 1; index >= 0; index -= 1) {
    const sample = samples[index];
    if (predicate(sample)) {
      return sample;
    }
  }

  return undefined;
}

function incrementCounter(counter: Map<string, number>, key: string): void {
  counter.set(key, (counter.get(key) ?? 0) + 1);
}

function mapToObject(counter: Map<string, number>): Record<string, number> {
  return Object.fromEntries(counter.entries());
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
