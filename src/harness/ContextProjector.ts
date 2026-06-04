import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AgentSession } from "@mariozechner/pi-coding-agent";
import type {
  AssistantMessage,
  ImageContent,
  TextContent,
  ThinkingContent,
  ToolCall,
  ToolResultMessage,
  Usage,
  UserMessage
} from "@mariozechner/pi-ai";

export interface ProjectedSessionStats {
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
  toolResults: number;
  totalMessages: number;
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
  cost: number;
  contextUsage?: unknown;
}

export interface ProjectedInnerContext {
  capturedAt: string;
  sessionId: string;
  sessionFile?: string;
  model?: {
    provider: string;
    id: string;
    name: string;
    api: string;
    contextWindow: number;
    maxTokens: number;
  };
  thinkingLevel: string;
  systemPrompt: string;
  activeTools: string[];
  isStreaming: boolean;
  pendingToolCallIds: string[];
  error?: string;
  lastAssistantText?: string;
  stats: ProjectedSessionStats;
  messages: ProjectedMessage[];
}

export interface ProjectedMessage {
  role: string;
  timestamp?: number;
  [key: string]: unknown;
}

export function projectSessionContext(session: AgentSession): ProjectedInnerContext {
  const stats = session.getSessionStats();

  return {
    capturedAt: new Date().toISOString(),
    sessionId: session.sessionId,
    sessionFile: session.sessionFile,
    model: session.model
      ? {
          provider: session.model.provider,
          id: session.model.id,
          name: session.model.name,
          api: session.model.api,
          contextWindow: session.model.contextWindow,
          maxTokens: session.model.maxTokens
        }
      : undefined,
    thinkingLevel: session.thinkingLevel,
    systemPrompt: session.systemPrompt,
    activeTools: session.getActiveToolNames(),
    isStreaming: session.isStreaming,
    pendingToolCallIds: Array.from(session.state.pendingToolCalls.values()),
    error: session.state.error,
    lastAssistantText: session.getLastAssistantText(),
    stats: {
      userMessages: stats.userMessages,
      assistantMessages: stats.assistantMessages,
      toolCalls: stats.toolCalls,
      toolResults: stats.toolResults,
      totalMessages: stats.totalMessages,
      tokens: {
        input: stats.tokens.input,
        output: stats.tokens.output,
        cacheRead: stats.tokens.cacheRead,
        cacheWrite: stats.tokens.cacheWrite,
        total: stats.tokens.total
      },
      cost: stats.cost,
      contextUsage: normalizeUnknown(stats.contextUsage)
    },
    messages: session.messages.map(projectMessage)
  };
}

export function projectMessage(message: AgentMessage): ProjectedMessage {
  switch (message.role) {
    case "user":
      return projectUserMessage(message);
    case "assistant":
      return projectAssistantMessage(message);
    case "toolResult":
      return projectToolResultMessage(message);
    case "bashExecution":
      return {
        role: message.role,
        timestamp: message.timestamp,
        command: message.command,
        output: message.output,
        exitCode: message.exitCode,
        cancelled: message.cancelled,
        truncated: message.truncated,
        fullOutputPath: message.fullOutputPath,
        excludeFromContext: message.excludeFromContext
      };
    case "custom":
      return {
        role: message.role,
        timestamp: message.timestamp,
        customType: message.customType,
        content: typeof message.content === "string" ? message.content : message.content.map(projectBasicContent),
        display: message.display,
        details: normalizeUnknown(message.details)
      };
    case "branchSummary":
      return {
        role: message.role,
        timestamp: message.timestamp,
        summary: message.summary,
        fromId: message.fromId
      };
    case "compactionSummary":
      return {
        role: message.role,
        timestamp: message.timestamp,
        summary: message.summary,
        tokensBefore: message.tokensBefore
      };
  }
}

function projectUserMessage(message: UserMessage): ProjectedMessage {
  return {
    role: message.role,
    timestamp: message.timestamp,
    content:
      typeof message.content === "string"
        ? message.content
        : message.content.map(projectBasicContent)
  };
}

function projectAssistantMessage(message: AssistantMessage): ProjectedMessage {
  return {
    role: message.role,
    timestamp: message.timestamp,
    api: message.api,
    provider: message.provider,
    model: message.model,
    responseId: message.responseId,
    stopReason: message.stopReason,
    errorMessage: message.errorMessage,
    usage: projectUsage(message.usage),
    content: message.content.map(projectAssistantContent)
  };
}

function projectToolResultMessage(message: ToolResultMessage): ProjectedMessage {
  return {
    role: message.role,
    timestamp: message.timestamp,
    toolCallId: message.toolCallId,
    toolName: message.toolName,
    isError: message.isError,
    content: message.content.map(projectBasicContent),
    details: normalizeUnknown(message.details)
  };
}

function projectUsage(usage: Usage) {
  return {
    input: usage.input,
    output: usage.output,
    cacheRead: usage.cacheRead,
    cacheWrite: usage.cacheWrite,
    totalTokens: usage.totalTokens,
    cost: {
      input: usage.cost.input,
      output: usage.cost.output,
      cacheRead: usage.cost.cacheRead,
      cacheWrite: usage.cost.cacheWrite,
      total: usage.cost.total
    }
  };
}

function projectAssistantContent(content: TextContent | ThinkingContent | ToolCall): unknown {
  switch (content.type) {
    case "text":
      return {
        type: content.type,
        text: content.text,
        textSignature: content.textSignature
      };
    case "thinking":
      return {
        type: content.type,
        thinking: content.thinking,
        thinkingSignature: content.thinkingSignature,
        redacted: content.redacted
      };
    case "toolCall":
      return {
        type: content.type,
        id: content.id,
        name: content.name,
        arguments: normalizeUnknown(content.arguments),
        thoughtSignature: content.thoughtSignature
      };
    default:
      return normalizeUnknown(content);
  }
}

function projectBasicContent(content: TextContent | ImageContent): unknown {
  switch (content.type) {
    case "text":
      return {
        type: content.type,
        text: content.text,
        textSignature: content.textSignature
      };
    case "image":
      return {
        type: content.type,
        mimeType: content.mimeType,
        dataLength: content.data.length
      };
    default:
      return normalizeUnknown(content);
  }
}

function normalizeUnknown(value: unknown, seen: WeakSet<object> = new WeakSet<object>()): unknown {
  if (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map((entry) => normalizeUnknown(entry, seen));
  }

  if (value instanceof Set) {
    return Array.from(value.values(), (entry) => normalizeUnknown(entry, seen));
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack
    };
  }

  if (typeof value === "object") {
    if (seen.has(value)) {
      return "[Circular]";
    }

    seen.add(value);

    const output: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      output[key] = normalizeUnknown(nestedValue, seen);
    }
    return output;
  }

  return String(value);
}
