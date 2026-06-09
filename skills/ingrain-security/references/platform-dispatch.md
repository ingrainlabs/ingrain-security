# Platform dispatch reference

The `ingrain-security` orchestrator dispatches each worker as a **fresh read-only
subagent** told to read `skills/<name>/SKILL.md` and follow it. That abstraction
maps differently onto each host. The dispatch *prompt* is always the same (see
**How to dispatch a worker** in the orchestrator skill); only the *mechanism*
below changes.

For every mechanism, the read-only constraint is carried by the prompt, not the
platform — so always restate "you are read-only; use only Read/Grep/Glob; make no
edits" inline in the dispatch.

## Claude Code

Use the **Task tool** with `subagent_type: general-purpose` and the dispatch
prompt as `prompt`. The general-purpose subagent runs in its own context and
reads the worker skill from `skills/<name>/SKILL.md`. Where the host supports a
per-subagent model, set the worker's recommended tier (advisory).

> Note: a general-purpose subagent has write-capable tools available. The
> read-only guarantee here is advisory — enforced by the prompt and the worker's
> own ROLE header, not by a tool allow-list. Keep workers strictly read-only.

## Other CLIs with a subagent / task primitive

Codex CLI, Gemini CLI, Copilot CLI, OpenCode, Cursor, and similar hosts expose a
task/subagent primitive. Dispatch the same prompt through that primitive, one
worker per dispatch, and read the returned text. Map the worker's recommended
model onto the host's model selector if it has one; otherwise ignore it.

## No subagent primitive — sequential in-context fallback

On a host with no subagent mechanism, run each worker **sequentially in the main
session**: read `skills/<name>/SKILL.md`, follow it on the current INPUT, capture
the output, then move to the next step. This is the weakest mode — there is no
isolation, and the main session is write-capable — so:

- Keep workers read-only by discipline: do not let a worker step perform edits.
- Run one worker step at a time, in the strict order the orchestrator defines.
- The two plan-file writes still happen only at Gate 1 and Gate 2, never inside a
  worker step.

## Branching on results

Whatever the mechanism, the orchestrator branches on the keyword each worker
leads its output with (`minor`/`major` for triage, `approved`/`needs-revision`
for the critics) and threads each worker's output into the next dispatch. State
lives in the orchestrator, never in the workers.
