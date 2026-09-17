/**
 * The OpenCode backend — the host the product's CI rides (Phase 5 bakes it into the image and
 * scripts the review as an `opencode run` inside the sandbox), driven locally here.
 *
 * **The harness runs OpenCode as configured on the developer's machine.** Providers, auth,
 * plugins, agents and the resolved default model are the machine's own, the same way the
 * Claude backend uses the caller's login. What this backend stages is one per-case `$HOME`
 * whose global config is the machine's global config deep-merged with the harness's
 * contribution — the skill's registration and the headless permission grants — plus staged
 * cache/state, so runs share nothing between themselves and write nothing into the machine.
 *
 * Measured on the pinned release (1.18.31), each bought with a run:
 * - `run --format json` streams NDJSON events — `part.type === "text"` carries assistant text,
 *   `type === "tool_use"` with `part.tool`/`part.state.input` carries a tool call. There is no
 *   turn-count flag, so runs are bounded by timeout alone.
 * - `run` reads the prompt from a positional argument; there is no stdin channel.
 * - **`skills.paths` is honoured only from the global config.** Set through an
 *   `OPENCODE_CONFIG` additional file it does not register the skill — `debug skill` lists
 *   nothing new, and a run behaves as if no skill existed. Hence the staged-home merge rather
 *   than the additional config the spike had suggested.
 * - `--auto` approves permissions that are not explicitly denied. Headless runs have no reply
 *   channel for an `ask`, and the trigger tests are the skill's own drive-by-mint, not a
 *   permission test — the staged grants carry intent, `--auto` guarantees headlessness, and
 *   explicit machine denials still hold.
 * - `XDG_DATA_HOME` must stay the machine's: a redirected data dir strands `auth.json`, and
 *   every provider unauthenticates. Machine data, staged config.
 */

import { HOST_TIMEOUT_SCALE, parseNdjson, PLUGIN_DIR } from "./shared.ts";
import type { IRunBackend, RunOptions, RunResult, StreamEvent, TToolUse } from "../types.ts";

/** Where the skill tree lives in this checkout — registered by `skills.paths`, never copied. */
export const SKILLS_DIR = `${PLUGIN_DIR}/skills`;

/**
 * The harness's own config contribution, exported for the static grant-coverage check
 * (`static/harness.test.ts`) so the granted set has exactly one definition.
 *
 * Deliberately narrow: nothing here re-declares what the machine already allows (`read`,
 * `edit`, the everyday shell tools), because a blanket `read: "allow"` would REPLACE the
 * machine's own `*.env` denials on merge and widen exactly what must not widen. The keys set
 * are the ones the skill needs that are absent or `ask`-gated on a stock machine: the `ingrain`
 * CLI itself, the subagent dispatch (`task`), the Skill tool, and the checklist.
 */
export const HARNESS_GRANTS = {
  skills: { paths: [SKILLS_DIR] },
  permission: {
    bash: {
      "ingrain": "allow",
      "ingrain *": "allow",
    },
    task: "allow",
    skill: "allow",
    todowrite: "allow",
  },
} as const;

/**
 * The machine's global OpenCode config — read, never written. The staged home deep-merges it
 * with the harness's contribution below.
 */
const machineGlobalConfig = (): string => {
  const xdg = Deno.env.get("XDG_CONFIG_HOME");
  const home = Deno.env.get("HOME") ?? "";
  const dir = xdg ? `${xdg}/opencode` : `${home}/.config/opencode`;
  return `${dir}/opencode.json`;
};

/**
 * Merge the harness's needs ON TOP of the machine's global config, without widening what the
 * machine denies.
 *
 * Per top-level key: a key the machine sets wins unless it is an OBJECT the harness extends —
 * `permission` per tool, and `permission.bash` per pattern. Machine scaları (`read: "allow"` with
 * `*.env` denials, an `edit` deny) are copied untouched; harness keys are only ever ADDED, and
 * only where a strict fan-in allows it (object patterns appended after — OpenCode evaluates the
 * last matching rule, so our `ingrain *` allows sit after the machine's `"*": "ask"` and win
 * nothing broader than the CLI).
 *
 * `skills` is harness-owned unless the machine already sets it (measured: `skills.paths` in an
 * `OPENCODE_CONFIG` additional file does NOT register the skill — it only takes from the
 * global config — which is why this file is merged into the staged global config rather than
 * passed as an additional one).
 */
export const mergeHarnessConfig = (
  machine: Record<string, unknown>,
): Record<string, unknown> => {
  const merged: Record<string, unknown> = { ...machine };
  const machinePerms = (merged.permission ?? {}) as Record<string, unknown>;
  const harnessPerms = HARNESS_GRANTS.permission as Record<string, unknown>;

  const permission: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(machinePerms), ...Object.keys(harnessPerms)]);
  for (const key of keys) {
    const machineValue = machinePerms[key];
    const harnessValue = harnessPerms[key];
    if (isRecord(machineValue) && isRecord(harnessValue)) {
      // Appended, not replaced: the machine's rules stay first, ours last.
      permission[key] = { ...machineValue, ...harnessValue };
    } else if (machineValue !== undefined) {
      // The machine has an opinion — even a deny — and it wins.
      permission[key] = machineValue;
    } else {
      permission[key] = harnessValue;
    }
  }

  const machineSkills = (merged.skills ?? {}) as Record<string, unknown>;
  merged.skills = {
    ...machineSkills,
    paths: [
      ...(HARNESS_GRANTS.skills.paths as readonly string[]),
      ...((machineSkills.paths as readonly string[]) ?? []),
    ],
  };
  merged.permission = permission;
  return merged;
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Stage the per-case OpenCode home: a throwaway `$HOME` whose global config is the machine's
 * config merged with the harness's contribution, so the skill is registered and headless
 * grants are in place while providers, plugins, agents and the resolved default model remain
 * exactly the machine's. Auth stays the machine's too — `XDG_DATA_HOME` is pinned to the real
 * data home, because a redirected data dir would strand `auth.json` and unauthenticate every
 * provider. Cache and state are staged, so no state leaks into the machine between runs.
 *
 * Machine-denied permissions are never widened; see `mergeHarnessConfig`.
 */
export const stageHome = async (): Promise<{
  home: string;
  config: Record<string, unknown>;
}> => {
  const home = await Deno.makeTempDir({ prefix: "ingrain-opencode-home-" });
  const configDir = `${home}/.config/opencode`;
  await Deno.mkdir(configDir, { recursive: true });

  const machineText = await Deno.readTextFile(machineGlobalConfig()).catch(
    () => "",
  );
  const machine = machineText.trim().length > 0
    ? JSON.parse(machineText) as Record<string, unknown>
    : {};
  const config = mergeHarnessConfig(machine);
  await Deno.writeTextFile(`${configDir}/opencode.json`, `${JSON.stringify(config, null, 2)}\n`);

  return { home, config };
};

/** The environment a staged-home run needs, over whatever the caller's own is. */
export const stageEnv = async (): Promise<Record<string, string>> => {
  const { home } = await stageHome();
  const machineData = Deno.env.get("XDG_DATA_HOME") ??
    `${Deno.env.get("HOME")}/.local/share`;
  return {
    HOME: home,
    XDG_CONFIG_HOME: `${home}/.config`,
    // The machine's real data dir holds auth.json and the provider credentials; staging it
    // would strand them. Machine data, staged config.
    XDG_DATA_HOME: machineData,
    XDG_CACHE_HOME: `${home}/.cache`,
    XDG_STATE_HOME: `${home}/.local/state`,
  };
};

/** Parse OpenCode's NDJSON event stream (measured shape — see the module doc). */
export const parseOpenCodeEvents = parseNdjson;

const toolUsesFromStream = (events: StreamEvent[]): TToolUse[] => {
  const uses: TToolUse[] = [];
  for (const ev of events) {
    if (ev.type !== "tool_use") continue;
    const part = ev.part as Record<string, unknown> | undefined;
    if (part?.type !== "tool") continue;
    const state = part.state as Record<string, unknown> | undefined;
    uses.push({
      name: String(part.tool ?? ""),
      // deno-lint-ignore no-explicit-any
      input: (state?.input ?? {}) as any as Record<string, unknown>,
    });
  }
  return uses;
};

const streamText = (events: StreamEvent[]): string =>
  events
    .filter((ev) => {
      const part = ev.part as Record<string, unknown> | undefined;
      return ev.type === "text" && part?.type === "text";
    })
    // deno-lint-ignore no-explicit-any
    .map((ev) => String((ev.part as any).text ?? ""))
    .join("\n");

/**
 * Run `opencode run` with the given prompt and options.
 *
 * No HOME/XDG redirection and no credential staging: the machine's OpenCode is the backend's
 * provider configuration, the same way the Claude backend is the caller's login. The prompt
 * travels as a positional argument (the measured channel — `--format json` holds stdout), and
 * the per-case config arrives only through `OPENCODE_CONFIG`.
 */
export const runOpenCode = async (prompt: string, opts: RunOptions = {}): Promise<RunResult> => {
  const staged = await stageEnv();

  const args = ["run"];
  args.push(`--title`, `ingrain-agent-tier`);
  if (opts.streamJson) args.push("--format", "json");
  args.push("--auto");
  if (opts.model) args.push("--model", opts.model);
  // Measured: opencode does not reliably bind a session to the spawn cwd — with an empty
  // fixture it substitutes the invoking process's directory, and under the staged env it did
  // so even with a git-inited fixture. The host's own `--dir` flag is what binds it; `cwd`
  // stays set for the CLI's own relative resolution.
  if (opts.cwd) args.push("--dir", opts.cwd);
  // The prompt travels as the positional message — the measured channel: `--format json`
  // occupies stdout, and `run` reads no stdin.
  args.push(prompt);

  // OpenCode has no `--max-turns`; its runs are bounded by timeout alone, scaled per host —
  // budgets are stated once, claude-calibrated, and the slower runtime here is a multiplier
  // (see `HOST_TIMEOUT_SCALE`), not a second set of numbers to calibrate again.
  const timeoutMs = (opts.timeoutMs ?? AGENT_TIMEOUT_FALLBACK) *
    HOST_TIMEOUT_SCALE.opencode;
  const signal = AbortSignal.timeout(timeoutMs);
  const cmd = new Deno.Command("opencode", {
    args,
    cwd: opts.cwd,
    // The staged home IS the machine's OpenCode configuration: providers, plugins, agents and
    // the resolved default model are copied into it, auth stays the machine's through
    // XDG_DATA_HOME, and the harness adds only the skill registration and the headless
    // grants. `opts.env` adds the one or two variables a case is about.
    env: { ...staged, ...opts.env },
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
    signal,
  });

  const out = await cmd.output().catch((e) => {
    if (e instanceof DOMException && e.name === "TimeoutError") {
      throw new Error(
        `opencode timed out after ${timeoutMs}ms — a run that ` +
          `stops on an unanswered permission ask has no reply channel headless; the staged ` +
          `grants plus --auto are what keep it moving`,
      );
    }
    throw e;
  });

  await Deno.remove(staged.HOME, { recursive: true });

  const stdout = new TextDecoder().decode(out.stdout);
  const stderr = new TextDecoder().decode(out.stderr);
  const events = opts.streamJson ? parseOpenCodeEvents(stdout) : [];
  const uses = events.length > 0 ? toolUsesFromStream(events) : [];
  const text = opts.streamJson ? streamText(events) : stdout;

  return { code: out.code, stdout, stderr, host: "opencode", events, uses, text };
};

/** OpenCode ships no `--max-turns`; its per-call default is the session budget, not one agent. */
const AGENT_TIMEOUT_FALLBACK = 180_000;

/**
 * The credential smoke — one completion against the machine's resolved default model, gated on
 * *completion* (exit 0, non-empty text), never on the model echoing a trivia token. Runs the
 * real spawn shape, `OPENCODE_CONFIG` included, so a config-shape break fails here with the
 * remedy rather than inside the first scenario case after it has spent its budget.
 */
export const smokeOpenCode = async (timeoutMs = AGENT_TIMEOUT_FALLBACK): Promise<void> => {
  const r = await runOpenCode(
    "Reply with the word PONG and nothing else.",
    { timeoutMs },
  );
  if (r.code !== 0 || r.text.trim().length === 0) {
    throw new Error(
      `opencode credential smoke failed (exit ${r.code}) — run \`opencode providers list\` to ` +
        `confirm a logged-in provider resolves a default model, and \`opencode run --format ` +
        `json --auto "Reply PONG"\` by hand if it still fails`,
    );
  }
};

/** The OpenCode spelling of the backend contract. */
export const opencodeBackend: IRunBackend = {
  host: "opencode",
  run: runOpenCode,
  bashCommands: (uses) =>
    uses
      .filter((u) => u.name === "bash")
      .map((u) => String(u.input.command ?? ""))
      .filter((c) => c.length > 0),
};
