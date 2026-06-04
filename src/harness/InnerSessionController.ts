import {
  type AgentContext,
  type AgentLoopConfig,
  type AgentMessage,
  runAgentLoop,
  runAgentLoopContinue
} from "@mariozechner/pi-agent-core";
import {
  AuthStorage,
  type AgentSessionEvent,
  createAgentSession,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager
} from "@mariozechner/pi-coding-agent";
import type { HarnessRunInput } from "./HarnessRunner.js";
import type { LoadedRunConfig } from "../schemas/runConfig.js";
import type { LoadedTaskSpec } from "../tasks/loadTaskSpec.js";
import type { RunLogger } from "../logging/RunLogger.js";
import type { MetricsCollector } from "../logging/MetricsCollector.js";
import {
  projectMessage,
  projectSessionContext,
  type ProjectedInnerContext,
  type ProjectedSessionStats
} from "./ContextProjector.js";
import { ContextApplicator } from "./ContextApplicator.js";
import { CheckpointStore, type CheckpointSummary } from "./CheckpointStore.js";
import type { OuterAgentClient } from "./OuterAgentClient.js";
import type { StreamFn } from "@mariozechner/pi-agent-core";
import type { ToolResultMessage } from "@mariozechner/pi-ai";
import type {
  OuterDecision,
  OuterTermination,
  RollbackDecision,
  RewriteContextDecision
} from "../schemas/outerDecision.js";

type CreateAgentSessionResult = Awaited<ReturnType<typeof createAgentSession>>;
type InnerSession = CreateAgentSessionResult["session"];

interface ControllerDependencies {
  config: LoadedRunConfig;
  task: LoadedTaskSpec;
}

interface AgentInternals {
  _state: {
    systemPrompt: string;
    model: AgentContext["messages"][number] extends never ? never : any;
    thinkingLevel: LoadedRunConfig["thinkingLevel"];
    tools: AgentContext["tools"];
    messages: AgentMessage[];
    isStreaming: boolean;
    streamMessage: AgentMessage | null;
    pendingToolCalls: Set<string>;
    error?: string;
  };
  convertToLlm: AgentLoopConfig["convertToLlm"];
  transformContext?: AgentLoopConfig["transformContext"];
  getApiKey?: AgentLoopConfig["getApiKey"];
  streamFn?: unknown;
  _sessionId?: string;
  _onPayload?: AgentLoopConfig["onPayload"];
  _thinkingBudgets?: AgentLoopConfig["thinkingBudgets"];
  _transport?: AgentLoopConfig["transport"];
  _maxRetryDelayMs?: AgentLoopConfig["maxRetryDelayMs"];
  _toolExecution?: AgentLoopConfig["toolExecution"];
  _beforeToolCall?: AgentLoopConfig["beforeToolCall"];
  _afterToolCall?: AgentLoopConfig["afterToolCall"];
  _processLoopEvent(event: AgentSessionEvent): void;
}

export interface CompletedInnerTurn {
  turnNumber: number;
  snapshotPath: string;
  snapshot: ProjectedInnerContext;
  assistantMessage: ReturnType<typeof projectMessage>;
  toolResults: ReturnType<typeof projectMessage>[];
  hasPendingContinuation: boolean;
}

export interface InnerSessionRunResult {
  turnCount: number;
  finalSnapshotPath: string;
  finalStats: ProjectedSessionStats;
  checkpointCount: number;
  latestCheckpointId?: string;
  checkpoints: CheckpointSummary[];
  termination?: OuterTermination;
  guardrail?: TriggeredGuardrail;
}

interface QueuedSessionEvent {
  event: AgentSessionEvent;
  turnNumber: number;
  turnRecord?: CompletedInnerTurn;
}

export interface TriggeredGuardrail {
  type: "max_inner_turns" | "max_estimated_cost_usd";
  summary: string;
  limit: number;
  observed: number;
  turnNumber: number;
}

class PauseAfterTurnError extends Error {
  constructor() {
    super("Paused after completed inner turn.");
  }
}

export class InnerSessionController {
  private currentAssistantText = "";
  private currentTurnNumber = 0;
  private eventQueue: Promise<void> = Promise.resolve();
  private started = false;
  private lastCompletedTurn?: CompletedInnerTurn;
  private strategyNotes = "";
  private termination?: OuterTermination;
  private guardrail?: TriggeredGuardrail;
  private unsubscribeEvents?: () => void;
  private readonly checkpointStore: CheckpointStore;

  private constructor(
    private readonly session: InnerSession,
    private readonly config: LoadedRunConfig,
    private readonly task: LoadedTaskSpec,
    private readonly logger: RunLogger,
    private readonly metrics: MetricsCollector,
    private readonly outerAgent?: OuterAgentClient
  ) {
    this.checkpointStore = new CheckpointStore(session, logger);
  }

  static async create(
    input: HarnessRunInput,
    logger: RunLogger,
    metrics: MetricsCollector,
    outerAgent?: OuterAgentClient
  ): Promise<InnerSessionController> {
    const session = await createInnerSession({
      config: input.config,
      task: input.task
    });

    const controller = new InnerSessionController(
      session,
      input.config,
      input.task,
      logger,
      metrics,
      outerAgent
    );
    controller.attachEventLogging();
    return controller;
  }

  async run(): Promise<InnerSessionRunResult> {
    await this.ensureInitialized();

    if (!this.outerAgent) {
      let firstTurn = true;

      while (true) {
        const turn = await this.runSingleTurn(firstTurn);
        firstTurn = false;

        if (this.shouldStopWithoutContinuation(turn)) {
          break;
        }

        const guardrail = await this.evaluateGuardrails(turn, {
          phase: "before_next_inner_turn"
        });

        if (guardrail) {
          await this.triggerGuardrail(guardrail);
          break;
        }
      }

      return this.finalizeRun();
    }

    let firstTurn = true;

    while (true) {
      const turn = await this.runSingleTurn(firstTurn);
      firstTurn = false;

      if (this.shouldStopWithoutContinuation(turn)) {
        const finalDecision = await this.outerAgent.decide({
          task: this.task,
          turnNumber: turn.turnNumber,
          hasPendingContinuation: turn.hasPendingContinuation,
          strategyNotes: this.strategyNotes,
          availableCheckpoints: this.checkpointStore.listCheckpoints(),
          innerContext: turn.snapshot,
          assistantMessage: turn.assistantMessage,
          toolResults: turn.toolResults
        });

        this.strategyNotes = finalDecision.updated_strategy_notes;
        await this.logger.writeTextArtifact("strategy_notes.txt", `${this.strategyNotes}\n`);

        if (finalDecision.action === "terminate") {
          this.termination = finalDecision.terminate;
          await this.logger.info(
            `[outer] terminate turn=${turn.turnNumber} status=${finalDecision.terminate.status}`
          );
          await this.logger.event("termination_requested", {
            turnNumber: turn.turnNumber,
            status: finalDecision.terminate.status,
            summary: finalDecision.terminate.summary,
            reasoningSummary: finalDecision.reasoning_summary
          });
          this.metrics.noteTerminationRequested();
        } else {
          await this.logger.info(
            `[outer] final turn=${turn.turnNumber} action=${finalDecision.action} with no pending continuation`
          );
        }

        break;
      }

      const preOuterGuardrail = await this.evaluateGuardrails(turn, {
        phase: "before_outer_invocation"
      });

      if (preOuterGuardrail) {
        await this.triggerGuardrail(preOuterGuardrail);
        break;
      }

      const decision = await this.outerAgent.decide({
        task: this.task,
        turnNumber: turn.turnNumber,
        hasPendingContinuation: turn.hasPendingContinuation,
        strategyNotes: this.strategyNotes,
        availableCheckpoints: this.checkpointStore.listCheckpoints(),
        innerContext: turn.snapshot,
        assistantMessage: turn.assistantMessage,
        toolResults: turn.toolResults
      });

      this.strategyNotes = decision.updated_strategy_notes;
      await this.logger.writeTextArtifact("strategy_notes.txt", `${this.strategyNotes}\n`);

      if (decision.action === "terminate") {
        this.termination = decision.terminate;
        await this.logger.info(
          `[outer] terminate turn=${turn.turnNumber} status=${decision.terminate.status}`
        );
        await this.logger.event("termination_requested", {
          turnNumber: turn.turnNumber,
          status: decision.terminate.status,
          summary: decision.terminate.summary,
          reasoningSummary: decision.reasoning_summary
        });
        this.metrics.noteTerminationRequested();
        break;
      }

      const postOuterGuardrail = await this.evaluateGuardrails(turn, {
        phase: "before_next_inner_turn"
      });

      if (postOuterGuardrail) {
        await this.triggerGuardrail(postOuterGuardrail);
        break;
      }

      if (decision.action === "rewrite_context") {
        const canContinue = await this.applyRewrite(turn, decision);

        if (!canContinue) {
          await this.logger.info(
            `[outer] rewrite produced a non-continuable context on turn=${turn.turnNumber}; ending run`
          );
          break;
        }

        continue;
      }

      if (decision.action === "rollback") {
        const canContinue = await this.applyRollback(turn, decision);

        if (!canContinue) {
          await this.logger.info(
            `[outer] rollback did not yield a continuable context on turn=${turn.turnNumber}; ending run`
          );
          break;
        }

        continue;
      }

      await this.logger.info(`[outer] pass_through turn=${turn.turnNumber}`);

      if (!turn.hasPendingContinuation) {
        break;
      }
    }

    return this.finalizeRun();
  }

  async finalizeRun(): Promise<InnerSessionRunResult> {
    await this.flushEventQueue();

    const finalSnapshotPath = "inner_context/final.json";
    const finalContext = projectSessionContext(this.session);
    await this.writeProjectedSnapshot(finalSnapshotPath, "final", finalContext);

    return {
      turnCount: this.currentTurnNumber,
      finalSnapshotPath,
      finalStats: finalContext.stats,
      checkpointCount: this.checkpointStore.checkpointCount(),
      latestCheckpointId: this.checkpointStore.latestCheckpoint()?.id,
      checkpoints: this.checkpointStore.listCheckpoints(),
      termination: this.termination,
      guardrail: this.guardrail
    };
  }

  dispose(): void {
    this.unsubscribeEvents?.();
    this.session.dispose();
  }

  get triggeredGuardrail(): TriggeredGuardrail | undefined {
    return this.guardrail;
  }

  private attachEventLogging(): void {
    this.unsubscribeEvents = this.session.subscribe((event) => {
      const queuedEvent = this.captureQueuedEvent(event);
      this.eventQueue = this.eventQueue.then(
        () => this.handleEvent(queuedEvent),
        () => this.handleEvent(queuedEvent)
      );
    });
  }

  private captureQueuedEvent(event: AgentSessionEvent): QueuedSessionEvent {
    switch (event.type) {
      case "turn_start":
        this.currentTurnNumber += 1;
        return {
          event,
          turnNumber: this.currentTurnNumber
        };
      case "turn_end": {
        const turnNumber = this.currentTurnNumber;
        const turnRecord = this.buildTurnRecord(turnNumber, event.message, event.toolResults);
        this.lastCompletedTurn = turnRecord;

        return {
          event,
          turnNumber,
          turnRecord
        };
      }
      default:
        return {
          event,
          turnNumber: this.currentTurnNumber
        };
    }
  }

  private async handleEvent(queuedEvent: QueuedSessionEvent): Promise<void> {
    const { event, turnNumber, turnRecord } = queuedEvent;

    switch (event.type) {
      case "turn_start":
        await this.logger.info(`[inner] turn_start turn=${turnNumber}`);
        await this.logger.event("inner_turn_started", {
          turnNumber,
          messageCount: this.session.messages.length
        });
        this.metrics.noteInnerTurnStarted(turnNumber);
        return;
      case "turn_end":
        if (!turnRecord) {
          throw new Error("Missing captured turn record for turn_end event.");
        }

        await this.logger.info(`[inner] turn_end turn=${turnNumber}`);
        await this.logger.writeJsonArtifact(turnRecord.snapshotPath, turnRecord.snapshot);
        await this.logger.event("inner_context_snapshot", {
          label: "post_turn",
          turnNumber,
          path: turnRecord.snapshotPath,
          messageCount: turnRecord.snapshot.messages.length
        });
        await this.logger.event("inner_turn_finished", {
          turnNumber,
          message: turnRecord.assistantMessage,
          toolResults: turnRecord.toolResults,
          sessionStats: turnRecord.snapshot.stats,
          hasPendingContinuation: turnRecord.hasPendingContinuation
        });
        this.metrics.noteInnerTurnFinished({
          turnNumber,
          snapshot: turnRecord.snapshot,
          assistantMessage: turnRecord.assistantMessage,
          toolResultCount: turnRecord.toolResults.length,
          hasPendingContinuation: turnRecord.hasPendingContinuation
        });
        const postTurnCheckpoint = await this.checkpointStore.createCheckpoint({
          kind: "post_turn",
          label: `turn-${String(turnNumber).padStart(3, "0")}-post-turn`,
          turnNumber,
          metadata: {
            snapshotPath: turnRecord.snapshotPath,
            hasPendingContinuation: turnRecord.hasPendingContinuation
          }
        });
        this.metrics.noteCheckpointCreated(postTurnCheckpoint);
        return;
      case "tool_execution_start":
        await this.logger.info(
          `[inner] tool_start turn=${turnNumber} name=${event.toolName ?? "unknown"}`
        );
        await this.logger.event("tool_call_started", {
          turnNumber,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: event.args
        });
        this.metrics.noteToolCallStarted();
        return;
      case "tool_execution_update":
        await this.logger.event("tool_call_updated", {
          turnNumber,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          partialResult: event.partialResult
        });
        return;
      case "tool_execution_end":
        await this.logger.info(
          `[inner] tool_end turn=${turnNumber} name=${event.toolName ?? "unknown"} status=${event.isError ? "error" : "success"}`
        );
        await this.logger.event("tool_call_finished", {
          turnNumber,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          result: event.result,
          isError: event.isError
        });
        this.metrics.noteToolCallFinished(event.isError);
        return;
      case "message_start":
        if (event.message.role === "assistant") {
          this.currentAssistantText = "";
          await this.logger.event("assistant_message_started", {
            turnNumber
          });
        }
        return;
      case "message_update":
        if (event.assistantMessageEvent.type === "text_delta" && event.assistantMessageEvent.delta) {
          this.currentAssistantText += event.assistantMessageEvent.delta;
          await this.logger.writeStdoutChunk(event.assistantMessageEvent.delta);
          await this.logger.event("assistant_message_delta", {
            turnNumber,
            deltaType: event.assistantMessageEvent.type,
            delta: event.assistantMessageEvent.delta
          });
        } else if (event.message.role === "assistant") {
          await this.logger.event("assistant_message_delta", {
            turnNumber,
            deltaType: event.assistantMessageEvent.type
          });
        }
        return;
      case "message_end":
        if (event.message.role === "assistant") {
          await this.flushCompletedAssistantText(event.message);
          await this.logger.event("assistant_message_finished", {
            turnNumber,
            message: projectMessage(event.message)
          });
        }
        return;
      default:
        return;
    }
  }

  private async runSingleTurn(isInitialTurn: boolean): Promise<CompletedInnerTurn> {
    const agent = this.session.agent as unknown as AgentInternals;
    let capturedTurn: CompletedInnerTurn | undefined;

    const emit = async (event: AgentSessionEvent): Promise<void> => {
      agent._processLoopEvent(event);

      if (event.type === "turn_end") {
        capturedTurn = this.buildTurnRecord(this.currentTurnNumber, event.message, event.toolResults);
        this.lastCompletedTurn = capturedTurn;

        if (capturedTurn.hasPendingContinuation) {
          throw new PauseAfterTurnError();
        }
      }
    };

    agent._state.isStreaming = true;
    agent._state.streamMessage = null;
    agent._state.error = undefined;

    try {
      if (isInitialTurn) {
        await runAgentLoop(
          [createUserPromptMessage(this.task.prompt)],
          this.buildAgentContext(agent),
          this.buildAgentLoopConfig(agent),
          emit,
          undefined,
          agent.streamFn as StreamFn | undefined
        );
      } else {
        await runAgentLoopContinue(
          this.buildAgentContext(agent),
          this.buildAgentLoopConfig(agent),
          emit,
          undefined,
          agent.streamFn as StreamFn | undefined
        );
      }
    } catch (error) {
      if (!(error instanceof PauseAfterTurnError)) {
        throw error;
      }
    } finally {
      agent._state.isStreaming = false;
      agent._state.streamMessage = null;
      agent._state.pendingToolCalls = new Set();
    }

    await this.flushEventQueue();

    if (!capturedTurn) {
      throw new Error("Direct inner loop completed without a captured turn.");
    }

    return capturedTurn;
  }

  private buildTurnRecord(
    turnNumber: number,
    message: AgentMessage,
    toolResults: ToolResultMessage[]
  ): CompletedInnerTurn {
    const snapshotPath = `inner_context/turn-${String(turnNumber).padStart(3, "0")}-post-turn.json`;
    const snapshot = projectSessionContext(this.session);

    return {
      turnNumber,
      snapshotPath,
      snapshot,
      assistantMessage: projectMessage(message),
      toolResults: toolResults.map((toolResult) => projectMessage(toolResult)),
      hasPendingContinuation:
        toolResults.length > 0 ||
        (message.role === "assistant" && message.stopReason === "toolUse")
    };
  }

  private buildAgentContext(agent: AgentInternals): AgentContext {
    return {
      systemPrompt: agent._state.systemPrompt,
      messages: [...agent._state.messages],
      tools: agent._state.tools
    };
  }

  private buildAgentLoopConfig(agent: AgentInternals): AgentLoopConfig {
    return {
      model: agent._state.model,
      reasoning: agent._state.thinkingLevel === "off" ? undefined : agent._state.thinkingLevel,
      sessionId: agent._sessionId,
      onPayload: agent._onPayload,
      transport: agent._transport,
      thinkingBudgets: agent._thinkingBudgets,
      maxRetryDelayMs: agent._maxRetryDelayMs,
      toolExecution: agent._toolExecution,
      beforeToolCall: agent._beforeToolCall,
      afterToolCall: agent._afterToolCall,
      convertToLlm: agent.convertToLlm.bind(agent),
      transformContext: agent.transformContext?.bind(agent),
      getApiKey: agent.getApiKey?.bind(agent),
      getSteeringMessages: async () => [],
      getFollowUpMessages: async () => []
    };
  }

  private async flushCompletedAssistantText(message: {
    content?: Array<{ type?: string; text?: string }>;
  }): Promise<void> {
    const fullText = extractAssistantText(message);

    if (fullText.length === 0) {
      this.currentAssistantText = "";
      return;
    }

    if (this.currentAssistantText.length === 0) {
      await this.logger.writeStdoutChunk(fullText);
    } else if (fullText.startsWith(this.currentAssistantText)) {
      await this.logger.writeStdoutChunk(fullText.slice(this.currentAssistantText.length));
    } else if (fullText !== this.currentAssistantText) {
      await this.logger.writeStdoutChunk(`\n${fullText}`);
    }

    await this.logger.writeStdoutChunk("\n");
    this.currentAssistantText = "";
  }

  private async writeContextSnapshot(relativePath: string, label: string): Promise<void> {
    const snapshot = projectSessionContext(this.session);
    await this.writeProjectedSnapshot(relativePath, label, snapshot);
  }

  private async writeProjectedSnapshot(
    relativePath: string,
    label: string,
    snapshot: ProjectedInnerContext,
    extraPayload: Record<string, unknown> = {}
  ): Promise<void> {
    const turnNumber =
      typeof extraPayload.turnNumber === "number" ? extraPayload.turnNumber : undefined;
    const contextHash =
      typeof extraPayload.contextHash === "string" ? extraPayload.contextHash : undefined;
    await this.logger.writeJsonArtifact(relativePath, snapshot);
    await this.logger.event("inner_context_snapshot", {
      label,
      path: relativePath,
      messageCount: snapshot.messages.length,
      ...extraPayload
    });
    this.metrics.noteContextSnapshot({
      label,
      path: relativePath,
      snapshot,
      turnNumber,
      contextHash
    });
  }

  private async applyRewrite(
    turn: CompletedInnerTurn,
    decision: RewriteContextDecision
  ): Promise<boolean> {
    const turnLabel = String(turn.turnNumber).padStart(3, "0");
    const preRewritePath = `inner_context/turn-${turnLabel}-pre-rewrite.json`;
    const postRewritePath = `inner_context/turn-${turnLabel}-post-rewrite.json`;

    await this.logger.info(
      `[outer] rewrite turn=${turn.turnNumber} label=${decision.operation_label}`
    );

    try {
      const application = new ContextApplicator(this.session).apply(decision.rewrite, {
        requireContinuable: turn.hasPendingContinuation
      });

      await this.writeProjectedSnapshot(preRewritePath, "pre_rewrite", application.beforeSnapshot, {
        turnNumber: turn.turnNumber,
        contextHash: application.beforeHash
      });
      await this.writeProjectedSnapshot(postRewritePath, "post_rewrite", application.afterSnapshot, {
        turnNumber: turn.turnNumber,
        contextHash: application.afterHash
      });
      await this.logger.event("rewrite_applied", {
        turnNumber: turn.turnNumber,
        operationLabel: decision.operation_label,
        reasoningSummary: decision.reasoning_summary,
        beforeHash: application.beforeHash,
        afterHash: application.afterHash,
        canContinue: application.canContinue,
        rewrittenMessageCount: application.afterSnapshot.messages.length
      });
      this.metrics.noteRewriteApplied();
      const rewriteCheckpoint = await this.checkpointStore.createCheckpoint({
        kind: "post_rewrite",
        label: `turn-${turnLabel}-post-rewrite`,
        turnNumber: turn.turnNumber,
        metadata: {
          operationLabel: decision.operation_label,
          beforeHash: application.beforeHash,
          afterHash: application.afterHash
        }
      });
      this.metrics.noteCheckpointCreated(rewriteCheckpoint);

      return application.canContinue;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;

      await this.logger.error(`[outer] rewrite failed on turn=${turn.turnNumber}: ${message}`);
      await this.logger.event("rewrite_application_failed", {
        turnNumber: turn.turnNumber,
        operationLabel: decision.operation_label,
        message
      });
      await this.logger.event("error", {
        scope: "ContextApplicator",
        turnNumber: turn.turnNumber,
        message,
        stack
      });
      this.metrics.noteRewriteFailed();

      return turn.hasPendingContinuation;
    }
  }

  private async applyRollback(
    turn: CompletedInnerTurn,
    decision: RollbackDecision
  ): Promise<boolean> {
    const turnLabel = String(turn.turnNumber).padStart(3, "0");
    const preRollbackPath = `inner_context/turn-${turnLabel}-pre-rollback.json`;
    const postRollbackPath = `inner_context/turn-${turnLabel}-post-rollback.json`;

    await this.logger.info(
      `[outer] rollback turn=${turn.turnNumber} checkpoint=${decision.rollback.checkpoint_id}`
    );

    try {
      const application = this.checkpointStore.rollback({
        checkpointId: decision.rollback.checkpoint_id,
        redirectMessage: decision.rollback.redirect_message,
        requireContinuable: true
      });

      await this.writeProjectedSnapshot(preRollbackPath, "pre_rollback", application.beforeSnapshot, {
        turnNumber: turn.turnNumber,
        contextHash: application.beforeHash
      });
      await this.writeProjectedSnapshot(postRollbackPath, "post_rollback", application.afterSnapshot, {
        turnNumber: turn.turnNumber,
        contextHash: application.afterHash
      });
      await this.logger.event("rollback_applied", {
        turnNumber: turn.turnNumber,
        checkpointId: application.checkpoint.id,
        checkpointKind: application.checkpoint.kind,
        redirectMessage: application.redirectMessage,
        reasoningSummary: decision.reasoning_summary,
        beforeHash: application.beforeHash,
        afterHash: application.afterHash,
        canContinue: application.canContinue,
        restoredMessageCount: application.afterSnapshot.messages.length
      });
      this.metrics.noteRollbackApplied();
      const rollbackCheckpoint = await this.checkpointStore.createCheckpoint({
        kind: "post_rollback",
        label: `turn-${turnLabel}-post-rollback`,
        turnNumber: turn.turnNumber,
        metadata: {
          restoredCheckpointId: application.checkpoint.id,
          redirectMessage: application.redirectMessage,
          beforeHash: application.beforeHash,
          afterHash: application.afterHash
        }
      });
      this.metrics.noteCheckpointCreated(rollbackCheckpoint);

      return application.canContinue;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;

      await this.logger.error(`[outer] rollback failed on turn=${turn.turnNumber}: ${message}`);
      await this.logger.event("rollback_application_failed", {
        turnNumber: turn.turnNumber,
        checkpointId: decision.rollback.checkpoint_id,
        message
      });
      await this.logger.event("error", {
        scope: "CheckpointStore",
        turnNumber: turn.turnNumber,
        message,
        stack
      });
      this.metrics.noteRollbackFailed();

      return turn.hasPendingContinuation;
    }
  }

  private async flushEventQueue(): Promise<void> {
    await this.eventQueue;
  }

  private shouldStopWithoutContinuation(turn: CompletedInnerTurn): boolean {
    return !turn.hasPendingContinuation;
  }

  private async evaluateGuardrails(
    turn: CompletedInnerTurn,
    input: { phase: "before_outer_invocation" | "before_next_inner_turn" }
  ): Promise<TriggeredGuardrail | undefined> {
    if (
      this.config.maxEstimatedCostUsd !== undefined &&
      this.metrics.getCurrentEstimatedCostUsd() >= this.config.maxEstimatedCostUsd
    ) {
      const observed = this.metrics.getCurrentEstimatedCostUsd();
      return {
        type: "max_estimated_cost_usd",
        summary:
          input.phase === "before_outer_invocation"
            ? `Estimated run cost reached $${observed.toFixed(2)} before outer invocation on turn ${turn.turnNumber}.`
            : `Estimated run cost reached $${observed.toFixed(2)} after turn ${turn.turnNumber}.`,
        limit: this.config.maxEstimatedCostUsd,
        observed,
        turnNumber: turn.turnNumber
      };
    }

    if (
      input.phase === "before_next_inner_turn" &&
      this.config.maxInnerTurns !== undefined &&
      this.currentTurnNumber >= this.config.maxInnerTurns
    ) {
      return {
        type: "max_inner_turns",
        summary: `Reached maxInnerTurns=${this.config.maxInnerTurns} after turn ${turn.turnNumber}.`,
        limit: this.config.maxInnerTurns,
        observed: this.currentTurnNumber,
        turnNumber: turn.turnNumber
      };
    }

    return undefined;
  }

  private async triggerGuardrail(guardrail: TriggeredGuardrail): Promise<void> {
    this.guardrail = guardrail;
    await this.logger.info(`[harness] guardrail triggered type=${guardrail.type} ${guardrail.summary}`);
    await this.logger.event("guardrail_triggered", {
      type: guardrail.type,
      summary: guardrail.summary,
      limit: guardrail.limit,
      observed: guardrail.observed,
      turnNumber: guardrail.turnNumber
    });
  }

  private async ensureInitialized(): Promise<void> {
    if (this.started) {
      return;
    }

    await this.logger.info(
      `[inner] model=${this.session.model?.provider ?? "unknown"}/${this.session.model?.id ?? "unknown"}`
    );
    await this.logger.info(`[inner] prompting task=${this.task.id}`);
    await this.logger.writeTextArtifact("task_prompt.md", this.task.prompt);
    await this.logger.writeTextArtifact("strategy_notes.txt", "");
    await this.writeContextSnapshot("inner_context/initial.json", "initial");
    const initialCheckpoint = await this.checkpointStore.createCheckpoint({
      kind: "initial",
      label: "initial",
      turnNumber: 0,
      metadata: {
        promptPath: "task_prompt.md"
      }
    });
    this.metrics.noteCheckpointCreated(initialCheckpoint);
    await this.logger.event("inner_prompt_submitted", {
      taskId: this.task.id,
      promptPath: "task_prompt.md"
    });
    this.started = true;
  }
}

function createUserPromptMessage(prompt: string): AgentMessage {
  return {
    role: "user",
    content: [{ type: "text", text: prompt }],
    timestamp: Date.now()
  };
}

function extractAssistantText(message: {
  content?: Array<{ type?: string; text?: string }>;
}): string {
  if (!Array.isArray(message.content)) {
    return "";
  }

  return message.content
    .filter((content): content is { type: "text"; text: string } => content.type === "text" && typeof content.text === "string")
    .map((content) => content.text)
    .join("");
}

async function createInnerSession(deps: ControllerDependencies): Promise<InnerSession> {
  const authStorage = AuthStorage.create();
  const modelRegistry = new ModelRegistry(authStorage);
  const model = modelRegistry.find(deps.config.provider, deps.config.model);

  if (!model) {
    throw new Error(`Unable to resolve model ${deps.config.provider}/${deps.config.model}.`);
  }

  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: false }
  });

  let resourceLoader: DefaultResourceLoader | undefined;
  if (deps.task.systemPrompt) {
    resourceLoader = new DefaultResourceLoader({
      cwd: deps.task.cwd,
      systemPromptOverride: () => deps.task.systemPrompt
    });
    await resourceLoader.reload();
  }

  const sessionOptions: Parameters<typeof createAgentSession>[0] = {
    cwd: deps.task.cwd,
    model,
    thinkingLevel: deps.config.thinkingLevel,
    authStorage,
    modelRegistry,
    sessionManager:
      deps.config.sessionMode === "persistent"
        ? SessionManager.create(deps.task.cwd)
        : SessionManager.inMemory(),
    settingsManager
  };

  if (deps.config.agentDir) {
    sessionOptions.agentDir = deps.config.agentDir;
  }

  if (resourceLoader) {
    sessionOptions.resourceLoader = resourceLoader;
  }

  const { session } = await createAgentSession(sessionOptions);
  return session;
}
