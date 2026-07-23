# Development dispatch reference

Each of the six Development workers is dispatched as a **fresh worker subagent** told to read
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

Rule retrieval happens **once** in Development, and it is not a dispatch.
`references/lib/ingrain-cli.md` owns the CLI itself — the commands, their flags, and the
failure taxonomy. This section owns only **where that pass runs**.

**The retrieval pass is the orchestrator's own**, in the main session, which already has the
host's shell/exec for the probe and the retrieval command. Running there is the point: a
sandbox or permission denial surfaces the host's **native approval prompt** ("allow this
command?") straight to the user, so the fetch retries in place.

**Every Development worker is dispatched with exactly five tools: Read, Grep, Glob, Edit and
Write** — it inspects the plan and repo with the first three, and writes its own section of
the assessment file with Edit or Write, which `allow-write-assessment` pre-approves for that
path. It works from the rules already on disk; the sidecar's path is what you pass them.

**No worker carries a shell**, so a worker that needs the file changed changes it with Edit or
Write. There is no fallback where it stages the text somewhere else for you to transplant.

## Selection windows (Gate 1 and Gate 2)

**The gate procedure — display the table first, then ask — lives in SKILL.md →
How to ask the user. Only the mechanism below is host-specific.** This section owns *how* to
show a selection on this host; SKILL.md owns *what* a gate does.

The primitive is generic; only the mechanism changes per host:

- **Host with a windowed single-choice primitive** — present each finding in
  its own single-choice window (one window per finding). Where the host caps how
  many windows it can show per call, present consecutive batches in the order the table
  displayed them — which is highest-priority-first — e.g. the first four, then the next
  four — and merge the choices.
  Zero-selection is inherent — the user reaches it by excluding every window, so
  the windows themselves carry the **"None"** case.
- **Text fallback** — where the host lacks a windowed primitive, ask the user to
  reply with the ids to include (e.g. `T01 T03`) or `none`.
