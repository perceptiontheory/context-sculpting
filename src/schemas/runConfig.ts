import { readJsonFile } from "../utils/readJsonFile.js";

const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh"]);
const SESSION_MODES = new Set(["in_memory", "persistent"]);
const RUN_CONDITIONS = new Set(["inner_only", "single_agent_baseline", "outer_harness"]);
const OUTER_PROMPT_PROFILES = new Set(["conservative", "intervention_targeted"]);

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
export type SessionMode = "in_memory" | "persistent";
export type RunCondition = "inner_only" | "single_agent_baseline" | "outer_harness";
export type RunArchitecture = "standard_agent_loop" | "outer_harness";
export type OuterPromptProfile = "conservative" | "intervention_targeted";

export interface LoadedOuterAgentConfig {
  provider: string;
  model: string;
  thinkingLevel: ThinkingLevel;
  promptProfile: OuterPromptProfile;
}

export interface LoadedRunConfig {
  sourcePath: string;
  condition: RunCondition;
  provider: string;
  model: string;
  thinkingLevel: ThinkingLevel;
  sessionMode: SessionMode;
  agentDir?: string;
  maxInnerTurns?: number;
  maxEstimatedCostUsd?: number;
  outerAgent?: LoadedOuterAgentConfig;
}

interface RawRunConfig {
  condition?: unknown;
  provider?: unknown;
  model?: unknown;
  thinkingLevel?: unknown;
  sessionMode?: unknown;
  agentDir?: unknown;
  maxInnerTurns?: unknown;
  maxEstimatedCostUsd?: unknown;
  outerAgent?: unknown;
}

export async function loadRunConfig(path: string): Promise<LoadedRunConfig> {
  const raw = await readJsonFile<RawRunConfig>(path);

  if (typeof raw.provider !== "string" || raw.provider.length === 0) {
    throw new Error(`Run config ${path} is missing a non-empty "provider" string.`);
  }

  if (typeof raw.model !== "string" || raw.model.length === 0) {
    throw new Error(`Run config ${path} is missing a non-empty "model" string.`);
  }

  const thinkingLevel =
    typeof raw.thinkingLevel === "string" && THINKING_LEVELS.has(raw.thinkingLevel)
      ? (raw.thinkingLevel as ThinkingLevel)
      : "off";

  if (typeof raw.thinkingLevel === "string" && !THINKING_LEVELS.has(raw.thinkingLevel)) {
    throw new Error(`Run config ${path} has an invalid thinkingLevel "${raw.thinkingLevel}".`);
  }

  const sessionMode =
    typeof raw.sessionMode === "string" && SESSION_MODES.has(raw.sessionMode)
      ? (raw.sessionMode as SessionMode)
      : "in_memory";

  if (typeof raw.sessionMode === "string" && !SESSION_MODES.has(raw.sessionMode)) {
    throw new Error(`Run config ${path} has an invalid sessionMode "${raw.sessionMode}".`);
  }

  if (raw.agentDir !== undefined && typeof raw.agentDir !== "string") {
    throw new Error(`Run config ${path} has a non-string "agentDir".`);
  }

  if (
    raw.maxInnerTurns !== undefined &&
    (typeof raw.maxInnerTurns !== "number" ||
      !Number.isInteger(raw.maxInnerTurns) ||
      raw.maxInnerTurns <= 0)
  ) {
    throw new Error(`Run config ${path} has an invalid "maxInnerTurns".`);
  }

  if (
    raw.maxEstimatedCostUsd !== undefined &&
    (typeof raw.maxEstimatedCostUsd !== "number" || !Number.isFinite(raw.maxEstimatedCostUsd) || raw.maxEstimatedCostUsd <= 0)
  ) {
    throw new Error(`Run config ${path} has an invalid "maxEstimatedCostUsd".`);
  }

  const condition = loadRunCondition(raw.condition, {
    path,
    hasOuterAgent: raw.outerAgent !== undefined
  });
  const outerAgent = loadOuterAgentConfig(raw.outerAgent, {
    path,
    defaultProvider: raw.provider,
    defaultModel: raw.model,
    defaultThinkingLevel: thinkingLevel
  });
  validateConditionCompatibility(path, condition, outerAgent);

  return {
    sourcePath: path,
    condition,
    provider: raw.provider,
    model: raw.model,
    thinkingLevel,
    sessionMode,
    agentDir: raw.agentDir,
    maxInnerTurns:
      typeof raw.maxInnerTurns === "number" ? raw.maxInnerTurns : undefined,
    maxEstimatedCostUsd: raw.maxEstimatedCostUsd,
    outerAgent
  };
}

export function usesOuterHarness(config: Pick<LoadedRunConfig, "condition">): boolean {
  return config.condition === "outer_harness";
}

export function getRunArchitecture(condition: RunCondition): RunArchitecture {
  return condition === "outer_harness" ? "outer_harness" : "standard_agent_loop";
}

interface LoadOuterAgentConfigInput {
  path: string;
  defaultProvider: string;
  defaultModel: string;
  defaultThinkingLevel: ThinkingLevel;
}

function loadOuterAgentConfig(
  rawOuterAgent: unknown,
  defaults: LoadOuterAgentConfigInput
): LoadedOuterAgentConfig | undefined {
  if (rawOuterAgent === undefined) {
    return undefined;
  }

  if (!rawOuterAgent || typeof rawOuterAgent !== "object" || Array.isArray(rawOuterAgent)) {
    throw new Error(`Run config ${defaults.path} has a non-object "outerAgent".`);
  }

  const record = rawOuterAgent as Record<string, unknown>;

  if (record.provider !== undefined && typeof record.provider !== "string") {
    throw new Error(`Run config ${defaults.path} has a non-string "outerAgent.provider".`);
  }

  if (record.model !== undefined && typeof record.model !== "string") {
    throw new Error(`Run config ${defaults.path} has a non-string "outerAgent.model".`);
  }

  if (
    record.thinkingLevel !== undefined &&
    (typeof record.thinkingLevel !== "string" || !THINKING_LEVELS.has(record.thinkingLevel))
  ) {
    throw new Error(`Run config ${defaults.path} has an invalid "outerAgent.thinkingLevel".`);
  }

  if (
    record.promptProfile !== undefined &&
    (typeof record.promptProfile !== "string" || !OUTER_PROMPT_PROFILES.has(record.promptProfile))
  ) {
    throw new Error(`Run config ${defaults.path} has an invalid "outerAgent.promptProfile".`);
  }

  return {
    provider: typeof record.provider === "string" && record.provider.length > 0 ? record.provider : defaults.defaultProvider,
    model: typeof record.model === "string" && record.model.length > 0 ? record.model : defaults.defaultModel,
    thinkingLevel:
      typeof record.thinkingLevel === "string"
        ? (record.thinkingLevel as ThinkingLevel)
        : defaults.defaultThinkingLevel,
    promptProfile:
      typeof record.promptProfile === "string"
        ? (record.promptProfile as OuterPromptProfile)
        : "conservative"
  };
}

interface LoadRunConditionInput {
  path: string;
  hasOuterAgent: boolean;
}

function loadRunCondition(
  rawCondition: unknown,
  defaults: LoadRunConditionInput
): RunCondition {
  if (rawCondition === undefined) {
    return defaults.hasOuterAgent ? "outer_harness" : "inner_only";
  }

  if (typeof rawCondition !== "string" || !RUN_CONDITIONS.has(rawCondition)) {
    throw new Error(`Run config ${defaults.path} has an invalid "condition".`);
  }

  return rawCondition as RunCondition;
}

function validateConditionCompatibility(
  path: string,
  condition: RunCondition,
  outerAgent: LoadedOuterAgentConfig | undefined
): void {
  if (condition === "outer_harness" && !outerAgent) {
    throw new Error(`Run config ${path} uses condition "outer_harness" but does not define "outerAgent".`);
  }

  if (condition !== "outer_harness" && outerAgent) {
    throw new Error(
      `Run config ${path} uses condition "${condition}" and must not define "outerAgent".`
    );
  }
}
