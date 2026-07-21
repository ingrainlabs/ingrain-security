# Development dispatch reference

Each of the seven Development workers is dispatched as a **fresh worker subagent** told to read
its reference file at `references/development/<name>.md` and follow it. That abstraction maps
differently onto each host. The dispatch *prompt* is always the same; only the *mechanism* below
changes.

Always restate the worker's write target inline in the dispatch: "your one write is your own
section of the stored analysis file at the path this dispatch names."

Your own writes as orchestrator — finalizing the assessment file, and the two plan-file writes at
Gate 1 and Gate 2 — happen strictly between worker steps, once the worker has returned.

## Host with a subagent / task primitive

Use the host's subagent / task primitive, passing the dispatch prompt and telling
the subagent to read the worker reference file from `references/development/<name>.md`. Dispatch one
worker per call and read the returned text. Where the host supports a per-subagent
model, set the worker's recommended tier; otherwise ignore it (advisory).

## Sequential in-context fallback

Where the host lacks a subagent mechanism, run each worker **sequentially in the main
session**: read the worker's reference file, follow it on the current INPUT, capture the output,
then move to the next step. This mode shares one context across every worker, so:

- Run one worker step at a time, in the order the checklist lists them, letting each finish before the next begins.

## Org-rules retrieval and the CLI

Rule retrieval happens twice in Development, and the two passes run in different places.
`references/lib/ingrain-cli.md` owns the CLI itself — the commands, their flags, and the
failure taxonomy the branches below name. This section owns only **which pass runs where**.

**The first pass is the orchestrator's own**, in the main session, which already has the
host's shell/exec for the probe and the retrieval command. Running there is the point: a
sandbox or permission denial surfaces the host's **native approval prompt** ("allow this
command?") straight to the user.

**The second pass is `ingrain-rule-expander`'s**, the one worker granted the `ingrain` CLI.
Dispatch it with the host's shell/exec tool available **in addition to** its file tools
(e.g. Claude Code: allow Bash for `ingrain`; Codex: the exec capability).
Restate inline that its writes are confined to the rules sidecar and its commands to the two
`ingrain` invocations. It is dispatched **exactly once** per review.

**Relaying an access denial is a dispatch concern**, because reaching the user is the
orchestrator's channel. The expander first relies on the host's **native approval prompt**
(Claude Code's "allow this command?"; Codex's exec-approval) so the fetch retries in place.
Where the host can surface that prompt only to the main session, the expander returns the
single-line `fetch blocked — permission needed` signal and hands the decision back; the
**orchestrator** then asks the user for permission (using the host's selection-window /
question primitive — see **Selection windows** below) and, on grant, re-dispatches it with
exec access. That recovery re-run completes the one expansion pass.

A **not installed** result on the first pass skips the expander altogether.

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
