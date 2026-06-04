# Context Sculpting

> What happens if you give one model permission to rewrite another model's working context between turns?

Most agent systems treat context like an append-only log: every turn piles on more
messages, tool results, and dead ends, and the model is expected to recover its own
trajectory from the growing transcript. **Context sculpting** asks what happens if you
break that assumption — if a second agent is allowed to actively reshape the first
agent's context as it works, the way a human teammate might restate the goal, throw away
stale detail, or say "go back and try a different route."

This repository is a small TypeScript harness, built on the
[Pi](https://www.npmjs.com/package/@mariozechner/pi-coding-agent) agent SDK, that
implements and instruments that idea so it can be measured.

The full write-up lives in [`blog_post_draft.md`](./blog_post_draft.md); the design and
methodology are in [`research_plan.md`](./research_plan.md) and
[`implementation_plan.md`](./implementation_plan.md).

## How it works

The harness runs a two-layer loop:

1. An **inner agent** works on the actual task, one turn at a time.
2. After every completed turn, an **outer agent** observes the inner agent's full context
   and chooses one of four actions:
   - `pass_through` — leave the context untouched
   - `rewrite_context` — replace the inner context with a rewritten version
   - `rollback` — restore an earlier checkpoint
   - `terminate` — stop the run

The inner agent is not told that sculpting is happening. Every turn, decision, context
snapshot, checkpoint, and rewrite is logged to disk under `runs/`, so even messy runs are
fully inspectable, and each run produces an analysis-grade `summary.json` with token,
cost, timing, and intervention metrics.

The harness also supports three comparison conditions — `inner_only`,
`single_agent_baseline`, and `outer_harness` — sharing a common artifact schema so runs
can be compared across architectures.

## Findings

Two demo suites were run against the harness:

- **Core suite** — the outer agent behaved less like a sculptor and more like a
  conservative supervisor, mostly passing through or terminating. Write-up:
  [`demo_report.md`](./demo_report.md).
- **Intervention-targeted suite** — with a more assertive outer prompt, the outer agent
  performed repeated real context rewrites, including a clean success case and a clear
  over-intervention failure. Write-up:
  [`intervention_demo_report.md`](./intervention_demo_report.md).

## Requirements

- Node.js `>= 20.6.0` and npm
- A provider API key (Anthropic or OpenAI) available to Pi, either through an environment
  variable (`ANTHROPIC_API_KEY` / `OPENAI_API_KEY`) or Pi's own auth storage

## Setup

```bash
npm install
npm run build      # compile TypeScript to dist/ (npm run typecheck to type-check only)
```

## Usage

Run a task with a config. The minimal example uses the inner agent only:

```bash
npm run dev -- --task examples/tasks/minimal.json --config examples/configs/minimal.json
```

Enable the outer agent with a low-cost Anthropic Haiku harness config:

```bash
npm run dev -- --task examples/tasks/minimal.json --config examples/configs/smoke-haiku-outer.json
```

Run a matrix of task/config pairs and capture per-run verification artifacts:

```bash
npm run demo -- --matrix examples/demo/demo-matrix-core.json
```

Ready-made task specs and run configs live in [`examples/`](./examples). CLI flags:
`--task <path>`, `--config <path>`, `--help`.

## Configuration

**Task specs** are JSON files describing what the inner agent should do. The minimal shape
is `{ "id": "...", "goal": "..." }`; goals can also be loaded from a file
(`goalFile`), and tasks may include `context`, `instructions`, a `cwd`, and an optional
`verification` command used by the demo runner.

**Run configs** are JSON files selecting the provider, model, and (optionally) an outer
agent:

```json
{
  "condition": "outer_harness",
  "provider": "anthropic",
  "model": "claude-sonnet-4-5",
  "sessionMode": "in_memory",
  "outerAgent": {
    "provider": "anthropic",
    "model": "claude-haiku-4-5",
    "promptProfile": "intervention_targeted"
  }
}
```

Key fields include `condition` (`inner_only` | `single_agent_baseline` | `outer_harness`),
`thinkingLevel`, `sessionMode` (`in_memory` | `persistent`), and the optional guardrails
`maxInnerTurns` and `maxEstimatedCostUsd`. See the files in
[`examples/configs/`](./examples/configs) for complete, working examples.

## Repository layout

```text
src/
  cli/        CLI entrypoints (runHarness, runDemo)
  harness/    inner session, outer agent, context rewrite/rollback, checkpoints
  logging/    run artifacts, metrics, secret redaction
  schemas/    task spec and run config validation
examples/     task specs, run configs, and demo matrices
```

## Limitations

- Context rewrite and rollback are supported only for `in_memory` sessions.
- Rewrite payloads carry text content only (no images).
- Rollback redirects are appended as synthetic `user` messages.
- Runs fail fast if no provider credentials are configured.

## License

MIT — see [`LICENSE`](./LICENSE).
