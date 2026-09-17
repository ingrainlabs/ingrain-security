# Tests

Test suite for the `ingrain-security` plugin — the `ingrain-security` orchestrator skill and its
worker roles: three in Development, plus Testing's `ingrain-threat-verifier` and
`ingrain-rule-verifier`. Built on Deno's test runner; the live tier drives a **real agent host** the
way the product does — a directed prompt is the only trigger (the CI entrypoint supplies the same
one) — and can exercise each worker in isolation by dispatching it the way the orchestrator does
(its `skills/ingrain-security/references/development/<name>.md` body as the system prompt, plus the
assessment file it writes its section into).

## Hosts

The live tier has **two backends** behind one registry (`lib/runners/index.ts`), selected per run by
`INGRAIN_TESTS_AGENT_HOST` (default `claude`):

| Host       | Binary                                                         | Credential                                                           | Model                                                        |
| ---------- | -------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------ |
| `claude`   | `claude --print --dangerously-skip-permissions --plugin-dir …` | the caller's Claude Code login                                       | the `sonnet` moving alias                                    |
| `opencode` | `opencode run --auto --dir <fixture> [--format json]`          | the machine's own OpenCode provider auth (`opencode providers list`) | the machine's resolved default — never pinned by the harness |

OpenCode's backend rides the machine's configuration: providers, plugins, agents and the resolved
default model are the host's own. It stages one per-case `$HOME` whose global config is the
machine's global config deep-merged with the harness's two additions — the skill's registration
(`skills.paths`, measured to register _only_ from the global config) and the headless permission
grants (`ingrain *`, `task`, `skill`, `todowrite`; machine denials are never widened).
`XDG_DATA_HOME` stays the machine's, because that is where `auth.json` lives. Timeouts are
claude-calibrated and scaled per host (`HOST_TIMEOUT_SCALE`); OpenCode ships no `--max-turns` at
1.18.31, its event tap is `run --format json` (NDJSON: `part.text`, `tool_use` with `part.tool`),
and it binds the session with its own `--dir` flag — measured, not assumed, at the pinned release.

**The seam is structural and asserted** (`static/harness.test.ts`): shared modules (`matchers`,
`reporter`, fixtures, types) import no backend; backends import only the shared core and never each
other; only `lib/runners/index.ts` and the test files reach into a backend.

## Reference layout

The skill's reference files are grouped by the phase that reads them, so a file's phase is visible
from its path:

| Folder                    | Holds                                                                                               |
| ------------------------- | --------------------------------------------------------------------------------------------------- |
| `references/development/` | The three Development worker roles, `ingrain-<role>.md`, and `flow.md`                              |
| `references/testing/`     | `verification-pass.md` (the Testing flow), `ingrain-threat-verifier.md`, `ingrain-rule-verifier.md` |
| `references/lib/`         | `ingrain-cli.md`, `branch-delta.md`, `dispatch.md` — phase-neutral, read by both phases             |
| `references/lib/`         | `assessment-file.md` — the one artifact's schema, read by both phases                               |

A worker's filename stem equals its frontmatter `name:`, so the static tests derive a worker's path
from its name — keep the two in step when adding a worker.

## Requirements

- **Deno** ≥ 2 (`deno --version`).
- For the **live tiers only**, the selected host in `PATH` and working: **Claude Code**
  (`claude
  --version`, logged in) or **OpenCode** (`opencode --version`, a logged-in provider
  resolving a default model — `opencode providers list`). `agents/hostSmoke.test.ts` is the
  fail-fast case that checks exactly this before any scenario spends its budget.
- For the **shell tier only**: **ShellCheck** in `PATH` (`brew install shellcheck`). CI pins
  v0.11.0.
- The static tier needs neither network nor auth.

Run all commands from this `tests/` directory.

## Layout

```
lib/      runners/ (shared.ts — the shared core · claude.ts · opencode.ts · index.ts — the registry)
          matchers.ts (host-neutral assertions over TToolUse) · sampleInputs.ts (canned plans) · sampleProjects.ts (paired fixture repos) · reporter.ts (input/output printer)
static/   offline lint of worker-reference frontmatter + advisory ROLE + skill structure + the host seam (no model calls)
parity/   taskWiring.test.ts — holds this file's own task table to the files it runs, per host (no model calls)
shell/    shellcheck.test.ts — ShellCheck over the three .github/ release scripts, plus the assertion that the plugin ships no executable at all (no model calls)
agents/   hostSmoke.test.ts (the host answers at all) · agents.test.ts (table-driven, one case per worker scenario) · unattended.test.ts (the gates resolving with nobody there) · resume.test.ts (tag permanence + the rule axis across a resume) — live
skill/    trigger.test.ts (directed review starts and runs / records `major` without re-asking) · orchestration.test.ts (INTEGRATION-gated)
```

## Seeing the model input & output

Every **live** test prints a block as it runs, so you can validate the model's actual responses by
eye alongside the automated verdict:

```
===== ingrain-threat-generator :: major plan [opencode] =====
INPUT:
    <the exact prompt sent>
OUTPUT:
    <the model's full response>
DISPATCHED: [ingrain-threat-generator, …]
VERDICT: ok  (exit 0, 3.1s)
```

The host that ran the case heads the block. This is always on for the live tiers — Deno streams each
test's output live (wrapped in its own `----- output -----` markers), in order. The full OUTPUT
prints even when an assertion fails. The `static/` tier has no model response and stays quiet.

## How the tests work

- **static/** — pure file reads. Asserts each worker reference file's frontmatter (name,
  anti-trigger description) and its advisory ROLE header — the named **write target** and the
  recommended model, plus the inverse guard that no worker calls itself read-only (workers write the
  assessment file; a read-only clause there contradicts their hand-off contract). Also the
  orchestrator's step ordering, announce/stop phrases, the read-reference dispatch mechanism, the
  frontmatter grant set and its OpenCode staging twin, and the host seam. Nothing injects the skill
  any more — the plugin ships no hooks — so the frontmatter description is the whole of what starts
  a run.
- **parity/** — the tier for facts stated in two places. `taskWiring` holds this file's own task
  table to the files it runs: the live tier globs `agents/`, so a new file there is covered for free
  while the **granular** tasks — which name one file each — silently stop being the sum of it, and
  anyone reaching for the narrow task runs a subset without being told. Grouped **per host** (the
  `INGRAIN_TESTS_AGENT_HOST=…` twins), so the sum-of-parts claim and permission parity hold within
  each host's matrix.

  **Three of this tier's checks moved to the monorepo**, because the thing they compared against
  left the repository. `scriptInvocations` executed every command inside an `ingrain-script` fence;
  those commands are `ingrain …` now, so running them needs a binary this repo cannot see, and it
  became `tests/contract/skill-cli/documentedInvocations.test.ts` in `ingrainlabs`.
  `scriptOutputFields`' surviving half (the fields `SKILL.md` tells the orchestrator to keep are
  fields the mint really emits) is `tests/contract/skill-cli/assessmentCards.test.ts` there too.
  `sourceGraph` derived the shell dependency graph, a job `ingrain`'s own `architecturetests` now
  does over the TypeScript that replaced it.
- **shell/** — runs the real `shellcheck` binary once per shell script, which after the
  consolidation is exactly the three `.github/` release scripts. **The tier is retained rather than
  deleted for that reason**: the plugin ships no shell any more, but those three still cut releases
  and would otherwise stop being linted entirely. Its `discovery` test asserts the linted set is
  _exactly_ those three, and a second test asserts the property that makes this plugin prose-only —
  no `.sh`, no extensionless script, no `run-hook.cmd`, and no `hooks` key in either plugin
  manifest. Lint settings come from the repo-root `.shellcheckrc`. CI installs a pinned ShellCheck
  rather than trusting the runner image, and lints from its own workflow step rather than through
  this tier — see **CI** below.
- **agents/** — `hostSmoke.test.ts` runs one bare completion on the selected host: the fail-fast
  case that names the remedy (export the credential, `opencode providers` login) instead of letting
  the first scenario die deep in its budget. `agents.test.ts` dispatches one worker per case the way
  the orchestrator does (via `workerDispatchPrompt`, the reference body inlined as the session
  prompt); each case mints a real assessment file in a throwaway project dir (via
  `ingrain assessment mint`) and hands the worker that absolute path as its write target, then
  asserts the worker actually modified the seeded file and checks the output's _shape_ (a verdict
  keyword, a 0–100 score, required fields) over the return and the file together. Assertions are
  loose because live output varies. Three cases over three workers.
- **skill/** — a full session (skill + agents, no hooks — a directed prompt is the only trigger
  there is, and the CI entrypoint supplies it). `trigger.test.ts` checks a directed
  security-relevant plan starts **and runs** the review (assessment minted is the artifact floor),
  and that a directed trivial plan records `major` without putting the question back — a review the
  user requested is never re-asked. Self-triggering on an ambient plan is not measured here: it
  belongs to the model, not the skill. `orchestration.test.ts` (integration-gated) checks the
  workers fire in order through risk scoring and the run halts at the user gates, on both driver
  axes.

## Running

The tasks are split by **whether they need an agent** — i.e. whether they spawn a host CLI and call
the model. Every model call in the suite funnels through the backend registry (`lib/runners/`),
which only `agents/` and `skill/` reach; `static/` and `parity/` never do.

**No agent** — deterministic, no auth, no network, sub-second:

```bash
deno task test:offline       # the default tier — static + parity + shell
deno task test:static        # just the offline lint of the skill/worker/hook files
deno task test:parity        # just the script <-> docs/header contracts
deno task test:shell         # just the shell scripts, checked with shellcheck
deno task test:ts            # the offline TS tests only — static + parity, no shellcheck needed
deno task ci                 # what CI runs: lint + fmt:check + test:offline
```

**Needs an agent** — spawns the selected host, requires its credential, costs model calls, can
flake. The default host is `claude`; the `:opencode` twins run the same cases on OpenCode:

```bash
deno task test:agent                  # the whole live tier on the default host
deno task test:agent:smoke            # one bare completion — run this first
deno task test:agent:workers          # 3 worker cases, one per worker
deno task test:agent:unattended       # the three gates resolving with nobody there
deno task test:agent:resume           # tag permanence + the rule axis across a resume
deno task test:agent:trigger          # the directed trigger pair
deno task test:integration            # everything, incl. the full orchestration cycle (slow)

# per-host matrices — the same cases, one host each:
deno task test:matrix:claude          # smoke + whole tier + integration, on Claude Code
INGRAIN_TESTS_AGENT_HOST=opencode deno task test:agent:workers   # one narrow task on OpenCode
deno task test:matrix:opencode        # smoke + whole live tier + integration, on OpenCode
```

The `:opencode` twins grant `--allow-run=opencode,bash,ingrain` and set the host env in one task;
the granular tasks carry the same permission flags within their host group (asserted by
`parity/taskWiring.test.ts`).

**Run one file rather than the tier.** The live tier is minutes and real money (measured on OpenCode
with the machine's default model: workers ~3 min, trigger ~6 min, unattended ~53 min — six full
cycles), so touching one subject should not mean paying for all of it. The granular tasks above are
the scoping mechanism; `--filter` exists on the scenario twins for a single test:

```bash
deno task test:agent:unattended:medium        # one band, whole-file invocation
deno task test:agent:unattended:medium:opencode   # one band, opencode host
```

Each tier's Deno permissions double as a capability tag: `test:static` gets `--allow-read` only and
the offline tiers grant no model access, so a test that reaches for the model from one fails on a
permission error instead of quietly calling it. Keep the tiers as separate `deno test` invocations
rather than merging their permission sets.

`deno task fmt` / `deno task lint` format and lint the suite.

## CI

`.github/workflows/ci.yml` runs the **no-agent** tier on pull requests into `main` and
`development`, and on pushes to `main`, as a single `deno task ci` (from `tests/`) — lint +
fmt:check + static + parity + shell. CI runs the same command you do, so it holds no test logic of
its own that could drift from this suite.

Its only other step installs **ShellCheck** at a pinned version, because `shell/shellcheck.test.ts`
shells out to it. Pinning keeps the lint reproducible: the runner image's preinstalled copy could
vanish, or move to a release whose new checks turn an unrelated PR red.

The agent tiers need credentials and cost model calls, so they stay local: run
`deno task test:agent` (and, before the CI integration lands, `test:matrix:opencode` — the host the
product rides) yourself before opening a PR.

## Tiers & rough cost

| Command                  | Needs an agent? | Model calls               | Time                                    | Auth |
| ------------------------ | --------------- | ------------------------- | --------------------------------------- | ---- |
| `test:static`            | no              | 0                         | < 1s                                    | no   |
| `test:parity`            | no              | 0                         | < 1s                                    | no   |
| `test:shell`             | no              | 0                         | < 1s                                    | no   |
| `test:ts`                | no              | 0                         | < 1s                                    | no   |
| `test:offline`           | no              | 0                         | < 1s                                    | no   |
| `ci` (+ lint, fmt:check) | no              | 0                         | a few s                                 | no   |
| `test:agent:smoke`       | yes             | 1 bare completion         | < 30s                                   | yes  |
| `test:agent:workers`     | yes             | 3 worker cases            | ~2 min (claude) · ~3 min (opencode)     | yes  |
| `test:agent:trigger`     | yes             | 2 directed reviews        | ~5 min (claude) · ~6 min (opencode)     | yes  |
| `test:agent:resume`      | yes             | 2, one a full cycle       | ~5 min                                  | yes  |
| `test:agent:unattended`  | yes             | 6 full cycles             | ~15 min (claude) · ~53 min (opencode)   | yes  |
| `test:agent`             | yes             | all 13 of the above       | 15–25 min (claude) · ~70 min (opencode) | yes  |
| `test:integration`       | yes             | + full cycle to the gates | 5–20 min                                | yes  |

`test:agent` is the sum of the five granular tasks above it, so reach for the narrow one: the
unattended tier alone is most of the tier's cost, and a change to the band table needs nothing else.
OpenCode times are measured on the machine's configured model (`berget/zai-org/GLM-5.3-Flash` at the
time of writing — record what your run used) and scale with that model; `ingrain-security` specifies
no model.

## Notes

- Live tests call the model, so an occasional flake is possible; re-run a single test with
  `--filter`. Assertions check shape, not exact wording, to minimize this.
- Each worker is dispatched by inlining its
  `skills/ingrain-security/references/development/<name>.md` body (via `workerDispatchPrompt` in
  `lib/runners/shared.ts`); on Claude Code the plugin is loaded via `--plugin-dir` pointing at the
  repo root, and tools are restricted to `Read,Grep,Glob,Write,Edit` — on OpenCode the equivalent
  grants live in the staged per-case config.
- The orchestration test deliberately does **not** answer the interactive gate prompts — headless
  mode has no human — so it asserts the run _reaches_ the user gates and stops there, on the threat
  axis and the rule axis alike.
- **It does answer two things up front, and neither is a gate.** The flow asks the subagent request
  (`references/lib/dispatch.md`) and Step 0's review question _before_ the driver gates, and
  headless has no reply channel for either — so an unanswered run stops there and the tier measures
  a review that never started. The invoking prompt supplies both, which `dispatch.md` names as
  sufficient for the first: a request already in the prompt _is_ the request.
- **Even so, about half of headless runs stop before dispatching, and the tier announces that rather
  than failing.** Whether a session acts on those answers or stops to ask them anyway is
  model-dependent; measured on this exact prompt it is roughly 50/50. A skipped run prints several
  lines naming which half it was, what still ran and what did not. The halt assertions run **first
  and unconditionally** — they read the assessment file, so they hold either way — and only the
  choreography half is skipped. One shape of it is **not** skipped: threats written with no subagent
  tool seen means the work happened through something the harness does not recognise, which shouts
  instead.
- **The subagent tool's NAME is a live dependency of this suite.** `dispatchedWorkers` filters the
  host-normalized tool uses by name, so a host rename empties it — turning every positive dispatch
  assertion red and every negative one **vacuous**. It happened: Claude Code's tool became `Agent`
  while the detector still matched `Task`. `SUBAGENT_TOOLS` in `lib/matchers.ts` now carries the
  names both hosts have shipped (`Agent`, `Task`, `task`), and the orchestration tier opens with a
  canary that fails loudly, naming that constant, when a run used no subagent tool at all.
