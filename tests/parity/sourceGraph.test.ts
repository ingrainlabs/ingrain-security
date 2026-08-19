/**
 * **The shell libs' headers describe a dependency graph. This checks it is the real one.**
 *
 * Each lib's header states who sources it and what it needs sourced first, and those lists
 * are the map a maintainer wires a new consumer from. They had drifted in three places at
 * once — `fork-point.sh` claimed to require `project-root.sh` while calling nothing from
 * it, `project-root.sh` counted `fork-point.sh` among the libs that call into it, and
 * `assessment-write.sh` claimed `normalize_dir`, which it names only to say it does the
 * opposite. Every one of them read as a real constraint and none of them was.
 *
 * All three are derivable, so none of them should have needed a reader to notice:
 *
 * - **who sources whom** — from the `.` commands themselves, both directions;
 * - **the ShellCheck directive beside each** — the same path written twice, so a rename that
 *   updates one and not the other is caught rather than silently un-linting a file;
 * - **what a lib needs** — from the symbols it uses that another lib defines, against the
 *   names its header declares, both directions. A lib that declares nothing must use
 *   nothing, which is what makes "Self-contained" a checked claim rather than a comment.
 */

import { assertEquals, assertGreaterOrEqual } from "@std/assert";
import { walk } from "@std/fs";
import { fromFileUrl, relative } from "@std/path";

const ROOT = fromFileUrl(new URL("../../", import.meta.url));
/** Both lib directories: the skill's, and the hook tree's own. */
const LIB_DIRS = ["skills/ingrain-security/scripts/lib", "hooks/scripts/lib"];
const isLib = (path: string): boolean => LIB_DIRS.some((d) => path.startsWith(d));

interface IShellFile {
  /** Repo-relative path. */
  path: string;
  /** Everything above the first definition or assignment — where a file declares itself. */
  header: string;
  /** The file with whole-line comments removed, so a name counts only where code uses it. */
  code: string;
}

/** True for a sourced lib (`*.sh`) or an extensionless script with a bash shebang. */
function isShell(path: string, text: string): boolean {
  return path.endsWith(".sh") || /^#!.*\b(bash|sh)\b/.test(text.split("\n", 1)[0]);
}

/**
 * A file's self-describing header: everything before the first function definition or
 * top-level assignment. Bounding it there keeps a function's own doc comment out, so a name
 * mentioned while explaining an algorithm is never read as a declared dependency.
 */
function headerOf(text: string): string {
  const lines = text.split("\n");
  const firstDefinition = lines.findIndex((l) =>
    /^[a-z_][a-z0-9_]*\(\)\s*\{/.test(l) || /^[A-Z][A-Z0-9_]*=/.test(l)
  );
  return (firstDefinition === -1 ? lines : lines.slice(0, firstDefinition)).join("\n");
}

async function readShellFiles(): Promise<IShellFile[]> {
  const files: IShellFile[] = [];
  for (const dir of ["skills/ingrain-security/scripts", "hooks"]) {
    for await (const entry of walk(`${ROOT}${dir}`, { includeDirs: false })) {
      const text = await Deno.readTextFile(entry.path).catch(() => "");
      if (!text || !isShell(entry.path, text)) continue;
      files.push({
        path: relative(ROOT, entry.path),
        header: headerOf(text),
        code: text.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n"),
      });
    }
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

const FILES = await readShellFiles();
const LIBS = FILES.filter((f) => isLib(f.path));

/** Every function and constant the libs export, mapped to the lib that owns it. */
const LIB_SYMBOLS = new Map<string, string>();
for (const lib of LIBS) {
  for (const m of lib.code.matchAll(/^([a-z_][a-z0-9_]*)\(\)\s*\{/gm)) {
    LIB_SYMBOLS.set(m[1], lib.path);
  }
  for (const m of lib.code.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)) LIB_SYMBOLS.set(m[1], lib.path);
}

/** The libs a file loads at runtime, in order, read from its `.` commands. */
function sourcedLibs(file: IShellFile): string[] {
  return file.code
    .split("\n")
    .filter((l) => /(^|\s)\.\s+"/.test(l))
    .flatMap((l) => [...l.matchAll(/lib\/([a-z-]+\.sh)/g)].map((m) => m[1]));
}

/**
 * The libs a file's `# shellcheck source=` directives point at, in order. Takes the RAW text,
 * not the comment-stripped `code`: a directive is a comment, which is the whole point of it.
 */
function directedLibs(text: string): string[] {
  return [...text.matchAll(/^#\s*shellcheck source=\S*?lib\/([a-z-]+\.sh)/gm)].map((m) => m[1]);
}

/** Symbols a file uses that some OTHER lib defines. */
function foreignSymbols(file: IShellFile): string[] {
  const used: string[] = [];
  for (const [symbol, owner] of LIB_SYMBOLS) {
    if (owner === file.path) continue;
    if (new RegExp(`\\b${symbol}\\b`).test(file.code)) used.push(symbol);
  }
  return used.sort();
}

Deno.test("discovery: the shell files and their exported symbols are found", () => {
  // Both sides of every check below come from these two sets; if either scan breaks, the
  // whole file passes by comparing nothing.
  assertGreaterOrEqual(LIBS.length, 5, "the lib scan found almost nothing");
  assertGreaterOrEqual(FILES.length - LIBS.length, 5, "the consumer scan found almost nothing");
  assertGreaterOrEqual(LIB_SYMBOLS.size, 15, "the exported-symbol scan found almost nothing");
});

Deno.test("every sourced lib exists, and its ShellCheck directive names the same file", async () => {
  const problems: string[] = [];
  for (const file of FILES) {
    if (isLib(file.path)) continue;
    const text = await Deno.readTextFile(`${ROOT}${file.path}`);
    const sourced = sourcedLibs(file);
    const directed = directedLibs(text);

    for (const lib of sourced) {
      const known = LIBS.some((l) => l.path.endsWith(`/${lib}`));
      if (!known) problems.push(`${file.path} sources lib/${lib}, which does not exist`);
    }
    // A directive that has drifted from its source line silently drops the lib out of
    // ShellCheck's view, which is exactly the coverage nobody notices losing.
    if (directed.join(",") !== sourced.join(",")) {
      problems.push(
        `${file.path}: shellcheck directives [${directed.join(", ")}] ` +
          `do not match the sourced libs [${sourced.join(", ")}]`,
      );
    }
  }
  assertEquals(problems, [], problems.join("\n"));
});

Deno.test("each lib's 'Sourced by' list is the real consumer set", () => {
  const problems: string[] = [];
  for (const lib of LIBS) {
    const name = lib.path.split("/").pop()!;
    const actual = FILES
      .filter((f) => !isLib(f.path) && sourcedLibs(f).includes(name))
      .map((f) => f.path)
      .sort();
    // The header names consumers by path, so a consumer is documented iff its path appears
    // in the block. Read off the whole header: the list's own heading wording is free to
    // change without breaking this.
    const documented = actual.filter((path) => lib.header.includes(path));
    const undocumented = actual.filter((path) => !documented.includes(path));
    if (undocumented.length) {
      problems.push(`${name} is sourced by, but does not list: ${undocumented.join(", ")}`);
    }
    for (const claimed of FILES.filter((f) => !isLib(f.path))) {
      if (lib.header.includes(claimed.path) && !actual.includes(claimed.path)) {
        problems.push(`${name} lists ${claimed.path} as a consumer, which does not source it`);
      }
    }
  }
  assertEquals(problems, [], problems.join("\n"));
});

Deno.test("every lib is FLAT — no lib calls into another", () => {
  // The layering rule, made checkable. A lib is a leaf: pure over its arguments, sourceable
  // in any order, readable on its own. Composing two of them is a top-level script's job —
  // `assessment-mint`, `branch-delta`, the hooks — because the script is the program.
  //
  // What this replaces: a "declares exactly the sibling symbols it uses" check, which kept
  // the dependency COMMENTS honest but blessed the dependencies themselves. mint.sh required
  // four siblings sourced in an unstated order, and `resolve_phase` read fork-point.sh's
  // `DELTA_*` globals behind its caller's back — a dependency no signature declared and no
  // reader could see. Both are gone; this is what stops them coming back.
  const problems: string[] = [];
  for (const lib of LIBS) {
    const used = foreignSymbols(lib);
    if (used.length) {
      problems.push(
        `${lib.path.split("/").pop()} calls into a sibling lib: ${used.join(", ")} — ` +
          `take them as arguments and let the calling script compose`,
      );
    }
  }
  assertEquals(problems, [], problems.join("\n"));
});
