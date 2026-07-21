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
| Tag | Title | Asset | Vector | Description | Assumptions | Justification | Impact | Likelihood | Risk score | Criticality | Selection | Robustness |
|-----|-------|-------|--------|-------------|-------------|---------------|--------|------------|------------|-------------|-----------|------------|
| T1 | Token replay | refresh token | network | A captured token is replayed. | Transport is TLS. | Replay is cheap and the token is long-lived. | high | medium | 78 | high | selected | — |
| T2 | Token in logs | refresh token | logging | The token is written to the request log. | Logs are retained. | Exposure needs log access first. | low | low | 40 | medium | excluded | — |

## Risk score
Score: 62
Criticality: high

## Mitigations
| Tag | Title | Description | Yield | Effort | Threat tags | Rule refs | Selection | Justification | Robustness |
|-----|-------|-------------|-------|--------|-------------|-----------|-----------|---------------|------------|
| M1 | Bind the token | Bind the refresh token to the client. | high | medium | T1 | r-auth-01 | selected | — | — |
| M2 | Audit the refresh | Emit a structured audit record. | medium | low | — | r-log-03 | selected | — | — |
| M3 | Redact the log | Redact the token from request logs. | low | low | T2 | — | excluded | — | — |

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

// --- positive ---------------------------------------------------------------------

Deno.test("valid: a finalized assessment validates clean", async () => {
  const { code, json, stderr } = await validate("assessment-branch-task.md", validAssessment());
  assertEquals(code, 0, stderr);
  assertEquals(json.valid, true);
  assertEquals(json.error_count, 0);
  assertEquals(json.errors, []);
  assertEquals(stderr, "");
});

Deno.test("valid: a Threats table with no rows is allowed (a minor triage)", async () => {
  let doc = validAssessment();
  doc = withoutLine(doc, "| T1 |");
  doc = withoutLine(doc, "| T2 |");
  // The mitigations may then carry no threat tags either.
  doc = withoutLine(doc, "| M1 |");
  doc = withoutLine(doc, "| M3 |");
  doc = withLine(doc, "| M2 |", "| M1 |");
  const { code, json } = await validate("assessment-x.md", doc);
  assertEquals(code, 0, JSON.stringify(json.errors));
  assertEquals(json.valid, true);
});

Deno.test("valid: unset verification columns pass at any stage", async () => {
  // Structure-only checking: the script must not care that a `testing` file still has
  // `—` in Robustness, nor that a `development` file has it filled.
  for (
    const doc of [
      withLine(validAssessment(), "Latest stage: development", "Latest stage: testing"),
      withLine(
        validAssessment(),
        "| high | medium | 78 | high | selected | — |",
        "| high | medium | 78 | high | selected | strong |",
      ),
    ]
  ) {
    const { code, json } = await validate("assessment-x.md", doc);
    assertEquals(code, 0, JSON.stringify(json.errors));
  }
});

Deno.test("valid: --lenient accepts a mid-loop file with tag gaps and unsorted risk", async () => {
  let doc = withLine(validAssessment(), "| T2 |", "| T5 |");
  doc = withLine(doc, "| T5 | Token in logs", "| T5 | Token in logs");
  doc = withLine(doc, "| low | low | 40 |", "| low | low | 90 |");
  doc = withLine(doc, "| T2 | — | excluded", "| T5 | — | excluded");

  const strict = await validate("assessment-x.md", doc);
  assertEquals(strict.code, 1);

  const lenient = await validate("assessment-x.md", doc, ["--lenient"]);
  assertEquals(lenient.code, 0, JSON.stringify(lenient.json.errors));
  assertEquals(lenient.json.lenient, true);
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

Deno.test("valid: --lenient accepts a section whose table is not written yet", async () => {
  // The orchestrator opens the file before the worker that fills the table is dispatched.
  let doc = validAssessment();
  for (
    const row of ["| Tag | Title | Asset |", "|-----|-------|-------|--------|", "| T1 |", "| T2 |"]
  ) {
    doc = withoutLine(doc, row);
  }
  // Its mitigations may then reference no threat, so drop the tagged rows with it.
  doc = withLine(doc, "| M1 | Bind the token", "| M1 | Bind the token");
  doc = withLine(doc, "| T1 | r-auth-01 |", "| — | r-auth-01 |");
  doc = withLine(doc, "| T2 | — | excluded", "| — | — | excluded");

  const lenient = await validate("assessment-x.md", doc, ["--lenient"]);
  assertEquals(lenient.code, 0, JSON.stringify(lenient.json.errors));

  const strict = await validate("assessment-x.md", doc);
  assertEquals(strict.code, 1);
  assertStringIncludes(
    strict.json.errors.map((e) => e.message).join("\n"),
    "section holds no table",
  );
});

Deno.test("invalid: --lenient is not a blanket pass", async () => {
  // What IS written is held to the schema whatever the mode — leniency waives only the
  // checks that cannot hold until the file is complete.
  const cases: Array<[string, string]> = [
    [withLine(A, "Latest stage: development", "Latest stage: shipped"), "Latest stage:"],
    [withLine(A, "| high | medium | 78 |", "| severe | medium | 78 |"), "Impact:"],
    [withLine(A, "| T1 | r-auth-01 |", "| T9 | r-auth-01 |"), "is not a threat in this file"],
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
    name: "wrong Threats header",
    doc: withLine(A, "| Tag | Title | Asset |", "| Tag | Name | Asset |"),
    expect: "table header column 2",
  },
  {
    name: "Threats section holds no table",
    doc: withoutLine(
      withoutLine(
        withoutLine(withoutLine(A, "| Tag | Title | Asset |"), "|-----|-------|-------|--------|"),
        "| T1 |",
      ),
      "| T2 |",
    ),
    expect: "section holds no table",
  },
  {
    name: "header without a separator row",
    doc: withoutLine(A, "|-----|-------|-------|--------|"),
    expect: "separator row",
  },
  {
    name: "row with the wrong cell count",
    doc: withLine(A, "| T2 | Token in logs |", "| T2 | Token in logs | extra |"),
    expect: "cells, expected 13",
  },
  {
    name: "malformed threat tag",
    doc: withLine(A, "| T2 | Token in logs", "| X2 | Token in logs"),
    expect: 'Tag: "X2" is not of the form T<n>',
  },
  {
    name: "threat tag gap",
    doc: withLine(A, "| T2 | Token in logs", "| T3 | Token in logs"),
    expect: "breaks the contiguous sequence",
  },
  {
    name: "duplicate threat tag",
    doc: withLine(A, "| T2 | Token in logs", "| T1 | Token in logs"),
    expect: "is a duplicate",
  },
  {
    name: "risk score out of range",
    doc: withLine(A, "| high | medium | 78 |", "| high | medium | 178 |"),
    expect: "Risk score:",
  },
  {
    name: "non-integer risk score",
    doc: withLine(A, "| high | medium | 78 |", "| high | medium | high |"),
    expect: "Risk score:",
  },
  {
    name: "rows not ordered by descending risk",
    doc: withLine(A, "| high | medium | 78 |", "| high | medium | 30 |"),
    expect: "rows must descend by risk",
  },
  {
    name: "bad Impact",
    doc: withLine(A, "| high | medium | 78 |", "| severe | medium | 78 |"),
    expect: "Impact:",
  },
  {
    name: "bad Likelihood",
    doc: withLine(A, "| high | medium | 78 |", "| high | certain | 78 |"),
    expect: "Likelihood:",
  },
  {
    name: "bad threat Criticality",
    doc: withLine(A, "| 78 | high | selected |", "| 78 | severe | selected |"),
    expect: "Criticality:",
  },
  {
    name: "bad threat Selection",
    doc: withLine(A, "| 78 | high | selected |", "| 78 | high | maybe |"),
    expect: "Selection:",
  },
  {
    name: "bad threat Robustness",
    doc: withLine(A, "| high | selected | — |", "| high | selected | brittle |"),
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
    name: "wrong Mitigations header",
    doc: withLine(
      A,
      "| Tag | Title | Description | Yield |",
      "| Tag | Title | Description | Payoff |",
    ),
    expect: "table header column 4",
  },
  {
    name: "malformed mitigation tag",
    doc: withLine(A, "| M2 | Audit the refresh", "| X2 | Audit the refresh"),
    expect: "is not of the form M<n>",
  },
  {
    name: "mitigation tag gap",
    doc: withLine(A, "| M2 | Audit the refresh", "| M4 | Audit the refresh"),
    expect: "breaks the contiguous sequence",
  },
  {
    name: "bad Yield",
    doc: withLine(A, "| high | medium | T1 | r-auth-01 |", "| huge | medium | T1 | r-auth-01 |"),
    expect: "Yield:",
  },
  {
    name: "bad Effort",
    doc: withLine(A, "| high | medium | T1 | r-auth-01 |", "| high | enormous | T1 | r-auth-01 |"),
    expect: "Effort:",
  },
  {
    name: "Threat tags naming an unknown threat",
    doc: withLine(A, "| T1 | r-auth-01 |", "| T9 | r-auth-01 |"),
    expect: 'Threat tags: "T9" is not a threat in this file',
  },
  {
    name: "malformed Threat tags cell",
    doc: withLine(A, "| T1 | r-auth-01 |", "| threat one | r-auth-01 |"),
    expect: "is not of the form T<n>",
  },
  {
    name: "malformed Rule refs cell",
    doc: withLine(A, "| T1 | r-auth-01 |", "| T1 | rule auth 01 |"),
    expect: "is not a rule id",
  },
  {
    name: "bad mitigation Selection",
    doc: withLine(A, "| r-log-03 | selected |", "| r-log-03 | adopted |"),
    expect: "Selection:",
  },
  {
    name: "bad mitigation Robustness",
    doc: withLine(A, "| r-log-03 | selected | — | — |", "| r-log-03 | selected | — | sturdy |"),
    expect: "Robustness:",
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
  const doc = withLine(A, "| high | medium | 78 |", "| severe | medium | 78 |");
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
