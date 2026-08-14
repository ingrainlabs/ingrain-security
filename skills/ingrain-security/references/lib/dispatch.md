# Dispatch reference — the host mechanism, for both phases

Every worker and every verifier is dispatched as a **fresh worker subagent** told to read its
reference file — `<plugin_root>/skills/ingrain-security/references/development/<name>.md` for a
Development worker, `<plugin_root>/skills/ingrain-security/references/testing/<name>.md` for a
Testing verifier — and follow it. That abstraction maps differently onto each host.

**This file owns the MECHANISM only.** The dispatch *prompt* belongs to the phase that sends it:
`flow.md` § How to dispatch a worker, `verification-pass.md` § How to dispatch a verifier. Phase
neutral, so it sits in `references/lib/` beside the other utilities both phases reach for.

Always restate a **Development worker's** write target inline in the dispatch: "your one write
is your own section of the stored analysis file at the path this dispatch names."

**A Testing verifier has no write target and is never given one.** Its whole output is what it
returns; the orchestrator re-derives the verdict and owns every write to the file. A verifier
handed a write target writes the level it led with, pre-empting the conclusion the Testing pass
exists to reach.

Your own writes as orchestrator — pruning and finalizing the assessment file, and the plan write
at Finalize — happen strictly between worker steps, once the worker has returned.

## This skill is built for an agent-based host

**Every Development worker and every Testing verifier runs as a fresh subagent — that is the
designed mode.** It gives each worker clean context and its own **Recommended model** tier, and it
keeps the orchestrator holding just compact statuses and pointers (SKILL.md § Context-window
discipline). Run the seven Development workers and the Testing verifiers as subagents wherever the
host allows.

The sequential in-context fallback below is a **degraded mode**: one shared context across every
worker, and the session model throughout. Reserve it for a host whose only mode is the main
session.

## Independent calls go out in one block

Anything with no data dependency on anything else in flight is issued **together, in a single
block** — not one per turn. Each extra turn is a round-trip the run pays for and nothing gains.
This covers:

- **The two bundled scripts at Phase select** — `assessment-mint` and `branch-delta` are
  read-only and deterministic, and neither reads the other's output. One block, and the values
  are reused for the whole run; no later step re-mints.
- **The two driver chains after the review question** — the threat chain and the broad rule retrieval have no
  data dependency on each other, so they run in parallel and join at the guidance generator.
- **The Testing verifiers** — one per selected threat and one per selected rule, mutually
  independent (see `references/testing/verification-pass.md` § How to dispatch a verifier).

The converse still holds: a step that consumes the previous worker's section waits for it. The
pipeline order in `references/development/flow.md` is a real data dependency, not a formality.

## Writing the assessment file

**Every change to it goes through the Edit or Write tool** — the orchestrator's and every worker's
alike. `allow-assessment-write` pre-approves both for this path, so the change lands with no
permission prompt and the user still sees the before/after. The shell has a different job: it runs
this plugin's read-only scripts and the `ingrain` CLI, and never edits the assessment file.

Every field is its own line, but **a write is one call**. A worker writes its whole section in a
single Write or Edit, and a stage filling fields into entries that already exist makes **one Edit
per entry** — replacing that entry's contiguous block of field lines, never one Edit per field. A
block Edit shows the same before/after a per-line one would, so the reviewable change costs one
call rather than one per line.

**The file tells you its own shape.** The mint seeds a **field card** under every section, and that
card is the write contract — write from it. `references/lib/assessment-file.md` is for what
a field *means*, not for learning its shape.

## Host with a subagent / task primitive

Use the host's subagent / task primitive, passing the dispatch prompt and telling
the subagent to read the worker reference file from
`<plugin_root>/skills/ingrain-security/references/development/<name>.md`. Dispatch one
worker per call and read the returned text. Where the host supports a per-subagent
model, set the worker's recommended tier; otherwise ignore it (advisory).

## When a session rule gates subagents behind user request

A **session rule says** the subagent tool is yours to call once the user has requested it — the
wording you will see is *"unless the user requested it."* Read that as a **permission gate over a
mechanism the host already has**: the rule names the condition that opens it, so the work is to
obtain that request. The sequential fallback below covers a different case — a host whose only mode
is the main session.

**Ask the user to allow the subagent flow, before the first dispatch of the run** — Development
Step 1a's threat generator, or Testing's verifier fan-out. Ask once, up front: one answer covers the whole run,
where a mid-flow ask splits it across two modes. State the rule and the trade-off in one short
message, then put the choice to the user with the host's question or selection primitive (plain
text elsewhere), **allow as the recommended option**:

> Worth noting: the rule says "unless the user requested it." If you'd prefer the review run with
> real subagent isolation — which is what the skill was designed for, and gives each worker clean
> context and its own recommended model tier — you can just say so, and that counts as the request.

- **Allowed** → **the gate is open for this run.** Switch to **Host with a subagent / task
  primitive** above and dispatch every worker there, model tier included. The answer covers the
  whole run — carry it through to the last step.
- **Declined, or the user prefers to get going** → run the **Sequential in-context fallback** below,
  and say which mode you are in, in one line, so the shared context stays visible to the user.

Where the user has **already** asked for subagents — in the invoking prompt, or anywhere earlier in
the session — that *is* the request: dispatch straight away.

Should the run reach a later step in-context and the user then ask for subagents, switch from that
step onward. Work already completed stands — its section is written to the assessment file, and the
next worker reads it there like any other.

## Sequential in-context fallback

Where the host's **only** mode is the main session — a permission gate belongs to the section above
— run each worker **sequentially in the main session**: read the worker's reference file,
follow it on the current INPUT, capture the output, then move to the next step. This mode shares
one context across every worker, so:

- Run one worker step at a time, in the order the checklist lists them, letting each finish before the next begins.
- The **Recommended model** line in each worker's reference file applies where per-worker models
  exist; here every worker runs on the session model.

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
the assessment file with Edit or Write, which `allow-assessment-write` pre-approves for that
path. It works from the rules already on disk — they are in the assessment's own `## Org rules`
section, so the assessment path you already pass is the only path a worker needs.

**No Development worker carries a shell**, so a worker that needs the file changed changes it
with Edit or Write. There is no fallback where it stages the text somewhere else for you to
transplant.

**A Testing verifier is the mirror image: Read, Grep, Glob and Bash — no Edit, no Write.** It
needs the shell for one thing only, the bundled `branch-delta <host> diff` command its dispatch
carries, which is how it reads the change without hand-writing git. Grant it nothing that could
write the assessment: the orchestrator is the file's single writer during Testing.

## Selection windows (the threat gate and the rule gate)

**What a gate decides, and the display-the-table-first rule, lives in `flow.md` → How to ask
the user — the only phase that gates.** This section owns *how* to show a
selection on this host, and nothing about what the answer means.

The primitive is generic; only the mechanism changes per host:

- **Host with a windowed single-choice primitive** — present each finding in
  its own single-choice window (one window per finding). Where the host caps how
  many windows it can show per call, present consecutive batches in the order the table
  displayed them — which is highest-priority-first — e.g. the first four, then the next
  four — and merge the choices.
  Zero-selection needs no window of its own: the user reaches it by excluding every one.
  The rule gate's accept-all is one window **ahead** of the per-rule ones, which follow only
  if it is declined — `flow.md` § 4b owns why that is the default.
- **Text fallback** — where the host lacks a windowed primitive, ask the user to
  reply with the ids to include (e.g. `T01 T03`) or `none`.
