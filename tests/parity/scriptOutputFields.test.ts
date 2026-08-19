/**
 * **A script's output contract, checked against both ends at once.**
 *
 * A script emits ~20 JSON keys; only some are the agent's to keep, and the rest are
 * diagnostic. That split is a decision, not something derivable from the `printf`, so each
 * script declares it in a `CONTRACT KEYS` block in its own header. This tier holds the two
 * ends to that declaration:
 *
 * - **code side** — every declared key is really emitted, so a key cannot be renamed in the
 *   `printf` while the header still promises the old name;
 * - **docs side** — every declared key is really named in `SKILL.md` or `references/`, so a
 *   key cannot be added to the contract without telling the agent it exists.
 *
 * Neither direction is checkable from one file, which is why nothing caught this before.
 *
 * The route enum gets the same treatment, in both directions: every `phase` and
 * `phase_reason` value `resolve_phase` can produce must be documented, and the `phase_reason`
 * table must name no value the script cannot produce. A documented route that cannot happen
 * sends the agent looking for a state that does not exist; an undocumented one strands it.
 */

import { assertEquals, assertGreaterOrEqual } from "@std/assert";
import { walk } from "@std/fs";
import { fromFileUrl } from "@std/path";

const ROOT = fromFileUrl(new URL("../../", import.meta.url));
const SKILL_ROOT = `${ROOT}skills/ingrain-security/`;
const SCRIPTS = `${SKILL_ROOT}scripts/`;

/**
 * The scripts that emit an agent-facing JSON contract. Each holds its OWN `printf`: the libs
 * are flat leaves, so chaining them — and emitting the result — is the script's job. This
 * used to pair a script with a separate emitter file, back when `lib/mint.sh` carried the
 * whole composition.
 */
const EMITTERS: ReadonlyArray<string> = ["assessment-mint", "branch-delta"];

/** The label a minter interpolates into its `"%s_abs"`-style keys. One label remains. */
const LABEL = "assessment";

/** Read the `CONTRACT KEYS BEGIN … END` block a script declares in its header. */
async function contractKeys(script: string): Promise<string[]> {
  const text = await Deno.readTextFile(`${SCRIPTS}${script}`);
  const block = text.match(/# CONTRACT KEYS BEGIN\n([\s\S]*?)# CONTRACT KEYS END/);
  if (!block) throw new Error(`${script} declares no CONTRACT KEYS block`);
  return block[1].replaceAll("#", " ").split(/\s+/).filter(Boolean).sort();
}

/**
 * Every JSON key a file's `printf` format strings emit. Reads the format string rather than
 * running the script, so a key emitted only on a branch this harness never reaches still
 * counts — a contract key is no less real for being conditional.
 */
async function emittedKeys(script: string): Promise<Set<string>> {
  const text = await Deno.readTextFile(`${SCRIPTS}${script}`);
  const keys = [...text.matchAll(/"([a-z_%s]+)":/g)].map((m) => m[1]);
  // `"%s_dir"` and friends are label-parameterized; resolve them the way a caller sees them.
  return new Set(keys.map((k) => k.replace(/^%s/, LABEL)));
}

/** `SKILL.md` plus every reference file — the docs an agent actually reads. */
async function agentFacingText(): Promise<string> {
  let text = await Deno.readTextFile(`${SKILL_ROOT}SKILL.md`);
  for await (const entry of walk(`${SKILL_ROOT}references`, { exts: [".md"] })) {
    if (entry.isFile) text += await Deno.readTextFile(entry.path);
  }
  return text;
}

const DOC_TEXT = await agentFacingText();

for (const script of EMITTERS) {
  Deno.test(`${script}: every contract key is really emitted`, async () => {
    const declared = await contractKeys(script);
    const emitted = await emittedKeys(script);
    assertGreaterOrEqual(declared.length, 5, `${script}'s CONTRACT KEYS block parsed as empty`);
    assertEquals(
      declared.filter((key) => !emitted.has(key)),
      [],
      `declared in ${script}'s header but emitted by no printf in the script — ` +
        `the header promises the agent a field it will never receive`,
    );
  });

  Deno.test(`${script}: every contract key is really documented`, async () => {
    const declared = await contractKeys(script);
    assertEquals(
      declared.filter((key) => !DOC_TEXT.includes(`\`${key}\``)),
      [],
      `emitted and declared as contract, but named in no agent-facing doc — nothing tells ` +
        `the agent this field exists, so it is contract in name only`,
    );
  });

  Deno.test(`${script}: the docs name no emitted key the contract omits`, async () => {
    const declared = await contractKeys(script);
    const emitted = await emittedKeys(script);
    // The reverse direction, and the one that was missing: a key can be explained to the
    // agent in a reference file while the header still files it under diagnostic. It stays
    // allowlist-free because the EMITTED set bounds what can count as a field reference, so
    // ordinary backticked prose is never mistaken for one.
    assertEquals(
      [...emitted]
        .filter((key) => DOC_TEXT.includes(`\`${key}\``) && !declared.includes(key))
        .sort(),
      [],
      `named in an agent-facing doc but absent from ${script}'s CONTRACT KEYS — either it is ` +
        `contract and belongs in the list, or the doc should not be telling the agent about it`,
    );
  });
}

Deno.test("phase select: the docs name every route the mint can resolve, and no other", async () => {
  const mint = await Deno.readTextFile(`${SCRIPTS}lib/mint.sh`);
  const routes = [...mint.matchAll(/phase="([a-z_]+)" phase_reason="([a-z_]+)"/g)];
  // The last branch falls through without the `return 0` the others carry, so it is written
  // as a bare assignment pair and needs its own match.
  const trailing = [...mint.matchAll(/^\s*phase="([a-z_]+)" phase_reason="([a-z_]+)"$/gm)];
  const all = [...routes, ...trailing];
  assertGreaterOrEqual(all.length, 5, "resolve_phase parsed as having no routes");

  const phases = [...new Set(all.map((m) => m[1]))].sort();
  const reasons = [...new Set(all.map((m) => m[2]))].sort();

  assertEquals(
    phases.filter((p) => !DOC_TEXT.includes(`\`${p}\``)),
    [],
    "resolve_phase can emit a `phase` no doc explains — the agent gets a route it cannot read",
  );
  assertEquals(
    reasons.filter((r) => !DOC_TEXT.includes(`\`${r}\``)),
    [],
    "resolve_phase can emit a `phase_reason` no doc explains",
  );

  // The reverse: SKILL.md's requires_judgement table resolves each ambiguous route, so a row
  // for a state the script cannot produce is an instruction that can never fire.
  const skill = await Deno.readTextFile(`${SKILL_ROOT}SKILL.md`);
  const tabled = [...skill.matchAll(/^\| `([a-z_]+)` \| What is ambiguous/gm)].length > 0
    ? [...skill.matchAll(/^\| `([a-z_]+)` \|/gm)].map((m) => m[1]).filter((r) =>
      r !== "phase_reason"
    )
    : [];
  assertGreaterOrEqual(tabled.length, 2, "SKILL.md's phase_reason table parsed as empty");
  assertEquals(
    tabled.filter((r) => !reasons.includes(r)),
    [],
    "SKILL.md documents how to resolve a `phase_reason` resolve_phase cannot produce",
  );
});
