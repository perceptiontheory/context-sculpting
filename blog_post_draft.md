# Context Sculpting: Letting an Outer Agent Rewrite an Inner Agent's Context

Most agent systems treat context like an append-only log.

That is a sensible default. Every turn adds more messages, more tool results, more partial plans, more failed attempts, more local clutter. The model sees the whole transcript and is expected to recover its own trajectory from that growing pile.

But that is also a design choice, not a law of nature.

If a human teammate sees me going down the wrong path, they usually do not help by appending one more paragraph to the bottom of the transcript. They restate the goal. They throw away stale detail. They say "ignore that dead end, here is the actual issue." Sometimes they say "go back to the earlier version and take a different route."

That is the idea behind what I have been calling `context sculpting`.

The core question is simple:

> What happens if you give one model permission to rewrite another model's working context between turns?

I built a small harness to test that idea. Then I ran two demo suites against it.

The first demo showed a result I did not expect but ended up liking a lot: the outer model behaved less like a sculptor and more like a conservative supervisor. The second demo, after I changed the outer prompt and task design, showed the opposite: repeated, real context rewriting, including a clean success case and a very clear over-intervention failure mode.

That combination ended up being more interesting than a neat success story.

## The Architecture

The harness is a simple two-layer loop:

1. An inner agent works on the actual task.
2. After every completed inner turn, an outer agent inspects the full inner context.
3. The outer agent chooses one of four actions:
   - `pass_through`
   - `rewrite_context`
   - `rollback`
   - `terminate`

At a high level, the loop looks like this:

```text
while run_is_active:
  inner_agent.take_one_turn()
  outer_agent.observe(full_inner_context)
  decision = outer_agent.decide()

  if decision == pass_through:
    continue
  if decision == rewrite_context:
    replace inner context with rewritten version
  if decision == rollback:
    restore an earlier checkpoint
  if decision == terminate:
    stop
```

The important design choices for this prototype were:

- the outer agent sees the full inner context
- the outer agent gets a chance to intervene every turn
- the inner agent is not explicitly aware that sculpting is happening
- the primary intervention primitive is full-context rewrite, not fine-grained patching

I built this on top of the Pi SDK in a local TypeScript harness. The implementation logs everything to disk:

- per-turn events
- prompt and response artifacts
- context snapshots
- checkpoints
- outer decisions
- verification output
- final task workspaces

So even when the runs are messy, they are inspectable.

That matters, because this project is not really about leaderboard wins. It is about making the control loop visible enough that you can study it.

## Why I Stopped Treating This Like "Research"

The original version of this project had a more research-flavored framing. I was thinking about a small benchmark matrix, quasi-rigorous comparisons, and a paper-lite write-up.

I backed away from that.

What I actually wanted was an engineering case study:

- build the harness for real
- run a few disciplined demos
- inspect the traces
- explain what happened honestly

That turned out to be a better fit for the idea.

`Context sculpting` is interesting even if I do not prove it is a broadly superior agent architecture. It is enough to show:

- what the mechanism is
- what kinds of intervention it enables
- when it helps
- when it does nothing
- when it becomes its own failure mode

That is a much better blog post than a weak imitation of a research paper.

## Demo 1: A Conservative Outer Supervisor

The first demo used:

- inner model: `gpt-5.4-mini`
- outer model: `gpt-5.4`
- a conservative outer prompt
- two compact tasks:
  - a small coding repair task
  - a local-corpus synthesis task

The clean suite was 8 runs total and cost about `$0.71`.

Operationally, it worked great:

- 8 of 8 runs completed
- 8 of 8 verification steps passed
- all artifacts were captured cleanly

But the most interesting result was what the outer agent did not do.

Across the 4 harnessed runs:

- outer invocations: `16`
- `pass_through`: `12`
- `terminate`: `4`
- `rewrite_context`: `0`
- `rollback`: `0`

So the outer model basically acted like a review layer:

- it watched progress
- it occasionally sharpened the next-step intent
- it terminated once the task was clearly done
- it never judged the inner trajectory to be wrong enough to justify rewriting or rollback

That is not the flashy version of the idea I had in mind when I started.

It is still a valuable result.

It shows a useful distinction:

- a `supervisory outer loop`
- a `true sculpting outer loop`

The first demo clearly produced the first one.

That result also forced me to confront something important: a context-sculpting architecture is not enough by itself. The outer policy matters. If the outer model is told to be conservative, it will often behave like a cautious reviewer rather than an active editor of the transcript.

## Demo 2: Forcing Real Context Sculpting

For the second demo, I changed two things.

First, I changed the outer prompt. I added an `intervention_targeted` profile that explicitly told the outer model to stop defaulting to `pass_through` whenever a defensible rewrite could:

- remove misleading context
- compact tool-heavy exploration
- inject a precise clarification
- reduce wasted turns

Second, I changed the tasks.

I created a more cluttered coding task with conflicting docs and stale migration notes, and a noisier synthesis task with multiple plausible chains and explicit distractors.

I also slightly weakened the inner setup:

- inner model: `gpt-5.4-mini`, `thinkingLevel: low`
- outer model: `gpt-5.4`, `thinkingLevel: medium`

The clean intervention-targeted suite was 4 runs and cost about `$1.26`.

This time the outer model absolutely did sculpt context.

Across the 2 harnessed runs:

- outer invocations: `15`
- `rewrite_context`: `14`
- `terminate`: `1`
- `rollback`: `0`

So the answer to "can this harness actually perform active context rewriting?" is now clearly yes.

The more interesting question is what kind of rewriting it produced.

## The Hero Run: Synthesis

The best run in the second demo was the noisy synthesis task.

The task was simple in form but deliberately noisy in context:

- answer a question from a fixed local corpus
- several documents formed plausible but wrong chains
- the output had to be written in a specific markdown structure

The harnessed run did three useful things:

1. The outer model used an `inject` rewrite early.
   It simplified the transcript and added a focused note about which lines of inquiry were likely distractors.

2. After the relevant documents had been read, the outer model used a `compact` rewrite.
   It replaced the noisy read-heavy history with a concise summary of the actual evidence chain and the exact files to cite.

3. The inner model then wrote the answer file on the next turn.
   The outer model terminated immediately after.

That is the cleanest illustration of the original concept:

- the outer model did not merely observe
- it reshaped the inner context
- that reshaping reduced clutter
- the next turn became simpler and more direct

This is what I mean by `context sculpting`.

Not "a larger model supervising a smaller one."

Not "an outer loop adding one more instruction."

But an outer layer treating the transcript itself as a mutable control surface.

## The Failure Run: Coding

The most valuable run in the whole project might actually be the coding harness run from Demo 2.

It is a great example of why this idea is interesting and dangerous at the same time.

The control run solved the task in:

- `7` turns
- about `42.7s`
- about `$0.015`

The harnessed run also passed verification, but it did so in a very different way:

- `12` turns
- about `566.9s`
- about `$1.06`
- `12` outer invocations
- `12` rewrite decisions
- `maxInnerTurns` guardrail triggered

The outer model repeatedly rewrote the context:

- early `inject` rewrites to correct path confusion
- repeated `compact` rewrites to collapse read-heavy transcript clutter
- more `inject` rewrites to push the next step toward verification

From one angle, this is a success:

- the harness genuinely changed the trajectory
- the outer model had real control authority
- the transcript was being sculpted turn after turn

From another angle, it is an oversteering disaster:

- too many rewrites
- too much latency
- too much cost
- no timely terminate decision
- a guardrail had to stop the run

And yet the code still passed verification in the end.

That is exactly the kind of result I was hoping to see eventually, because it exposes the real problem.

The interesting question is no longer:

> Can an outer agent intervene?

The answer is obviously yes.

The interesting question is:

> What is the intervention policy that makes rewriting useful more often than harmful?

That is a much harder problem, and much more interesting than the original naive version of the idea.

## The Biggest Lesson: The Prompt Is the Policy

The strongest shift between the two demos was not the model family.

It was not the SDK.

It was not the logging stack.

It was not the checkpointing mechanism.

It was the outer decision policy.

In Demo 1, the outer agent was instructed to prefer `pass_through` while the inner agent still seemed to be making progress.

In Demo 2, the outer agent was explicitly told to intervene when a rewrite could reduce wasted work or simplify the next turn.

That single policy change moved the system from:

- "polite supervisor"

to:

- "active context editor"

That is an important lesson for anyone building agent harnesses.

The control plane is not just infrastructure. It is behavior. The prompt is part of the policy surface.

## What I Now Think Context Sculpting Actually Is

At this point, I no longer think of context sculpting as "one weird trick for making models better."

I think of it as a control-policy problem over a mutable transcript.

The harness gives the outer model several powers:

- condense
- reorder
- inject
- redirect
- restore
- stop

Those are powerful operations.

But the value does not come from having them. It comes from using them at the right time and with the right restraint.

That framing feels much more durable than the original version of the project.

It also makes the blog-worthy claim cleaner:

> The interesting part is not that an outer agent can rewrite context.  
> The interesting part is that once you allow it, you have created a new control problem.

## What Is Still Missing

One thing still remains unproven in this prototype: `rollback`.

The harness supports it.
The logging is there.
The checkpoints are there.
The outer schema supports it.

But neither demo produced a case where rollback was actually the best move.

So if I continue this project, the next obvious target is not "run more of the same."

It is:

- design a task where rollback is naturally useful
- make the wrong local commitment expensive enough that restoration is cleaner than rewrite

That would round out the story.

## Why I Like This Result

I like where this landed because it is more honest than the story I expected to tell.

If everything had gone perfectly, the post would have been:

- here is a clever harness
- the outer model helps
- context sculpting works

That is fine, but it is not very interesting.

What I have instead is better:

- one demo where the outer layer behaves conservatively and mostly supervises
- one demo where the outer layer actively rewrites context
- one clean success case
- one clear over-intervention case
- a concrete engineering insight about the policy surface

That is the kind of result I trust more.

## Closing

So my current view is:

`Context sculpting` is real.

It is not just a metaphor. I built a harness where an outer model can rewrite an inner model's working transcript between turns, and I now have clean traces showing that it can do so repeatedly.

But the interesting part is not that this power exists.

The interesting part is that it creates a new optimization problem:

- when to intervene
- how strongly to intervene
- when to compress
- when to inject
- when to roll back
- when to stop touching the trajectory and let the inner model work

That feels like fertile ground for agent-harness design.

Not because it proves a grand theory of intelligence, but because it exposes a concrete and very engineerable control surface inside modern agent loops.

If you are building agent systems, I think that surface is worth paying attention to.
