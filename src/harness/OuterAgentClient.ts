import { completeSimple, type AssistantMessage, type Context } from "@mariozechner/pi-ai";
import { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";
import type { LoadedTaskSpec } from "../tasks/loadTaskSpec.js";
import type { LoadedOuterAgentConfig } from "../schemas/runConfig.js";
import type { RunLogger } from "../logging/RunLogger.js";
import type { MetricsCollector } from "../logging/MetricsCollector.js";
import type { ProjectedInnerContext, ProjectedMessage } from "./ContextProjector.js";
import type { CheckpointSummary } from "./CheckpointStore.js";
import { parseOuterDecision, type OuterDecision } from "../schemas/outerDecision.js";

export interface OuterAgentTurnInput {
  task: LoadedTaskSpec;
  turnNumber: number;
  hasPendingContinuation: boolean;
  strategyNotes: string;
  availableCheckpoints: CheckpointSummary[];
  innerContext: ProjectedInnerContext;
  assistantMessage: ProjectedMessage;
  toolResults: ProjectedMessage[];
}

export class OuterAgentClient {
  private readonly authStorage: AuthStorage;
  private readonly modelRegistry: ModelRegistry;

  constructor(
    private readonly config: LoadedOuterAgentConfig,
    private readonly logger: RunLogger,
    private readonly metrics: MetricsCollector
  ) {
    this.authStorage = AuthStorage.create();
    this.modelRegistry = new ModelRegistry(this.authStorage);
  }

  async decide(input: OuterAgentTurnInput): Promise<OuterDecision> {
    const model = this.modelRegistry.find(this.config.provider, this.config.model);

    if (!model) {
      throw new Error(`Unable to resolve outer model ${this.config.provider}/${this.config.model}.`);
    }

    const promptPayload = {
      task: {
        id: input.task.id,
        goal: input.task.goal,
        context: input.task.context,
        instructions: input.task.instructions
      },
      turn: {
        number: input.turnNumber,
        has_pending_continuation: input.hasPendingContinuation,
        assistant_message: input.assistantMessage,
        tool_results: input.toolResults
      },
      strategy_notes: input.strategyNotes,
      available_checkpoints: input.availableCheckpoints,
      rewrite_guidance: {
        full_context_rewrite_enabled: true,
        preserve_unchanged_messages_verbatim: true,
        image_rewrites_supported: false,
        continuation_rule:
          "If has_pending_continuation is true and you choose rewrite_context, the rewritten messages must end in a user or toolResult message."
      },
      inner_context: input.innerContext
    };

    const promptPath = `outer_agent/turn-${padTurnNumber(input.turnNumber)}-prompt.json`;
    const systemPrompt = getOuterAgentSystemPrompt(this.config.promptProfile);
    await this.logger.writeJsonArtifact(promptPath, {
      system_prompt: systemPrompt,
      prompt_profile: this.config.promptProfile,
      user_payload: promptPayload,
      model: {
        provider: this.config.provider,
        model: this.config.model,
        thinkingLevel: this.config.thinkingLevel,
        promptProfile: this.config.promptProfile
      }
    });
    await this.logger.event("outer_invocation_started", {
      turnNumber: input.turnNumber,
      promptPath,
      provider: this.config.provider,
      model: this.config.model
    });
    this.metrics.noteOuterInvocationStarted(
      input.turnNumber,
      this.config.provider,
      this.config.model
    );
    await this.logger.info(
      `[outer] invoking turn=${input.turnNumber} model=${this.config.provider}/${this.config.model}`
    );

    const context: Context = {
      systemPrompt: systemPrompt,
      messages: [
        {
          role: "user",
          content: JSON.stringify(promptPayload, null, 2),
          timestamp: Date.now()
        }
      ]
    };

    let response: AssistantMessage | undefined;

    try {
      response = await completeSimple(model, context, {
        apiKey: await this.authStorage.getApiKey(model.provider),
        reasoning: this.config.thinkingLevel === "off" ? undefined : this.config.thinkingLevel
      });

      const responsePath = `outer_agent/turn-${padTurnNumber(input.turnNumber)}-response.json`;
      await this.logger.writeJsonArtifact(responsePath, response);

      const text = extractAssistantText(response);
      const decision = parseOuterDecision(text);
      const decisionPath = `outer_agent/turn-${padTurnNumber(input.turnNumber)}-decision.json`;

      await this.logger.writeJsonArtifact(decisionPath, decision);
      await this.logger.event("outer_invocation_finished", {
        turnNumber: input.turnNumber,
        responsePath,
        usage: response.usage,
        stopReason: response.stopReason
      });
      await this.logger.event("outer_decision_parsed", {
        turnNumber: input.turnNumber,
        action: decision.action,
        operationLabel: decision.operation_label
      });
      await this.logger.info(
        `[outer] decision turn=${input.turnNumber} action=${decision.action}`
      );
      this.metrics.noteOuterInvocationFinished({
        turnNumber: input.turnNumber,
        success: true,
        action: decision.action,
        operationLabel: decision.operation_label,
        usage: response.usage,
        stopReason: response.stopReason
      });

      return decision;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.logger.error(`[outer] decision failed on turn=${input.turnNumber}: ${message}`);
      await this.logger.event("outer_decision_validation_failed", {
        turnNumber: input.turnNumber,
        message
      });
      this.metrics.noteOuterInvocationFinished({
        turnNumber: input.turnNumber,
        success: false,
        action: "pass_through",
        operationLabel: "pass_through",
        usage: response?.usage,
        stopReason: response?.stopReason,
        failureMessage: message
      });

      return {
        action: "pass_through",
        operation_label: "pass_through",
        reasoning_summary: `Fallback to pass_through after outer-agent failure: ${message}`,
        updated_strategy_notes: input.strategyNotes
      };
    }
  }
}

function extractAssistantText(message: AssistantMessage): string {
  return message.content
    .filter((content): content is { type: "text"; text: string } => content.type === "text" && typeof content.text === "string")
    .map((content) => content.text)
    .join("");
}

function padTurnNumber(turnNumber: number): string {
  return String(turnNumber).padStart(3, "0");
}

const OUTER_AGENT_SYSTEM_PROMPT = `You are the outer agent in a cognitive harness.

Your job is to review the inner agent after each completed turn and choose exactly one action:
- pass_through
- rewrite_context
- rollback
- terminate

Rules:
1. Return strict JSON only. No prose, no markdown, no code fences.
2. If the inner agent clearly still has work to do and another inner turn is expected, prefer "pass_through".
3. Choose "rewrite_context" only when replacing the full inner context is materially better than leaving it alone.
4. Choose "rollback" when a known checkpoint is better than the current state and targeted recovery is preferable to rewriting from scratch.
5. If the task appears complete, stuck, or should intentionally stop now, choose "terminate".
6. Keep reasoning_summary and updated_strategy_notes concise.
7. When rewriting, return a full replacement for rewrite.system_prompt and rewrite.messages.
8. Reuse the exact message object shapes from inner_context.messages whenever possible. Preserve unchanged fields verbatim.
9. Do not emit image content in rewrites. Only text content is supported.
10. If turn.has_pending_continuation is true and you choose rewrite_context, the rewritten messages must end in a user or toolResult message so the inner agent can continue.
11. If you choose rollback, rollback.checkpoint_id must match one of available_checkpoints[].id exactly.
12. rollback.redirect_message is optional but recommended when the target checkpoint does not end in a user or toolResult message.

Return this exact schema:
{
  "action": "pass_through | rewrite_context | rollback | terminate",
  "operation_label": "pass_through | rewrite_context | compact | inject | reorder | edit_system_prompt | rollback | terminate",
  "reasoning_summary": "short explanation",
  "updated_strategy_notes": "notes for future turns, can be empty string",
  "rewrite": {
    "system_prompt": "full replacement system prompt",
    "messages": []
  },
  "rollback": {
    "checkpoint_id": "required when action is rollback",
    "redirect_message": "optional follow-up user message after rollback"
  },
  "terminate": {
    "status": "success | failure | unachievable",
    "summary": "required when action is terminate"
  }
}

If action is "pass_through", omit rewrite, rollback, and terminate.
If action is "rewrite_context", include rewrite and omit terminate.
If action is "rollback", include rollback and omit rewrite and terminate.
If action is "terminate", include terminate and omit rewrite and rollback.`;

const INTERVENTION_TARGETED_SYSTEM_PROMPT = `You are the outer agent in a cognitive harness.

Your job is to review the inner agent after each completed turn and choose exactly one action:
- pass_through
- rewrite_context
- rollback
- terminate

You are running in an intervention-targeted demo. In this mode, do not default to pass_through just because the inner agent still has work to do.

Primary objective:
- Use the outer control loop to actively improve the next inner turn when a defensible intervention can remove clutter, correct drift, or sharpen the active plan.

Intervene proactively when one of these is true:
1. The transcript contains misleading or stale context that can be removed or de-emphasized.
2. The next step is clear, but the current context is bloated with exploration that can be compacted.
3. The inner agent is pursuing a weak or wrong hypothesis and a rewrite or rollback would reduce wasted turns.
4. A short injected clarification would materially improve the next turn.

Action guidance:
- Prefer "rewrite_context" when you can improve the next turn by compacting, reordering, or injecting a concise clarification.
- Prefer operation_label "compact" when you can replace stale exploratory history with a compact summary message and preserve only the context the inner agent still needs.
- Prefer operation_label "inject" when the inner agent mostly has the right transcript, but needs one targeted user-style clarification or prioritization note.
- Prefer operation_label "edit_system_prompt" when the correction belongs at the policy/instruction layer.
- Prefer "rollback" only when returning to an earlier checkpoint is cleaner than rewriting from the current state.
- Use "pass_through" only when the current context is already well-shaped for the next turn.
- Use "terminate" when the task is complete, intentionally should stop, or further turns would be wasteful.

Rewriting tips:
- You may keep only the minimum messages needed for the next turn.
- You may replace long exploratory spans with a "compactionSummary" message.
- You may append a synthetic user message to refocus the inner agent.
- If you keep any toolResult messages, you must also keep the earlier assistant toolCall messages they refer to.
- When in doubt, prefer compacting to user messages plus plain-language summary messages rather than keeping partial tool-call history.
- Preserve message object shapes carefully for any messages you keep.
- Do not emit image content in rewrites. Only text content is supported.
- If turn.has_pending_continuation is true and you choose rewrite_context, the rewritten messages must end in a user or toolResult message so the inner agent can continue.

Rules:
1. Return strict JSON only. No prose, no markdown, no code fences.
2. Keep reasoning_summary and updated_strategy_notes concise.
3. When rewriting, return a full replacement for rewrite.system_prompt and rewrite.messages.
4. Reuse the exact message object shapes from inner_context.messages whenever possible. Preserve unchanged fields verbatim.
5. If you choose rollback, rollback.checkpoint_id must match one of available_checkpoints[].id exactly.
6. rollback.redirect_message is optional but recommended when the target checkpoint does not end in a user or toolResult message.
7. Choose interventions that are legible and defensible from the trace. Do not rewrite gratuitously if the current context is already sharp.

Return this exact schema:
{
  "action": "pass_through | rewrite_context | rollback | terminate",
  "operation_label": "pass_through | rewrite_context | compact | inject | reorder | edit_system_prompt | rollback | terminate",
  "reasoning_summary": "short explanation",
  "updated_strategy_notes": "notes for future turns, can be empty string",
  "rewrite": {
    "system_prompt": "full replacement system prompt",
    "messages": []
  },
  "rollback": {
    "checkpoint_id": "required when action is rollback",
    "redirect_message": "optional follow-up user message after rollback"
  },
  "terminate": {
    "status": "success | failure | unachievable",
    "summary": "required when action is terminate"
  }
}

If action is "pass_through", omit rewrite, rollback, and terminate.
If action is "rewrite_context", include rewrite and omit terminate.
If action is "rollback", include rollback and omit rewrite and terminate.
If action is "terminate", include terminate and omit rewrite and rollback.`;

function getOuterAgentSystemPrompt(profile: LoadedOuterAgentConfig["promptProfile"]): string {
  return profile === "intervention_targeted"
    ? INTERVENTION_TARGETED_SYSTEM_PROMPT
    : OUTER_AGENT_SYSTEM_PROMPT;
}
