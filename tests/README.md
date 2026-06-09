# Tests

Test suite for the `ingrain-security` plugin — the `ingrain-security` skill and its six read-only
subagents. Built on Deno's test runner; it drives the `claude` CLI in headless mode and can exercise
each subagent in isolation via `claude --agent`.

## Requirements

- **Deno** ≥ 2 (`deno --version`).
- **Claude Code CLI** in `PATH` (`claude --version`).
- For the **live tiers only**: `claude` must be authenticated (logged in, or `ANTHROPIC_API_KEY`
  set). The static tier needs neither network nor auth.

Run all commands from this `tests/` directory.

## Layout

```
lib/      claude.ts (spawn helper) · assert.ts (matchers) · fixtures.ts (canned plans)
static/   offline lint of agent frontmatter + skill/hook structure (no model calls)
agents/   agents.test.ts — table-driven live tests, one case per subagent (`claude --agent <name>`)
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

- **static/** — pure file reads. Asserts each agent's frontmatter (name, model, non-empty
  description) and that every agent stays **read-only** (`Read, Grep, Glob` only), plus the skill's
  step ordering, announce/stop phrases, and a valid SessionStart hook.
- **agents/** — `claude -p "<input>" --agent <name> --plugin-dir <repo>` runs the session _as_ that
  one subagent; the test asserts the output's _shape_ (a verdict keyword, a 0–100 score, a preserved
  `T1` tag, required fields). Assertions are loose because live output varies.
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

# one agent only:
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
- `--agent <name>` uses the bare agent name (e.g. `relevance-triage`); the plugin is loaded via
  `--plugin-dir` pointing at the repo root (computed automatically in `lib/claude.ts`).
- The orchestration test deliberately does **not** answer the interactive Gate 1/Gate 2 prompts —
  headless mode has no human — so it asserts the run _reaches_ Gate 1 and stops.
