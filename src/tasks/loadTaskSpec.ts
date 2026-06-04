import { readFile } from "node:fs/promises";
import path from "node:path";
import { readJsonFile } from "../utils/readJsonFile.js";

export interface LoadedTaskSpec {
  sourcePath: string;
  id: string;
  cwd: string;
  resetWorkspaceFrom?: string;
  goal: string;
  context?: string;
  instructions?: string;
  systemPrompt?: string;
  prompt: string;
  verification?: TaskVerification;
}

export interface TaskVerification {
  command: string[];
  cwd: string;
  expectedExitCode: number;
}

interface RawTaskSpec {
  id?: unknown;
  cwd?: unknown;
  resetWorkspaceFrom?: unknown;
  goal?: unknown;
  goalFile?: unknown;
  context?: unknown;
  contextFile?: unknown;
  instructions?: unknown;
  systemPrompt?: unknown;
  verification?: unknown;
}

export async function loadTaskSpec(specPath: string): Promise<LoadedTaskSpec> {
  const raw = await readJsonFile<RawTaskSpec>(specPath);
  const baseDir = path.dirname(specPath);

  if (typeof raw.id !== "string" || raw.id.length === 0) {
    throw new Error(`Task spec ${specPath} is missing a non-empty "id" string.`);
  }

  if (raw.instructions !== undefined && typeof raw.instructions !== "string") {
    throw new Error(`Task spec ${specPath} has a non-string "instructions" field.`);
  }

  if (raw.systemPrompt !== undefined && typeof raw.systemPrompt !== "string") {
    throw new Error(`Task spec ${specPath} has a non-string "systemPrompt" field.`);
  }

  const goal = await loadInlineOrFile({
    inlineValue: raw.goal,
    fileValue: raw.goalFile,
    fieldName: "goal",
    baseDir,
    specPath
  });

  if (!goal) {
    throw new Error(`Task spec ${specPath} must define a non-empty goal.`);
  }

  const context = await loadInlineOrFile({
    inlineValue: raw.context,
    fileValue: raw.contextFile,
    fieldName: "context",
    baseDir,
    specPath,
    required: false
  });

  const cwd =
    typeof raw.cwd === "string" && raw.cwd.length > 0
      ? path.resolve(baseDir, raw.cwd)
      : process.cwd();
  const resetWorkspaceFrom =
    typeof raw.resetWorkspaceFrom === "string" && raw.resetWorkspaceFrom.length > 0
      ? path.resolve(baseDir, raw.resetWorkspaceFrom)
      : undefined;

  if (raw.resetWorkspaceFrom !== undefined && typeof raw.resetWorkspaceFrom !== "string") {
    throw new Error(`Task spec ${specPath} has a non-string "resetWorkspaceFrom" field.`);
  }

  const verification = loadVerification(raw.verification, {
    baseDir,
    cwd,
    specPath
  });

  return {
    sourcePath: specPath,
    id: raw.id,
    cwd,
    resetWorkspaceFrom,
    goal,
    context,
    instructions: raw.instructions,
    systemPrompt: raw.systemPrompt,
    verification,
    prompt: buildPrompt({
      goal,
      context,
      instructions: raw.instructions
    })
  };
}

interface LoadInlineOrFileInput {
  inlineValue: unknown;
  fileValue: unknown;
  fieldName: string;
  baseDir: string;
  specPath: string;
  required?: boolean;
}

async function loadInlineOrFile(input: LoadInlineOrFileInput): Promise<string | undefined> {
  const required = input.required ?? true;

  if (typeof input.inlineValue === "string" && input.inlineValue.length > 0) {
    return input.inlineValue;
  }

  if (input.inlineValue !== undefined && typeof input.inlineValue !== "string") {
    throw new Error(`Task spec ${input.specPath} has a non-string "${input.fieldName}" field.`);
  }

  if (typeof input.fileValue === "string" && input.fileValue.length > 0) {
    const absolutePath = path.resolve(input.baseDir, input.fileValue);
    const contents = await readFile(absolutePath, "utf8");
    return contents.trim();
  }

  if (input.fileValue !== undefined && typeof input.fileValue !== "string") {
    throw new Error(`Task spec ${input.specPath} has a non-string "${input.fieldName}File" field.`);
  }

  if (required) {
    throw new Error(`Task spec ${input.specPath} must define "${input.fieldName}" or "${input.fieldName}File".`);
  }

  return undefined;
}

function buildPrompt(input: { goal: string; context?: string; instructions?: string }): string {
  const sections = [`# Goal\n${input.goal.trim()}`];

  if (input.instructions && input.instructions.trim().length > 0) {
    sections.push(`# Instructions\n${input.instructions.trim()}`);
  }

  if (input.context && input.context.trim().length > 0) {
    sections.push(`# Context\n${input.context.trim()}`);
  }

  return sections.join("\n\n");
}

function loadVerification(
  rawVerification: unknown,
  input: { baseDir: string; cwd: string; specPath: string }
): TaskVerification | undefined {
  if (rawVerification === undefined) {
    return undefined;
  }

  if (!rawVerification || typeof rawVerification !== "object" || Array.isArray(rawVerification)) {
    throw new Error(`Task spec ${input.specPath} has a non-object "verification" field.`);
  }

  const record = rawVerification as Record<string, unknown>;

  if (!Array.isArray(record.command) || record.command.length === 0) {
    throw new Error(`Task spec ${input.specPath} must define verification.command as a non-empty string array.`);
  }

  const command = record.command.map((value, index) => {
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(
        `Task spec ${input.specPath} has an invalid verification.command[${index}] value.`
      );
    }

    return value;
  });

  if (record.cwd !== undefined && (typeof record.cwd !== "string" || record.cwd.length === 0)) {
    throw new Error(`Task spec ${input.specPath} has an invalid "verification.cwd" field.`);
  }

  if (
    record.expectedExitCode !== undefined &&
    (typeof record.expectedExitCode !== "number" ||
      !Number.isInteger(record.expectedExitCode) ||
      record.expectedExitCode < 0)
  ) {
    throw new Error(`Task spec ${input.specPath} has an invalid "verification.expectedExitCode" field.`);
  }

  return {
    command,
    cwd:
      typeof record.cwd === "string"
        ? path.resolve(input.baseDir, record.cwd)
        : input.cwd,
    expectedExitCode:
      typeof record.expectedExitCode === "number" ? record.expectedExitCode : 0
  };
}
