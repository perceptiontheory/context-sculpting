import { createHash } from "node:crypto";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AgentSession } from "@mariozechner/pi-coding-agent";
import type {
  AssistantMessage,
  TextContent,
  ThinkingContent,
  ToolCall,
  ToolResultMessage,
  Usage,
  UserMessage
} from "@mariozechner/pi-ai";
import { projectSessionContext, type ProjectedInnerContext } from "./ContextProjector.js";
import type {
  AssistantStopReason,
  RewrittenAssistantContent,
  RewrittenBasicContent,
  RewrittenContext,
  RewrittenMessage,
  RewrittenUsage
} from "../schemas/outerDecision.js";

export interface CapturedSessionState {
  systemPrompt: string;
  messages: AgentMessage[];
  error?: string;
}

interface SessionInternals {
  _steeringMessages?: unknown[];
  _followUpMessages?: unknown[];
  _pendingNextTurnMessages?: unknown[];
}

export interface ContextApplicationResult {
  beforeSnapshot: ProjectedInnerContext;
  afterSnapshot: ProjectedInnerContext;
  beforeHash: string;
  afterHash: string;
  canContinue: boolean;
}

export interface ContextApplicationOptions {
  requireContinuable?: boolean;
}

export class ContextApplicator {
  constructor(private readonly session: AgentSession) {}

  apply(
    rewrite: RewrittenContext,
    options: ContextApplicationOptions = {}
  ): ContextApplicationResult {
    ensureMutableSession(this.session, "Context rewrite");

    const previousState = captureSessionState(this.session);
    const beforeSnapshot = projectSessionContext(this.session);
    const beforeHash = hashContextMaterial(previousState.systemPrompt, previousState.messages);

    try {
      const nextMessages = rewrite.messages.map((message, index) =>
        materializeMessage(message, index, this.session)
      );

      validateMessageStructure(nextMessages);

      const canContinue = canContinueFromMessages(nextMessages);
      if (options.requireContinuable && !canContinue) {
        throw new Error(
          "Rewritten context is not continueable. The last rewritten message must be a user or toolResult message."
        );
      }

      resetTransientSessionState(this.session);
      this.session.agent.setSystemPrompt(rewrite.system_prompt);
      this.session.agent.replaceMessages(nextMessages);
      this.session.agent.state.error = findLatestAssistantError(nextMessages);

      const afterSnapshot = projectSessionContext(this.session);
      const afterHash = hashContextMaterial(rewrite.system_prompt, nextMessages);

      return {
        beforeSnapshot,
        afterSnapshot,
        beforeHash,
        afterHash,
        canContinue
      };
    } catch (error) {
      restoreSessionState(this.session, previousState);
      throw error;
    }
  }
}

export function canContinueFromMessages(messages: AgentMessage[]): boolean {
  const lastMessage = messages.at(-1);
  return lastMessage?.role === "user" || lastMessage?.role === "toolResult";
}

export function captureSessionState(session: AgentSession): CapturedSessionState {
  return {
    systemPrompt: session.systemPrompt,
    messages: structuredClone(session.messages),
    error: session.state.error
  };
}

export function restoreSessionState(session: AgentSession, state: CapturedSessionState): void {
  resetTransientSessionState(session);
  session.agent.setSystemPrompt(state.systemPrompt);
  session.agent.replaceMessages(state.messages);
  session.agent.state.error = state.error;
}

export function resetTransientSessionState(session: AgentSession): void {
  session.agent.clearAllQueues();
  session.agent.state.isStreaming = false;
  session.agent.state.streamMessage = null;
  session.agent.state.pendingToolCalls = new Set();

  const sessionInternals = session as unknown as SessionInternals;
  sessionInternals._steeringMessages = [];
  sessionInternals._followUpMessages = [];
  sessionInternals._pendingNextTurnMessages = [];
}

export function createUserTextMessage(text: string, timestamp: number = Date.now()): UserMessage {
  return {
    role: "user",
    content: [{ type: "text", text }],
    timestamp
  };
}

function materializeMessage(
  message: RewrittenMessage,
  index: number,
  session: AgentSession
): AgentMessage {
  switch (message.role) {
    case "user":
      return materializeUserMessage(message, index);
    case "assistant":
      return materializeAssistantMessage(message, index, session);
    case "toolResult":
      return materializeToolResultMessage(message, index);
    case "bashExecution":
      return {
        role: "bashExecution",
        command: message.command,
        output: message.output,
        exitCode: message.exitCode,
        cancelled: message.cancelled ?? false,
        truncated: message.truncated ?? false,
        fullOutputPath: message.fullOutputPath,
        excludeFromContext: message.excludeFromContext,
        timestamp: normalizeTimestamp(message.timestamp, index)
      };
    case "custom":
      return {
        role: "custom",
        customType: message.customType,
        content:
          typeof message.content === "string"
            ? message.content
            : message.content.map(materializeBasicContent),
        display: message.display ?? true,
        details: message.details,
        timestamp: normalizeTimestamp(message.timestamp, index)
      };
    case "branchSummary":
      return {
        role: "branchSummary",
        summary: message.summary,
        fromId: message.fromId,
        timestamp: normalizeTimestamp(message.timestamp, index)
      };
    case "compactionSummary":
      return {
        role: "compactionSummary",
        summary: message.summary,
        tokensBefore: message.tokensBefore,
        timestamp: normalizeTimestamp(message.timestamp, index)
      };
  }
}

function materializeUserMessage(message: Extract<RewrittenMessage, { role: "user" }>, index: number): UserMessage {
  return {
    role: "user",
    content:
      typeof message.content === "string"
        ? message.content
        : message.content.map(materializeBasicContent),
    timestamp: normalizeTimestamp(message.timestamp, index)
  };
}

function materializeAssistantMessage(
  message: Extract<RewrittenMessage, { role: "assistant" }>,
  index: number,
  session: AgentSession
): AssistantMessage {
  const currentModel = session.model;
  if (!currentModel) {
    throw new Error("Cannot materialize rewritten assistant messages without an active model.");
  }

  const content = message.content.map(materializeAssistantContent);
  const stopReason = resolveAssistantStopReason(message.stopReason, message.errorMessage, content);

  return {
    role: "assistant",
    content,
    api: (message.api ?? currentModel.api) as AssistantMessage["api"],
    provider: (message.provider ?? currentModel.provider) as AssistantMessage["provider"],
    model: message.model ?? currentModel.id,
    responseId: message.responseId,
    usage: materializeUsage(message.usage),
    stopReason,
    errorMessage: message.errorMessage,
    timestamp: normalizeTimestamp(message.timestamp, index)
  };
}

function materializeToolResultMessage(
  message: Extract<RewrittenMessage, { role: "toolResult" }>,
  index: number
): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId: message.toolCallId,
    toolName: message.toolName,
    content: message.content.map(materializeBasicContent),
    details: message.details,
    isError: message.isError,
    timestamp: normalizeTimestamp(message.timestamp, index)
  };
}

function materializeBasicContent(content: RewrittenBasicContent): TextContent {
  return {
    type: "text",
    text: content.text,
    textSignature: content.textSignature
  };
}

function materializeAssistantContent(
  content: RewrittenAssistantContent
): TextContent | ThinkingContent | ToolCall {
  switch (content.type) {
    case "text":
      return {
        type: "text",
        text: content.text,
        textSignature: content.textSignature
      };
    case "thinking":
      return {
        type: "thinking",
        thinking: content.thinking,
        thinkingSignature: content.thinkingSignature,
        redacted: content.redacted
      };
    case "toolCall":
      return {
        type: "toolCall",
        id: content.id,
        name: content.name,
        arguments: content.arguments as Record<string, any>,
        thoughtSignature: content.thoughtSignature
      };
  }
}

function materializeUsage(usage: RewrittenUsage | undefined): Usage {
  const input = usage?.input ?? 0;
  const output = usage?.output ?? 0;
  const cacheRead = usage?.cacheRead ?? 0;
  const cacheWrite = usage?.cacheWrite ?? 0;
  const totalTokens = usage?.totalTokens ?? input + output + cacheRead + cacheWrite;
  const costInput = usage?.cost?.input ?? 0;
  const costOutput = usage?.cost?.output ?? 0;
  const costCacheRead = usage?.cost?.cacheRead ?? 0;
  const costCacheWrite = usage?.cost?.cacheWrite ?? 0;

  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    totalTokens,
    cost: {
      input: costInput,
      output: costOutput,
      cacheRead: costCacheRead,
      cacheWrite: costCacheWrite,
      total:
        usage?.cost?.total ??
        costInput + costOutput + costCacheRead + costCacheWrite
    }
  };
}

function resolveAssistantStopReason(
  requestedStopReason: AssistantStopReason | undefined,
  errorMessage: string | undefined,
  content: Array<TextContent | ThinkingContent | ToolCall>
): AssistantMessage["stopReason"] {
  const hasToolCalls = content.some((block) => block.type === "toolCall");

  if (requestedStopReason) {
    if (hasToolCalls && requestedStopReason !== "toolUse") {
      throw new Error(
        `Rewritten assistant message with tool calls must use stopReason "toolUse", received "${requestedStopReason}".`
      );
    }

    if (!hasToolCalls && requestedStopReason === "toolUse") {
      throw new Error(
        'Rewritten assistant message without tool calls cannot use stopReason "toolUse".'
      );
    }

    return requestedStopReason;
  }

  if (errorMessage) {
    return "error";
  }

  return hasToolCalls ? "toolUse" : "stop";
}

function validateMessageStructure(messages: AgentMessage[]): void {
  if (messages.length === 0) {
    throw new Error("Rewritten context must contain at least one message.");
  }

  const seenToolCalls = new Set<string>();

  for (const message of messages) {
    if (message.role === "assistant") {
      for (const content of message.content) {
        if (content.type === "toolCall") {
          seenToolCalls.add(content.id);
        }
      }
    }

    if (message.role === "toolResult" && !seenToolCalls.has(message.toolCallId)) {
      throw new Error(
        `Tool result "${message.toolCallId}" does not reference a prior assistant tool call.`
      );
    }
  }
}

function findLatestAssistantError(messages: AgentMessage[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (message.role === "assistant" && message.errorMessage) {
      return message.errorMessage;
    }
  }

  return undefined;
}

function normalizeTimestamp(timestamp: number | undefined, index: number): number {
  return timestamp ?? Date.now() + index;
}

export function hashContextMaterial(systemPrompt: string, messages: AgentMessage[]): string {
  return createHash("sha256")
    .update(JSON.stringify({ systemPrompt, messages }))
    .digest("hex");
}

export function ensureMutableSession(session: AgentSession, operation: string): void {
  if (session.sessionManager.isPersisted()) {
    throw new Error(
      `${operation} is currently supported only for in_memory sessions. Persistent session files are not yet rewritten safely.`
    );
  }
}
