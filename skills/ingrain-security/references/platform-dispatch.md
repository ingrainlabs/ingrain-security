# Platform dispatch reference

Each worker is dispatched as a **fresh worker subagent** (read-only on the
codebase; its sole write is its own section of the assessment file) told to read
its reference file at `references/<name>.md` and follow it. That abstraction maps
differently onto each host. The dispatch *prompt* is always the same; only the
*mechanism* below changes.

Always restate the constraint inline in the dispatch: "read-only on the codebase —
use only Read/Grep/Glob and make no code edits; your only write is your own section
of the stored analysis file at the path this dispatch names."

## Host with a subagent / task primitive

Use the host's subagent / task primitive, passing the dispatch prompt and telling
the subagent to read the worker reference file from `references/<name>.md`. Dispatch one
worker per call and read the returned text. Where the host supports a per-subagent
model, set the worker's recommended tier; otherwise ignore it (advisory).

> Note: a general-purpose subagent typically has write-capable tools available.
> The constraint here is advisory — enforced by the prompt and the worker's own
> ROLE header, not by a tool allow-list. Keep workers off the codebase (no code
> edits); their only write is their own section of the assessment file.

## No subagent primitive — sequential in-context fallback

On a host with no subagent mechanism, run each worker **sequentially in the main
session**: read `references/<name>.md`, follow it on the current INPUT, capture
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

## Mitigation-generator's CLI exception

Every worker is read-only, but the `ingrain-mitigation-generator` has one narrow
exception: it runs the read-only `ingrain context security_rules "<query>"` lookup
to fetch the org's security rules. Dispatch it with the host's shell/exec tool
available **in addition to** Read/Grep/Glob (e.g. Claude Code: allow Bash for
`ingrain`; Codex: the exec capability). Restate inline that it makes no
edits and runs no other commands. All other workers get no shell access.

**Access denied vs. unavailable — two different failures.** If the `ingrain context`
call is **blocked by the host's sandbox / permission layer** (the binary and config
are fine, exec just wasn't granted), the rules are recoverable: the worker first relies
on the host's **native approval prompt** (Claude Code's "allow this command?"; Codex's
exec-approval) so the user can grant access and the fetch retries. Where the host cannot
surface such a prompt to a subagent, the worker returns the single-line
`fetch blocked — permission needed` signal instead of proceeding; the **orchestrator**
then asks the user for permission (using the host's selection-window / question primitive
— see **Selection windows** below) and, on grant, re-dispatches the generator with exec
access. Only on decline does it fall back to proceeding without rules.

Genuine unavailability is best-effort, not required: where the `ingrain` binary is not
installed, or the CLI is unconfigured (no `INGRAIN_SYNC_URL` / API token) or returns
nothing — cases the user cannot fix by granting access — the worker **degrades
gracefully**, proposing mitigations without org rules and noting why. Rule retrieval
never blocks or fails the review.

## Phase B's two reads

The standing rule above — "your only write is your own section of the stored analysis
file at the path this dispatch names" — is a **Phase A** rule. Phase B's two worker
roles (`references/verification-pass.md`) do not fit it, in two ways:

- **They write nothing at all.** Neither the `ingrain-mitigation-verifier` nor the
  `ingrain-blind-maturity-reviewer` has a section of its own; they return their reasoning
  and the orchestrator reconciles and records it. So drop the "your only write is…"
  clause from their dispatches and say **you write nothing** instead. Both get the same
  narrow read-only-git exception (`git diff HEAD`, `git status`, `git show`) to obtain
  the working-tree diff, and neither gets shell or CLI access beyond it.
- **The blind reviewer is the one dispatch that carries no pointer.** Every other
  dispatch withholds the content and names a path; that one withholds the path too — no
  assessment file, no rules sidecar, no mitigation or threat data. It is given the task
  title and nothing else, deliberately, so that its read is independent of the analysis
  it is checking. See `references/verification-pass.md` → **How to dispatch the blind
  reviewer**.

On a host with a subagent primitive, fan out the per-mitigation verifiers and the single
blind reviewer **together** — the blind reviewer depends on nothing they produce. On the
sequential fallback, run them in the same session one at a time; the blind reviewer still
gets only the task title, and the discipline of not telling it more is the only thing
preserving its value there.

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
