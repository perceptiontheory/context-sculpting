# Cognitive Harness: Phase 1 Implementation Plan

## 1. Decisions Locked In

These decisions resolve the open implementation questions for Phase 1:

- The outer agent sees the full inner-agent context on every intervention.
- The outer agent is invoked after every inner-agent turn.
- Sculpting is implemented as full-context rewrite, not a constrained programmatic edit language.
- The inner agent is not told that its context is being sculpted.
- The harness is built around Pi's SDK, with the inner agent run under programmatic control.

This is the right Phase 1 tradeoff. It maximizes experimental freedom and keeps the implementation focused on proving the core idea. The main cost is higher risk from bad rewrites, so validation, checkpointing, and logging need to be first-class parts of the design.

## 2. Phase 1 Scope

Phase 1 should answer one narrow question: can an outer agent improve an inner agent by rewriting its working context between turns?

To keep the implementation tight, Phase 1 should exclude:

- Prediction-driven intervention logic
- Selective or trigger-based intervention
- A constrained sculpting DSL
- Fine-grained automated edit primitives over the message array
- Any attempt to hide or compress information for the outer agent

Those are valid later experiments, but they should not shape the first implementation.

## 3. Architecture

### 3.1 Runtime Model

The harness should be a TypeScript application that orchestrates two model loops:

1. Create and own a Pi `AgentSession` for the inner agent.
2. Let the inner agent complete one turn.
3. Capture the full inner-agent state after the turn.
4. Invoke the outer agent with:
   - original goal
   - optional task context
   - outer strategy notes
   - full inner-agent context
   - available checkpoints
   - run metadata collected so far
5. Parse the outer agent's structured decision.
6. Validate the decision.
7. Apply the sculpted context to the inner session.
8. Repeat until the outer agent terminates, the inner agent finishes naturally, or a hard run limit is reached.

The harness, not Pi, should own the experiment lifecycle. Pi is the inner execution engine.

### 3.2 Core Components

The first implementation should have these modules:

- `HarnessRunner`
  - Top-level orchestrator for one run.
  - Owns run lifecycle, stop conditions, and top-level error handling.
- `InnerSessionController`
  - Wraps the Pi SDK session.
  - Starts the inner agent, waits for turn completion, reads current state, and applies sculpted state.
- `OuterAgentClient`
  - Builds the outer-agent prompt, submits it to the configured model, and parses structured output.
- `ContextProjector`
  - Converts Pi session state into a stable JSON representation for logging and outer-agent input.
- `ContextApplicator`
  - Validates and installs a rewritten inner context back into the Pi session.
- `CheckpointStore`
  - Records checkpointed inner contexts and supports rollback by checkpoint ID.
- `StrategyNotesStore`
  - Maintains the outer agent's persistent notes across turns within a run.
- `RunLogger`
  - Writes concise console logs and complete disk artifacts.
- `MetricsCollector`
  - Tracks tokens, cost, timings, intervention counts, tool failures, and context growth over time.

### 3.3 Context Representation

The outer agent should not rewrite raw provider payloads directly. It should rewrite a harness-owned, validated representation of the inner context.

The projected inner context should include:

- current system prompt
- ordered message list
- assistant/tool structure preserved well enough to reconstruct the session
- tool call metadata
- turn boundaries
- token estimates per message or per turn if available
- checkpoint references

For Phase 1, the outer agent should return one of four actions:

- `pass_through`
- `rewrite_context`
- `rollback`
- `terminate`

The existing sculpting operations remain useful as semantic labels, but they should be metadata, not engine branches. In other words:

- `compact`, `inject`, `reorder`, and `edit_system_prompt` are all kinds of `rewrite_context`
- `rollback` remains separate because it references a prior checkpoint
- `terminate` remains separate because it ends the run

This keeps the harness simpler. The outer agent can still say that a rewrite is "compact" or "inject" for analysis, but the executor only needs to support a small action surface.

### 3.4 Outer-Agent Contract

The outer agent should be forced into a strict structured output contract. A reasonable Phase 1 shape is:

```json
{
  "action": "pass_through | rewrite_context | rollback | terminate",
  "operation_label": "pass_through | compact | inject | reorder | rollback | edit_system_prompt | terminate",
  "reasoning_summary": "short explanation",
  "updated_strategy_notes": "persistent notes for next turn",
  "rewrite": {
    "system_prompt": "optional replacement system prompt",
    "messages": []
  },
  "rollback": {
    "checkpoint_id": "optional checkpoint id",
    "redirect_message": "optional steering message after rollback"
  },
  "terminate": {
    "status": "success | failure | unachievable",
    "summary": "why the run should stop"
  }
}
```

Validation rules should include:

- valid action enum
- valid operation label enum
- rewritten message list must be well-formed
- required fields must exist for `rewrite_context`, `rollback`, and `terminate`
- references to unknown checkpoints are rejected
- rewritten context must preserve a minimum viable structure

If validation fails, the harness should default to `pass_through`, log the failure, and continue. Phase 1 should bias toward non-destructive recovery.

### 3.5 Checkpoints and Rollback

Checkpointing should be automatic and frequent.

At minimum, create a checkpoint:

- before the first inner turn
- after every completed inner turn
- after every applied rewrite

Each checkpoint should store:

- checkpoint ID
- timestamp
- turn number
- full projected inner context
- system prompt
- summary metadata
- hash of the context payload

Rollback should work like this:

1. Outer agent chooses a checkpoint ID.
2. Harness restores that checkpointed context into the inner session.
3. If the outer agent provided a redirect message, the harness appends it as a synthetic user or system message, according to the contract.
4. Harness logs both the restored checkpoint and the final post-rollback state.

The Phase 1 implementation should prefer harness-managed checkpoints over trying to depend on Pi session-tree branching as the primary rollback mechanism. Pi's tree is useful, but the harness needs its own explicit audit trail and exact replay artifacts.

### 3.6 Logging and Trace Storage

Logging needs two layers:

- human-readable runtime logging to stdout/stderr
- complete machine-readable traces to timestamped run directories on disk

#### Console logging

Console output should be brief and operational:

- run start and configuration summary
- inner turn start/end
- tool start/end with success or failure
- outer decision per turn
- rewrite applied or skipped
- rollback events
- termination reason
- final token, cost, and duration summary

Use stdout for normal lifecycle messages and stderr for errors, validation failures, and recovery events.

#### Disk artifacts

Every run should create a timestamped directory, for example:

```text
runs/2026-03-28T18-42-11Z-task-slug-run-001/
```

The run directory should contain:

- `manifest.json`
  - run ID, timestamps, task ID, condition, model IDs, config, cwd, git commit if available
- `events.jsonl`
  - append-only structured event stream for the entire run
- `stdout.log`
  - plain-text console mirror
- `stderr.log`
  - plain-text error mirror
- `summary.json`
  - final metrics and outcome
- `strategy_notes.txt`
  - latest outer-agent strategy notes
- `checkpoints/`
  - checkpoint snapshots as JSON
- `inner_context/`
  - context snapshots before and after each outer decision
- `outer_agent/`
  - prompt payloads, model responses, parsed decisions, and validation results
- `tool_results/`
  - optional per-turn tool transcripts if event volume becomes hard to inspect in `events.jsonl`

The event stream should be detailed enough to reconstruct what happened without rerunning the task. Important event types:

- `run_started`
- `run_finished`
- `inner_turn_started`
- `inner_turn_finished`
- `tool_call_started`
- `tool_call_finished`
- `checkpoint_created`
- `outer_invocation_started`
- `outer_invocation_finished`
- `outer_decision_parsed`
- `outer_decision_validation_failed`
- `rewrite_applied`
- `rollback_applied`
- `termination_requested`
- `error`

Disk logs should store full prompts, full context snapshots, and full outer responses, but secrets must be redacted before persistence. The harness should never write raw API keys or unfiltered environment dumps into artifacts.

### 3.7 Failure Handling

The harness should assume the outer agent will occasionally produce bad decisions. Phase 1 should include explicit fallback behavior:

- invalid rewrite shape: reject and pass through
- invalid checkpoint reference: reject and pass through
- outer-agent API failure: log and pass through
- context application failure: restore last valid checkpoint
- repeated consecutive outer failures: disable sculpting for the rest of the run or terminate with explicit failure status

The harness must always prefer preserving a valid inner run over forcing a questionable rewrite.

## 4. Proposed Repository Structure

Assuming a TypeScript implementation:

```text
src/
  cli/
    runHarness.ts
  harness/
    HarnessRunner.ts
    InnerSessionController.ts
    OuterAgentClient.ts
    ContextProjector.ts
    ContextApplicator.ts
    CheckpointStore.ts
    StrategyNotesStore.ts
  logging/
    RunLogger.ts
    MetricsCollector.ts
    eventTypes.ts
    redact.ts
  prompts/
    outer-system.md
  schemas/
    outerDecision.ts
    runConfig.ts
    taskSpec.ts
  tasks/
    loadTaskSpec.ts
  utils/
    ids.ts
    time.ts
    hashes.ts
```

This is enough structure to keep orchestration, logging, and schema validation separate from task setup.

## 5. Development Sequence

### Milestone 1: Bootstrap the harness shell

- Set up a TypeScript project in this repo.
- Add Pi SDK dependency and basic runtime wiring.
- Add a CLI entry point that accepts a task spec and run configuration.
- Verify a minimal inner-agent run works under SDK control.

Exit criterion: a command can start an inner Pi session and complete a trivial prompt.

### Milestone 2: Capture and log inner turns

- Wrap the Pi session in `InnerSessionController`.
- Subscribe to turn and tool lifecycle events.
- Project the inner session state into a stable JSON representation.
- Write runtime events to stdout/stderr and `events.jsonl`.
- Write the first timestamped run directories.

Exit criterion: a single run produces a complete disk artifact trail even before any sculpting exists.

### Milestone 3: Add the outer-agent loop with pass-through and terminate

- Build `OuterAgentClient`.
- Define and validate the outer structured response schema.
- Invoke the outer agent after every inner turn.
- Support only `pass_through` and `terminate` at first.
- Persist outer prompts and responses to disk.

Exit criterion: the harness runs both agents, logs every outer invocation, and can terminate runs intentionally.

### Milestone 4: Add full-context rewrite

- Implement `ContextApplicator`.
- Let the outer agent return a full rewritten context payload.
- Validate rewritten contexts before application.
- Record before/after context snapshots and hashes.
- Add recovery behavior when application fails.

Exit criterion: the outer agent can successfully replace the inner context between turns.

### Milestone 5: Add checkpointing and rollback

- Implement `CheckpointStore`.
- Create automatic checkpoints throughout the run.
- Support rollback to checkpoint ID plus optional redirect message.
- Log checkpoint creation and rollback application as first-class events.

Exit criterion: the harness can restore a prior state and continue execution.

### Milestone 6: Harden observability and metrics

- Add token, timing, and cost accounting.
- Add context-size measurements over time.
- Add intervention statistics by operation label.
- Write final `summary.json` with all collected metrics.
- Add redaction safeguards.

Exit criterion: a run produces analysis-grade artifacts suitable for later evaluation and writing.

### Milestone 7: Add baseline run modes

- Implement `inner-only` mode.
- Implement `outer-only` or high-capability single-agent mode for the comparison condition.
- Keep logging and artifact structure consistent across all conditions.

Exit criterion: the same harness can execute all three experimental conditions with comparable logs.

At that point, the harness is ready for experiment setup and task preparation.

## 6. Important Design Principles

- Keep the execution engine small. The harness should be an orchestrator, not a framework.
- Prefer a single rewrite primitive over a large family of edit primitives.
- Preserve complete auditability. Every intervention should be inspectable after the run.
- Make failure recovery automatic and conservative.
- Keep experimental conditions comparable by reusing the same logging and run structure.

## 7. Main Risk and Mitigation

The biggest Phase 1 risk is that full-context rewrite makes the system powerful but brittle. A bad outer decision can corrupt the inner-agent state in ways that are hard to diagnose.

The mitigation is not to weaken rewrite power. The mitigation is to make rewrites safe to inspect and safe to recover from:

- strict schema validation
- automatic checkpointing
- deterministic artifact storage
- conservative fallback to pass-through
- explicit logging of both attempted and applied changes

That gives you the freedom to test the strongest version of the idea without losing debuggability.

## 8. Milestone Checklist

- [x] Milestone 1: Bootstrap the harness shell
- [x] Milestone 2: Capture and log inner turns
- [x] Milestone 3: Add the outer-agent loop with pass-through and terminate
- [x] Milestone 4: Add full-context rewrite
- [x] Milestone 5: Add checkpointing and rollback
- [x] Milestone 6: Harden observability and metrics
- [x] Milestone 7: Add baseline run modes

When a milestone is completed, update this checklist and the `Current Status` section in `README.md` together.

Phase 1 implementation is complete. The next step is experiment design and setup.
