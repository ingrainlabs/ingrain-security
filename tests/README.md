# Tests

Test suite for the `ingrain-security` plugin — the `ingrain-security` orchestrator skill and its six
read-only worker skills. Built on Deno's test runner; it drives the `claude` CLI in headless mode
and can exercise each worker in isolation by dispatching it the way the orchestrator does (its
`skills/<name>/SKILL.md` body as the system prompt, restricted to read-only tools).

## Requirements

- **Deno** ≥ 2 (`deno --version`).
- **Claude Code CLI** in `PATH` (`claude --version`).
- For the **live tiers only**: `claude` must be authenticated (logged in, or `ANTHROPIC_API_KEY`
  set). The static tier needs neither network nor auth.

Run all commands from this `tests/` directory.

## Layout

```
lib/      claudeRunner.ts (spawn helper) · matchers.ts (assertions) · sampleInputs.ts (canned plans) · reporter.ts (input/output printer)
static/   offline lint of worker-skill frontmatter + advisory ROLE + skill/hook structure (no model calls)
agents/   agents.test.ts — table-driven live tests, one case per worker (dispatched as its skill)
skill/    trigger.test.ts (review starts / minor stops) · orchestration.test.ts (gated)
```

## Seeing the model input & output

Every **live** test prints a block as it runs, so you can validate the model's actual responses by
eye alongside the automated verdict:

```
===== relevance-triage :: major plan =====
INPUT:
    <the exact prompt sent>
OUTPUT:
    <the model's full response>
DISPATCHED: [relevance-triage]        # skill/orchestration tests only
VERDICT: ok  (exit 0, 3.1s)
```

This is always on for the live tiers — Deno streams each test's output live (wrapped in its own
`----- output -----` markers), in order. The full OUTPUT prints even when an assertion fails. The
`static/` tier has no model response and stays quiet.

## How the tests work

- **static/** — pure file reads. Asserts each worker skill's frontmatter (name, anti-trigger
  description) and the advisory **read-only** ROLE header (`Read, Grep, Glob` only, no edits,
  recommended model), plus the orchestrator's step ordering, announce/stop phrases, the read-skill
  dispatch mechanism, and a valid SessionStart hook.
- **agents/** — dispatches one worker per case the way the orchestrator does: its
  `skills/<name>/SKILL.md` body as the system prompt with `--allowed-tools Read,Grep,Glob`. The test
  asserts the output's _shape_ (a verdict keyword, a 0–100 score, a preserved `T1` tag, required
  fields). Assertions are loose because live output varies.
- **skill/** — a full session (skill + agents + hook). `trigger.test.ts` checks a security-relevant
  plan starts the review and a trivial one stops at triage. `orchestration.test.ts`
  (integration-gated) checks the workers fire in order through risk scoring and the run halts at
  Gate 1.

## Running

```bash
deno task test:static        # offline, deterministic, ~0.3s — no auth needed
deno task test               # static + 6 live agents + skill trigger (default tier)
deno task test:agents        # just the 6 live per-agent tests
deno task test:integration   # everything, incl. full orchestration (slow)

# one worker only:
deno test --allow-run=claude --allow-read --allow-env agents/ --filter relevance-triage
```

`deno task fmt` / `deno task lint` format and lint the suite.

## Tiers & rough cost

| Command            | Model calls            | Time      | Auth |
| ------------------ | ---------------------- | --------- | ---- |
| `test:static`      | 0                      | < 1s      | no   |
| `test`             | ~8 (6 agents + 2)      | a few min | yes  |
| `test:integration` | + full cycle to Gate 1 | 5–20 min  | yes  |

## Notes

- Live tests call the model, so an occasional flake is possible; re-run a single test with
  `--filter`. Assertions check shape, not exact wording, to minimize this.
- Each worker is dispatched by inlining its `skills/<name>/SKILL.md` body (via
  `workerDispatchPrompt` in `lib/claudeRunner.ts`) and restricting tools to `Read,Grep,Glob`; the
  plugin is loaded via `--plugin-dir` pointing at the repo root (computed automatically).
- The orchestration test deliberately does **not** answer the interactive Gate 1/Gate 2 prompts —
  headless mode has no human — so it asserts the run _reaches_ Gate 1 and stops.
