# Platform dispatch reference

Each worker is dispatched as a **fresh worker subagent** told to read its reference file at
`references/development/<name>.md` and follow it. That abstraction maps differently onto each
host. The dispatch *prompt* is always the same; only the *mechanism* below changes.

Always restate the constraint inline in the dispatch: "read-only on the codebase —
use only Read/Grep/Glob and make no code edits; your only write is your own section
of the stored analysis file at the path this dispatch names."

## Host with a subagent / task primitive

Use the host's subagent / task primitive, passing the dispatch prompt and telling
the subagent to read the worker reference file from `references/development/<name>.md`. Dispatch one
worker per call and read the returned text. Where the host supports a per-subagent
model, set the worker's recommended tier; otherwise ignore it (advisory).

> Note: a general-purpose subagent typically has write-capable tools available, so the
> constraint above is advisory — enforced by the dispatch prompt and the worker's own
> ROLE header.

## Sequential in-context fallback

Where the host lacks a subagent mechanism, run each worker **sequentially in the main
session**: read `references/development/<name>.md`, follow it on the current INPUT, capture
the output, then move to the next step. This mode shares one write-capable context across
every worker, so:

- Discipline is the only enforcement here — hold the standing constraint yourself.
- Run one worker step at a time, in strict order — never reorder or parallelize.
- The orchestrator's writes — finalizing the assessment file and the two plan-file
  writes at Gate 1 and Gate 2 — happen outside worker steps.

## Org-rules retrieval and the CLI

Rule retrieval happens twice in Development, and the two passes run in different places.
`references/lib/ingrain-cli.md` owns the CLI itself — the commands, their flags, and the
failure taxonomy the branches below name. This section owns only **which pass runs where**.

**The first pass is the orchestrator's own**, in the main session, which already has the
host's shell/exec for the probe and the retrieval command. Running there is the point: a
sandbox or permission denial surfaces the host's **native approval prompt** ("allow this
command?") straight to the user.

**The second pass is `ingrain-rule-expander`'s**, the one worker granted read-only `ingrain`
invocations. Dispatch it with the host's shell/exec tool available **in addition to**
Read/Grep/Glob (e.g. Claude Code: allow Bash for `ingrain`; Codex: the exec capability).
Restate inline that it makes no edits and runs no other commands. It is dispatched **exactly
once** per review. Every other worker runs on Read/Grep/Glob alone.

**Relaying an access denial is a dispatch concern**, because reaching the user is the
orchestrator's channel. The expander first relies on the host's **native approval prompt**
(Claude Code's "allow this command?"; Codex's exec-approval) so the fetch retries in place.
Where the host can surface that prompt only to the main session, the expander returns the
single-line `fetch blocked — permission needed` signal and hands the decision back; the
**orchestrator** then asks the user for permission (using the host's selection-window /
question primitive — see **Selection windows** below) and, on grant, re-dispatches it with
exec access. That recovery re-run completes the one expansion pass.

A **not installed** result on the first pass skips the expander altogether.

## Testing's verifier

The standing rule above — "your only write is your own section of the stored analysis
file at the path this dispatch names" — is a **Development** rule. Testing's worker role
(`references/testing/verification-pass.md`) carries its own: the `ingrain-threat-verifier`
**writes nothing at all.** It returns its reasoning, and the orchestrator concludes and
records it. So drop the "your only write is…" clause from its dispatch and say **you write
nothing** instead. Its one shell allowance is read-only git (`git diff <diff_ref>`,
`git status`, `git show`) to obtain the branch diff at the `diff_ref` the orchestrator
resolved.

On a host with a subagent primitive, fan out the per-threat verifiers **together** — each
one is independent. On the sequential fallback, run them in the same session one at a time,
in tag order.

## Selection windows (Gate 1 and Gate 2)

**The gate procedure — display the table first, then ask — lives in SKILL.md →
How to ask the user. Only the mechanism below is host-specific.** This section owns *how* to
show a selection on this host; SKILL.md owns *what* a gate does.

The primitive is generic; only the mechanism changes per host:

- **Host with a windowed single-choice primitive** — present each finding in
  its own single-choice window (one window per finding). Where the host caps how
  many windows it can show per call, present consecutive batches in table order —
  which is tag order, and tags run highest-priority-first — e.g. T1–T4, then
  T5–T8 — and merge the choices.
  Zero-selection is inherent — the user reaches it by excluding every window, so
  the windows themselves carry the **"None"** case.
- **Text fallback** — where the host lacks a windowed primitive, ask the user to
  reply with the tags to include (e.g. `T1 T3`) or `none`.
