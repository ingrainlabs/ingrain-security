/**
 * Behavioral tests for `skills/ingrain-security/scripts/threat-retag` — the deterministic
 * half of risk scoring. Like its siblings here these EXECUTE the script under bash against a
 * throwaway dir, so they need the `test:hooks` run+write permissions and call no model.
 *
 * **This is where the re-tag's central promise is proved.** The script moves entries by line
 * span, so every phase block travels with its threat byte for byte and only the `T<nn>` token
 * in a heading is ever rewritten. The script checks its own line arithmetic and nothing more;
 * the byte-preservation claim is asserted from the outside, here — a multiset comparison over
 * every non-heading line, which no span bug can satisfy accidentally.
 *
 * That property is not academic. Re-tagging used to be the `ingrain-risk-scorer`'s, the one
 * writer told to rewrite `## Threats` wholesale, and a live run came back having flattened a
 * populated `#### test` block — erasing a prior pass's verdicts, which reads downstream as
 * "this threat was never verified".
 *
 * **Two kinds of fixture, and the split is deliberate.** Anything asserting how the script reads
 * or rewrites a real assessment runs on one `scripts/assessment-mint` produced
 * (`mintedAssessment`) — the parser is then pointed at the document a live run hands it, card and
 * neighbouring sections included, rather than at this file's rendering of it. The hand-authored
 * builder below covers what a mint cannot produce: a marker-less entry from an older plugin, CRLF
 * endings, a half-scored section, a file with no `## Threats` heading, a target the mint would
 * never name.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl } from "@std/path";
import { assertBlockCarriedAcross, phaseBlocksOf, threatEntries } from "../lib/matchers.ts";

const ROOT = fromFileUrl(new URL("../../", import.meta.url));
const SCRIPT = `${ROOT}skills/ingrain-security/scripts/threat-retag`;
const MINT_SCRIPT = `${ROOT}skills/ingrain-security/scripts/assessment-mint`;

interface IResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** What the script emits. `threats` is empty on every refusal. */
interface IRetagJson {
  retagged: boolean;
  reason: string;
  count: number;
  threats: Array<{
    tag: string;
    previous_tag: string;
    title: string;
    risk_score: number;
    criticality: string;
  }>;
  malformed: string[];
  instruction: string;
}

async function run(args: string[]): Promise<IResult> {
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

/**
 * A disposable `.ingrain-security/` holding one hand-authored assessment, and that file's path.
 *
 * For the shapes a mint cannot produce — a marker-less entry from an older plugin, CRLF endings,
 * a file with no `## Threats` heading, a target the mint would never name. Anything that turns on
 * the document's real shape uses `mintedAssessment` instead.
 */
async function seedAssessment(body: string, name = "assessment-fixture.md"): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "ingrain-retag-" });
  await Deno.mkdir(`${dir}/.ingrain-security`);
  const path = `${dir}/.ingrain-security/${name}`;
  await Deno.writeTextFile(path, body);
  return path;
}

/** The one field this file reads from the mint's JSON. */
interface IMintJson {
  assessment_abs: string;
}

/**
 * A REAL assessment: minted by `scripts/assessment-mint`, then filled the way a run fills it —
 * `entries` under the section's own field card, the plan-level residual under `## Risk score`.
 *
 * **The hand-authored fixtures stand in for the skeleton, and that is what this covers.** Theirs
 * is a one-line field card, so nothing in them would notice the real one changing shape — a
 * renamed marker, a card that grew a line beginning with `###`, a section reordered around
 * `## Threats`. Minting means the parser is pointed at the document the mint actually produces,
 * rather than at this file's memory of it.
 */
async function mintedAssessment(entries: string[]): Promise<{ path: string; body: string }> {
  /** git and the mint are driven THROUGH bash, which keeps this inside `--allow-run=bash`. */
  const bash = async (args: string[], cwd: string): Promise<string> => {
    const out = await new Deno.Command("bash", {
      args,
      cwd,
      clearEnv: true,
      // git's config supplied by the test rather than by the machine: a developer's global
      // config carries an `init.defaultBranch` and hooks a CI runner does not, and the repo
      // under test is disposable, so what git reads about it has to be too.
      env: {
        PATH: Deno.env.get("PATH") ?? "",
        HOME: Deno.env.get("HOME") ?? "",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_SYSTEM: "/dev/null",
      },
      stdout: "piped",
      stderr: "piped",
    }).output();
    if (out.code !== 0) {
      throw new Error(
        `${args.join(" ")} exited ${out.code}: ${new TextDecoder().decode(out.stderr)}`,
      );
    }
    return new TextDecoder().decode(out.stdout);
  };

  const dir = await Deno.makeTempDir({ prefix: "ingrain-retag-mint-" });
  // No commit: the mint resolves the branch with `git branch --show-current`, which answers on an
  // unborn one, and the branch slug is the only thing it needs a repo for here.
  await bash(["-c", "git init -q && git checkout -q -b feature/retag-fixture"], dir);
  const { assessment_abs: path }: IMintJson = JSON.parse(
    await bash([MINT_SCRIPT, "claude", "--title", "retag fixture"], dir),
  );

  const lines = (await Deno.readTextFile(path)).split("\n");
  const residualAt = lines.indexOf("## Risk score");
  assert(residualAt > 0, "the minted skeleton carries no `## Risk score` heading");

  // The plan-level residual, as the scoring step writes it. Matched from the heading DOWN and on
  // the WHOLE line, so the `Score:` and `Criticality:` named inside that section's own field card
  // are never what gets filled.
  for (const [field, value] of [["Score", "88"], ["Criticality", "critical"]]) {
    const at = lines.indexOf(`${field}:`, residualAt);
    assert(at > residualAt, `the minted skeleton has no empty \`${field}:\` under ## Risk score`);
    lines[at] = `${field}: ${value}`;
  }

  // Entries go where the generator puts them: under the card, above the next section. The blank
  // line the skeleton already carries stays put and becomes the separator above the first entry,
  // so the spacing is the document's own rather than this file's idea of it.
  lines.splice(residualAt, 0, ...entries.flatMap((e) => [...e.split("\n"), ""]));

  const body = lines.join("\n");
  await Deno.writeTextFile(path, body);
  return { path, body };
}

interface IEntry {
  tag: string;
  title: string;
  /** The whole `#### score` body. A blank string writes the marker with nothing under it. */
  score: string;
  /** Anything after `#### usergate`, so a prior gate decision can be put in the way. */
  usergate?: string;
  /** Anything after `#### test`, so a prior verification's verdicts can be put in the way. */
  test?: string;
}

const entry = (e: IEntry): string =>
  [
    `### ${e.tag} — ${e.title}`,
    "",
    "#### gen",
    `Asset: the asset of ${e.tag}`,
    `Vector: the vector of ${e.tag}`,
    `Description: what ${e.tag} is`,
    "Assumptions: none",
    "",
    "#### score",
    ...(e.score ? [e.score] : []),
    "",
    "#### usergate",
    ...(e.usergate ? [e.usergate] : []),
    "",
    "#### test",
    ...(e.test ? [e.test] : []),
  ].join("\n");

const score = (impact: string, likelihood: string, risk: number, band: string): string =>
  [
    `Justification: why ${risk} is the number`,
    `Impact: ${impact}`,
    `Likelihood: ${likelihood}`,
    `Risk score: ${risk}`,
    `Criticality: ${band}`,
  ].join("\n");

/**
 * A whole assessment around the entries, with sections on both sides of `## Threats`.
 *
 * The hand-authored stand-in: enough shape for the edge cases to be about the edge, and a
 * one-line field card where the skeleton carries a thirty-line one. Where the real shape is what
 * is under test, `mintedAssessment` supplies it.
 */
const assessment = (entries: string[]): string =>
  [
    "# Security assessment — fixture",
    "",
    "## Task",
    "Title: fixture",
    "Latest stage: development",
    "Schema version: 2",
    "",
    "## Threats",
    "<!-- the field card: #### gen, #### score, #### usergate, #### test -->",
    "",
    ...entries.map((e) => `${e}\n`),
    "## Risk score",
    "Score: 88",
    "Criticality: critical",
    "",
    "## Org rules",
    "",
  ].join("\n");

/** The `### T<nn> — …` heading lines, in document order. */
const headings = (text: string): string[] =>
  text.split("\n").filter((line) => /^### T\d+\b/.test(line));

/**
 * Every line the re-tag is not allowed to touch, sorted.
 *
 * A multiset rather than a sequence, because the whole point is that entries MOVED: comparing
 * in order would fail on a correct run. Headings are excluded because they are the one line the
 * script does rewrite, and they are asserted separately.
 */
const nonHeadingLines = (text: string): string[] =>
  text.split("\n").filter((line) => !/^### T\d+\b/.test(line)).sort();

Deno.test("threat-retag: sorts by risk, renumbers from T01, and moves nothing else", async (t) => {
  // On a MINTED file, so the promise below is made about the document a run actually re-tags —
  // real field card, real neighbouring sections, real line endings.
  const { path, body: before } = await mintedAssessment([
    entry({ tag: "T01", title: "low risk one", score: score("low", "medium", 30, "low") }),
    entry({
      tag: "T02",
      title: "the dangerous one",
      score: score("critical", "high", 88, "critical"),
      usergate: "Selection: excluded",
      test: [
        "Robustness justification: judged in a prior pass",
        "Robustness: adequate",
        "Residual path: —",
        "Evidence: services/auth/signup.ts:31",
      ].join("\n"),
    }),
    entry({ tag: "T03", title: "middling", score: score("medium", "medium", 55, "medium") }),
  ]);
  const result = await run(["--assessment", path]);
  const json: IRetagJson = JSON.parse(result.stdout);
  const after = await Deno.readTextFile(path);

  await t.step("exits 0 and reports the re-tag", () => {
    assertEquals(result.code, 0, result.stderr);
    assertEquals(json.retagged, true);
    assertEquals(json.count, 3);
  });

  await t.step("the file reads T01..Tn in descending risk order", () => {
    assertEquals(headings(after), [
      "### T01 — the dangerous one",
      "### T02 — middling",
      "### T03 — low risk one",
    ]);
  });

  await t.step("the emitted order maps each new id back to the one that was scored", () => {
    assertEquals(json.threats.map((entry) => entry.tag), ["T01", "T02", "T03"]);
    assertEquals(json.threats.map((entry) => entry.previous_tag), ["T02", "T03", "T01"]);
    assertEquals(json.threats.map((entry) => entry.risk_score), [88, 55, 30]);
    assertEquals(json.threats.map((entry) => entry.criticality), ["critical", "medium", "low"]);
    assertEquals(json.threats[0].title, "the dangerous one");
  });

  await t.step("every line except the three headings survives byte for byte", () => {
    // The assertion the whole script exists to earn. A span bug that swallowed a marker, or
    // dropped a blank line, or duplicated a block, changes this multiset; a correct move
    // cannot.
    assertEquals(nonHeadingLines(after), nonHeadingLines(before));
  });

  await t.step("the section's field card stays above the entries it describes", () => {
    // The card is the write contract every later stage reads, and the multiset above cannot
    // see it MOVE — only vanish. A span bug that took the `## Threats` boundary an entry too
    // early would carry the card into the list and satisfy every other assertion here.
    const card = after.indexOf("THE BLOCK IS THE OWNERSHIP RECORD");
    assert(card > after.indexOf("## Threats"), "the field card left its own section");
    assert(card < after.indexOf("### T01"), "the field card sank below the first entry");
  });

  await t.step("every entry still carries its four markers, in order", () => {
    const entries = threatEntries(after);
    assertEquals(entries.length, 3);
    for (const found of entries) {
      assertEquals(phaseBlocksOf(found).map((block) => block.name), [
        "gen",
        "score",
        "usergate",
        "test",
      ]);
    }
  });

  await t.step("a prior pass's gate decision and verdicts travel with their threat", () => {
    // The regression that motivated moving this out of a worker: an entry rewritten from
    // memory came back with `#### test` flattened, and an emptied block reads as "never
    // verified" rather than as data loss.
    assertBlockCarriedAcross(after, "usergate", "Selection: excluded", "prior gate decision");
    assertBlockCarriedAcross(after, "test", "Robustness: adequate", "prior verdict");
    assertBlockCarriedAcross(
      after,
      "test",
      "Evidence: services/auth/signup.ts:31",
      "prior evidence",
    );
  });

  await t.step("running it again changes nothing", () => {
    // Determinism is what makes the re-tag safe to re-run on a re-assessment: the sort is a
    // total order, so a section already in that order is a fixed point.
    return run(["--assessment", path]).then(async (second) => {
      assertEquals(second.code, 0, second.stderr);
      assertEquals(await Deno.readTextFile(path), after);
    });
  });
});

Deno.test("threat-retag: ties break by impact, then likelihood, then the incoming id", async () => {
  // All four entries carry the SAME risk score, so nothing but the tie-breaks decides the
  // order — and the last of them is unique within the file, which is what makes the total
  // order total. Two runs over the same scores must produce the same ids.
  const before = assessment([
    entry({
      tag: "T01",
      title: "same score, low impact",
      score: score("low", "high", 60, "medium"),
    }),
    entry({
      tag: "T02",
      title: "same score, high impact",
      score: score("high", "low", 60, "medium"),
    }),
    entry({
      tag: "T03",
      title: "same impact, higher likelihood",
      score: score("high", "high", 60, "medium"),
    }),
    entry({ tag: "T04", title: "identical to T02", score: score("high", "low", 60, "medium") }),
  ]);
  const path = await seedAssessment(before);
  const result = await run(["--assessment", path]);
  const json: IRetagJson = JSON.parse(result.stdout);

  assertEquals(result.code, 0, result.stderr);
  assertEquals(json.threats.map((entry) => entry.previous_tag), ["T03", "T02", "T04", "T01"]);
  assertEquals(nonHeadingLines(await Deno.readTextFile(path)), nonHeadingLines(before));
});

Deno.test("threat-retag: refuses a half-scored section and leaves the file alone", async () => {
  // An id is permanent from here — guidance references it — so an order computed over entries
  // the scoring stage never reached would freeze the wrong priority, and nothing downstream
  // could correct it. Refusing whole is the only safe answer, and the file must come through
  // untouched so the missing scores can simply be filled in.
  const before = assessment([
    entry({ tag: "T01", title: "scored", score: score("high", "high", 70, "high") }),
    entry({ tag: "T02", title: "never scored", score: "" }),
  ]);
  const path = await seedAssessment(before);
  const result = await run(["--assessment", path]);
  const json: IRetagJson = JSON.parse(result.stdout);

  assertEquals(result.code, 0, result.stderr);
  assertEquals(json.retagged, false);
  assertEquals(json.reason, "unscored-entries");
  assertEquals(json.threats, []);
  assertEquals(json.malformed.length, 1);
  assertStringIncludes(json.malformed[0], "T02");
  assertEquals(await Deno.readTextFile(path), before);
});

Deno.test("threat-retag: an out-of-range risk score is unscored, not a 0", async () => {
  // Reading `Risk score: 150` as a number would sort that threat to the top and freeze it
  // there. It is a malformed field, and the same refusal covers it.
  const path = await seedAssessment(assessment([
    entry({ tag: "T01", title: "in range", score: score("high", "high", 70, "high") }),
    entry({ tag: "T02", title: "out of range", score: score("high", "high", 150, "high") }),
  ]));
  const json: IRetagJson = JSON.parse((await run(["--assessment", path])).stdout);

  assertEquals(json.retagged, false);
  assertEquals(json.reason, "unscored-entries");
  assertStringIncludes(json.malformed[0], "T02");
});

Deno.test("threat-retag: reads a marker-less entry by field presence", async () => {
  // A file written by an older plugin carries no `####` markers at all. The schema's rule is
  // that such an entry falls back to reading its fields by presence — per ENTRY, never per
  // file — and the CLI already does this, so the re-tag must not be the one stage that
  // refuses to read it.
  const flat = (tag: string, title: string, risk: number): string =>
    [
      `### ${tag} — ${title}`,
      "Asset: an asset",
      "Vector: a vector",
      `Risk score: ${risk}`,
      "Impact: high",
      "Likelihood: high",
      "Criticality: high",
    ].join("\n");
  const path = await seedAssessment(
    assessment([flat("T01", "quiet", 20), flat("T02", "loud", 90)]),
  );
  const result = await run(["--assessment", path]);
  const json: IRetagJson = JSON.parse(result.stdout);

  assertEquals(result.code, 0, result.stderr);
  assertEquals(json.retagged, true);
  assertEquals(json.threats.map((entry) => entry.previous_tag), ["T02", "T01"]);
});

Deno.test("threat-retag: reads scores only from the ## Threats section", async () => {
  // `## Risk score` carries a `Score:` line and the plan-level `Criticality:` beside it, its own
  // field card names `Risk score (0-100)` in prose, and a future section could carry a real
  // `Risk score:` of its own. The section bound is what stops any of those being read as the
  // last threat's — the same bounding `count_selected_in_section` applies for the same reason.
  // Minted, because those neighbours and their cards are precisely what is under test.
  const { path } = await mintedAssessment([
    entry({ tag: "T01", title: "first", score: score("low", "low", 10, "low") }),
    entry({ tag: "T02", title: "second", score: score("high", "high", 90, "critical") }),
  ]);
  const json: IRetagJson = JSON.parse((await run(["--assessment", path])).stdout);

  assertEquals(json.threats.map((entry) => entry.risk_score), [90, 10]);
  // The plan-level residual is untouched by the entry sort. Both lines together, because the
  // pair is what the scoring step writes and a sort that reached into the section would take
  // one of them.
  assertStringIncludes(await Deno.readTextFile(path), "\nScore: 88\nCriticality: critical\n");
});

Deno.test("threat-retag: preserves CRLF line endings", async () => {
  // Git for Windows is a supported platform, so an assessment can legitimately arrive with
  // CRLF endings. Lines are matched with the `\r` stripped and written back with it intact —
  // rewriting the file LF-only would be a whole-file diff on every re-tag.
  const before = assessment([
    entry({ tag: "T01", title: "quiet", score: score("low", "low", 20, "low") }),
    entry({ tag: "T02", title: "loud", score: score("high", "high", 90, "critical") }),
  ]).replaceAll("\n", "\r\n");
  const path = await seedAssessment(before);
  const result = await run(["--assessment", path]);
  const after = await Deno.readTextFile(path);

  assertEquals(JSON.parse(result.stdout).retagged, true);
  assertStringIncludes(after, "### T01 — loud\r\n");
  assertEquals(after.split("\n").length, before.split("\n").length);
  assert(!/[^\r]\n/.test(after), "a line lost its carriage return");
});

Deno.test("threat-retag: every no-op is a complete JSON object, not a failure", async (t) => {
  // Callers route on `retagged`/`reason`, never on a status code — the same contract
  // branch-delta states for its degraded cases. A rules-only review reaches the empty-section
  // case legitimately, so a non-zero exit there would fail a perfectly ordinary run.
  await t.step("a section with no entries", async () => {
    const path = await seedAssessment(assessment([]));
    const result = await run(["--assessment", path]);
    assertEquals(result.code, 0, result.stderr);
    assertEquals(JSON.parse(result.stdout).reason, "no-threat-entries");
  });

  await t.step("a file with no `## Threats` heading at all", async () => {
    const path = await seedAssessment("# Security assessment\n\n## Task\nTitle: x\n");
    const result = await run(["--assessment", path]);
    assertEquals(result.code, 0, result.stderr);
    assertEquals(JSON.parse(result.stdout).reason, "no-threats-section");
  });

  await t.step("a file that is not there", async () => {
    const path = await seedAssessment("placeholder");
    await Deno.remove(path);
    const result = await run(["--assessment", path]);
    assertEquals(result.code, 0, result.stderr);
    assertEquals(JSON.parse(result.stdout).reason, "no-assessment-file");
  });
});

Deno.test("threat-retag: refuses a target that is not an assessment artifact", async (t) => {
  // The safety check on a caller's argument: this script REWRITES the file it is given, so a
  // path the orchestrator got wrong — a plan file, a source file — must be refused rather than
  // re-tagged. Lexical on purpose: an assessment in a temp tree, a second checkout or a nested
  // repo is still an assessment, and a containment test against a resolved project root would
  // refuse every one of them.
  await t.step("a file outside `.ingrain-security/`", async () => {
    const dir = await Deno.makeTempDir({ prefix: "ingrain-retag-" });
    const path = `${dir}/plan.md`;
    await Deno.writeTextFile(path, assessment([]));
    const result = await run(["--assessment", path]);
    assertEquals(result.code, 2);
    assertStringIncludes(result.stderr, "refusing");
  });

  await t.step("a file inside it that the mint would never name", async () => {
    const path = await seedAssessment(assessment([]), "notes.md");
    const result = await run(["--assessment", path]);
    assertEquals(result.code, 2);
    assertStringIncludes(result.stderr, "refusing");
  });

  await t.step("an assessment reached through a symlink", async () => {
    // Following it would write outside the folder the caller believes it is writing into.
    const path = await seedAssessment(assessment([]));
    const link = `${path.replace(/[^/]+$/, "")}assessment-link.md`;
    await Deno.symlink(path, link);
    const result = await run(["--assessment", link]);
    assertEquals(result.code, 2);
    assertStringIncludes(result.stderr, "refusing");
  });
});

Deno.test("threat-retag: usage errors exit 2 and say what to try", async (t) => {
  await t.step("no arguments", async () => {
    const result = await run([]);
    assertEquals(result.code, 2);
    assertStringIncludes(result.stderr, "--help");
  });

  await t.step("an unknown flag", async () => {
    const result = await run(["--retag-everything"]);
    assertEquals(result.code, 2);
    assertStringIncludes(result.stderr, "--help");
  });

  await t.step("--assessment with no value", async () => {
    const result = await run(["--assessment"]);
    assertEquals(result.code, 2);
    assertStringIncludes(result.stderr, "needs a value");
  });

  await t.step("--help exits 0 and documents the refusal reasons", async () => {
    const result = await run(["--help"]);
    assertEquals(result.code, 0);
    for (const reason of ["no-assessment-file", "no-threat-entries", "unscored-entries"]) {
      assertStringIncludes(result.stdout, reason);
    }
  });
});
