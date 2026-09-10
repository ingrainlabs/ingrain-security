/**
 * **Every test file is reachable from a task, and the live tier's parts really sum to it.**
 *
 * `deno.json` names directories, so a new file under one is picked up by its tier for free —
 * which is exactly why the *granular* tasks rot silently. `test:agent` globs `agents/`, but
 * `test:agent:workers`/`:unattended`/`:resume` each name **one file**: add `agents/newthing.
 * test.ts` and the tier still runs it while no narrow task does. Anyone reaching for the narrow
 * task — which is the whole point of having one, since the live tier costs minutes and real
 * money — then runs a subset without being told it is one.
 *
 * The README states the sum outright ("`test:agent` is the sum of the four above it"), and a
 * claim in prose that nothing checks is a claim that goes quietly false. This is the check.
 *
 * Deliberately about the LIVE tier only. The offline tasks are one-per-directory, so their
 * coverage is a property of the glob rather than of a list somebody maintains — there is
 * nothing there to drift.
 */

import { assertEquals, assertGreaterOrEqual } from "@std/assert";
import { fromFileUrl } from "@std/path";

const TESTS_ROOT = fromFileUrl(new URL("..", import.meta.url));

const tasks = (): Record<string, string> => {
  const config = JSON.parse(Deno.readTextFileSync(`${TESTS_ROOT}deno.json`));
  return config.tasks as Record<string, string>;
};

/** The `*.test.ts` paths a task command names, in the order it names them. */
const testPathsIn = (command: string): string[] =>
  [...command.matchAll(/\b([a-zA-Z][\w./-]*\.test\.ts)\b/g)].map((m) => m[1]);

/** Directories a task command names, e.g. `agents/`. */
const dirsIn = (command: string): string[] =>
  [...command.matchAll(/(?:^|\s)([a-z][\w-]*)\/(?=\s|$)/g)].map((m) => m[1]);

/** Every directory holding test files. A tier absent here is a tier this guard cannot see. */
const TIERS = ["agents", "hooks", "parity", "shell", "skill", "static"];

const filesUnder = async (dir: string): Promise<string[]> => {
  const found: string[] = [];
  for await (const entry of Deno.readDir(`${TESTS_ROOT}${dir}`)) {
    if (entry.isFile && entry.name.endsWith(".test.ts")) found.push(`${dir}/${entry.name}`);
  }
  return found.sort();
};

Deno.test("discovery: the task table parses and the live tier is still a directory glob", () => {
  // Both sides of every check below come from these. If the shape of the table changes so this
  // stops finding them, the assertions after it would compare nothing and report green.
  const table = tasks();
  assertGreaterOrEqual(Object.keys(table).length, 10, "the task table parsed as almost empty");
  assertEquals(
    dirsIn(table["test:agent"]),
    ["agents"],
    "`test:agent` no longer globs exactly `agents/` — the coverage check below assumes it does",
  );
});

Deno.test("every agents/ file is named by exactly one granular task", async () => {
  const table = tasks();
  const granular = Object.entries(table).filter(([name]) => name.startsWith("test:agent:"));
  assertGreaterOrEqual(granular.length, 1, "no granular live tasks found at all");

  const named = granular.flatMap(([, command]) => testPathsIn(command));
  const present = await filesUnder("agents");

  const unreachable = present.filter((file) => !named.includes(file));
  assertEquals(
    unreachable,
    [],
    `these files run under \`test:agent\` but under no granular task, so anyone using the ` +
      `narrow task silently skips them — add one per file in tests/deno.json:\n  ` +
      unreachable.join("\n  "),
  );

  // NOT scoped to `agents/`: a granular task pointing at a renamed or deleted file anywhere
  // would otherwise pass, and `deno test` on a missing path fails the run rather than skipping
  // it — so the wiring guard has to see every path a task names, not only the ones it expects.
  const allNamed = Object.values(table).flatMap(testPathsIn);
  const onDisk = new Set(
    (await Promise.all(TIERS.map(filesUnder))).flat(),
  );
  const missing = [...new Set(allNamed)].filter((file) => !onDisk.has(file));
  assertEquals(missing, [], `a task names a test file that does not exist:\n  ${missing}`);

  // No file counted twice: two tasks naming one file makes the "sum of its parts" claim false
  // in the other direction, and doubles what a full run pays for.
  assertEquals(
    named.length,
    new Set(named).size,
    `a file is named by more than one granular task: ${named.join(", ")}`,
  );
});

Deno.test("the granular tasks carry the same permissions as the tier", () => {
  // The permission set doubles as a capability tag (README → Running), so a narrow task that
  // quietly grants more than its tier would let a case reach the model from somewhere the tier
  // would have refused — and the tier, not the narrow task, is what CI and the plan cite.
  const table = tasks();
  const flags = (command: string): string[] =>
    command.split(/\s+/).filter((word) => word.startsWith("--allow")).sort();

  const expected = flags(table["test:agent"]);
  assertGreaterOrEqual(expected.length, 3, "`test:agent` parsed as having no permission flags");

  for (const [name, command] of Object.entries(table)) {
    if (!name.startsWith("test:agent:")) continue;
    assertEquals(
      flags(command),
      expected,
      `${name} does not carry the same permissions as test:agent`,
    );
  }
});
