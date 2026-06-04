export type OuterAction = "pass_through" | "rewrite_context" | "rollback" | "terminate";
export type RewriteOperationLabel =
  | "rewrite_context"
  | "compact"
  | "inject"
  | "reorder"
  | "edit_system_prompt";
export type OuterOperationLabel = "pass_through" | RewriteOperationLabel | "rollback" | "terminate";
export type TerminationStatus = "success" | "failure" | "unachievable";
export type AssistantStopReason = "stop" | "length" | "toolUse" | "error" | "aborted";

export interface OuterTermination {
  status: TerminationStatus;
  summary: string;
}

export interface OuterRollback {
  checkpoint_id: string;
  redirect_message?: string;
}

export interface RewrittenUsage {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  totalTokens?: number;
  cost?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    total?: number;
  };
}

export interface RewrittenTextContent {
  type: "text";
  text: string;
  textSignature?: string;
}

export interface RewrittenThinkingContent {
  type: "thinking";
  thinking: string;
  thinkingSignature?: string;
  redacted?: boolean;
}

export interface RewrittenToolCallContent {
  type: "toolCall";
  id: string;
  name: string;
  arguments: unknown;
  thoughtSignature?: string;
}

export type RewrittenBasicContent = RewrittenTextContent;
export type RewrittenAssistantContent =
  | RewrittenTextContent
  | RewrittenThinkingContent
  | RewrittenToolCallContent;

interface RewrittenMessageBase {
  role: string;
  timestamp?: number;
}

export interface RewrittenUserMessage extends RewrittenMessageBase {
  role: "user";
  content: string | RewrittenBasicContent[];
}

export interface RewrittenAssistantMessage extends RewrittenMessageBase {
  role: "assistant";
  content: RewrittenAssistantContent[];
  api?: string;
  provider?: string;
  model?: string;
  responseId?: string;
  usage?: RewrittenUsage;
  stopReason?: AssistantStopReason;
  errorMessage?: string;
}

export interface RewrittenToolResultMessage extends RewrittenMessageBase {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: RewrittenBasicContent[];
  details?: unknown;
  isError: boolean;
}

export interface RewrittenBashExecutionMessage extends RewrittenMessageBase {
  role: "bashExecution";
  command: string;
  output: string;
  exitCode?: number;
  cancelled?: boolean;
  truncated?: boolean;
  fullOutputPath?: string;
  excludeFromContext?: boolean;
}

export interface RewrittenCustomMessage extends RewrittenMessageBase {
  role: "custom";
  customType: string;
  content: string | RewrittenBasicContent[];
  display?: boolean;
  details?: unknown;
}

export interface RewrittenBranchSummaryMessage extends RewrittenMessageBase {
  role: "branchSummary";
  summary: string;
  fromId: string;
}

export interface RewrittenCompactionSummaryMessage extends RewrittenMessageBase {
  role: "compactionSummary";
  summary: string;
  tokensBefore: number;
}

export type RewrittenMessage =
  | RewrittenUserMessage
  | RewrittenAssistantMessage
  | RewrittenToolResultMessage
  | RewrittenBashExecutionMessage
  | RewrittenCustomMessage
  | RewrittenBranchSummaryMessage
  | RewrittenCompactionSummaryMessage;

export interface RewrittenContext {
  system_prompt: string;
  messages: RewrittenMessage[];
}

interface OuterDecisionBase {
  action: OuterAction;
  operation_label: OuterOperationLabel;
  reasoning_summary: string;
  updated_strategy_notes: string;
}

export interface PassThroughDecision extends OuterDecisionBase {
  action: "pass_through";
  operation_label: "pass_through";
}

export interface RewriteContextDecision extends OuterDecisionBase {
  action: "rewrite_context";
  operation_label: RewriteOperationLabel;
  rewrite: RewrittenContext;
}

export interface RollbackDecision extends OuterDecisionBase {
  action: "rollback";
  operation_label: "rollback";
  rollback: OuterRollback;
}

export interface TerminateDecision extends OuterDecisionBase {
  action: "terminate";
  operation_label: "terminate";
  terminate: OuterTermination;
}

export type OuterDecision =
  | PassThroughDecision
  | RewriteContextDecision
  | RollbackDecision
  | TerminateDecision;

export function parseOuterDecision(rawText: string): OuterDecision {
  const candidate = JSON.parse(extractJsonObject(rawText)) as unknown;

  if (!candidate || typeof candidate !== "object") {
    throw new Error("Outer decision is not a JSON object.");
  }

  const record = candidate as Record<string, unknown>;
  const action = requireEnum(record.action, ["pass_through", "rewrite_context", "rollback", "terminate"], "action");
  const reasoningSummary = requireString(record.reasoning_summary, "reasoning_summary");
  const updatedStrategyNotes = requireString(record.updated_strategy_notes, "updated_strategy_notes");

  if (action === "pass_through") {
    const operationLabel = requireEnum(record.operation_label, ["pass_through"], "operation_label");

    return {
      action,
      operation_label: operationLabel,
      reasoning_summary: reasoningSummary,
      updated_strategy_notes: updatedStrategyNotes
    };
  }

  if (action === "rewrite_context") {
    const operationLabel = requireEnum(
      record.operation_label,
      ["rewrite_context", "compact", "inject", "reorder", "edit_system_prompt"],
      "operation_label"
    );
    const rewrite = parseRewrittenContext(record.rewrite, "rewrite");

    return {
      action,
      operation_label: operationLabel,
      reasoning_summary: reasoningSummary,
      updated_strategy_notes: updatedStrategyNotes,
      rewrite
    };
  }

  if (action === "rollback") {
    const operationLabel = requireEnum(record.operation_label, ["rollback"], "operation_label");
    const rollbackRecord = requireRecord(record.rollback, "rollback");

    return {
      action,
      operation_label: operationLabel,
      reasoning_summary: reasoningSummary,
      updated_strategy_notes: updatedStrategyNotes,
      rollback: {
        checkpoint_id: requireNonEmptyString(rollbackRecord.checkpoint_id, "rollback.checkpoint_id"),
        redirect_message: optionalString(rollbackRecord.redirect_message, "rollback.redirect_message")
      }
    };
  }

  const operationLabel = requireEnum(record.operation_label, ["terminate"], "operation_label");
  const terminateRecord = requireRecord(record.terminate, "terminate");
  const status = requireEnum(terminateRecord.status, ["success", "failure", "unachievable"], "terminate.status");
  const summary = requireString(terminateRecord.summary, "terminate.summary");

  return {
    action,
    operation_label: operationLabel,
    reasoning_summary: reasoningSummary,
    updated_strategy_notes: updatedStrategyNotes,
    terminate: {
      status,
      summary
    }
  };
}

function parseRewrittenContext(value: unknown, fieldName: string): RewrittenContext {
  const record = requireRecord(value, fieldName);
  const systemPrompt = requireString(record.system_prompt, `${fieldName}.system_prompt`);
  const messages = parseRewrittenMessages(record.messages, `${fieldName}.messages`);

  if (messages.length === 0) {
    throw new Error(`Outer decision field "${fieldName}.messages" must contain at least one message.`);
  }

  return {
    system_prompt: systemPrompt,
    messages
  };
}

function parseRewrittenMessages(value: unknown, fieldName: string): RewrittenMessage[] {
  if (!Array.isArray(value)) {
    throw new Error(`Outer decision field "${fieldName}" must be an array.`);
  }

  return value.map((message, index) => parseRewrittenMessage(message, `${fieldName}[${index}]`));
}

function parseRewrittenMessage(value: unknown, fieldName: string): RewrittenMessage {
  const record = requireRecord(value, fieldName);
  const role = requireEnum(
    record.role,
    ["user", "assistant", "toolResult", "bashExecution", "custom", "branchSummary", "compactionSummary"],
    `${fieldName}.role`
  );
  const timestamp = optionalNumber(record.timestamp, `${fieldName}.timestamp`);

  switch (role) {
    case "user":
      return {
        role,
        timestamp,
        content: parseStringOrTextArray(record.content, `${fieldName}.content`)
      };
    case "assistant":
      return {
        role,
        timestamp,
        content: parseAssistantContentArray(record.content, `${fieldName}.content`),
        api: optionalString(record.api, `${fieldName}.api`),
        provider: optionalString(record.provider, `${fieldName}.provider`),
        model: optionalString(record.model, `${fieldName}.model`),
        responseId: optionalString(record.responseId, `${fieldName}.responseId`),
        usage: parseUsage(record.usage, `${fieldName}.usage`),
        stopReason: optionalEnum(
          record.stopReason,
          ["stop", "length", "toolUse", "error", "aborted"],
          `${fieldName}.stopReason`
        ),
        errorMessage: optionalString(record.errorMessage, `${fieldName}.errorMessage`)
      };
    case "toolResult":
      return {
        role,
        timestamp,
        toolCallId: requireNonEmptyString(record.toolCallId, `${fieldName}.toolCallId`),
        toolName: requireNonEmptyString(record.toolName, `${fieldName}.toolName`),
        content: parseTextContentArray(record.content, `${fieldName}.content`),
        details: record.details,
        isError: requireBoolean(record.isError, `${fieldName}.isError`)
      };
    case "bashExecution":
      return {
        role,
        timestamp,
        command: requireString(record.command, `${fieldName}.command`),
        output: requireString(record.output, `${fieldName}.output`),
        exitCode: optionalNumber(record.exitCode, `${fieldName}.exitCode`),
        cancelled: optionalBoolean(record.cancelled, `${fieldName}.cancelled`),
        truncated: optionalBoolean(record.truncated, `${fieldName}.truncated`),
        fullOutputPath: optionalString(record.fullOutputPath, `${fieldName}.fullOutputPath`),
        excludeFromContext: optionalBoolean(record.excludeFromContext, `${fieldName}.excludeFromContext`)
      };
    case "custom":
      return {
        role,
        timestamp,
        customType: requireNonEmptyString(record.customType, `${fieldName}.customType`),
        content: parseStringOrTextArray(record.content, `${fieldName}.content`),
        display: optionalBoolean(record.display, `${fieldName}.display`),
        details: record.details
      };
    case "branchSummary":
      return {
        role,
        timestamp,
        summary: requireString(record.summary, `${fieldName}.summary`),
        fromId: requireNonEmptyString(record.fromId, `${fieldName}.fromId`)
      };
    case "compactionSummary":
      return {
        role,
        timestamp,
        summary: requireString(record.summary, `${fieldName}.summary`),
        tokensBefore: requireNumber(record.tokensBefore, `${fieldName}.tokensBefore`)
      };
  }
}

function parseUsage(value: unknown, fieldName: string): RewrittenUsage | undefined {
  if (value === undefined) {
    return undefined;
  }

  const record = requireRecord(value, fieldName);
  const cost = record.cost === undefined ? undefined : requireRecord(record.cost, `${fieldName}.cost`);

  return {
    input: optionalNumber(record.input, `${fieldName}.input`),
    output: optionalNumber(record.output, `${fieldName}.output`),
    cacheRead: optionalNumber(record.cacheRead, `${fieldName}.cacheRead`),
    cacheWrite: optionalNumber(record.cacheWrite, `${fieldName}.cacheWrite`),
    totalTokens: optionalNumber(record.totalTokens, `${fieldName}.totalTokens`),
    cost: cost
      ? {
          input: optionalNumber(cost.input, `${fieldName}.cost.input`),
          output: optionalNumber(cost.output, `${fieldName}.cost.output`),
          cacheRead: optionalNumber(cost.cacheRead, `${fieldName}.cost.cacheRead`),
          cacheWrite: optionalNumber(cost.cacheWrite, `${fieldName}.cost.cacheWrite`),
          total: optionalNumber(cost.total, `${fieldName}.cost.total`)
        }
      : undefined
  };
}

function parseStringOrTextArray(value: unknown, fieldName: string): string | RewrittenTextContent[] {
  if (typeof value === "string") {
    return value;
  }

  return parseTextContentArray(value, fieldName);
}

function parseTextContentArray(value: unknown, fieldName: string): RewrittenTextContent[] {
  if (!Array.isArray(value)) {
    throw new Error(`Outer decision field "${fieldName}" must be a string or array.`);
  }

  return value.map((content, index) => parseTextContent(content, `${fieldName}[${index}]`));
}

function parseAssistantContentArray(value: unknown, fieldName: string): RewrittenAssistantContent[] {
  if (!Array.isArray(value)) {
    throw new Error(`Outer decision field "${fieldName}" must be an array.`);
  }

  if (value.length === 0) {
    throw new Error(`Outer decision field "${fieldName}" must contain at least one content block.`);
  }

  return value.map((content, index) => parseAssistantContent(content, `${fieldName}[${index}]`));
}

function parseTextContent(value: unknown, fieldName: string): RewrittenTextContent {
  const record = requireRecord(value, fieldName);
  const type = requireEnum(record.type, ["text"], `${fieldName}.type`);

  return {
    type,
    text: requireString(record.text, `${fieldName}.text`),
    textSignature: optionalString(record.textSignature, `${fieldName}.textSignature`)
  };
}

function parseAssistantContent(value: unknown, fieldName: string): RewrittenAssistantContent {
  const record = requireRecord(value, fieldName);
  const type = requireEnum(record.type, ["text", "thinking", "toolCall"], `${fieldName}.type`);

  switch (type) {
    case "text":
      return {
        type,
        text: requireString(record.text, `${fieldName}.text`),
        textSignature: optionalString(record.textSignature, `${fieldName}.textSignature`)
      };
    case "thinking":
      return {
        type,
        thinking: requireString(record.thinking, `${fieldName}.thinking`),
        thinkingSignature: optionalString(record.thinkingSignature, `${fieldName}.thinkingSignature`),
        redacted: optionalBoolean(record.redacted, `${fieldName}.redacted`)
      };
    case "toolCall":
      return {
        type,
        id: requireNonEmptyString(record.id, `${fieldName}.id`),
        name: requireNonEmptyString(record.name, `${fieldName}.name`),
        arguments: requireRecord(record.arguments, `${fieldName}.arguments`),
        thoughtSignature: optionalString(record.thoughtSignature, `${fieldName}.thoughtSignature`)
      };
  }
}

function extractJsonObject(value: string): string {
  const trimmed = value.trim();

  if (trimmed.startsWith("```")) {
    const codeFenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    if (codeFenceMatch) {
      return codeFenceMatch[1];
    }
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
    throw new Error("Outer decision did not contain a JSON object.");
  }

  return trimmed.slice(firstBrace, lastBrace + 1);
}

function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== "string") {
    throw new Error(`Outer decision field "${fieldName}" must be a string.`);
  }

  return value;
}

function requireNonEmptyString(value: unknown, fieldName: string): string {
  const parsed = requireString(value, fieldName);

  if (parsed.trim().length === 0) {
    throw new Error(`Outer decision field "${fieldName}" must be a non-empty string.`);
  }

  return parsed;
}

function requireBoolean(value: unknown, fieldName: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`Outer decision field "${fieldName}" must be a boolean.`);
  }

  return value;
}

function requireNumber(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Outer decision field "${fieldName}" must be a finite number.`);
  }

  return value;
}

function requireEnum<T extends string>(value: unknown, allowed: readonly T[], fieldName: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new Error(`Outer decision field "${fieldName}" must be one of: ${allowed.join(", ")}.`);
  }

  return value as T;
}

function requireRecord(value: unknown, fieldName: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Outer decision field "${fieldName}" must be an object.`);
  }

  return value as Record<string, unknown>;
}

function optionalString(value: unknown, fieldName: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return requireString(value, fieldName);
}

function optionalBoolean(value: unknown, fieldName: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  return requireBoolean(value, fieldName);
}

function optionalNumber(value: unknown, fieldName: string): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  return requireNumber(value, fieldName);
}

function optionalEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fieldName: string
): T | undefined {
  if (value === undefined) {
    return undefined;
  }

  return requireEnum(value, allowed, fieldName);
}
