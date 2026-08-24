---
name: ingrain-security
description: >-
  Finds the security holes in a change while they are still cheap to fix, then verifies the
  implementation actually closed them.
  **Before you build** — run it AS THE FINAL STEP of building an implementation plan, before
  you present it or write any code. It works out what could go wrong, ranks it by risk, and
  asks you what is worth acting on. What you pick becomes work in the plan.
  **After you build** — run it AFTER you have implemented code for that plan, but before you
  present or commit it. It checks the code against those decisions and reports which ones held.
  The two are mutually exclusive, and it works out which applies. Use it on any change that
  might touch security — it opens by asking whether a review is warranted.
license: MIT
compatibility: >-
  Built for agent hosts that can dispatch subagents (Claude Code, Codex). Requires bash, git, jq
  and the usual POSIX text tools (grep, sed, coreutils); on Windows, Git for Windows supplies the
  bash the hooks run through. The optional `ingrain`
  CLI, plus network access to reach the platform, adds org-rule retrieval and assessment syncing;
  without it the review runs on the threat axis alone.
metadata:
  author: Ingrain Labs
allowed-tools: Bash(ingrain context:*) Bash(ingrain record:*)
---

<SUBAGENT-STOP>
If you were dispatched as a worker subagent (ingrain-threat-generator, ingrain-threat-critic,
ingrain-rule-critic, ingrain-rule-verifier, ingrain-threat-verifier), do the one job you were given
and return. The orchestration — Development and Testing alike — is run by the session that
dispatched you; you are one step inside it.
</SUBAGENT-STOP>

<EXTREMELY-IMPORTANT>
Security analysis is the FINAL step of planning. Build the plan in full first — affected files,
concrete implementations, tests. The trigger is that *state*, reached alike by an **ad-hoc plan**
worked out inline and a **formal planning session** (plan mode, a design doc): detailed plan,
implementation still ahead. Run the review there, before you present it or write any code, then
fold its results back into the plan. At a 1% chance of touching security, run it — its first act is
to ask the user whether to review, so the cost of being wrong here is one question.
</EXTREMELY-IMPORTANT>

## Phase select — do this FIRST

Two phases. **Development — plan review** (`references/development/flow.md`) runs on a finished
plan, before code. **Testing — verification** (`references/testing/verification-pass.md`) runs on
the code that plan produced. Decide which from repo state, before anything else.

**If the user named a phase, that is the answer.** "Verify the implementation" → **Testing**.
"Review this plan" → **Development**. Skip the routing below — but **not the script batch**: a named
phase skips the *routing*, never the mint. Both phases open the assessment at `assessment_abs` and
neither can build that path, so issue the batch below first and carry on into the flow. Testing
states the same rule at its step 0.

Otherwise **issue both bundled scripts in ONE block** — read-only, deterministic and mutually
independent, so together they cost a single round-trip. Your SessionStart context carries each one
ready to run (plugin root and host already substituted):

```ingrain-script
bash <plugin>/skills/ingrain-security/scripts/assessment-mint <host> --title "<task title>"
bash <plugin>/skills/ingrain-security/scripts/branch-delta <host>
```

**Every field you will need for the whole run is declared below — keep them all.** No step
re-mints anything, except the recovery case named under `siblings`. (A run that arrived by a
**named phase** has not issued the batch at all yet — it issues it here, once.) Obey each script's
`instruction` field. Both scripts emit more than this; anything not listed here is diagnostic.

**From the mint —**

- **`assessment_abs`** — the absolute path — is the write target for every worker dispatch, every
  Write/Edit, and finalize. The relative `assessment_path`
  (`.ingrain-security/assessment-<branch-slug>-<task-slug>.md`) is a **display form** only: prose,
  tables and plan-file links.
- **`plugin_root`** — the absolute root of this plugin, which is **not** the project root and
  cannot be derived from it. Every worker dispatch pastes it in front of the reference-file path,
  for the same reason it pastes `assessment_abs` in full: a subagent's cwd is the user's project,
  so a relative `references/…` resolves to `<project>/references/…` and the read fails outright.
- **`branch_slug`** — this branch, slugified; empty when HEAD is detached. Step 0's prior-analysis
  lookup matches on it, and it is the branch half of the file's identity — which is
  why re-minting the same task on the same branch resolves to the same file.
- **`phase` / `phase_reason`** — the resolved route, and why. Read it and act; see below.
- **`has_content`** — `true` once a stage has written into the assessment. A mint always leaves a
  file behind — it seeds an empty skeleton when none exists, and **never rewrites one that does** —
  so the file being on disk says nothing either way, and this is the field that tells a fresh review
  from a resumption. It is also what makes the `siblings` re-mint below safe: re-running the mint
  reads the file, it never resets it.
- **`selected_threats` / `selected_rules`** — how many drivers the user has put in scope on each
  axis, counted from the file the mint just read. Together they decide `phase`, so you never count
  them yourself; carry them because they are the one thing that makes a route legible — `0` on both
  is an analysis still mid-flight, while a gated set with no delta is an implementation not yet
  written.
- **`siblings`** — assessments already on this branch that **this title did not mint**, listed only
  when `has_content: false`. Non-empty means the mint found no file for the title you gave it while
  other written assessments sit beside it — which is what drives `phase: requires_judgement`
  (`siblings_present`) below. **Open each and read its `## Task` Title.** If one is this same task
  under different wording, re-run the mint with that Title **verbatim** and use the result — a
  paraphrase mints a different path, so the alternative is re-reviewing an implemented change from
  scratch and abandoning the prior analysis. This is the one sanctioned re-mint. The minter never
  guesses which sibling is yours: choosing wrong would write into another task's assessment, which
  is the harm the never-glob rule below exists to prevent.

**From `branch-delta` —**

- **`delta_empty: false`** means commits since the fork point, an uncommitted change, or both. It
  already fed `phase`, so Phase select needs nothing from it; keep it for context when a route
  looks wrong.
- **`base_ref` / `diff_ref`** — the parent branch, and the merge-base commit Testing actually diffs
  against. `diff_ref` is the run's fixed basis: pass it verbatim to every verifier, never re-derive
  it per dispatch and never substitute HEAD.
- **`changed_files`** — **every** file this change touched, already resolved: `[{path, status}]`
  over committed, staged, unstaged and untracked. No single git command covers all four, which is
  why the script does the merge rather than leaving Testing to assemble it. It is the review's
  **starting point, not its boundary** — a threat survives, and a control goes missing, in code
  the change never touched.
- **Reading the change is the script's job too** — `branch-delta <host> diff --ref <diff_ref>`, or
  the same with paths appended. Nobody in this review hand-writes a `git diff`: a brewed command
  drifts between the orchestrator and each verifier, and the run then reads several different
  changes while reporting one.
- **`fallback`** — `true` when no fork point resolved, with `reason` saying why. Read that script's
  `instruction`, which states whether the review is narrowed by it.
  → `references/lib/branch-delta.md` owns the refs and why this, not `git status`, is the signal.

**The mint resolves the route. Read `phase` and act:**

- **`development`** → the plan review. Announce it and go.
- **`testing`** → read `references/testing/verification-pass.md` NOW.
- **`requires_judgement`** → the route turns on something no script may decide. `phase_reason`
  names which, and only these two exist:

| `phase_reason` | What is ambiguous | Resolve it |
|---|---|---|
| `siblings_present` | This title minted nothing, which is **also** what a paraphrased title looks like — the real analysis may be the written assessment sitting beside it, possibly one already implemented. | Open each `siblings` entry and read its `## Task` Title. If one is this task under different wording, re-run the mint with that Title **verbatim** and use the result. Otherwise it is a fresh task: Development, start at Step 0. |
| `delta_unreliable` | Drivers are gated and the tree is clean, which normally means the implementation is still ahead — but no fork point resolved, so **committed work is invisible** and `delta_empty` measured only the working tree. | Look at whether this branch already carries the implementation (`git log`), or ask. Implementation present → Testing; genuinely not started → Development. |

`phase_reason` also names the settled cases — `fresh_task`, `resume_analysis`,
`implementation_ahead`, `verify_now` — so the announce line can say *why* in four words.

**A phase the user named still wins**, per the rule above: `phase` reads repo state, and an
explicit request is intent.

**`selected_threats` and `selected_rules` are SUMMED, never weighed separately**, because either
axis alone sustains a verification: a review that selected no threat but accepted one org rule
still has a control to judge, and a rules-only review is an ordinary outcome rather than a
stranded state. Both count **drivers, never guidance** — guidance is not gated, so its presence
says nothing about whether anything was decided.

How to classify three less-obvious repo states. Verdict first, then why:
- **A branch delta with no assessment for this task → Development (`fresh_task`).** A fresh task on a
  branch already carrying unrelated commits or WIP mints a fresh path, so `has_content: false`; a
  delta alone is never a Testing signal. The mint is keyed on branch **+ task title**, binding an
  assessment to one task — so take `has_content` at its word rather than globbing the folder, which
  surfaces another task's file. The mint's own `siblings` list is the sanctioned version of that
  lookup: it reports what is there without choosing, so you decide by reading each candidate's
  recorded Title rather than by matching filenames.
- **`Latest stage: testing`, delta grown since → Testing again (`verify_now`).** It records that
  a verification ran, not that the task is closed. What a re-verification overwrites, and what it
  must leave alone, is `verification-pass.md`'s — do not re-derive it here.
- **A `minor` verdict → Development (`resume_analysis`)** — no driver was selected on either axis, so there is
  nothing to verify. An explicit request sends you to Testing, which stops at its
  own no-drivers case; otherwise the run resumes Development and puts the review question again.
  Either way the run ends at Step 0, which is right for a minor change.

**Announce the phase you picked in your opening line.** Each flow file carries its own opening
phrase — use the one belonging to the phase you routed to, so a misroute costs the user one turn
instead of a whole pass.

# Security review loop

Both phases work the same way: **you orchestrate, dispatched subagents do the work that needs
fresh eyes, and the assessment file is how every stage hands off.** Each worker is a role a
subagent adopts by reading its reference file; you hold the state between steps and never do a
worker's job yourself. Which workers, in what order, what stays yours, and what the phase produces
are the flow file's — Development dispatches three roles and writes back into the plan, Testing
dispatches verifiers and reports.

**A step is dispatched when it needs fresh eyes; it is yours when you already hold its input.** A
dispatch costs a wave — the subagent re-reads from disk what you are holding, and you cannot take a
turn while suspended on it — so it is spent on judgement that benefits from clean context, not on
work whose inputs are already in front of you.

**Two driver axes, one vessel.** A threat sets a goal (close this); an org rule sets a goal
(implement this control); implementation guidance is *how* either goal is reached. The user gates
the **drivers** — the threat gate and the rule gate, in one user moment — and never the vessel:
guidance lands in the plan and the user refines it **there**. Each axis's Selection scopes that
axis's verification dimension, and guidance carries no verdict of its own.

**Context-window discipline:** hold only the compact statuses and pointers workers return, and
read a bounded slice of the assessment file at the gates and at finalize — those bounded reads
are the whole of what the analysis costs your context. The file is the shared state, so you move
data between workers by pointing them at its sections and letting each read for itself.

## The three-check

**Check what was written against its field card — never by re-reading the schema.** Three things,
and nothing else:

1. every field label present, in the order the card lists;
2. every enumerated value one of the words the card names, verbatim;
3. every field your stage owns written, and every other phase block left exactly as you
   found it.

**An empty block is a finished state.** Where an entry is divided into `#### ` phase blocks, a
block with no field lines under it means the stage that owns it has not run — leave it as it
stands. That emptiness is what lets a later reader tell "not yet judged" from "judged, nothing
to say". Inside a block whose stage **has** run, `—` keeps its ordinary meaning: a field that
does not apply.

**An `## Org rules` entry has a different shape, so it gets the check that fits it.** It is a
heading, one field and a free-text body, so check 1 has almost nothing to read. Check instead:
the heading carries the full rule id, `Selection` is one of the card's words, and — the
load-bearing one — **a `selected` entry's body is present and verbatim**. That body is what the
Testing pass reads as the rule's specification; a truncated one reaches Testing as a corrupt
spec, and nothing downstream can tell.

**It costs no read of its own.** Run it on the reads you already make — the bounded `## Threats`
and `## Org rules` slices at the user gates, and the finished file at finalize. Each sits upstream
of everything that consumes the section, so a malformed entry is cheapest to repair there:
re-dispatch the worker that produced it with the problem quoted back.

## Development — plan review

Development reviews the plan before code exists: the review question, then the two driver chains (threats and
org rules) run in parallel through critique into the two user gates, then implementation guidance,
finalize, and the write back into the plan. It fires when **Phase select** lands on Development —
`phase: development`.

**Read `references/development/flow.md` NOW and follow it.** The full loop lives there, with its
own checklist; this section is a pointer, and the procedure is in that file.

## Testing — verification

Testing judges the code as built on **both driver axes**: for each threat the threat gate selected,
can it still be realized — **negative testing**; and for each rule the rule gate selected, does the
control it prescribes exist. The selections define the scope, one per axis. It fires when
**Phase select** lands on Testing — an assessment for this task exists, it carries 1+ selected
driver on either axis, and `scripts/branch-delta` reported `delta_empty: false`.
**Everything Development does lives in `references/development/flow.md`:** its numbered steps,
both user gates, the critique rounds, and the org-rule retrieval.

**Read `references/testing/verification-pass.md` NOW and follow it.** The full loop lives there;
this section is a pointer, and the procedure is in that file.

## Rules that are easy to miss

Environment-specific facts that defy a reasonable assumption. Each phase's flow file is the
procedure; these are what it cannot infer.

| Situation | Do this |
|-----------|---------|
| `.ingrain-security/` appears to be missing | Re-run the mint and use the path it returns. The folder self-ignores, so `git status` stays silent about it — "missing" means the path resolved elsewhere. |
| Naming the assessment file to a worker | Pass the absolute `assessment_abs`. A worker has no project root in view, so a relative path resolves against the file it was reading and creates a stray folder there. |
| The minted file looks empty | Correct — the mint seeds a skeleton, so `has_content` stays `false` until a stage writes into it. Fill it in place rather than re-creating the page. |
| Deciding the phase on a clean tree | Route on `delta_empty`, never `git status`: a fully committed implementation still belongs to Testing. |
| Writing on Codex | Approval is granted per **patch** — one touching the assessment *and* another file prompts as a whole. Keep assessment edits in their own patch. |
| A write to `.ingrain-security/` is held in plan mode | Ask the user to allow writes to that folder — one line on which file and why — then retry the same write. The folder is the run's artifact store, separate from the plan file. |
| Minting in a later session | Use the recorded Title **verbatim**. The mint is keyed on branch + title, so a paraphrase mints a different file and silently loses the task. |
| A worker's section looks correct | Three-check it against its field card at the next gate anyway — an enum typo stays invisible until it breaks in a later session. |
| About to open the schema reference mid-run | Only for what a field *means*. The card under the section is the whole of the shape; re-reading the reference to recover it is the cost this skill exists to avoid. |
| A **session rule says** to call the subagent tool once the user has requested it | A permission gate over a mechanism the host already has. Ask the user to allow the subagent flow before your first dispatch — → `references/lib/dispatch.md` § When a session rule gates subagents behind user request. The sequential fallback is for a host whose only mode is the main session. |
| The `ingrain` fetch was sandbox-blocked | The retrieval (`flow.md` Step 1b) runs in the main session — re-run and let the host's native prompt reach the user. Continue without rules only once they decline. |
| A guidance entry names no threat | Fine **if** it names a `selected` org rule — that is rule-driven guidance, fully anchored. An entry naming neither is refused by the CLI and by the platform. |
| The threat gate selected nothing but a rule was accepted | Proceed to guidance. Selected rules alone sustain a round; only *both* gates empty ends the review. |
| A code write was **denied** by the review gate | Not a permissions fault. No assessment on this branch records a `## Triage` Verdict, so the user has never been asked. Run this skill — the denial is routing you here. If they do not want a review, answer Step 0's question `No`: the recorded `Verdict: minor` opens the gate for the branch. Never route around the block. |
