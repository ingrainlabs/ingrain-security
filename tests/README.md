# Tests

Test suite for the `ingrain-security` plugin — the `ingrain-security` orchestrator skill and its six
read-only worker roles. Built on Deno's test runner; it drives the `claude` CLI in headless mode and
can exercise each worker in isolation by dispatching it the way the orchestrator does (its
`skills/ingrain-security/references/<name>.md` body as the system prompt, restricted to read-only
tools).

## Requirements

- **Deno** ≥ 2 (`deno --version`).
- **Claude Code CLI** in `PATH` (`claude --version`).
- For the **live tiers only**: `claude` must be authenticated (logged in, or `ANTHROPIC_API_KEY`
  set). The static tier needs neither network nor auth.

Run all commands from this `tests/` directory.

## Layout

```
lib/      claudeRunner.ts (spawn helper) · matchers.ts (assertions) · sampleInputs.ts (canned plans) · reporter.ts (input/output printer)
static/   offline lint of worker-reference frontmatter + advisory ROLE + skill/hook structure (no model calls)
hooks/    assessment-hooks.test.ts · assessment-path.test.ts · allow-assessment-write.test.ts · codex-allow-assessment-write.test.ts — run the hook/path scripts under bash against a throwaway project (no model calls)
agents/   agents.test.ts — table-driven live tests, one case per worker (dispatched via its reference file)
skill/    trigger.test.ts (review starts / minor stops) · orchestration.test.ts (gated)
```

## Seeing the model input & output

Every **live** test prints a block as it runs, so you can validate the model's actual responses by
eye alongside the automated verdict:

```
===== ingrain-relevance-triage :: major plan =====
INPUT:
    <the exact prompt sent>
OUTPUT:
    <the model's full response>
DISPATCHED: [ingrain-relevance-triage]        # skill/orchestration tests only
VERDICT: ok  (exit 0, 3.1s)
```

This is always on for the live tiers — Deno streams each test's output live (wrapped in its own
`----- output -----` markers), in order. The full OUTPUT prints even when an assertion fails. The
`static/` tier has no model response and stays quiet.

## How the tests work

- **static/** — pure file reads. Asserts each worker reference file's frontmatter (name,
  anti-trigger description) and the advisory **read-only** ROLE header (`Read, Grep, Glob` only, no
  edits, recommended model), plus the orchestrator's step ordering, announce/stop phrases, the
  read-reference dispatch mechanism, and a valid SessionStart hook.
- **hooks/** — offline, no model calls, but unlike `static/` it **executes** the
  `hooks/start/ensure-assessment-dir` SessionStart hook under `bash` against a `Deno.makeTempDir()`
  project, asserting the durable folder/README/`.gitignore` are seeded and the `CLAUDE_PROJECT_DIR`
  / `$PWD` resolution behaves. (The finalize snapshot is now written by the orchestrator via its
  file tools, not a hook script, so it has no bash test here.) It also executes both auto-approval
  hooks, piping each one real hook payloads — `hooks/claude/allow-assessment-write` (**PreToolUse**,
  target named in `tool_input.file_path`) and `hooks/codex/allow-assessment-write`
  (**PermissionRequest**, targets read out of an `apply_patch` patch): the assessment file must be
  auto-approved, while every other path — and every malformed, multi-file or decoy payload — must
  fall back to the user's normal permission prompt. Needs `bash` + coreutils (macOS/Linux); the
  Windows `cd && pwd` normalization can't be exercised on POSIX and stays a manual check.
- **agents/** — dispatches one worker per case the way the orchestrator does: its
  `skills/ingrain-security/references/<name>.md` body as the system prompt with
  `--allowed-tools Read,Grep,Glob`. The test asserts the output's _shape_ (a verdict keyword, a
  0–100 score, a preserved `T1` tag, required fields). Assertions are loose because live output
  varies.
- **skill/** — a full session (skill + agents + hook). `trigger.test.ts` checks a security-relevant
  plan starts the review and a trivial one stops at triage. `orchestration.test.ts`
  (integration-gated) checks the workers fire in order through risk scoring and the run halts at
  Gate 1.

## Running

```bash
deno task test:static        # offline, deterministic, ~0.3s — no auth needed
deno task test:hooks         # offline, runs the assessment hook scripts under bash — no auth needed
deno task test               # static + 6 live agents + skill trigger (default tier)
deno task test:agents        # just the 6 live per-agent tests
deno task test:integration   # everything, incl. full orchestration (slow)

# one worker only:
deno test --allow-run=claude --allow-read --allow-env agents/ --filter ingrain-relevance-triage
```

`deno task fmt` / `deno task lint` format and lint the suite.

## Comparing skill variants (trigger-comparison harness)

To iterate on a skill's wording, drop **alternative variants** alongside its `SKILL.md` and watch
them all run the **same task in parallel**, one macOS Terminal window each — so you can see
_whether_, _at what point_, and _with what wording_ each variant triggers its review.

1. In the skill folder (default `skills/ingrain-security/`), add alternates named `SKILL1.md`,
   `SKILL2.md`, … `SKILLN.md` (case-sensitive, same casing as `SKILL.md`). The canonical `SKILL.md`
   is the **baseline**. These alternates are git-ignored scratch files — never committed.
2. Run a task from `lib/taskPrompts.ts` across every variant:

   ```bash
   deno task variants login-endpoint                    # default skill: ingrain-security, normal mode
   deno task variants file-upload --skill ingrain-security
   deno task variants login-endpoint --plan             # run the variants in plan mode
   ```

   (`deno task variants` with no id lists the available task ids.)
3. A run launches **one window per SKILL variant**, all in the **single mode you pick** with
   `--plan` or `--normal` (default `normal`; the two are mutually exclusive). `--plan` starts each
   `claude` with `--permission-mode plan` (gated, read-only until a plan is approved), which also
   exercises the `PostToolUse:ExitPlanMode` hook path; `--normal` omits the flag and exercises only
   the `SessionStart` injection. Run once per mode to compare the variants under each condition.
4. Each window is titled `variant: <label>·<mode> · <SKILLfile>` (e.g.
   `variant: baseline·normal ·
   SKILL.md`, `variant: SKILL2·plan · SKILL2.md`), so the header
   names both the mode and the skill file under test. Each is a real interactive `claude` session
   preloaded with the task — drive the Gate 1 / Gate 2 prompts yourself and compare what each window
   shows.

Each variant runs against a **staged throwaway plugin dir** (the variant swapped in as the target
`SKILL.md`, so both the `SessionStart` hook injection and the skill description come from it).
Everything lands under `tests/.variant-runs/<taskId>/<variantLabel>/` (git-ignored): `plugin/`
(staged once per variant), then a per-mode subdir (`plan/` or `normal/`) holding `prompt.txt`,
`launch.sh`, `workspace/` (the session's cwd), and `session.log` (the captured transcript —
`less -R
session.log` to read it with its ANSI colors). Running the other mode later keeps the
earlier mode's transcript in its own subdir.

> **macOS-only today.** Opening terminal windows and capturing the session are the only OS-specific
> bits; they live behind `ITerminalLauncher` in `tests/skillVariantTest/platform/` (`macos.ts` is
> the sole implementation, picked by the factory in `platform/index.ts`). `skillVariantTest/run.ts`
> itself is platform-neutral. On any other OS the runner exits with a clear message naming the file
> to add (`platform/linux.ts`) — that's where Linux support would go.

## Tiers & rough cost

| Command            | Model calls            | Time      | Auth |
| ------------------ | ---------------------- | --------- | ---- |
| `test:static`      | 0                      | < 1s      | no   |
| `test:hooks`       | 0                      | < 1s      | no   |
| `test`             | ~8 (6 agents + 2)      | a few min | yes  |
| `test:integration` | + full cycle to Gate 1 | 5–20 min  | yes  |

## Notes

- Live tests call the model, so an occasional flake is possible; re-run a single test with
  `--filter`. Assertions check shape, not exact wording, to minimize this.
- Each worker is dispatched by inlining its `skills/ingrain-security/references/<name>.md` body (via
  `workerDispatchPrompt` in `lib/claudeRunner.ts`) and restricting tools to `Read,Grep,Glob`; the
  plugin is loaded via `--plugin-dir` pointing at the repo root (computed automatically).
- The orchestration test deliberately does **not** answer the interactive Gate 1/Gate 2 prompts —
  headless mode has no human — so it asserts the run _reaches_ Gate 1 and stops.
