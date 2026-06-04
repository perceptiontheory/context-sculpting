# Context Sculpting Demo Report

## Scope

This report covers the clean core demo suite executed on April 10, 2026 against the harness in this repo.

- Suite directory: `runs/demo-suites/2026-04-11T04-27-35-568Z-context-sculpting-demo-core`
- Matrix: 8 total runs
- Conditions:
  - `inner_only`: `openai/gpt-5.4-mini`
  - `outer_harness`: inner `openai/gpt-5.4-mini` plus outer `openai/gpt-5.4`
- Guardrails:
  - `maxInnerTurns: 10`
  - `maxEstimatedCostUsd: 4` for inner-only runs
  - `maxEstimatedCostUsd: 8` for harnessed runs

Before this clean suite, I found a runner bug: repeated runs were sharing the same mutable task workspace. I fixed that by adding seeded workspace templates and automatic reset before and after each run. The results below refer only to the corrected suite.

## Demo Setup

The goal was not to run a paper-style experiment. The goal was to test whether the harness could produce a credible, inspectable demonstration of `context sculpting` as an engineering pattern.

The demo used two small tasks:

1. A coding repair task.
   - The agent had to repair a tiny file-backed task-manager CLI so that `node verify.mjs` passed.
   - The workspace contained an intentionally outdated legacy note as a distractor.
   - Verification was objective: all five tests had to pass.

2. A local-corpus synthesis task.
   - The agent had to answer a question from a small `docs/` corpus only and write `answer/final_answer.md` in a fixed structure.
   - The corpus included distractor documents.
   - Verification checked the exact output file shape and the expected evidence chain.

For each task, I ran two `inner_only` runs and two `outer_harness` runs. Every run wrote a normal harness trace plus:

- verification artifacts under `verification/`
- the final task workspace under `workspace_final/`

## Results

At a high level, the suite succeeded cleanly:

- 8 of 8 runs completed successfully
- 8 of 8 verification steps passed
- 0 guardrails triggered
- total estimated API cost: `$0.7079`

### Coding Task

`inner_only`:

- 2 of 2 passed
- total estimated cost: `$0.0331`
- average turns: `7.5`
- average run time: about `21.5s`

`outer_harness`:

- 2 of 2 passed
- total estimated cost: `$0.4706`
- average turns: `5.0`
- average run time: about `39.8s`

What changed:

- The harnessed runs finished in fewer inner turns.
- They were still materially slower and much more expensive overall because the outer model was invoked after every inner turn.
- The cost multiplier on this task was roughly `14x` versus `inner_only`.

Representative successful coding verification:

- `runs/2026-04-11T04-28-19-537Z-outer-harness-demo-coding-task-manager-62897d15/verification/stdout.log`

Representative repaired coding workspace:

- `runs/2026-04-11T04-28-19-537Z-outer-harness-demo-coding-task-manager-62897d15/workspace_final/`

### Synthesis Task

`inner_only`:

- 2 of 2 passed
- total estimated cost: `$0.0135`
- average turns: `4.0`
- average run time: about `6.0s`

`outer_harness`:

- 2 of 2 passed
- total estimated cost: `$0.1907`
- average turns: `3.0`
- average run time: about `22.5s`

What changed:

- The harnessed runs again finished in fewer inner turns.
- As with coding, the total runtime and total cost rose sharply because of outer-loop overhead.
- The cost multiplier was again about `14x`.

Representative synthesis answer:

- `runs/2026-04-11T04-29-52-646Z-outer-harness-demo-synthesis-local-corpus-9543599d/workspace_final/answer/final_answer.md`

The answer was:

- `Company: Aperture Fleet`

and it cited the intended evidence chain:

- `01_northwind_dispatch.md`
- `02_rook_profile.md`
- `03_signalstep_acquisition.md`

## What The Outer Agent Actually Did

This is the most important part of the demo.

The harness worked technically, but the outer agent did not perform any actual context sculpting on these tasks.

Across the 4 harnessed runs:

- outer invocations: `16`
- `pass_through`: `12`
- `terminate`: `4`
- `rewrite_context`: `0`
- `rollback`: `0`

In other words, the outer agent behaved like a conservative supervisor:

- it observed progress
- it sometimes sharpened the next-step intent in `strategy_notes.txt`
- it terminated once the task was clearly complete
- it never judged the inner trajectory to be wrong enough to justify a rewrite or rollback

Two representative outer decisions make that pattern clear:

- On the coding task, after the inner edits aligned with the failing tests, the outer agent chose `pass_through` with the reasoning that the inner agent should now run verification.
- Once verification passed, the outer agent chose `terminate` and summarized the completed fix.

- On the synthesis task, after the evidence chain was gathered, the outer agent chose `pass_through` with the reasoning that the inner agent should now write `answer/final_answer.md`.
- Once the answer file existed with the right structure, the outer agent chose `terminate`.

So the interesting outcome is not "the harness made the model better." The interesting outcome is that the harness exposed a concrete distinction between:

- a supervisory control loop
- true context sculpting

This demo produced the first one, not the second.

## What I Learned

1. The harness implementation is real and useful.

It can run a turn-by-turn outer loop, capture full artifacts, checkpoint state, validate interventions, and produce a clean on-disk record of what happened.

2. The current tasks are too easy, or the current outer prompt is too conservative, to force real sculpting behavior.

On both tasks, the inner model was already competent enough to stay on track. The outer model mostly added oversight, not correction.

3. That is still a good outcome for the kind of blog post this project now wants to be.

For an engineering audience, this is a credible story:

- here is a working control-plane harness
- here is how the outer loop sees and judges inner progress
- here is the artifact trail
- here is the honest result: supervision emerged, but context rewrite/rollback did not

4. If I want a more dramatic context-sculpting demo later, I need different task pressure.

Likely options:

- longer tasks with more opportunity for drift
- tasks with deliberately misleading intermediate artifacts
- an outer prompt that intervenes earlier instead of defaulting to pass-through
- a task where rollback is naturally useful after a wrong local commitment

## Bottom Line

If I were explaining this to a colleague, I would put it this way:

I built the harness I wanted. It is capable of real context observation, rewrite, rollback, and trace capture. I then ran a small, fully logged demo suite with OpenAI models. The demo succeeded operationally and produced good artifacts, but it did not show dramatic context sculpting in action. Instead, it showed a more conservative pattern: the outer model acted as a review layer that watched the inner model, occasionally sharpened the next step, and terminated once the work was done.

That is still worth writing about. It makes the post more credible, not less. The interesting story is not "I proved a new research result." The interesting story is "I built a context-sculpting harness, here is how it works, here is what happened when I ran it, and here is the gap between a conceptual sculptor and the more conservative supervisor that actually emerged."
