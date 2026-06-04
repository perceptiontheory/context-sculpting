# Context Sculpting Demo Plan

## 1. Purpose

This document replaces the original research-first framing with a smaller, demo-oriented plan.

The goal is no longer to run a quasi-rigorous benchmark suite and publish a paper-lite write-up. The goal is to produce a credible, interesting engineering case study showing what the cognitive harness is, how it behaves in practice, and why `context sculpting` is an interesting design pattern for agent systems.

The intended output is a blog post for a software engineering and agent-harness audience, not an AI research audience.

## 2. Demo Thesis

The demo should support one clear claim:

> An outer agent that can inspect and rewrite an inner agent's context between turns can sometimes improve trajectory quality in ways that are visible in traces, not just in final scores.

That claim is narrower than the original research plan, but it is also more realistic and easier to demonstrate well.

The write-up does not need to prove that context sculpting is generally superior. It only needs to show:

- what the architecture is
- how it changes the agent loop
- what kinds of interventions it enables
- at least one convincing example where the outer layer helps
- at least one example where the outer layer is neutral or harmful

That is enough to make the idea legible and interesting.

## 3. Audience and Tone

Primary audience:

- software engineers interested in agent tooling
- people building Codex/Claude Code/Pi-style harnesses
- technically literate readers who care about traces, architecture, and failure modes

Secondary audience:

- AI-adjacent builders on X who may find the idea novel

Tone goals for the eventual post:

- practical, not academic
- honest about limitations
- focused on harness design, not claims of general intelligence progress
- concrete and artifact-driven

## 4. What Changes from the Research Plan

The original `research_plan.md` remains valid as posterity and as the origin of the idea. This demo plan intentionally narrows scope.

Removed or de-emphasized:

- large run matrix
- statistical framing
- explicit completion-rate comparison as the main deliverable
- strong claims about cost-efficiency versus a larger model
- live web search as a core benchmark dependency
- paper-lite write-up structure

Emphasized instead:

- trace quality
- human-readable examples
- intervention taxonomy
- failure analysis
- the architecture itself as the main product

## 5. Demo Questions

The demo should answer these questions:

1. What does it mean to treat context as a mutable design surface rather than an append-only log?
2. What kinds of outer-agent interventions are actually useful in practice?
3. Can we show a few runs where rewrite or rollback clearly changes the inner agent's trajectory?
4. What new failure modes does this architecture introduce?
5. Is the overhead acceptable for a small prototype using current frontier and mini models?

## 6. Model Strategy

### 6.1 Default Recommendation

For clarity and compliance, the default demo path should use the OpenAI API directly rather than rely on a subscription-backed `openai-codex` login path.

Recommended model pair:

- Inner agent: `gpt-5.4-mini` with `thinkingLevel: medium`
- Outer agent: `gpt-5.4` with `thinkingLevel: high`

Optional ceiling run:

- Single-agent baseline: `gpt-5.4` with `thinkingLevel: high`

Why this pairing:

- `gpt-5.4-mini` is strong enough to do meaningful coding and synthesis work, but weak enough that strategic steering can still matter.
- `gpt-5.4` is a clean outer-agent choice because it is explicitly positioned as the stronger reasoning model.
- Keeping the inner at `medium` rather than `high` preserves a real division of labor between execution and supervision.

### 6.2 Pi Config Mapping

If using the OpenAI API provider in Pi:

- `provider`: `openai`
- `model`: `gpt-5.4-mini` or `gpt-5.4`
- `thinkingLevel`: `medium` for inner, `high` for outer

If experimenting with the subscription-backed Pi path later:

- the provider would likely be `openai-codex`
- the model IDs remain the same

That path should be treated as optional and secondary.

## 7. Demo Structure

The demo should be a small `demonstration matrix`, not a benchmark campaign.

### 7.1 Core Conditions

- `inner_only`
  - Model: `gpt-5.4-mini`
  - Purpose: show what the inner agent does without supervision

- `outer_harness`
  - Outer: `gpt-5.4` high
  - Inner: `gpt-5.4-mini` medium
  - Purpose: show what context sculpting changes

### 7.2 Optional Ceiling Condition

- `single_agent_baseline`
  - Model: `gpt-5.4` high
  - Purpose: give readers a rough ceiling reference

This condition is useful, but it should be sparse. It is not necessary to run it at full parity with the other conditions.

## 8. Demo Tasks

The demo should use two tasks, both intentionally chosen to produce interpretable traces.

### Task A: Small Multi-File Coding Task

Goal:

- create or repair a small CLI-sized project with multiple files, tests, and one likely wrong turn

Properties:

- enough complexity to require planning
- small enough to keep token costs down
- deterministic local verification
- likely to trigger useful outer interventions such as rewrite or rollback

Recommended shape:

- 3-5 source files
- 1-2 test files
- a spec that creates an ordering or architecture trap

Good examples:

- a task tracker CLI with export/import requirements that can create schema drift
- a small config-driven parser where the agent can prematurely lock into the wrong data model
- a bugfix task with a misleading first hypothesis and a narrow correct path

Success criteria:

- tests pass
- a local verification script passes
- output behavior matches the written spec

### Task B: Local-Corpus Research Synthesis

Goal:

- answer a multi-document question from a fixed local corpus and produce a short evidence-backed synthesis

Properties:

- no live web search
- reproducible inputs
- easier cost control
- lets the outer agent demonstrate compaction, prioritization, and redirection

Recommended shape:

- 4-6 short documents
- one multi-hop question that requires connecting facts across documents
- one or two distractor documents

Success criteria:

- final answer is correct
- evidence cites the right files/sections
- output is concise and coherent

Why this task matters:

- it tests the same context-management idea in a non-coding setting
- it avoids the variability and tool fees of web search
- it provides a good example of context clutter without needing a long benchmark

## 9. Run Matrix

Recommended minimum matrix:

- Task A, `inner_only`: 2 runs
- Task A, `outer_harness`: 2 runs
- Task B, `inner_only`: 2 runs
- Task B, `outer_harness`: 2 runs

Optional ceiling additions:

- Task A, `single_agent_baseline`: 1 run
- Task B, `single_agent_baseline`: 1 run

Total:

- core demo: 8 runs
- with optional ceiling: 10 runs

This is enough to gather:

- a likely success story
- a likely neutral case
- a likely failure or over-intervention case

## 10. Selection Strategy for the Blog Post

Do not treat every run equally in the write-up.

Instead, select:

- one `hero run` where the outer agent clearly improves trajectory
- one `control run` where the inner-only agent fails or wanders
- one `failure run` where the outer agent makes things worse or adds unnecessary overhead

The write-up should focus on trace comparison, not aggregate tables.

## 11. Evaluation Style

The demo should still be disciplined, but not formal.

### 11.1 What to Measure

Use the harness artifacts already available:

- final outcome
- wall-clock time
- input/output tokens
- estimated cost
- number of inner turns
- number of outer interventions
- operation labels
- checkpoint and rollback usage
- context growth over time

### 11.2 What to Emphasize

In analysis, prioritize:

- trajectory quality
- intervention timing
- whether the outer agent identified the right problem
- whether the resulting rewrite or rollback actually improved the path

### 11.3 What Not to Overclaim

Avoid claims like:

- "context sculpting is better than larger models"
- "we demonstrated statistical improvement"
- "this is a validated benchmark result"

Prefer claims like:

- "in these demo runs, the outer layer sometimes improved trajectory quality"
- "the traces show a distinct and useful supervisory pattern"
- "the architecture exposes a new lever for harness design"

## 12. Artifact Plan

The current harness already produces most of what the demo needs.

For the blog post, the key artifacts to curate are:

- `summary.json`
- `events.jsonl`
- selected `inner_context` snapshots
- selected `outer_agent` prompt/decision artifacts
- `strategy_notes.txt`

For each featured run, create a short human summary:

- task
- condition
- outcome
- key turn numbers
- important outer decisions
- why the run is worth showing

These summaries can live in a separate notes file or directly in the blog drafting folder later.

## 13. Implementation Work Needed

The core harness is already built. The remaining work is demo setup, not harness R&D.

### 13.1 Required Repo Additions

1. Add task assets for Task A and Task B.
2. Add verification scripts for both tasks.
3. Add run configs for the OpenAI API model pair.
4. Add a small script or documented workflow for executing the demo matrix manually.
5. Add a lightweight analysis note format for featured runs.

### 13.2 Suggested New Files

Examples:

- `examples/tasks/demo-coding.json`
- `examples/tasks/demo-synthesis.json`
- `examples/configs/openai-mini-inner.json`
- `examples/configs/openai-outer-harness.json`
- `examples/configs/openai-gpt54-baseline.json`
- `examples/demo/`
  - task fixtures
  - local corpus files
  - verification scripts
  - selected run notes

### 13.3 Nice-to-Have, Not Required

- a helper script to run the 8-10 planned demo runs
- a helper script to extract a compact per-run report from `summary.json`
- a helper script to render a small comparison table for the final post

These should only be built if they save real time.

## 14. Cost Control Rules

Because this project is being run on a personally funded API key, cost control should be explicit.

Rules:

- Use only two main tasks.
- Use only the 8-run core matrix by default.
- Keep the `single_agent_baseline` runs optional.
- Use a fixed local corpus instead of live web search.
- Keep task specs compact.
- Stop a run if it is clearly looping or exploding in turns.
- Prefer manual review between runs rather than firing off everything blindly.
- Do not use `xhigh` thinking unless a specific run needs it.

Hard budget recommendation:

- target budget: `$25-$50`
- acceptable ceiling: `$100`

## 15. Proposed Execution Sequence

### Phase 1: Prepare Inputs

1. Define the small coding task.
2. Build its validation script.
3. Define the local synthesis corpus and question.
4. Build its validation rubric.

### Phase 2: Prepare Configs

1. Add OpenAI API configs for `gpt-5.4-mini` inner-only.
2. Add OpenAI API configs for `gpt-5.4` + `gpt-5.4-mini` harness runs.
3. Add optional `gpt-5.4` baseline configs.

### Phase 3: Dry Runs

1. Run one cheap sanity check per config.
2. Confirm artifacts, cost capture, and verification workflow.
3. Tighten prompts or task wording if traces are noisy for the wrong reasons.

### Phase 4: Demo Runs

1. Execute the 8-run core matrix.
2. Review outcomes after each pair of runs.
3. Add 1-2 optional ceiling runs only if they materially improve the eventual post.

### Phase 5: Curate Evidence

1. Pick the best success trace.
2. Pick the best failure trace.
3. Pick one neutral or mixed trace.
4. Extract the most readable artifacts and summarize them.

### Phase 6: Write the Blog Post

The post should likely follow this structure:

1. The problem: append-only context is a weak abstraction for long agent runs.
2. The idea: treat context as a mutable design surface.
3. The architecture: outer supervisor, inner executor, checkpoints, rewrites, rollback.
4. The prototype: Pi-based cognitive harness with full traces.
5. The demos: coding task and local synthesis task.
6. The interesting traces: one good, one bad, one mixed.
7. The takeaway: context sculpting is an interesting harness primitive worth exploring.
8. The limits: expensive, brittle, and easy to overfit.

## 16. Risks

### Risk 1: The outer agent does nothing interesting

Mitigation:

- choose tasks that have a plausible wrong path
- keep the inner model small enough that supervision can matter

### Risk 2: The outer agent helps, but only in subtle ways

Mitigation:

- focus on traces and intervention timing, not just final pass/fail

### Risk 3: The outer agent makes things worse

Mitigation:

- this is not a project failure
- a compelling negative trace is useful material for the post

### Risk 4: Costs drift upward

Mitigation:

- use the 8-run matrix first
- manually inspect token/cost output after each run batch

### Risk 5: The post starts sounding like a weak research paper

Mitigation:

- keep the narrative grounded in prototype behavior and design insight
- avoid statistical language unless you actually have the evidence

## 17. Success Criteria

This demo plan is successful if it produces:

- two solid demo tasks
- 8-10 well-instrumented runs
- at least one trace where context sculpting clearly changes the trajectory
- at least one trace showing a real failure mode
- enough material for a strong engineering-focused blog post

It does not need to produce publishable experimental evidence.

## 18. Recommendation

Proceed with this plan as an engineering case study.

Use the OpenAI API as the default execution path for clarity and predictable billing. Treat the original research framing as background context, not as the deliverable. The interesting thing here is not whether the harness wins a benchmark. The interesting thing is that it turns context itself into an object that another agent can supervise and rewrite.
