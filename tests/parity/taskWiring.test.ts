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
 *
 * **The live tier is not purely a glob, and that was a blind spot.** `test:agent` is
 * `agents/ skill/trigger.test.ts`: the second half is a named file, so `skill/` needs its own
 * check rather than riding on the glob's guarantee.
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
const TIERS = ["agents", "parity", "shell", "skill", "static"];

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

/**
 * `test:agent` is `agents/ skill/trigger.test.ts` — a glob **and a named file**.
 *
 * The glob half looks after itself; the named half is a hand-maintained list, so a new
 * `skill/*.test.ts` is run by the live tier only if somebody remembers to add it. The check
 * below covers `agents/` and could not see that, which is the same drift in the other
 * direction: a file that runs under no task at all rather than under no narrow one.
 *
 * `skill/orchestration.test.ts` is the standing exception — it is `INTEGRATION`-gated and run
 * deliberately, not by `test:agent`. Named here rather than pattern-matched, so adding a second
 * exception is a decision somebody records instead of a rule quietly widening.
 */
const SKILL_FILES_OUTSIDE_THE_LIVE_TIER = ["skill/orchestration.test.ts"];

Deno.test("every skill/ file is either in the live tier or a recorded exception", async () => {
  const named = testPathsIn(tasks()["test:agent"]);
  const present = await filesUnder("skill");

  const stranded = present.filter((file) =>
    !named.includes(file) && !SKILL_FILES_OUTSIDE_THE_LIVE_TIER.includes(file)
  );
  assertEquals(
    stranded,
    [],
    "`test:agent` names skill/ files one by one rather than globbing, so these run under no " +
      `task at all — add them to test:agent in tests/deno.json, or record why not:\n  ${
        stranded.join("\n  ")
      }`,
  );
});

/**
 * Group the granular tasks by the host they run on.
 *
 * **The tier has two backends, and the sum-of-parts claim is per host.** `test:agent` (and its
 * narrow tasks) resolve their host from `INGRAIN_TESTS_AGENT_HOST`, defaulting to `claude`; the
 * per-host twins re-state the same command with the env set and the backend's binary granted.
 * A `claude` twin collides with a `default` twin on the same file *by design* — they are the
 * same matrix on different hosts — so uniqueness, reachability and permission parity are all
 * asserted WITHIN a host group, never across them.
 */
type THostGroup = "claude" | "opencode";

const hostOf = (command: string): THostGroup => {
  const m = command.match(/INGRAIN_TESTS_AGENT_HOST=(\w+)/);
  if (m === null) return "claude";
  if (m[1] === "claude" || m[1] === "opencode") return m[1];
  throw new Error(`a task sets INGRAIN_TESTS_AGENT_HOST to unknown host: ${command}`);
};

Deno.test("every agents/ file is named by exactly one granular task — per host", async () => {
  const table = tasks();
  // A `--filter` task selects a subset of one file rather than owning it, so it is not part of
  // the sum: counting it would double that file and make the sum-of-parts claim false. Its own
  // guard is below — that the filter selects exactly one test.
  const granular = Object.entries(table).filter(
    ([name, command]) => name.startsWith("test:agent:") && !command.includes("--filter"),
  );
  assertGreaterOrEqual(granular.length, 1, "no granular live tasks found at all");

  const present = await filesUnder("agents");

  for (const host of ["claude", "opencode"] as const) {
    const group = granular.filter(([, command]) => hostOf(command) === host);
    assertGreaterOrEqual(
      group.length,
      1,
      `the \`${host}\` group has no granular live task at all — the twin matrix colonised the ` +
        "table without covering every host",
    );

    const named = group.flatMap(([, command]) => testPathsIn(command));
    const unreachable = present.filter((file) => !named.includes(file));
    assertEquals(
      unreachable,
      [],
      `\`${host}\`: these files run under \`test:agent\` but under no \`${host}\` granular task,` +
        " so anyone using the narrow task silently skips them — " +
        `add one per file in tests/deno.json:\n  ${unreachable.join("\n  ")}`,
    );

    // No file counted twice within a host: two tasks naming one file makes the "sum of its
    // parts" claim false in the other direction, and doubles what a full run pays for.
    assertEquals(
      named.length,
      new Set(named).size,
      `\`${host}\`: a file is named by more than one granular task: ${named.join(", ")}`,
    );
  }

  // NOT scoped to `agents/`: a granular task pointing at a renamed or deleted file anywhere
  // would otherwise pass, and `deno test` on a missing path fails the run rather than skipping
  // it — so the wiring guard has to see every path a task names, not only the ones it expects.
  const allNamed = Object.values(table).flatMap(testPathsIn);
  const onDisk = new Set(
    (await Promise.all(TIERS.map(filesUnder))).flat(),
  );
  const missing = [...new Set(allNamed)].filter((file) => !onDisk.has(file));
  assertEquals(missing, [], `a task names a test file that does not exist:\n  ${missing}`);
});

Deno.test("the granular tasks carry the same permissions as their tier — per host", () => {
  // The permission set doubles as a capability tag (README → Running), so a narrow task that
  // quietly grants more than its tier would let a case reach the model from somewhere the tier
  // would have refused — and the tier, not the narrow task, is what CI and the plan cite.
  // Hosts differ by design in exactly one flag (`--allow-run` names the host's binary), so the
  // comparison is within a host group.
  const table = tasks();
  const flags = (command: string): string[] =>
    command.split(/\s+/).filter((word) => word.startsWith("--allow")).sort();

  for (const host of ["claude", "opencode"] as const) {
    const expected = flags(table[host === "claude" ? "test:agent" : "test:agent:workers:opencode"]);
    assertGreaterOrEqual(
      expected.length,
      3,
      `\`${host}\` tier command parsed as having no permission flags`,
    );

    for (const [name, command] of Object.entries(table)) {
      if (!name.startsWith("test:agent:")) continue;
      if (hostOf(command) !== host) continue;
      assertEquals(
        flags(command),
        expected,
        `${name} does not carry the same permissions as the \`${host}\` tier`,
      );
    }
  }
});

/**
 * **A `--filter` that matches nothing exits 0.** Measured: `0 passed | 0 failed | N filtered
 * out`, exit 0 — so a scenario task whose filter drifts off a renamed test reports success
 * having run nothing, on a tier that costs minutes and real money. That is strictly worse than
 * the subset problem the tests above guard, because there is no subset: there is nothing.
 *
 * Backticks are the concrete way it happens. `deno task`'s shell reads them as command
 * substitution, so a filter quoting a test name verbatim — every band name carries one —
 * silently selects zero tests. The scenario filters use `/regex/` for that reason.
 */
Deno.test("every scenario task's filter selects exactly one test", async () => {
  const file = "agents/unattended.test.ts";
  const source = await Deno.readTextFile(`${TESTS_ROOT}${file}`);

  // Names as registered, with the band loop expanded — a template, not a literal, is what
  // the file actually carries, so a guard reading only literals would miss three of six.
  const names: string[] = [];
  for (const [, template] of source.matchAll(/Deno\.test\(\s*`((?:[^`\\]|\\.)*)`/g)) {
    const name = template.replaceAll("\\`", "`");
    if (!name.includes("${band}")) {
      names.push(name);
      continue;
    }
    for (const band of ["high", "medium", "low"]) {
      names.push(name.replaceAll("${band}", band).replace(/\$\{[^}]+\}/g, "0"));
    }
  }
  for (const [, literal] of source.matchAll(/Deno\.test\(\s*"([^"]+)"/g)) {
    names.push(literal);
  }
  assertGreaterOrEqual(names.length, 6, `no test names parsed out of ${file}`);

  const scenarios = Object.entries(tasks()).filter(([name]) =>
    name.startsWith("test:agent:unattended:")
  );
  assertGreaterOrEqual(scenarios.length, 1, "no scenario tasks found to check");

  for (const [task, command] of scenarios) {
    // A task with no --filter is a whole-file task — the granular-sum test above guarantees
    // exactly one such task per file per host, so it selects the same set by construction and
    // has no filter to verify. Only the scenario tasks carry one.
    if (!command.includes("--filter")) continue;
    const filter = command.match(/--filter "([^"]+)"/)?.[1];
    assertEquals(typeof filter, "string", `${task} names no --filter`);
    const pattern = filter as string;

    // Checked BEFORE the match, because matching alone cannot see this: the string reaches
    // `--filter` only after `deno task`'s shell has had it, and a backtick or `$` is consumed
    // there. The mangled filter then selects nothing and the run exits 0 — while a guard that
    // only replayed the matching would compare the UNmangled text and find it perfectly good.
    const shellEats = [...pattern].filter((c) => c === "`" || c === "$" || c === '"');
    assertEquals(
      shellEats,
      [],
      `${task}'s filter ${JSON.stringify(pattern)} carries ${shellEats.join(" ")}, which ` +
        `\`deno task\`'s shell consumes before \`--filter\` sees it — the task would then ` +
        `select nothing and still exit 0. Use the /regex/ form: a \`.\` matches the backtick.`,
    );

    const matches = names.filter((name) =>
      pattern.startsWith("/") && pattern.endsWith("/")
        ? new RegExp(pattern.slice(1, -1)).test(name)
        : name.includes(pattern)
    );
    assertEquals(
      matches.length,
      1,
      `${task}'s filter ${JSON.stringify(pattern)} selects ${matches.length} tests, not 1` +
        ` — it would ${matches.length === 0 ? "run nothing and pass" : "run a set"}. ` +
        `Names are:\n  ${names.join("\n  ")}`,
    );
  }
});
