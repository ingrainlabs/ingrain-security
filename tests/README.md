# Tests

Test suite for the `ingrain-security` plugin — the `ingrain-security` orchestrator skill and its
read-only worker roles: six in Development, plus Testing's `ingrain-threat-verifier`. Built on
Deno's test runner; it drives the `claude` CLI in headless mode and can exercise each worker in
isolation by dispatching it the way the orchestrator does (its
`skills/ingrain-security/references/development/<name>.md` body as the system prompt, restricted to
read-only tools).

## Reference layout

The skill's reference files are grouped by the phase that reads them, so a file's phase is visible
from its path:

| Folder                    | Holds                                                                      |
| ------------------------- | -------------------------------------------------------------------------- |
| `references/development/` | The seven Development worker roles, `ingrain-<role>.md`                    |
| `references/testing/`     | `verification-pass.md` (the Testing flow) and `ingrain-threat-verifier.md` |
| `references/lib/`         | `platform-dispatch.md` — dispatch machinery, read by both phases           |
| `references/formatting/`  | `assessment-file.md`, `rules-file.md` — file schemas, read by both phases  |

A worker's filename stem equals its frontmatter `name:`, so the static tests derive a worker's path
from its name — keep the two in step when adding a worker.

## Requirements

- **Deno** ≥ 2 (`deno --version`).
- **Claude Code CLI** in `PATH` (`claude --version`).
- For the **shell tier only**: **ShellCheck** in `PATH` (`brew install shellcheck`). CI pins
  v0.11.0.
- For the **live tiers only**: `claude` must be authenticated (logged in, or `ANTHROPIC_API_KEY`
  set). The static tier needs neither network nor auth.

Run all commands from this `tests/` directory.

## Layout

```
lib/      claudeRunner.ts (spawn helper) · matchers.ts (assertions) · sampleInputs.ts (canned plans) · reporter.ts (input/output printer)
static/   offline lint of worker-reference frontmatter + advisory ROLE + skill/hook structure (no model calls)
hooks/    assessment-hooks.test.ts · assessment-path.test.ts · allow-assessment-write.test.ts · codex-allow-assessment-write.test.ts — run the hook/path scripts under bash against a throwaway project (no model calls)
shell/    shellcheck.test.ts — ShellCheck over every committed shell script, found by shebang so the extensionless hooks are covered too (no model calls)
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
  Windows `cd && pwd` normalization can't be exercised on Unix and stays a manual check.
- **shell/** — runs the real `shellcheck` binary once per shell script tracked by git. Discovery is
  **shebang-based, not a `*.sh` glob**: the hooks are deliberately extensionless (see
  `hooks/run-hook.cmd`), so a glob would silently lint the three release scripts and skip every
  hook. A `discovery` test guards exactly that regression — it asserts a known set of scripts is
  present, so a broken scan can't leave the tier green but vacuous. Lint settings come from the
  repo-root `.shellcheckrc`, whose `source-path=SCRIPTDIR` is what lets ShellCheck follow the
  `# shellcheck source=...` directives the hooks use to pull in their shared libs. CI installs a
  pinned ShellCheck rather than trusting the runner image to preinstall one, and lints the same
  scripts from its own workflow step rather than through this tier — see **CI** below.
- **agents/** — dispatches one worker per case the way the orchestrator does: its
  `skills/ingrain-security/references/development/<name>.md` body as the system prompt with
  `--allowed-tools Read,Grep,Glob`. The test asserts the output's _shape_ (a verdict keyword, a
  0–100 score, risk descending by threat tag, required fields). Assertions are loose because live
  output varies.
- **skill/** — a full session (skill + agents + hook). `trigger.test.ts` checks a security-relevant
  plan starts the review and a trivial one stops at triage. `orchestration.test.ts`
  (integration-gated) checks the workers fire in order through risk scoring and the run halts at
  Gate 1.

## Running

The tasks are split by **whether they need an agent** — i.e. whether they spawn the `claude` CLI and
call the model. Every model call in the suite funnels through `runClaude` in `lib/claudeRunner.ts`,
which only `agents/` and `skill/` reach; `static/` and `hooks/` never do.

**No agent** — deterministic, no auth, no network, sub-second:

```bash
deno task test:offline       # the default tier — static + hooks + shell
deno task test:static        # just the offline lint of the skill/worker/hook files
deno task test:hooks         # just the hook + path scripts, executed under bash
deno task test:shell         # just the shell scripts, checked with shellcheck
deno task test:ts            # the offline TS tests only — static + hooks, no shellcheck needed
deno task ci                 # what CI runs: lint + fmt:check + test:offline
```

**Needs an agent** — spawns `claude`, requires auth, costs model calls, can flake:

```bash
deno task test:agent         # 6 per-worker tests + the 2 skill trigger tests
deno task test:integration   # everything, incl. the full orchestration cycle (slow)

# one worker only:
deno test --allow-run=claude --allow-read --allow-env agents/ --filter ingrain-relevance-triage
```

Each tier's Deno permissions double as a capability tag: `test:static` gets `--allow-read` only and
`test:hooks` only `--allow-run=bash`, so a test that reaches for the model from an offline directory
fails on a permission error instead of quietly calling it. Keep the tiers as separate `deno test`
invocations rather than merging their permission sets.

`deno task fmt` / `deno task lint` format and lint the suite.

## CI

`.github/workflows/ci.yml` runs the **no-agent** tier on pull requests into `main` and
`development`, and on pushes to `main`, as a single `deno task ci` (from `tests/`) — lint +
fmt:check + static + hooks + shell. CI runs the same command you do, so it holds no test logic of
its own that could drift from this suite.

Its only other step installs **ShellCheck** at a pinned version, because `shell/shellcheck.test.ts`
shells out to it. Pinning keeps the lint reproducible: the runner image's preinstalled copy could
vanish, or move to a release whose new checks turn an unrelated PR red.

The agent tiers need credentials and cost model calls, so they stay local: run
`deno task test:agent` yourself before opening a PR.

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

| Command                  | Needs an agent? | Model calls            | Time      | Auth |
| ------------------------ | --------------- | ---------------------- | --------- | ---- |
| `test:static`            | no              | 0                      | < 1s      | no   |
| `test:hooks`             | no              | 0                      | < 1s      | no   |
| `test:shell`             | no              | 0                      | < 1s      | no   |
| `test:ts`                | no              | 0                      | < 1s      | no   |
| `test:offline`           | no              | 0                      | < 1s      | no   |
| `ci` (+ lint, fmt:check) | no              | 0                      | a few s   | no   |
| `test:agent`             | yes             | ~8 (7 workers + 2)     | a few min | yes  |
| `test:integration`       | yes             | + full cycle to Gate 1 | 5–20 min  | yes  |

## Notes

- Live tests call the model, so an occasional flake is possible; re-run a single test with
  `--filter`. Assertions check shape, not exact wording, to minimize this.
- Each worker is dispatched by inlining its
  `skills/ingrain-security/references/development/<name>.md` body (via `workerDispatchPrompt` in
  `lib/claudeRunner.ts`) and restricting tools to `Read,Grep,Glob`; the plugin is loaded via
  `--plugin-dir` pointing at the repo root (computed automatically).
- The orchestration test deliberately does **not** answer the interactive Gate 1/Gate 2 prompts —
  headless mode has no human — so it asserts the run _reaches_ Gate 1 and stops.
