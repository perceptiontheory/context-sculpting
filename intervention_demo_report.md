# Intervention-Targeted Context Sculpting Demo Report

## Scope

This report covers the clean intervention-targeted demo suite executed on April 11, 2026.

- Suite directory: `runs/demo-suites/2026-04-11T05-04-32-275Z-context-sculpting-demo-intervention-core`
- Matrix: 4 total runs
- Conditions:
  - `inner_only`: `openai/gpt-5.4-mini`, `thinkingLevel: low`
  - `outer_harness`: inner `openai/gpt-5.4-mini`, outer `openai/gpt-5.4`, `thinkingLevel: medium`, `promptProfile: intervention_targeted`

This suite was intentionally different from the earlier clean demo in `demo_report.md`.

The earlier demo asked, effectively, "what happens with a conservative outer supervisor?" This second demo asked, "what happens if I deliberately pressure the harness to sculpt context rather than merely observe it?"

Before the clean suite, I ran a targeted smoke and one aborted high-reasoning trial. Those exploratory runs were useful for tuning, but the numbers below refer only to the clean suite listed above.

## Demo Setup

The main design change was not just the tasks. It was the outer prompt.

I added an `intervention_targeted` outer prompt profile that explicitly tells the outer model to stop defaulting to `pass_through` when a defensible rewrite could:

- remove misleading context
- compact tool-heavy exploration
- inject a precise clarification
- reduce wasted turns

I paired that with two tasks designed to make intervention rational:

1. A coding repair task with conflicting docs, stale migration notes, and enough clutter for a compacting or injecting rewrite to matter.
2. A noisy local-corpus synthesis task with multiple plausible but incorrect chains, where the outer model could prune distractors and push the inner model toward a direct file-writing turn.

The intent was not to prove that context sculpting is generally better. The intent was to force the harness into a regime where active context rewriting would actually happen.

## Top-Line Results

The intervention-targeted suite completed cleanly:

- 4 of 4 runs completed successfully
- 4 of 4 verification steps passed
- total estimated API cost: `$1.2573`

Unlike the first demo, the outer agent did not behave like a passive supervisor.

Across the 2 harnessed runs:

- outer invocations: `15`
- `rewrite_context`: `14`
- `terminate`: `1`
- `rollback`: `0`

That is the key result. The original vision of the project was finally exercised: the outer agent actively sculpted the inner context, repeatedly.

## Per-Run Summary

### Coding Control

- Run: `intervention-coding-inner-01`
- Condition: `inner_only`
- Result: passed verification
- Turns: `7`
- Duration: about `42.7s`
- Cost: about `$0.0150`

This run is the baseline for the coding task. The low-capability inner model explored broadly, found the real mismatches, edited the right files, and passed verification without outer help.

### Coding Harness

- Run: `intervention-coding-harness-01`
- Condition: `outer_harness`
- Result: passed verification
- Turns: `12`
- Duration: about `566.9s`
- Cost: about `$1.0601`
- Outer invocations: `12`
- Outer actions: `12` rewrites
- Guardrail: `max_inner_turns` triggered after turn 12

This was the most interesting run in the suite.

The outer model did exactly what the harness was built to permit:

- early `inject` rewrites to correct path confusion and restate the authoritative signals
- repeated `compact` rewrites to collapse read-heavy context into shorter diagnostic summaries
- further `inject` rewrites to redirect the next step toward verification or away from unnecessary rereads

From a pure architecture standpoint, this is a clear success: active context sculpting happened repeatedly and was visible in the trace.

From a practical standpoint, it also exposed the core failure mode:

- the outer model over-intervened
- the run took far longer than the control
- cost exploded relative to the control
- the harness hit the turn cap before the outer model ever decided to terminate

And yet the run still passed verification.

That combination is important. It means the harness was not merely making noise. It really was steering the inner trajectory. But the steering policy was too aggressive and too expensive on this task.

In other words:

- active sculpting was real
- useful sculpting and over-sculpting were easy to blur together

### Synthesis Control

- Run: `intervention-synthesis-inner-01`
- Condition: `inner_only`
- Result: passed verification
- Turns: `4`
- Duration: about `6.8s`
- Cost: about `$0.0065`

The control run solved the noisy corpus task quickly and correctly, even with the low inner configuration.

### Synthesis Harness

- Run: `intervention-synthesis-harness-01`
- Condition: `outer_harness`
- Result: passed verification
- Turns: `3`
- Duration: about `83.6s`
- Cost: about `$0.1756`
- Outer invocations: `3`
- Outer actions: `rewrite_context`, `rewrite_context`, `terminate`

This was the cleanest demonstration of the original concept.

The outer model first used `inject` to replace a diffuse opening with a more directed note about likely distractors and the exact evidence chain to establish.

Then, once the relevant documents had been read, it used `compact` to replace the noisy exploration history with a concise summary that explicitly named:

- the three relevant files
- the final answer
- the instruction to write `answer/final_answer.md` immediately

The inner model then wrote the answer file on the next turn, and the outer model terminated the run.

This is the best "hero run" in the second demo because it shows context sculpting doing something specific and legible:

- reducing context clutter
- focusing the next step
- shortening the path to the final output

## What Changed Relative to the First Demo

The first demo showed:

- a technically working harness
- strong artifacts
- outer supervision with almost no actual intervention

The second demo showed:

- the same harness can absolutely perform active context rewriting
- once prompted to intervene, the outer model will intervene often
- the architecture is powerful enough to change trajectory shape, not just observe it

So the original project vision was not wrong. It just was not naturally activated by the conservative prompt and small straightforward tasks from the first demo.

## Main Lessons

1. `rewrite_context` is operationally real.

This is no longer hypothetical. The clean suite contains successful, repeated rewrites on both tasks.

2. The outer prompt is the main policy lever.

The biggest shift between Demo 1 and Demo 2 was not model family or infrastructure. It was the outer decision policy. Once the prompt stopped preferring `pass_through`, the system actually started sculpting context.

3. Active sculpting is easy to overdo.

The coding harness run is the clearest example. It did not fail verification, but it still behaved badly at the control-policy level:

- too many rewrites
- too much latency
- too much cost
- no timely terminate decision

That is a real engineering lesson, not a defect in the write-up.

4. Synthesis tasks are currently a better showcase than coding tasks.

On the synthesis task, compaction and injection look natural and useful.

On the coding task, aggressive rewriting can easily become micromanagement, especially when the inner model is already close to the fix.

5. Rollback still remains unproven.

This second demo validated active rewriting, but not rollback. The architecture supports rollback, yet this task set still did not make rollback the best move.

## Bottom Line

If I were explaining the second demo to a colleague, I would say:

The first demo proved that the harness worked. The second demo proved that the harness can actually sculpt context, not just supervise. On a noisy synthesis task, that worked well: the outer model injected direction, compacted the transcript, and pushed the inner model to a clean finish. On a coding task, the same power became a liability: the outer model kept rewriting the context over and over, eventually hitting the turn cap even though the code still passed verification.

That is exactly the kind of result I wanted at this stage. It does not merely show that intervention is possible. It shows that intervention is a real control policy problem. The harness is strong enough to let the outer model help, but also strong enough to let it oversteer. That is a much more interesting blog-post story than a simple “the outer model helped” claim.
