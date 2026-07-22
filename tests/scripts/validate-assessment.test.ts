/**
 * Behavioral tests for the `skills/ingrain-security/scripts/validate-assessment` script
 * — the schema check over the assessment file the review persists into
 * `.ingrain-security/`. Like the `tests/hooks/` tier these EXECUTE the script under bash,
 * here against fixtures written to a throwaway temp dir, so they need the `test:scripts`
 * run+read+write permissions.
 *
 * The fixtures are built from one valid document (`validAssessment()`), each negative case
 * being that document with a single line swapped. A negative therefore proves exactly one
 * rule: everything else about the file is known good because the positive test asserts the
 * unmodified version validates clean.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl } from "@std/path";

const ROOT = fromFileUrl(new URL("../../", import.meta.url));
const SCRIPT = `${ROOT}skills/ingrain-security/scripts/validate-assessment`;

/** One reported violation: the line it sits on (0 for the file as a whole). */
interface IValidationError {
  line: number;
  message: string;
}

/** The JSON object the script emits on stdout. */
interface IValidationResult {
  path: string;
  lenient: boolean;
  valid: boolean;
  error_count: number;
  errors: IValidationError[];
}

interface IRun {
  code: number;
  stdout: string;
  stderr: string;
}

/** Run the validator with the given argv. */
async function run(args: string[]): Promise<IRun> {
  const out = await new Deno.Command("bash", {
    args: [SCRIPT, ...args],
    clearEnv: true,
    env: { PATH: Deno.env.get("PATH") ?? "", HOME: Deno.env.get("HOME") ?? "" },
    stdout: "piped",
    stderr: "piped",
  }).output();
  return {
    code: out.code,
    stdout: new TextDecoder().decode(out.stdout),
    stderr: new TextDecoder().decode(out.stderr),
  };
}

/** Write `content` to a temp file named `basename` and validate it. */
async function validate(
  basename: string,
  content: string,
  flags: string[] = [],
): Promise<IRun & { json: IValidationResult }> {
  const dir = await Deno.makeTempDir({ prefix: "ingrain-validate-" });
  const path = `${dir}/${basename}`;
  await Deno.writeTextFile(path, content);
  try {
    const res = await run([path, ...flags]);
    return { ...res, json: JSON.parse(res.stdout) }; // throws if stdout is not one JSON object
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

// --- fixtures ---------------------------------------------------------------------

/** A finalized assessment that satisfies every rule the script checks. */
function validAssessment(): string {
  return `# Security assessment — Token refresh endpoint

> Local working artifact produced by ingrain-security. Git-ignored.

## Task
Title: Token refresh endpoint
Latest stage: development

## Triage
Verdict: major
Security relevant: true
Surfaces:
- the refresh endpoint
Prior analysis: none

## Threats

### T01 — Token replay
Asset: refresh token
Vector: network
Description: A captured token is replayed.
Assumptions: Transport is TLS.
Justification: Replay is cheap and the token is long-lived.
Impact: high
Likelihood: medium
Risk score: 78
Criticality: high
Selection: selected
Robustness: —

### T02 — Token in logs
Asset: refresh token
Vector: logging
Description: The token is written to the request log.
Assumptions: Logs are retained.
Justification: Exposure needs log access first.
Impact: low
Likelihood: low
Risk score: 40
Criticality: medium
Selection: excluded
Robustness: —

## Risk score
Score: 62
Criticality: high

## Mitigations

### M01 — Bind the token
Description: Bind the refresh token to the client.
Yield: high
Effort: medium
Threats: T01
Rule refs: r-auth-01
Selection: selected
Justification: —
Robustness: —

### M02 — Audit the refresh
Description: Emit a structured audit record.
Yield: medium
Effort: low
Threats: —
Rule refs: r-log-03
Selection: selected
Justification: —
Robustness: —

### M03 — Redact the log
Description: Redact the token from request logs.
Yield: low
Effort: low
Threats: T02
Rule refs: —
Selection: excluded
Justification: —
Robustness: —

## Coverage / open items
- none

## Maintenance (for the implementing agent)
Update this file whenever the implementation diverges from the analysis.
`;
}

/**
 * The valid document with the first line containing `find` replaced by `replace` — how
 * every negative case introduces exactly one defect.
 */
function withLine(doc: string, find: string, replace: string): string {
  const lines = doc.split("\n");
  const at = lines.findIndex((line) => line.includes(find));
  assert(at >= 0, `fixture no longer contains "${find}" — update the test`);
  lines[at] = lines[at].replace(find, replace);
  return lines.join("\n");
}

/** The valid document with the first line containing `find` removed. */
function withoutLine(doc: string, find: string): string {
  const lines = doc.split("\n");
  const at = lines.findIndex((line) => line.includes(find));
  assert(at >= 0, `fixture no longer contains "${find}" — update the test`);
  lines.splice(at, 1);
  return lines.join("\n");
}

/**
 * As withLine, but the search starts at the line holding `anchor` — the way to reach a
 * field of one entry when every entry carries a field of that name.
 */
function withLineAfter(doc: string, anchor: string, find: string, replace: string): string {
  const lines = doc.split("\n");
  const from = lines.findIndex((line) => line.includes(anchor));
  assert(from >= 0, `fixture no longer contains "${anchor}" — update the test`);
  const at = lines.findIndex((line, i) => i >= from && line.includes(find));
  assert(at >= 0, `fixture no longer contains "${find}" after "${anchor}" — update the test`);
  lines[at] = lines[at].replace(find, replace);
  return lines.join("\n");
}

/**
 * The valid document with the whole `### <id> — …` entry removed: its heading, its field
 * lines, and the blank line that separates it from what follows.
 */
function withoutEntry(doc: string, id: string): string {
  const lines = doc.split("\n");
  const at = lines.findIndex((line) => line.startsWith(`### ${id} `));
  assert(at >= 0, `fixture no longer contains entry "${id}" — update the test`);
  let end = at + 1;
  while (end < lines.length && !lines[end].startsWith("### ") && !lines[end].startsWith("## ")) {
    end++;
  }
  lines.splice(at, end - at);
  return lines.join("\n");
}

// --- positive ---------------------------------------------------------------------

Deno.test("valid: a finalized assessment validates clean", async () => {
  const { code, json, stderr } = await validate("assessment-branch-task.md", validAssessment());
  assertEquals(code, 0, stderr);
  assertEquals(json.valid, true);
  assertEquals(json.error_count, 0);
  assertEquals(json.errors, []);
  assertEquals(stderr, "");
});

Deno.test("valid: a Threats section with no entries is allowed (a minor triage)", async () => {
  let doc = withoutEntry(validAssessment(), "T01");
  doc = withoutEntry(doc, "T02");
  // The mitigations may then reference no threat either.
  doc = withoutEntry(doc, "M01");
  doc = withoutEntry(doc, "M03");
  const { code, json } = await validate("assessment-x.md", doc);
  assertEquals(code, 0, JSON.stringify(json.errors));
  assertEquals(json.valid, true);
});

Deno.test("valid: unset verification fields pass at any stage", async () => {
  // Structure-only checking: the script must not care that a `testing` file still has
  // `—` in Robustness, nor that a `development` file has it filled.
  for (
    const doc of [
      withLine(validAssessment(), "Latest stage: development", "Latest stage: testing"),
      withLine(validAssessment(), "Robustness: —", "Robustness: strong"),
    ]
  ) {
    const { code, json } = await validate("assessment-x.md", doc);
    assertEquals(code, 0, JSON.stringify(json.errors));
  }
});

Deno.test("valid: ids need not be contiguous, and entries need not descend by risk", async () => {
  // Ids are permanent, so a retired threat leaves a gap and every reference around it keeps
  // pointing where it did. Priority is derived from Risk score at display time, so document
  // order carries no meaning — both hold in either mode.
  let doc = validAssessment();
  doc = doc.replaceAll("T02", "T05");
  doc = withLine(doc, "Risk score: 40", "Risk score: 90");

  for (const flags of [[], ["--lenient"]]) {
    const { code, json } = await validate("assessment-x.md", doc, flags);
    assertEquals(code, 0, JSON.stringify(json.errors));
  }
});

Deno.test("valid: ids are accepted in either case, and cross-references fold", async () => {
  // The references prescribe the uppercase form, but an id written lowercase still names
  // the same threat — so a lowercase heading resolves an uppercase `Threats:` reference
  // and vice versa.
  for (
    const doc of [
      withLine(validAssessment(), "### T02 — Token in logs", "### t02 — Token in logs"),
      withLine(validAssessment(), "Threats: T01", "Threats: t01"),
    ]
  ) {
    const { code, json } = await validate("assessment-x.md", doc);
    assertEquals(code, 0, JSON.stringify(json.errors));
    assertEquals(json.valid, true);
  }
});

/**
 * The in-progress cases. Every write during a run is validated, and mid-run these files
 * are incomplete by construction — so `--lenient` must accept what the run has written so
 * far while strict still refuses to call it finished.
 */
Deno.test("valid: --lenient accepts the Step 0 skeleton, strict refuses it", async () => {
  const skeleton = `# Security assessment — Token refresh endpoint

## Task
Title: Token refresh endpoint
Latest stage: development

## Triage
Verdict: major
Security relevant: true
Surfaces:
- the refresh endpoint
`;
  const lenient = await validate("assessment-x.md", skeleton, ["--lenient"]);
  assertEquals(lenient.code, 0, JSON.stringify(lenient.json.errors));

  const strict = await validate("assessment-x.md", skeleton);
  assertEquals(strict.code, 1);
  assertStringIncludes(
    strict.json.errors.map((e) => e.message).join("\n"),
    'missing required section "## Threats"',
  );
});

Deno.test("valid: --lenient accepts threats written before the risk scorer runs", async () => {
  // The shape the threat generator produces at step 1: every scoring field still `—`,
  // because the risk scorer that owns them does not run until step 3. Every write is
  // validated, so this state MUST pass leniently — there is no correction that would make
  // it pass otherwise, and an agent told to fix it has nothing it can do.
  let doc = validAssessment();
  for (const field of ["Justification", "Impact", "Likelihood", "Risk score", "Criticality"]) {
    doc = doc.replaceAll(new RegExp(`^${field}: .+$`, "gm"), `${field}: —`);
  }

  const lenient = await validate("assessment-x.md", doc, ["--lenient"]);
  assertEquals(lenient.code, 0, JSON.stringify(lenient.json.errors));
  assertEquals(lenient.json.lenient, true);

  // Strict still refuses it: at finalize the file must be scored.
  const strict = await validate("assessment-x.md", doc);
  assertEquals(strict.code, 1);
  assertStringIncludes(
    strict.json.errors.map((e) => e.message).join("\n"),
    "Impact: is not filled in",
  );
});

Deno.test("valid: --lenient accepts an entry whose fields are not written yet", async () => {
  // A heading on the page with nothing under it — the worker wrote the id and stopped.
  const doc = withoutLine(
    withoutLine(validAssessment(), "Asset: refresh token"),
    "Vector: network",
  );
  const lenient = await validate("assessment-x.md", doc, ["--lenient"]);
  assertEquals(lenient.code, 0, JSON.stringify(lenient.json.errors));

  const strict = await validate("assessment-x.md", doc);
  assertEquals(strict.code, 1);
  assertStringIncludes(
    strict.json.errors.map((e) => e.message).join("\n"),
    'missing required field "Asset:"',
  );
});

Deno.test("invalid: --lenient is not a blanket pass", async () => {
  // What IS written is held to the schema whatever the mode — leniency waives only the
  // checks that cannot hold until the file is complete.
  const cases: Array<[string, string]> = [
    [withLine(A, "Latest stage: development", "Latest stage: shipped"), "Latest stage:"],
    [withLine(A, "Impact: high", "Impact: severe"), "Impact:"],
    [withLine(A, "Threats: T01", "Threats: T09"), "is not a threat in this file"],
    [
      A.replace("## Triage", "## PLACEHOLDER").replace("## Task", "## Triage").replace(
        "## PLACEHOLDER",
        "## Task",
      ),
      "out of order",
    ],
  ];
  for (const [doc, expected] of cases) {
    const { code, json } = await validate("assessment-x.md", doc, ["--lenient"]);
    assertEquals(code, 1, `expected ${expected} to fail under --lenient`);
    assertStringIncludes(json.errors.map((e) => e.message).join("\n"), expected);
  }
});

// --- negative: one case per rule ---------------------------------------------------

interface ICase {
  name: string;
  doc: string;
  /** A distinctive fragment the reported message must contain. */
  expect: string;
  basename?: string;
  flags?: string[];
}

const A = validAssessment();

const NEGATIVES: ICase[] = [
  {
    name: "no level-1 title",
    doc: withLine(A, "# Security assessment", "Security assessment"),
    expect: '"# <title>" heading',
  },
  {
    name: "missing required section",
    doc: withoutLine(A, "## Risk score"),
    expect: 'missing required section "## Risk score"',
  },
  {
    name: "sections out of order",
    doc: A.replace("## Triage", "## PLACEHOLDER").replace("## Task", "## Triage").replace(
      "## PLACEHOLDER",
      "## Task",
    ),
    expect: "out of order",
  },
  {
    name: "unknown section",
    doc: withLine(A, "## Coverage / open items", "## Coverage and open items"),
    expect: "unknown section",
  },
  {
    name: "missing Task field",
    doc: withoutLine(A, "Latest stage: development"),
    expect: 'missing required field "Latest stage:"',
  },
  {
    name: "empty Task field",
    doc: withLine(A, "Title: Token refresh endpoint", "Title:"),
    expect: 'field "Title:" is empty',
  },
  {
    name: "bad Latest stage",
    doc: withLine(A, "Latest stage: development", "Latest stage: shipped"),
    expect: "Latest stage:",
  },
  {
    name: "bad Verdict",
    doc: withLine(A, "Verdict: major", "Verdict: medium"),
    expect: "Verdict:",
  },
  {
    name: "non-boolean Security relevant",
    doc: withLine(A, "Security relevant: true", "Security relevant: yes"),
    expect: "Security relevant:",
  },
  {
    name: "malformed threat id",
    doc: withLine(A, "### T02 — Token in logs", "### x2 — Token in logs"),
    expect: 'id: "x2" is not of the form T<n>',
  },
  {
    // The retired dashed form, so a file written against the old schema fails loudly
    // rather than validating under the new one.
    name: "dashed threat id",
    doc: withLine(A, "### T02 — Token in logs", "### t-02 — Token in logs"),
    expect: 'id: "t-02" is not of the form T<n>',
  },
  {
    name: "duplicate threat id",
    doc: withLine(A, "### T02 — Token in logs", "### T01 — Token in logs"),
    expect: 'id: "T01" is a duplicate',
  },
  {
    name: "entry heading with no id separator",
    doc: withLine(A, "### T02 — Token in logs", "### Token in logs"),
    expect: "is not of the form T<n>",
  },
  {
    name: "missing threat field",
    doc: withoutLine(A, "Assumptions: Transport is TLS."),
    expect: 'missing required field "Assumptions:"',
  },
  {
    name: "unfilled threat field at finalize",
    doc: withLine(A, "Impact: high", "Impact: —"),
    expect: "Impact: is not filled in",
  },
  {
    name: "risk score out of range",
    doc: withLine(A, "Risk score: 78", "Risk score: 178"),
    expect: "Risk score:",
  },
  {
    name: "non-integer risk score",
    doc: withLine(A, "Risk score: 78", "Risk score: high"),
    expect: "Risk score:",
  },
  {
    name: "bad Impact",
    doc: withLine(A, "Impact: high", "Impact: severe"),
    expect: "Impact:",
  },
  {
    name: "bad Likelihood",
    doc: withLine(A, "Likelihood: medium", "Likelihood: certain"),
    expect: "Likelihood:",
  },
  {
    name: "bad threat Criticality",
    // The first `Criticality:` in the document is T01's; the plan-level one follows it.
    doc: withLine(A, "Criticality: high", "Criticality: severe"),
    expect: "Criticality:",
  },
  {
    name: "bad threat Selection",
    doc: withLine(A, "Selection: selected", "Selection: maybe"),
    expect: "Selection:",
  },
  {
    name: "bad threat Robustness",
    doc: withLine(A, "Robustness: —", "Robustness: brittle"),
    expect: "Robustness:",
  },
  {
    name: "justification over the 256-character cap",
    doc: withLine(A, "Replay is cheap and the token is long-lived.", "x".repeat(257)),
    expect: "exceeds the 256-character cap",
  },
  {
    name: "bad Score in the plan-level risk section",
    doc: withLine(A, "Score: 62", "Score: 620"),
    expect: "Score:",
  },
  {
    name: "malformed mitigation id",
    doc: withLine(A, "### M02 — Audit the refresh", "### x2 — Audit the refresh"),
    expect: "is not of the form M<n>",
  },
  {
    name: "duplicate mitigation id",
    doc: withLine(A, "### M02 — Audit the refresh", "### M01 — Audit the refresh"),
    expect: 'id: "M01" is a duplicate',
  },
  {
    name: "missing mitigation field",
    doc: withoutLine(A, "Yield: high"),
    expect: 'missing required field "Yield:"',
  },
  {
    name: "bad Yield",
    doc: withLine(A, "Yield: high", "Yield: huge"),
    expect: "Yield:",
  },
  {
    name: "bad Effort",
    doc: withLine(A, "Effort: medium", "Effort: enormous"),
    expect: "Effort:",
  },
  {
    name: "Threats naming an unknown threat",
    doc: withLine(A, "Threats: T01", "Threats: T09"),
    expect: 'Threats: "T09" is not a threat in this file',
  },
  {
    name: "malformed Threats field",
    doc: withLine(A, "Threats: T01", "Threats: threat one"),
    expect: "is not of the form T<n>",
  },
  {
    name: "malformed Rule refs field",
    doc: withLine(A, "Rule refs: r-auth-01", "Rule refs: rule auth 01"),
    expect: "is not a rule id",
  },
  {
    name: "bad mitigation Robustness",
    doc: withLineAfter(A, "### M01 ", "Robustness: —", "Robustness: sturdy"),
    expect: "Robustness:",
  },
  {
    name: "bad mitigation Selection",
    doc: withLineAfter(A, "### M01 ", "Selection: selected", "Selection: adopted"),
    expect: "Selection:",
  },
];

for (const testCase of NEGATIVES) {
  Deno.test(`invalid: ${testCase.name}`, async () => {
    const { code, json, stderr } = await validate(
      testCase.basename ?? "assessment-x.md",
      testCase.doc,
      testCase.flags ?? [],
    );
    assertEquals(code, 1, `expected a schema failure, got ${code}: ${stderr}`);
    assertEquals(json.valid, false);
    assert(json.error_count > 0, "a failing run must report at least one error");

    const messages = json.errors.map((e) => e.message).join("\n");
    assertStringIncludes(messages, testCase.expect);
    // Every violation is also printed for a human, prefixed with the file it is in.
    assertStringIncludes(stderr, testCase.expect);
  });
}

Deno.test("invalid: every reported error carries a plausible line number", async () => {
  const doc = withLine(A, "Impact: high", "Impact: severe");
  const { json } = await validate("assessment-x.md", doc);
  const lineCount = doc.split("\n").length;
  for (const error of json.errors) {
    assert(
      error.line > 0 && error.line <= lineCount,
      `line ${error.line} is outside the file (1..${lineCount}): ${error.message}`,
    );
  }
});

// --- the minter's seeded skeleton -------------------------------------------------

/**
 * Mint an assessment path in a throwaway project, which seeds the file's empty skeleton,
 * and return that file's absolute path. Non-git, so the branch segment is simply dropped.
 */
async function seedSkeleton(dir: string, title: string): Promise<string> {
  const minter = `${ROOT}skills/ingrain-security/scripts/assessment-path`;
  const out = await new Deno.Command("bash", {
    args: [minter, "claude", "mint", "--title", title],
    cwd: dir,
    clearEnv: true,
    env: {
      PATH: Deno.env.get("PATH") ?? "",
      HOME: Deno.env.get("HOME") ?? "",
      CLAUDE_PROJECT_DIR: dir,
    },
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(out.code, 0, new TextDecoder().decode(out.stderr));
  return JSON.parse(new TextDecoder().decode(out.stdout)).assessment_abs;
}

Deno.test("skeleton: a freshly seeded file is lenient-valid and strictly invalid", async () => {
  const dir = await Deno.makeTempDir({ prefix: "ingrain-validate-" });
  try {
    const path = await seedSkeleton(dir, "Token refresh endpoint");

    const lenient = await run([path, "--lenient"]);
    assertEquals(lenient.code, 0, lenient.stderr);

    // Strict must reject it: the sections are on the page but not yet filled in.
    const strict = await run([path]);
    assertEquals(strict.code, 1);
    const json: IValidationResult = JSON.parse(strict.stdout);
    assert(json.error_count > 0);
    assert(
      json.errors.every((e) => /is empty|missing required field/.test(e.message)),
      `expected only unfilled-field violations, got: ${JSON.stringify(json.errors)}`,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// --- usage ------------------------------------------------------------------------

Deno.test("usage: no arguments exits 2", async () => {
  const { code, stderr } = await run([]);
  assertEquals(code, 2);
  assertStringIncludes(stderr, "missing <file>");
});

Deno.test("usage: --help exits 0 and documents the flags", async () => {
  const { code, stdout } = await run(["--help"]);
  assertEquals(code, 0);
  assertStringIncludes(stdout, "--lenient");
});

Deno.test("usage: a nonexistent file exits 2", async () => {
  const { code, stderr } = await run(["/nonexistent/assessment-x.md"]);
  assertEquals(code, 2);
  assertStringIncludes(stderr, "no such file");
});

Deno.test("usage: an unknown flag exits 2", async () => {
  const dir = await Deno.makeTempDir({ prefix: "ingrain-validate-" });
  const path = `${dir}/assessment-x.md`;
  await Deno.writeTextFile(path, validAssessment());
  try {
    const { code, stderr } = await run([path, "--strict"]);
    assertEquals(code, 2);
    assertStringIncludes(stderr, 'unknown flag "--strict"');
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("usage: the basename does not matter — any .md is checked as an assessment", async () => {
  const { code, stderr } = await validate("notes.md", validAssessment());
  assertEquals(code, 0, stderr);
});
