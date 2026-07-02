# Platform dispatch reference

Each worker is dispatched as a **fresh worker subagent** (read-only on the
codebase; its sole write is its own section of the assessment file) told to read
its reference file at `references/<name>.md` and follow it. That abstraction maps
differently onto each host. The dispatch *prompt* is always the same; only the
*mechanism* below changes.

Always restate the constraint inline in the dispatch: "read-only on the codebase —
use only Read/Grep/Glob and make no code edits; your only write is your own section
of `.claude/ingrain-security/assessment.md`."

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
  (`.claude/ingrain-security/assessment.md`).
- Run one worker step at a time, in strict order — never reorder or parallelize.
- The orchestrator's writes — finalizing the assessment file and the two plan-file
  writes at Gate 1 and Gate 2 — happen outside worker steps. Hand off between workers
  by pointing them at sections of the assessment file rather than threading full
  content; the orchestrator does not read the full running analysis into its own
  context, only compact statuses and the bounded gate slices.

## Selection windows (Gate 1 and Gate 2)

At each gate, present a per-finding selection as **multiple single-choice
windows — one window per finding** — each a binary include/exclude decision
labeled by tag + short title, with high/critical findings marked recommended.
The user may select any subset, **including none**. The primitive is generic;
only the mechanism changes per host:

- **Host with a windowed single-choice primitive** — present each finding in
  its own single-choice window (one window per finding). Where the host caps how
  many windows it can show per call, present consecutive batches in table order
  (highest risk first) — e.g. T1–T4, then T5–T8 — and merge the choices.
  Zero-selection is inherent — the user excludes every window — so no extra
  **"None"** option is required.
- **No windowed primitive — fallback** — ask the user to reply with the tags to
  include (e.g. `T1 T3`) or `none`.

Whatever the mechanism, never collapse the gate into a single yes/no over the
whole set, never fold all findings into one combined list — one window per
finding. Keep the window labels faithful to the frozen findings, and incorporate
exactly the selected subset — selecting none incorporates nothing (and at Gate 1
ends the review).
