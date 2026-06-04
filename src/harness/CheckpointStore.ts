import type { AgentSession } from "@mariozechner/pi-coding-agent";
import type { RunLogger } from "../logging/RunLogger.js";
import { projectSessionContext, type ProjectedInnerContext } from "./ContextProjector.js";
import {
  canContinueFromMessages,
  captureSessionState,
  createUserTextMessage,
  ensureMutableSession,
  hashContextMaterial,
  restoreSessionState,
  type CapturedSessionState
} from "./ContextApplicator.js";

export type CheckpointKind = "initial" | "post_turn" | "post_rewrite" | "post_rollback";

export interface CheckpointSummary {
  id: string;
  kind: CheckpointKind;
  label: string;
  createdAt: string;
  turnNumber: number;
  path: string;
  contextHash: string;
  messageCount: number;
  lastMessageRole?: string;
  canContinue: boolean;
}

interface CheckpointRecord extends CheckpointSummary {
  state: CapturedSessionState;
  snapshot: ProjectedInnerContext;
  metadata?: Record<string, unknown>;
}

export interface CreateCheckpointInput {
  kind: CheckpointKind;
  label: string;
  turnNumber: number;
  metadata?: Record<string, unknown>;
}

export interface RollbackResult {
  checkpoint: CheckpointSummary;
  beforeSnapshot: ProjectedInnerContext;
  afterSnapshot: ProjectedInnerContext;
  beforeHash: string;
  afterHash: string;
  canContinue: boolean;
  redirectMessage?: string;
}

export interface RollbackInput {
  checkpointId: string;
  redirectMessage?: string;
  requireContinuable?: boolean;
}

export class CheckpointStore {
  private readonly records = new Map<string, CheckpointRecord>();
  private nextOrdinal = 1;

  constructor(
    private readonly session: AgentSession,
    private readonly logger: RunLogger
  ) {}

  async createCheckpoint(input: CreateCheckpointInput): Promise<CheckpointSummary> {
    const createdAt = new Date().toISOString();
    const ordinal = String(this.nextOrdinal).padStart(4, "0");
    const id = `cp-${ordinal}`;
    const fileSlug = slugify(`${input.kind}-${input.label}`);
    const path = `checkpoints/${id}-${fileSlug}.json`;
    const state = captureSessionState(this.session);
    const snapshot = projectSessionContext(this.session);
    const contextHash = hashContextMaterial(state.systemPrompt, state.messages);

    const record: CheckpointRecord = {
      id,
      kind: input.kind,
      label: input.label,
      createdAt,
      turnNumber: input.turnNumber,
      path,
      contextHash,
      messageCount: snapshot.messages.length,
      lastMessageRole: snapshot.messages.at(-1)?.role,
      canContinue: canContinueFromMessages(state.messages),
      state: structuredClone(state),
      snapshot,
      metadata: input.metadata
    };

    this.records.set(id, record);
    this.nextOrdinal += 1;

    await this.logger.writeJsonArtifact(path, {
      id: record.id,
      kind: record.kind,
      label: record.label,
      createdAt: record.createdAt,
      turnNumber: record.turnNumber,
      contextHash: record.contextHash,
      messageCount: record.messageCount,
      lastMessageRole: record.lastMessageRole,
      canContinue: record.canContinue,
      metadata: record.metadata,
      projected_context: record.snapshot,
      restorable_context: {
        systemPrompt: record.state.systemPrompt,
        messages: record.state.messages,
        error: record.state.error
      }
    });
    await this.logger.event("checkpoint_created", {
      checkpointId: record.id,
      kind: record.kind,
      label: record.label,
      turnNumber: record.turnNumber,
      path: record.path,
      contextHash: record.contextHash,
      messageCount: record.messageCount,
      canContinue: record.canContinue
    });

    return toCheckpointSummary(record);
  }

  listCheckpoints(): CheckpointSummary[] {
    return Array.from(this.records.values(), (record) => toCheckpointSummary(record));
  }

  latestCheckpoint(): CheckpointSummary | undefined {
    const latestRecord = Array.from(this.records.values()).at(-1);
    return latestRecord ? toCheckpointSummary(latestRecord) : undefined;
  }

  checkpointCount(): number {
    return this.records.size;
  }

  rollback(input: RollbackInput): RollbackResult {
    ensureMutableSession(this.session, "Checkpoint rollback");

    const checkpoint = this.records.get(input.checkpointId);
    if (!checkpoint) {
      throw new Error(`Unknown checkpoint "${input.checkpointId}".`);
    }

    const previousState = captureSessionState(this.session);
    const beforeSnapshot = projectSessionContext(this.session);
    const beforeHash = hashContextMaterial(previousState.systemPrompt, previousState.messages);

    try {
      restoreSessionState(this.session, structuredClone(checkpoint.state));

      const redirectMessage = input.redirectMessage?.trim();
      if (redirectMessage) {
        this.session.agent.appendMessage(createUserTextMessage(redirectMessage));
        this.session.agent.state.error = undefined;
      }

      const afterState = captureSessionState(this.session);
      const afterSnapshot = projectSessionContext(this.session);
      const afterHash = hashContextMaterial(afterState.systemPrompt, afterState.messages);
      const canContinue = canContinueFromMessages(afterState.messages);

      if (input.requireContinuable && !canContinue) {
        throw new Error(
          "Rolled-back context is not continueable. Provide a redirect_message or target a checkpoint that ends in a user or toolResult message."
        );
      }

      return {
        checkpoint: toCheckpointSummary(checkpoint),
        beforeSnapshot,
        afterSnapshot,
        beforeHash,
        afterHash,
        canContinue,
        redirectMessage
      };
    } catch (error) {
      restoreSessionState(this.session, previousState);
      throw error;
    }
  }
}

function toCheckpointSummary(record: CheckpointRecord): CheckpointSummary {
  return {
    id: record.id,
    kind: record.kind,
    label: record.label,
    createdAt: record.createdAt,
    turnNumber: record.turnNumber,
    path: record.path,
    contextHash: record.contextHash,
    messageCount: record.messageCount,
    lastMessageRole: record.lastMessageRole,
    canContinue: record.canContinue
  };
}

function slugify(value: string): string {
  const slug = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "checkpoint";
}
