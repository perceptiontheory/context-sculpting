# Context Sculpting: Research Plan

## 1. Core Idea

Standard LLM agent loops treat the context window as an immutable, append-only array: system prompt → user message → assistant response → tool calls → tool results → repeat. As context accumulates, performance degrades ("context rot"), failed explorations pollute working memory, and the agent has no mechanism for strategic self-correction.

**Context sculpting** is the technique of having one agent actively observe and mutate another agent's context window between turns. The **cognitive harness** is the two-layer architecture that makes this possible:

- **Inner agent**: A capable but cost-efficient model (e.g., Claude Sonnet 4.6) running a standard agent loop with tools. This agent executes — making tool calls, processing results, pursuing the goal.
- **Outer agent**: A more capable reasoning model (e.g., Claude Opus 4.6) that observes the inner agent's context window after each turn and can *sculpt* it before the next turn — compacting noise, injecting guidance, reordering information, or rolling back failed approaches.

The key insight: the inner agent's context window is not a log. It is a **design space** that the outer agent actively sculpts.

This idea draws from and synthesizes three threads:

1. **Harness engineering** (SWE-agent, Anthropic's Claude Code, OpenAI's Codex): the environment determines agent performance more than model capability.
2. **Recursive Language Models (RLMs)** (Zhang & Khattab, 2025): treating input context as a first-class variable that models can programmatically manipulate.
3. **Predictive processing** (Andy Clark, *The Experience Machine*): cognition as fundamentally expectation-driven, with intervention triggered by prediction error.

Thread (3) is explored in Phase 2. Threads (1) and (2) are the foundation for Phase 1.


## 2. Research Questions

### Phase 1: Context Sculpting with the Cognitive Harness

**Primary question**: Can an outer agent that observes and sculpts the inner agent's context window improve task completion rates compared to either model operating alone in a standard agent loop?

**Secondary questions**:
- What types of context sculpting operations are most effective? (Compaction, reordering, injection, rollback, system prompt modification)
- What is the cost profile? Does the cognitive harness achieve better results per dollar than using the more expensive model directly?
- What failure modes does the architecture introduce? What new risks come from context sculpting?
- How should the outer agent's own context be managed to avoid the same rot problem it's solving for the inner agent?

### Phase 2: The Prediction Layer (future blog post)

- Can the outer agent predict the inner agent's next action and the likely result?
- Does prediction accuracy correlate with task success?
- Can prediction error ("surprise") serve as an efficient trigger for intervention — i.e., the outer agent only intervenes when surprised?
- How does this relate to predictive processing theories of cognition?


## 3. Architecture

### 3.1 Overview

```
┌─────────────────────────────────────────────────┐
│                    User                          │
│         goal.md + context.md (optional)          │
└──────────────────────┬──────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────┐
│               OUTER AGENT (Opus)                │
│                                                 │
│  Receives: goal, current inner agent context    │
│  Maintains: strategy notes, intervention log    │
│  Sculpting operations:                          │
│    - Pass through (no intervention)             │
│    - Compact: summarize verbose/failed sections  │
│    - Inject: add guidance or reframe the goal   │
│    - Reorder: move critical info to prominent   │
│      positions                                  │
│    - Rollback: revert to earlier checkpoint     │
│      and redirect                               │
│    - Edit system prompt: adjust inner agent's   │
│      behavioral instructions                    │
│    - Terminate: declare goal achieved or        │
│      unachievable                               │
│                                                 │
│  Context management: sliding window             │
│    - Current inner agent context (or summary)   │
│    - Outer agent's own strategy notes           │
│    - NOT the full history of all past inner     │
│      agent contexts                             │
└──────────────────────┬──────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────┐
│              INNER AGENT (Sonnet)               │
│                                                 │
│  Standard agent loop:                           │
│    system prompt → user message → model →       │
│    tool calls → tool results → repeat           │
│                                                 │
│  Tools: read, write, edit, bash (Pi defaults)   │
│    + task-specific tools as needed              │
│                                                 │
│  Key difference from standard: the context      │
│  window may be altered between turns by the     │
│  outer agent. The inner agent is not aware      │
│  of this.                                       │
└─────────────────────────────────────────────────┘
```

### 3.2 Outer Agent Context Management

The outer agent's own context window must be kept lean to avoid the same rot it's solving for the inner agent. Proposed approach:

**Per outer-agent invocation, the context contains:**
1. The original goal (from `goal.md`) — always present, anchoring.
2. The outer agent's system prompt — its role, available mutations, decision criteria.
3. The outer agent's **strategy notes** — a running document the outer agent maintains and updates each time it's invoked. This is the outer agent's persistent memory. Kept concise by the outer agent itself (it is instructed to keep notes brief and forward-looking).
4. The current inner agent context window — either the full context (if small enough) or a summary/compressed version. This is the object the outer agent is reasoning about.

**Not included:**
- Previous versions of the inner agent's context window. The outer agent only sees the *current* state, plus whatever it recorded in its strategy notes about past states.

This keeps the outer agent's context short and focused. The strategy notes serve as compressed memory. This is an area for future investigation — the optimal outer agent context structure is itself a design question.

### 3.3 The Observation-Intervention Cycle

```
1. Inner agent completes a turn (model response + any tool calls + tool results)
2. Inner agent's updated context window is captured
3. Outer agent is invoked with:
   - Goal
   - Its strategy notes from the previous cycle
   - The inner agent's current context window
4. Outer agent reasons about:
   - Is the inner agent making progress toward the goal?
   - Are there signs of context rot, looping, or strategic error?
   - What, if anything, should be changed?
5. Outer agent outputs:
   - A decision (pass through, compact, inject, reorder, rollback, edit system prompt, terminate)
   - If sculpting: the specific operations to apply
   - Updated strategy notes for next cycle
6. Sculpting operations are applied to the inner agent's context window
7. Inner agent continues with its (possibly sculpted) context
8. Repeat from step 1
```

### 3.4 Sculpting Operations (Initial Set)

| Operation | Description | When to use |
|----------|-------------|-------------|
| **Pass through** | No changes | Inner agent is making good progress |
| **Compact** | Replace verbose failed tool outputs with brief summaries | Context rot from accumulated error messages |
| **Inject** | Add a synthetic message to the context (as if from the user or system) | Inner agent needs a nudge in a different direction |
| **Reorder** | Move important information to more prominent positions | Inner agent is ignoring a critical constraint |
| **Rollback** | Revert context to an earlier checkpoint, optionally with a redirect message | Inner agent is deep in a wrong approach |
| **Edit system prompt** | Modify the inner agent's system prompt | The task requires different behavioral constraints than originally specified |
| **Terminate** | End the inner agent loop | Goal achieved, or goal determined to be unachievable |


## 4. Implementation Plan

### 4.1 Platform: Pi Agent Framework

The Pi agent framework (`badlogic/pi-mono`) is well-suited for this experiment:

- **Extension system**: Pi's extension hooks (`context`, `tool_result`, `before_agent_start`, `turn_start`, `turn_end`) provide exactly the interception points needed. The `context` hook can modify messages before each turn — this is where context sculpting operations would be applied.
- **Session tree**: Pi's session tree structure with branching already supports the concept of rollback — we could leverage this for the outer agent's rollback operation.
- **Minimal core**: Pi ships with four tools (read, write, edit, bash) and encourages building everything else as extensions. This means the cognitive harness can be added without forking or modifying Pi internals.
- **SDK mode**: Pi can be embedded programmatically, which would allow the outer agent to drive the inner agent as a subprocess/library call.

**Implementation approach**: Build the cognitive harness as a Pi extension that:
1. Hooks into `turn_end` to capture the inner agent's context after each turn
2. Invokes the outer agent (Opus) via the Anthropic API with the captured context + goal + strategy notes
3. Parses the outer agent's response to determine sculpting operation and specifics
4. Applies sculpting operations via the `context` hook before the next turn
5. Logs all outer agent decisions and sculpting operations for analysis

**Alternative approach**: Use Pi's SDK mode to run the inner agent programmatically, with the outer agent as the orchestrating process. This gives more control over the context window but requires more custom code. Worth evaluating both approaches during implementation.

### 4.2 Development Sequence

1. **Set up Pi dev environment** — clone pi-mono, build, verify basic agent functionality
2. **Build a minimal extension** — hook into turn lifecycle events, log context window state after each turn. Verify we can observe and capture the inner agent's full message array.
3. **Build the outer agent invocation** — create a module that takes the inner agent's context + goal + strategy notes, calls Opus via the API, and parses a structured response (sculpting operation + details + updated notes).
4. **Implement sculpting operations** — for each operation type, implement the logic that modifies the inner agent's message array. Start with the simplest operations (pass through, compact, terminate) and add more complex ones (inject, rollback, edit system prompt) incrementally.
5. **Build the observation-sculpting loop** — wire together steps 2-4 into a complete cycle.
6. **Add logging and instrumentation** — capture all outer agent decisions, sculpting details, token counts, costs, and timing for analysis.
7. **Run the three-condition experiment** — execute the benchmark tasks under all three conditions and collect data.


## 5. Experimental Design

### 5.1 The Three-Condition Comparison

For each benchmark task, run under three conditions:

| Condition | Model | Architecture | Purpose |
|-----------|-------|-------------|---------|
| **A: Sonnet alone** | Sonnet 4.6 | Standard agent loop | Baseline: what the inner agent can do without help |
| **B: Opus alone** | Opus 4.6 | Standard agent loop | Ceiling: what the more capable model can do with the same tools |
| **C: Cognitive Harness** | Opus (outer) + Sonnet (inner) | Context sculpting architecture | The experiment: does context sculpting help? |

**Metrics to collect per run:**
- Task completion (binary: did it achieve the goal?)
- Task quality (graded: how well did it achieve the goal? rubric TBD per task)
- Total tokens consumed (input + output, both models)
- Total cost (USD, using API pricing)
- Total wall-clock time
- Number of inner agent turns
- Number of outer agent interventions
- Types of sculpting operations applied
- Number of failed tool calls
- Context window size over time (token count at each turn)

### 5.2 Benchmark Tasks

#### Task 1: Data Transformation Pipeline

**Description**: Given a messy CSV dataset and a target schema, transform the data through a chain of cleaning, restructuring, and validation steps to produce a clean output file matching the target schema.

**Why this task**: Data transformation requires multi-step reasoning, is prone to verbose error messages from malformed data, often involves dead-end approaches that contaminate context, and has a clearly verifiable success criterion (output matches target schema).

**Setup**:
- Input: A deliberately messy CSV (~500-1000 rows) with mixed date formats, inconsistent categories, missing values, encoding issues, and structural problems (merged columns, header rows in the wrong place).
- Target: A clean JSON/CSV schema specification describing the expected output format, field types, validation rules, and derived fields.
- Success criterion: Output file passes automated validation against the target schema.

**Why context rot is likely**: The agent will likely try a parsing approach, hit encoding or formatting errors with verbose tracebacks, try to fix them, hit more errors, and accumulate a context full of error messages and half-working code. This is the classic context rot scenario.

#### Task 2: Multi-File Code Generation with Interdependencies

**Description**: Build a small but complete CLI application with multiple modules that depend on each other — e.g., a task management tool with subcommands (add, list, complete, export), a shared configuration module, a storage layer, and tests.

**Why this task**: Requires maintaining consistency across files over many turns, involves iterative debugging when interfaces don't align, and tends to produce long contexts full of intermediate file states. The agent must hold a mental model of the overall architecture while working on individual pieces.

**Setup**:
- Input: A specification document describing the CLI tool's behavior, subcommands, configuration format, storage format, and expected test coverage.
- Success criterion: All tests pass; CLI produces correct output for a set of integration test scenarios.

**Why this tests more than context rot**: This task also tests the outer agent's ability to detect *strategic errors* — e.g., the inner agent building the storage layer in a way that's incompatible with the export subcommand, or implementing features in an order that creates unnecessary rework.

#### Task 3: Long-Context Research Synthesis (RLM-adjacent)

**Description**: Given access to web search (or a pre-assembled corpus of documents), answer a complex multi-hop question that requires finding, cross-referencing, and synthesizing information from several sources.

**Why this task**: Directly comparable to the RLM benchmark scenarios. Tests whether the outer agent can help the inner agent manage information overload — a different manifestation of the same context management problem that RLMs address, but through supervision rather than recursive decomposition.

**Setup**:
- Input: A multi-hop research question that requires combining facts from 3-5 different sources (e.g., "Which company acquired the startup founded by the person who invented the algorithm used in [specific system]?").
- Tools: Web search + web fetch (or a pre-assembled document corpus for reproducibility).
- Success criterion: Correct answer with supporting evidence trail.

**Why the outer agent might help here**: The inner agent will accumulate search results, many irrelevant, that clog its context. The outer agent can compact irrelevant search results and keep the context focused on the promising leads.

### 5.3 Number of Runs

Each task × each condition should be run multiple times (minimum 5, ideally 10) to account for stochastic variation in model outputs. This means:

- 3 tasks × 3 conditions × 5-10 runs = 45-90 total runs

This is feasible with API access but will require budgeting for token costs. Estimate costs before running the full battery.

### 5.4 Analysis Plan

For each task:
1. Compare completion rates across conditions (A vs B vs C)
2. Compare cost-efficiency: if C outperforms A, does it do so at lower cost than B?
3. Analyze the outer agent's intervention patterns: when does it intervene? What sculpting operations does it apply? Do certain operation types correlate with success?
4. Qualitative analysis of 2-3 interesting runs per task: trace through the outer agent's reasoning and the effect of its sculpting on the inner agent's behavior.

The most compelling result would be: **Condition C outperforms Condition B at lower cost.** This would demonstrate that context sculpting is more valuable than raw model capability for the same task — a concrete validation of the harness engineering thesis.

A still-interesting result would be: **Condition C outperforms Condition A and approaches Condition B at significantly lower cost.** This would demonstrate cost-effective capability amplification.


## 6. Blog Post Outline (Phase 1)

**Working title**: "Context Sculpting: What Happens When an Agent Can Reshape Another Agent's Mind"

1. **Opening**: The harness engineering thesis (brief summary of the X article, the claim that the environment matters more than the model)
2. **The context window problem**: Why append-only context accumulation is a fundamental limitation of current agent architectures. Connection to context rot, strategic errors, and the RLM paper's insight about treating context as a variable.
3. **The idea**: What if an agent could sculpt another agent's context? Introduce the cognitive harness architecture. Explain the key design decisions (sliding window for outer agent, sculpting operations, observation-sculpting cycle).
4. **Related work**: Position context sculpting relative to existing reflection-based approaches (Reflexion, MAR, LATS). Explain how context sculpting differs — the outer agent doesn't send feedback messages; it rewrites the inner agent's cognitive landscape directly.
5. **The experiment**: Three-condition comparison. Describe the tasks, the setup, the metrics.
6. **Results**: What happened. Data, charts, analysis.
7. **Interesting observations**: Qualitative deep-dives into specific runs. What did the outer agent do? What sculpting operations were most effective? What surprised us?
8. **Discussion**: What this means for harness engineering. Cost implications. Limitations. Open questions.
9. **What's next**: Tease Phase 2 (the prediction layer) without going into full detail.

**Target length**: ~4,000-6,000 words. Long enough to be substantive, short enough to hold attention. Heavy on concrete examples and data, light on abstract theorizing.


## 7. Open Questions and Risks

### Design Questions to Resolve During Implementation
- **Outer agent context structure**: What exactly does the outer agent see? Full inner context vs. compressed summary? How much compression?
- **Intervention frequency**: Should the outer agent be invoked after every turn, or only after certain triggers (e.g., tool failures, N turns without progress)?
- **Sculpting granularity**: How fine-grained should sculpting operations be? Should the outer agent specify exact edits to the message array, or express intent that gets translated programmatically?
- **Inner agent awareness**: Should the inner agent know it's being sculpted? Or should operations be invisible? (Initial design: invisible. But worth exploring.)

### Risks
- **Counterproductive sculpting**: The outer agent might apply operations that are counterproductive — injecting misleading information or compacting important context.
- **Overhead not worth it**: If the outer agent's invocation cost exceeds the benefit of its sculpting, the architecture is net-negative. The cost tracking will reveal this.
- **Evaluation difficulty**: Grading task quality on a rubric introduces subjectivity. Mitigate by using binary completion criteria where possible and clearly defining rubrics in advance.
- **Pi extension limitations**: The extension hooks may not provide sufficient control over the context window for all sculpting operations. Will need to evaluate early and potentially fall back to SDK mode.
- **Sample size**: 5-10 runs per condition may not be enough for statistical significance. This is exploratory research for a blog post, not a peer-reviewed paper — but we should be honest about the limitations.


## 8. Timeline (Rough Estimate)

| Week | Activity |
|------|----------|
| 1 | Set up Pi dev environment. Build minimal extension. Verify context observation works. |
| 2 | Build outer agent invocation module. Implement basic sculpting operations (pass through, compact, terminate). |
| 3 | Implement remaining sculpting operations (inject, reorder, rollback, edit system prompt). Wire together the full loop. |
| 4 | Design and prepare benchmark tasks (create messy datasets, write specifications, define success criteria). |
| 5 | Run the three-condition experiment. Collect data. |
| 6 | Analyze results. Write the blog post. |

This is aggressive but feasible for someone working on it as a focused side project. Adjust as needed based on reality.


## 9. Naming

| Term | Usage |
|------|-------|
| **Context sculpting** | The core technique — an agent observing and actively modifying another agent's context window between turns. This is the primary concept, the blog post title, and the term people should remember and reference. |
| **Cognitive harness** | The two-layer architecture (outer agent + inner agent) that enables context sculpting. Introduced in the body of the blog post as the implementation: "To test this idea, we built a *cognitive harness*..." |
| **Sculpting operations** | The specific types of context modifications the outer agent can perform (compact, inject, reorder, rollback, edit system prompt, terminate). |
| **Outer agent / Inner agent** | The two components of the cognitive harness. The outer agent sculpts; the inner agent executes. |

**Note on "reflection" terminology**: Existing LLM agent literature uses "reflection agents" and "reflective agents" extensively (Reflexion, MAR, LATS, LangChain Reflection Agents). Those approaches involve self-critique via feedback messages appended to context. Context sculpting is fundamentally different — the outer agent directly modifies the inner agent's context structure rather than appending feedback. The blog post should include a Related Work section that explicitly differentiates context sculpting from reflection-based approaches.
