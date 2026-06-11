/**
 * Skill-variant discovery and plugin-dir staging for the trigger-comparison
 * harness (`tests/skillVariantTest/run.ts`).
 *
 * A "variant" is an alternative body for a skill's `SKILL.md`. The canonical
 * `SKILL.md` is the baseline; alternates live alongside it as `SKILL1.md …
 * SKILLN.md` (case-sensitive, dev-only scratch files, git-ignored). To trigger-test a variant we
 * stage a throwaway copy of the plugin whose target `SKILL.md` is the variant's
 * content, then point `claude --plugin-dir` at it — so both the `SessionStart`
 * hook injection (`hooks/session-start` reads the file at runtime) and the skill
 * description come from the variant.
 */

import { copy } from "@std/fs";
import { join } from "@std/path";
import { PLUGIN_DIR } from "./claudeRunner.ts";

/** Matches an alternate variant file `SKILL<N>.md` (case-sensitive) and captures N. */
const ALTERNATE_RE = /^SKILL(\d+)\.md$/;

/** A single skill variant to trigger-test. */
export interface TVariant {
  /** Display label: `baseline` for SKILL.md, else `SKILL<N>`. */
  label: string;
  /** File name within the skill folder (e.g. `SKILL.md`, `skill1.md`). */
  fileName: string;
  /** Absolute path to the variant file. */
  path: string;
}

/**
 * Discover the variants of a skill: the baseline `SKILL.md` first, then any
 * `skill<N>.md` alternates sorted numerically by N.
 *
 * @throws if the skill folder or its baseline `SKILL.md` is missing.
 */
export const discoverVariants = async (skillName: string): Promise<TVariant[]> => {
  const skillDir = join(PLUGIN_DIR, "skills", skillName);

  let entries: Deno.DirEntry[];
  try {
    entries = await Array.fromAsync(Deno.readDir(skillDir));
  } catch {
    throw new Error(`No such skill folder: skills/${skillName} (looked in ${skillDir})`);
  }

  const baselinePath = join(skillDir, "SKILL.md");
  if (!entries.some((e) => e.isFile && e.name === "SKILL.md")) {
    throw new Error(`Skill skills/${skillName} has no baseline SKILL.md`);
  }

  const alternates = entries
    .filter((e) => e.isFile && ALTERNATE_RE.test(e.name))
    .map((e) => ({ n: Number(e.name.match(ALTERNATE_RE)![1]), name: e.name }))
    .sort((a, b) => a.n - b.n)
    .map(({ name }): TVariant => ({
      label: name.replace(/\.md$/, ""),
      fileName: name,
      path: join(skillDir, name),
    }));

  return [
    { label: "baseline", fileName: "SKILL.md", path: baselinePath },
    ...alternates,
  ];
};

/**
 * Stage a throwaway plugin dir for one variant: copy the repo's `skills/` and
 * `hooks/` into `<runDir>/plugin`, then overwrite the target skill's `SKILL.md`
 * with the variant's content. Returns the staged plugin-dir path to pass to
 * `claude --plugin-dir`.
 *
 * @param skillName the skill whose SKILL.md the variant replaces
 * @param variant the variant to stage
 * @param runDir the per-variant run directory (the plugin is staged under it)
 */
export const stageVariantPluginDir = async (
  skillName: string,
  variant: TVariant,
  runDir: string,
): Promise<string> => {
  const pluginDir = join(runDir, "plugin");
  await Deno.mkdir(pluginDir, { recursive: true });

  // Only skills/ and hooks/ matter for plugin discovery + the SessionStart hook.
  await copy(join(PLUGIN_DIR, "skills"), join(pluginDir, "skills"), { overwrite: true });
  await copy(join(PLUGIN_DIR, "hooks"), join(pluginDir, "hooks"), { overwrite: true });

  // Swap in the variant as the target skill's SKILL.md. For the baseline this is
  // a no-op rewrite of identical content, which keeps the call site uniform.
  const variantBody = await Deno.readTextFile(variant.path);
  await Deno.writeTextFile(join(pluginDir, "skills", skillName, "SKILL.md"), variantBody);

  return pluginDir;
};
