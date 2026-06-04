# Cognitive Harness Agent Notes

Load these files first in a new session:

1. `README.md`
2. `implementation_plan.md`
3. `demo_plan.md`
4. `research_plan.md`

## Project Purpose

This repo is implementing Phase 1 of the `context sculpting` experiment.

- Core idea: an outer agent rewrites an inner agent's context between turns.
- Phase 1 only: no prediction layer.
- Implementation direction: Pi SDK orchestrated from a local TypeScript harness.

## Phase 1 Decisions

- Outer agent sees full inner context.
- Outer agent intervenes every turn.
- Sculpting primitive is full-context rewrite.
- Inner agent is unaware of sculpting.
- Pi SDK is the integration path.

## Current Status

- Milestone 1 is complete.
- Milestone 2 is complete.
- Milestone 3 is complete.
- Milestone 4 is complete.
- Milestone 5 is complete.
- Milestone 6 is complete.
- Milestone 7 is complete.
- Phase 1 harness implementation is complete.
- Demo scaffolding is complete on top of the completed Phase 1 harness.
- The clean core OpenAI demo suite has been executed successfully.
- All 8 demo runs passed verification.
- The outer agent behaved as a conservative supervisor: `pass_through` and `terminate`, with no `rewrite_context` or `rollback`.
- The narrative write-up is saved in `demo_report.md`.
- A second intervention-targeted OpenAI demo suite has been executed successfully.
- All 4 intervention-targeted demo runs passed verification.
- Active `rewrite_context` behavior was observed repeatedly in the clean intervention suite.
- The synthesis harness run showed a clean intervention success case.
- The coding harness run showed a clear over-intervention failure mode and hit `maxInnerTurns` while still passing verification.
- The second narrative write-up is saved in `intervention_demo_report.md`.

Milestone 1 currently includes:

- TypeScript project scaffold
- Pi SDK inner-agent runner
- task/config JSON loading
- minimal CLI
- basic console logging
- confirmed live Anthropic smoke test

Milestone 2 adds:

- timestamped run directories under `runs/`
- `events.jsonl`, `stdout.log`, `stderr.log`, `manifest.json`, and `summary.json`
- stable JSON snapshots of the inner session context
- prompt artifact capture and per-turn event logging

Milestone 3 adds:

- outer-agent invocation after every completed inner turn
- persisted outer prompt, response, and parsed decision artifacts under `outer_agent/`
- `pass_through` and `terminate` as the only enabled outer actions
- per-run `strategy_notes.txt`
- direct single-turn stepping through Pi's underlying agent loop so outer decisions happen truly between turns

Milestone 4 adds:

- `rewrite_context` as an outer action with a validated full-context payload
- `ContextApplicator` to install rewritten system prompts and message arrays
- pre-rewrite and post-rewrite snapshots with stable context hashes
- conservative recovery that restores the previous in-memory context if rewrite application fails
- current rewrite limits: `in_memory` sessions only and text-only content blocks

Milestone 5 adds:

- `CheckpointStore` with automatic checkpoints at initialization, post-turn, post-rewrite, and post-rollback
- exact restorable checkpoint state kept in memory plus checkpoint artifacts written under `checkpoints/`
- `rollback` as an outer action, targeting checkpoint IDs exposed to the outer agent each turn
- rollback with optional synthetic user redirect message
- pre/post rollback snapshots and first-class `checkpoint_created` / `rollback_applied` logging

Milestone 6 adds:

- `MetricsCollector` for run-level token, cost, timing, context, and intervention accounting
- analysis-grade `summary.json` output with inner, outer, and combined usage totals
- context-size samples, growth tracking, and checkpoint/intervention breakdowns
- strengthened redaction for logs and persisted text artifacts, including inline secret patterns
- verified no-paid synthetic smoke artifacts for summary correctness and redaction behavior

Milestone 7 adds:

- explicit run conditions: `inner_only`, `single_agent_baseline`, and `outer_harness`
- config validation that prevents mixed-mode definitions, such as a baseline run with `outerAgent`
- consistent `condition` and `architecture` labeling in `manifest.json`, `summary.json`, and run-start events
- condition-aware run directory names for easier cross-condition comparison
- example configs covering all three experimental conditions

Post-Phase-1 demo scaffolding adds:

- `demo_plan.md` with the narrowed, case-study-style demo framing
- OpenAI demo configs with `maxInnerTurns` and `maxEstimatedCostUsd` guardrails
- optional per-task verification metadata in task specs
- a demo matrix runner at `src/cli/runDemo.ts`
- per-run workspace resets from seeded templates so repeated demo runs stay isolated
- final task-workspace snapshots copied into each run directory before cleanup
- a broken coding-task workspace with a local verifier
- a local-corpus synthesis task with a file-output verifier
- matrix JSON files for the 8-run core demo and the 10-run variant with ceiling baselines

## Important Files

- `README.md`: current repo status and usage
- `implementation_plan.md`: canonical build plan and milestone tracker
- `demo_plan.md`: canonical demo framing, scope, and execution plan
- `demo_report.md`: narrative write-up of the clean core demo execution
- `intervention_demo_report.md`: narrative write-up of the intervention-targeted demo execution
- `blog_post_draft.md`: current long-form blog draft synthesizing both demo suites
- `research_plan.md`: research framing and experiment context
- `src/cli/runHarness.ts`: CLI entrypoint
- `src/cli/runDemo.ts`: demo-matrix runner with per-run verification capture
- `src/harness/HarnessRunner.ts`: top-level orchestrator
- `src/harness/InnerSessionController.ts`: Pi session creation, single-turn stepping, and inner run logging
- `src/harness/OuterAgentClient.ts`: outer-agent prompting, artifact capture, and decision parsing
- `src/harness/ContextApplicator.ts`: rewrite validation, application, hashing, and recovery
- `src/harness/CheckpointStore.ts`: checkpoint capture, rollback, and checkpoint artifact writing
- `src/harness/ContextProjector.ts`: stable JSON projection of session state
- `src/schemas/outerDecision.ts`: outer decision schema and validation
- `src/schemas/runConfig.ts`: run condition validation and config loading
- `src/logging/RunLogger.ts`: run directory and artifact writer
- `src/logging/MetricsCollector.ts`: usage, timing, context-growth, and intervention metrics

## Operational Notes

- Pi is used as a local dependency, but by default it still reads shared config from `~/.pi/agent`.
- In this environment, Pi auth access may require escalated execution because it creates a lock file next to `~/.pi/agent/auth.json`.
- For cheap live smoke tests, prefer Anthropic Haiku configs unless higher quality is required.
- Avoid unnecessary paid API calls. Use local typecheck/build first whenever possible.
- For OpenAI demo runs, use the explicit `openai` provider configs, not `openai-codex`, unless intentionally testing the subscription path.
- Outer prompt profiles are now supported via `outerAgent.promptProfile`. The intervention-focused demo uses `intervention_targeted`.
- For outer-controlled runs, do not regress to `session.prompt()` for the full task. The current control point depends on direct single-turn stepping via `runAgentLoop` and `runAgentLoopContinue`.
- Rewrite and rollback application are currently supported only for `in_memory` sessions. Persistent Pi session files are not yet rewritten safely.
- Rewrite payloads currently support text content only. Image blocks are rejected.
- Rollback redirect messages are currently appended as synthetic `user` messages only.
- Paid-run guardrails now exist in run config:
  - `maxInnerTurns`
  - `maxEstimatedCostUsd`
- Demo task verification is not built into the harness loop itself. It is executed by `src/cli/runDemo.ts` after each harness run and written into the run directory under `verification/`.
- Demo tasks can define `resetWorkspaceFrom`; `src/cli/runDemo.ts` restores that template before and after each run, and copies the final working tree into `workspace_final/` inside the run directory.

## Milestone Closeout Rule

When a milestone is completed:

1. Check it off in `implementation_plan.md`.
2. Update the `Current Status` section in `README.md`.
3. Keep milestone summaries consistent across both files.

## Next Step

The next useful task is interpretation and communication:

- revise `blog_post_draft.md` into the publishable version
- compare the supervisory and intervention-targeted traces directly
- optionally design a rollback-specific task if the next follow-up should validate rollback rather than rewrite
