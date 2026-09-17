/**
 * **Every command the skill runs must be one its frontmatter grants.**
 *
 * `allowed-tools` is what replaced the two deleted `allow-assessment-write` hooks, and it is
 * an enumeration — so it fails the way enumerations fail: silently, and only on a host that
 * enforces it. The gap this tier exists to close shipped once already. `ingrain --version` is
 * the review's opening probe, it was in no granted pattern, and `SKILL.md`'s own failure branch
 * routes any failure of it to *"the CLI is not on PATH"* — so a permission denial would have
 * been reported as a missing binary and aborted the whole review with a remedy for a problem
 * the user does not have.
 *
 * Nothing else could see it. The monorepo's `documentedInvocations` tier **executes** the
 * fences, so it never consults the frontmatter at all; a live agent test would need a host
 * that enforces the field. This is a text-against-text check, which is the only kind that
 * catches it offline.
 */

import { assertEquals, assertGreaterOrEqual } from "@std/assert";
import { walk } from "@std/fs";
import { fromFileUrl } from "@std/path";

const SKILL_ROOT = fromFileUrl(
  new URL("../../skills/ingrain-security/", import.meta.url),
);

/** The fence info-string marking a block as commands the agent is told to run. */
const FENCE_TAG = "ingrain-script";

/**
 * The `Bash(...)` patterns in the frontmatter's `allowed-tools`.
 *
 * Read from the raw text rather than through a YAML parser: the value is a folded scalar
 * spanning several lines, and what matters is the set of patterns, not the document shape.
 */
const grantedBashPatterns = (skill: string): string[] => {
  const field = skill.match(/^allowed-tools:([\s\S]*?)^---$/m)?.[1] ?? "";
  return [...field.matchAll(/Bash\(([^)]*)\)/g)].map((m) => m[1]);
};

/**
 * Does `command` fall under `pattern`?
 *
 * `foo:*` is a prefix grant over the command's leading tokens; anything else is exact. That
 * is the host's own rule, kept deliberately narrow — a looser reading here would let this
 * gate pass on a grant the host would still refuse, which is the one way it could mislead.
 */
const covers = (pattern: string, command: string): boolean => {
  if (!pattern.endsWith(":*")) return pattern === command;
  const prefix = pattern.slice(0, -2);
  return command === prefix || command.startsWith(`${prefix} `);
};

/** Every command line inside every `ingrain-script` fence, across the agent-facing docs. */
const fenceCommands = async (): Promise<string[]> => {
  const commands: string[] = [];
  for await (const entry of walk(SKILL_ROOT, { exts: [".md"] })) {
    if (!entry.isFile) continue;
    let inFence = false;
    for (const raw of (await Deno.readTextFile(entry.path)).split("\n")) {
      const marker = raw.trimStart();
      if (marker.startsWith("```")) {
        inFence = !inFence && marker.slice(3).trim() === FENCE_TAG;
        continue;
      }
      if (inFence && raw.trim()) commands.push(raw.trim());
    }
  }
  return commands;
};

const SKILL = await Deno.readTextFile(`${SKILL_ROOT}SKILL.md`);
const COMMANDS = await fenceCommands();
const PATTERNS = grantedBashPatterns(SKILL);

Deno.test("allowed-tools: the frontmatter grants Bash at all", () => {
  // Without this the whole file passes by finding nothing — a renamed field or a reflowed
  // frontmatter would make every assertion below vacuous rather than failing.
  assertGreaterOrEqual(
    PATTERNS.length,
    4,
    `expected Bash() grants in \`allowed-tools\`; found ${PATTERNS.length}`,
  );
  assertGreaterOrEqual(
    COMMANDS.length,
    4,
    `expected \`${FENCE_TAG}\` fences to yield commands; found ${COMMANDS.length}`,
  );
});

Deno.test("allowed-tools: every fenced command is granted", () => {
  const ungranted = COMMANDS.filter((command) =>
    !PATTERNS.some((pattern) => covers(pattern, command))
  );
  assertEquals(
    ungranted,
    [],
    "the skill tells the agent to run these and the frontmatter grants none of them, so on a " +
      `host that enforces \`allowed-tools\` each prompts or is denied:\n  ${
        ungranted.join("\n  ")
      }`,
  );
});

/**
 * The commands the prose prescribes outside a runnable fence.
 *
 * They sit in plain ```` ```bash ```` blocks because they need configuration or the network,
 * which is why the monorepo's executing tier correctly leaves them alone — and is exactly why
 * their grant is checked nowhere else. `validate` is the one that matters: it is the stated
 * remedy for a malformed artifact, so it is reached on the path where the run is already
 * degraded.
 */
const PRESCRIBED = [
  "ingrain --version",
  "ingrain validate",
  "ingrain context security_rules",
  "ingrain record design",
  "ingrain record verification",
  "ingrain assessment mint",
  "ingrain assessment retag",
  "ingrain delta",
  "ingrain delta diff",
];

Deno.test("allowed-tools: every command the skill can reach is granted", () => {
  const ungranted = PRESCRIBED.filter((command) =>
    !PATTERNS.some((pattern) => covers(pattern, command))
  );
  assertEquals(
    ungranted,
    [],
    `granted by no \`allowed-tools\` pattern:\n  ${ungranted.join("\n  ")}`,
  );
});

/**
 * **The OpenCode harness's grants cover the same enumeration.**
 *
 * The OpenCode backend rides the machine's OpenCode and contributes its own permission grants
 * through `OPENCODE_CONFIG` (see `lib/runners/opencode.ts`). That grant list is this file's
 * frontmatter check in the other host's grammar — so it must cover the commands the skill
 * prescribes, derived from the same `PRESCRIBED` set rather than retyped. Importing it from a
 * backend module is the point and not a leak: the *shared* modules may not import a backend,
 * but a test file asserting one backend's contract may read its exported constant.
 */
Deno.test("allowed-tools: the opencode harness grants cover the prescribed command set", async () => {
  const opencode = await import("../lib/runners/opencode.ts");
  const bashGrants = Object.keys(
    (opencode.HARNESS_GRANTS.permission as Record<string, unknown>).bash as Record<
      string,
      unknown
    >,
  );

  assertGreaterOrEqual(bashGrants.length, 1, "the opencode staging grants parsed as empty");

  const ungranted = PRESCRIBED.filter((command) =>
    !bashGrants.some((g) => g === command || g === "ingrain *" && command.startsWith("ingrain "))
  );
  assertEquals(
    ungranted,
    [],
    "the skill prescribes these and the opencode harness grants none of them, so a headless " +
      `run would stall on an ask it has no reply channel for:\n  ${ungranted.join("\n  ")}`,
  );
});
