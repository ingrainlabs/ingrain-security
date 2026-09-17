/**
 * **The harness's host seam is structural, not conventional.**
 *
 * The live tier runs on two backends (Claude Code and OpenCode) behind one registry. If a
 * shared module — a matcher, the reporter, a fixture builder — starts importing a backend
 * directly, the tier drifts back toward a single host with the other one bolted on: its
 * helpers grow host-shaped parameters, its fixtures grow host-shaped staging, and adding a
 * third host means auditing every file by hand. This file is the check that keeps the seam
 * where the design put it:
 *
 * - shared modules (`lib/matchers.ts`, `lib/reporter.ts`, `lib/sampleInputs.ts`,
 *   `lib/sampleProjects.ts`, `lib/workers.ts`, `lib/types.ts`) import **no** backend module;
 *   only the reporter may name the registry, because it is what runs prompts;
 * - the two backends never import each other, and import only the shared core and the stdlib.
 */

import { assertEquals } from "@std/assert";
import { fromFileUrl, join, normalize } from "@std/path";

const TESTS_ROOT = fromFileUrl(new URL("..", import.meta.url));

/** Modules governed as "shared": shapes, matchers, fixtures, reporting. */
const SHARED_MODULES = [
  "lib/matchers.ts",
  "lib/reporter.ts",
  "lib/sampleInputs.ts",
  "lib/sampleProjects.ts",
  "lib/workers.ts",
  "lib/types.ts",
];

const BACKENDS = ["lib/runners/claude.ts", "lib/runners/opencode.ts"];

const IMPORT_RE = /import[\s\S]*?from\s*["']([^"']+)["']/g;

/** Resolve a relative import spec to a `tests/`-relative path. */
const resolveSpec = (fromModule: string, spec: string): string =>
  normalize(join(fromModule, "..", spec));

/** Which `tests/`-relative target a spec names, or null when it is remote. */
const targetOf = (fromModule: string, spec: string): string | null => {
  if (spec.startsWith(".")) return resolveSpec(fromModule, spec);
  if (spec.startsWith("../")) return resolveSpec(fromModule, spec);
  return null;
};

Deno.test("harness seam: shared modules import no backend, and only the reporter names the registry", async () => {
  const violations: string[] = [];

  for (const module of SHARED_MODULES) {
    const source = await Deno.readTextFile(`${TESTS_ROOT}${module}`);
    for (const m of source.matchAll(IMPORT_RE)) {
      const target = targetOf(module, m[1]);
      if (target === null || !target.startsWith("lib/runners")) continue;
      if (module === "lib/reporter.ts" && target === "lib/runners/index.ts") continue;
      violations.push(`${module} imports \`${target}\``);
    }
  }

  assertEquals(
    violations,
    [],
    "the harness's host seam leaked — shared modules must not import a backend (only the " +
      `reporter may name the registry):\n  ${violations.join("\n  ")}`,
  );
});

Deno.test("harness seam: the backends import the shared core, never each other or the live tier", async () => {
  const violations: string[] = [];

  for (const backend of BACKENDS) {
    const source = await Deno.readTextFile(`${TESTS_ROOT}${backend}`);
    for (const m of source.matchAll(IMPORT_RE)) {
      const target = targetOf(backend, m[1]);
      if (target === null) continue;
      if (BACKENDS.some((b) => b !== backend && target === b)) {
        violations.push(`${backend} imports its sibling backend`);
      }
      if (
        /\/(matchers|reporter|sampleInputs|sampleProjects|taskPrompts)\.ts$/.test(target) ||
        target === "lib/runners/index.ts"
      ) {
        violations.push(`${backend} reaches past the shared core: \`${target}\``);
      }
    }
  }

  assertEquals(
    violations,
    [],
    "a backend reached past the shared core — the seam is claude.ts/opencode.ts → shared.ts → " +
      `types, and nothing else:\n  ${violations.join("\n  ")}`,
  );
});
