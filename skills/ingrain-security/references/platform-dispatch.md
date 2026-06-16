# Platform dispatch reference

Each worker is dispatched as a **fresh read-only subagent** told to read its
reference file at `references/<name>.md` and follow it. That abstraction maps
differently onto each host. The dispatch *prompt* is always the same; only the
*mechanism* below changes.

Always restate "you are read-only; use only Read/Grep/Glob; make no
edits" inline in the dispatch.

## Host with a subagent / task primitive

Use the host's subagent / task primitive, passing the dispatch prompt and telling
the subagent to read the worker reference file from `references/<name>.md`. Dispatch one
worker per call and read the returned text. Where the host supports a per-subagent
model, set the worker's recommended tier; otherwise ignore it (advisory).

> Note: a general-purpose subagent typically has write-capable tools available.
> The read-only guarantee here is advisory — enforced by the prompt and the
> worker's own ROLE header, not by a tool allow-list. Keep workers strictly
> read-only.

## No subagent primitive — sequential in-context fallback

On a host with no subagent mechanism, run each worker **sequentially in the main
session**: read `references/<name>.md`, follow it on the current INPUT, capture
the output, then move to the next step. This is the weakest mode — there is no
isolation, and the main session is write-capable — so:

- Keep workers read-only by discipline: do not let a worker step perform edits.
- Run one worker step at a time, in strict order — never reorder or parallelize.
- The two plan-file writes still happen only at Gate 1 and Gate 2, never inside a
  worker step.

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
