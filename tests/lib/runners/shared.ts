/**
 * The harness's shared core — everything about driving a live review that is true of every
 * host. Backends (`lib/runners/claude.ts`, `lib/runners/opencode.ts`) import from here; the
 * registry (`lib/runners/index.ts`) is the only module allowed to import a backend.
 */

import { fromFileUrl } from "@std/path";
import type {
  IRunBackend,
  RunOptions,
  RunResult,
  StreamEvent,
  THostBackend,
  TToolUse,
} from "../types.ts";

/** Repo root = three levels up from this file (tests/lib/runners/shared.ts). */
export const PLUGIN_DIR = fromFileUrl(new URL("../../..", import.meta.url));

/**
 * Per-call timeouts (ms), shared across hosts.
 */
export const AGENT_TIMEOUT_MS = 120_000; // single-agent default
export const SESSION_TIMEOUT_MS = 180_000; // full session (skill + agents)
export const ORCHESTRATION_TIMEOUT_MS = 600_000; // full gated cycle

/**
 * Turn caps — the tier's budgets, *exercised* by the Claude backend's `--max-turns`.
 * OpenCode ships no turn flag at 1.18.31, so a case's `maxTurns` is ignored there and its
 * run is bounded by the matching timeout instead; the budgets below are the one calibration
 * both hosts are held to.
 *
 * `SESSION_MAX_TURNS` was 4, calibrated back when a session hook inlined `SKILL.md` and the
 * agent could route straight from context. Nothing injects context any more — the plugin ships
 * no hooks — so the skill body arrives only when the Skill tool loads it. That is one extra
 * round trip before the run can reach a verdict, and at 4 the minor-plan test ran out of turns
 * mid-tool-call and returned no text at all. The cap absorbs the round trip; the cycle guard
 * still holds well inside ORCHESTRATION_MAX_TURNS.
 *
 * `ORCHESTRATION_MAX_TURNS` was 30, calibrated on runs that never dispatched a worker at all —
 * the subagent gate went unanswered, so the run stopped at the questions and 30 was generous.
 * With the request supplied in the prompt the tier finally reaches the fan-out it exists to
 * check, and a measured run spent its 30 turns still writing the threat list. This is the
 * budget to the gates plus room for the one conditional revision round; a run that needs more
 * than this has a real problem worth failing on.
 *
 * Exported from the Claude backend as well (same numbers); these live here because they are
 * the tier's calibration, not that host's configuration.
 */
export const SESSION_MAX_TURNS = 8;
export const ORCHESTRATION_MAX_TURNS = 60;

/**
 * Time budgets are claude-calibrated; OpenCode drives the machine's default model through a
 * different runtime, and the same case measured materially slower there. The scale multiplies
 * each case's timeout in the backend whose runtime is slower — the budget semantics stay one
 * (a case E should take about this long on its host), so the numbers are stated once, here.
 *
 * Measured: the user-asked trigger case, killed at 240s on OpenCode mid-review, completes
 * comfortably inside 3× on the machine's configured model.
 */
export const HOST_TIMEOUT_SCALE: Record<THostBackend, number> = {
  claude: 1,
  opencode: 3,
};

/** The environment variable the granular deno tasks set to select a host. */
export const HOST_ENV_VAR = "INGRAIN_TESTS_AGENT_HOST";

const HOSTS: readonly THostBackend[] = ["claude", "opencode"];

/**
 * Resolve the host for a run.
 *
 * Precedence: the per-call option, then the environment the invoking task set, then `claude`
 * — so existing call sites keep working unchanged and `test:agent` never changes host just
 * because a variable happens to be exported. An unknown value throws, naming the valid set:
 * a typo'd task must fail loudly here rather than silently fall back to a different host.
 */
export const resolveHost = (opts?: { host?: THostBackend }): THostBackend => {
  if (opts?.host) return opts.host;
  const fromEnv = Deno.env.get(HOST_ENV_VAR);
  if (!fromEnv) return "claude";
  if ((HOSTS as readonly string[]).includes(fromEnv)) return fromEnv as THostBackend;
  throw new Error(
    `${HOST_ENV_VAR}=${JSON.stringify(fromEnv)} names no backend — valid hosts: ${
      HOSTS.join(", ")
    }`,
  );
};

/**
 * Run one prompt through the registry-resolved backend. The single entry point tests use.
 */
export const runPrompt = (
  prompt: string,
  opts: RunOptions = {},
): Promise<RunResult> => getRunnerImpl(resolveHost(opts)).run(prompt, opts);

// Set by index.ts at load. Declared optional so this module has no import-time dependency on
// a backend; `runPrompt` is the only consumer and fails loud if the registry never installed.
let registry: ((host: THostBackend) => IRunBackend) | undefined = undefined;

/** @internal — called once by `index.ts`; not for backends or tests. */
export const installRegistry = (get: (host: THostBackend) => IRunBackend): void => {
  registry = get;
};

const getRunnerImpl = (host: THostBackend): IRunBackend => {
  if (!registry) throw new Error("runner registry not installed — import lib/runners/index.ts");
  return registry(host);
};

/** The `--host` value each backend mints with — part of the branch-scoped artifact naming. */
export const mintHost = (host: THostBackend): string => host; /**
 * Mint a real assessment file in a throwaway project dir and return both paths.
 *
 * Drives the real minter rather than hand-building a path or a skeleton, so a live worker
 * fills the same seeded structure it would fill in a real run. The project root resolves from
 * `cwd`, never from a host-specific environment variable — the fallback
 * `cli/lib/git/projectRoot.ts` already implements, and the delta tests pin.
 *
 * **Requires the `ingrain` CLI on PATH**, which the live tier needs anyway — the skill it is
 * exercising cannot run without it. A missing binary fails here with that stated, rather than
 * further in with an empty assessment.
 */

export const mintAssessment = async (
  projectDir: string,
  title: string,
  host: THostBackend,
): Promise<{ assessmentAbs: string; json: Record<string, unknown> }> => {
  const out = await new Deno.Command("ingrain", {
    args: ["assessment", "mint", "--host", mintHost(host), "--title", title],
    clearEnv: true,
    env: {
      PATH: Deno.env.get("PATH") ?? "",
      HOME: Deno.env.get("HOME") ?? "",
    },
    cwd: projectDir,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (out.code !== 0) {
    throw new Error(`assessment mint failed: ${new TextDecoder().decode(out.stderr)}`);
  }
  const minted = JSON.parse(new TextDecoder().decode(out.stdout)) as Record<string, unknown>;
  // The whole object, not just the path: the mint is the authority for the gating thresholds
  // too, and a test mirroring those numbers would be an unpinned copy of them.
  return { assessmentAbs: minted.assessment_abs as string, json: minted };
};

/**
 * Build the dispatch prompt for a single worker, mirroring what the orchestrator
 * sends: the worker's own reference-file body (frontmatter stripped) as the
 * system prompt, then the INPUT. Lets a live test exercise one worker in
 * isolation without a platform-native agent definition.
 *
 * `assessmentAbs` supplies the per-run write target the orchestrator pastes into
 * every dispatch (references/development/flow.md § How to dispatch a worker). It is the one thing a worker
 * cannot learn from its own reference file, so without it the worker has nowhere to
 * write and answers inline instead.
 */
export const workerDispatchPrompt = async (
  name: string,
  input: string,
  assessmentAbs?: string,
): Promise<string> => {
  const md = await Deno.readTextFile(
    `${PLUGIN_DIR}/skills/ingrain-security/references/development/${name}.md`,
  );
  const body = md.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
  const writeTarget = assessmentAbs
    ? [
      "",
      `Your ONE permitted write is your own section of the stored analysis file for`,
      `this run at ${assessmentAbs}, written to the schema in`,
      `references/lib/assessment-file.md — use exactly its fields and enum values.`,
      `Write to that exact absolute path, character for character as pasted above.`,
    ]
    : [];
  return [
    `You have been dispatched as the \`${name}\` worker of the ingrain-security`,
    `review. Follow the instructions below as your system prompt, act on the`,
    `INPUT, and return only what the Output section specifies.`,
    ...writeTarget,
    "",
    body,
    "",
    "INPUT:",
    input,
  ].join("\n");
};

/** The Bash-equivalent tool name(s) each host carries; backends pick theirs from here. */
export const BASH_TOOL_NAMES: Record<THostBackend, readonly string[]> = {
  claude: ["Bash"],
  opencode: ["bash"],
};

/** Shell commands among normalized tool uses, for the backend's own tool naming. */
export const commandsFromUses = (
  uses: readonly TToolUse[],
  toolNames: readonly string[],
): string[] =>
  uses
    .filter((u) => toolNames.includes(u.name))
    .map((u) => String(u.input.command ?? ""))
    .filter((c) => c.length > 0);

/** Parse newline-delimited JSON events, skipping non-JSON lines. Shared by both taps. */
export const parseNdjson = (raw: string): StreamEvent[] => {
  const events: StreamEvent[] = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    try {
      events.push(JSON.parse(t));
    } catch {
      // ignore partial/non-JSON lines
    }
  }
  return events;
};
