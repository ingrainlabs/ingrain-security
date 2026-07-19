# Platform dispatch reference

Each worker is dispatched as a **fresh worker subagent** (read-only on the
codebase; its sole write is its own section of the assessment file) told to read
its reference file at `references/development/<name>.md` and follow it. That abstraction maps
differently onto each host. The dispatch *prompt* is always the same; only the
*mechanism* below changes.

Always restate the constraint inline in the dispatch: "read-only on the codebase —
use only Read/Grep/Glob and make no code edits; your only write is your own section
of the stored analysis file at the path this dispatch names."

## Host with a subagent / task primitive

Use the host's subagent / task primitive, passing the dispatch prompt and telling
the subagent to read the worker reference file from `references/development/<name>.md`. Dispatch one
worker per call and read the returned text. Where the host supports a per-subagent
model, set the worker's recommended tier; otherwise ignore it (advisory).

> Note: a general-purpose subagent typically has write-capable tools available.
> The constraint here is advisory — enforced by the prompt and the worker's own
> ROLE header, not by a tool allow-list. Keep workers off the codebase (no code
> edits); their only write is their own section of the assessment file.

## No subagent primitive — sequential in-context fallback

On a host with no subagent mechanism, run each worker **sequentially in the main
session**: read `references/development/<name>.md`, follow it on the current INPUT, capture
the output, then move to the next step. This is the weakest mode — there is no
isolation, and the main session is write-capable — so:

- Keep workers off the codebase by discipline: a worker does no code or repo edits;
  its sole write is its own section of the stored analysis file
  (at the path the dispatch specifies).
- Run one worker step at a time, in strict order — never reorder or parallelize.
- The orchestrator's writes — finalizing the assessment file and the two plan-file
  writes at Gate 1 and Gate 2 — happen outside worker steps. Hand off between workers
  by pointing them at sections of the assessment file rather than threading full
  content; the orchestrator does not read the full running analysis into its own
  context, only compact statuses and the bounded gate slices.

## Org-rules retrieval and the CLI

Rule retrieval happens twice in Development, and the two passes run in different places.
`references/lib/ingrain-cli.md` owns the CLI itself — the commands, their flags, and the
failure taxonomy the branches below name. This section owns only **which pass runs where**.

**The first pass is the orchestrator's own**, in the main session — no worker, no dispatch.
It needs the host's shell/exec for the probe and the retrieval command, which the main
session already has. Running there is the point: a sandbox or permission denial surfaces the
host's **native approval prompt** ("allow this command?") to the user directly, so there is
nothing to relay.

**The second pass is `ingrain-rule-expander`'s**, and it is the one narrow exception to the
read-only rule: it runs the same two read-only `ingrain` invocations. Dispatch it with the
host's shell/exec tool available **in addition to** Read/Grep/Glob (e.g. Claude Code: allow
Bash for `ingrain`; Codex: the exec capability). Restate inline that it makes no edits and
runs no other commands. It is dispatched **exactly once** per review. All other workers —
`ingrain-mitigation-generator` included — get no shell access.

**Access denied vs. unavailable — two different failures.** On an **access denied** result
for the expander's lookup (the binary and config are fine, exec just wasn't granted), the
rules are recoverable: it first relies
on the host's **native approval prompt** (Claude Code's "allow this command?"; Codex's
exec-approval) so the user can grant access and the fetch retries. Where the host cannot
surface such a prompt to a subagent, it returns the single-line
`fetch blocked — permission needed` signal instead of proceeding; the **orchestrator**
then asks the user for permission (using the host's selection-window / question primitive
— see **Selection windows** below) and, on grant, re-dispatches it with exec
access. That recovery re-run is not a second expansion pass. Only on decline does the
orchestrator fall back to the first pass's rules alone.

Genuine unavailability is best-effort, not required: for every outcome the user cannot fix
by granting access, both passes **degrade gracefully**, and mitigations are proposed without
org rules with a note on why. A **not installed** result on the first pass means the expander
is skipped altogether. Rule retrieval never blocks or fails the review.

## Testing's verifier

The standing rule above — "your only write is your own section of the stored analysis
file at the path this dispatch names" — is a **Development** rule. Testing's worker role
(`references/testing/verification-pass.md`) does not fit it: the `ingrain-threat-verifier`
**writes nothing at all.** It has no section of its own; it returns its reasoning and the
orchestrator concludes and records it. So drop the "your only write is…" clause from its
dispatch and say **you write nothing** instead. It gets one narrow exception — read-only
git (`git diff <diff_ref>`, `git status`, `git show`) to obtain the branch diff at the
`diff_ref` the orchestrator resolved — and no shell or CLI access beyond it.

On a host with a subagent primitive, fan out the per-threat verifiers **together** —
each depends on nothing the others produce. On the sequential fallback, run them in the
same session one at a time, in tag order.

## Selection windows (Gate 1 and Gate 2)

**The gate procedure — display the table first, then ask — lives in SKILL.md →
How to ask the user. Only the mechanism below is host-specific.** Read this
section for *how* to show a selection on this host, not for *what* a gate does.

The gate presents a per-finding selection as **multiple single-choice
windows — one window per finding** — each a binary include/exclude decision
labeled by tag + short title, with high/critical findings marked recommended.
The user may select any subset, **including none**. The primitive is generic;
only the mechanism changes per host:

- **Host with a windowed single-choice primitive** — present each finding in
  its own single-choice window (one window per finding). Where the host caps how
  many windows it can show per call, present consecutive batches in table order —
  which is tag order, and tags run highest-priority-first — e.g. T1–T4, then
  T5–T8 — and merge the choices.
  Zero-selection is inherent — the user excludes every window — so no extra
  **"None"** option is required.
- **No windowed primitive — fallback** — ask the user to reply with the tags to
  include (e.g. `T1 T3`) or `none`.
