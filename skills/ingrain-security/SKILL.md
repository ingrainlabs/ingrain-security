---
name: ingrain-security
description: >-
  Use this WHENEVER an implementation plan is ready, before writing any code. It
  first triages the change and only runs the full review for security-relevant
  ("major") changes: threats → 0-100 risk score → user incorporates findings →
  mitigations → user incorporates findings, with critic-driven improvement loops,
  via dedicated read-only subagents.
---

<SUBAGENT-STOP>
If you were dispatched as a worker subagent (relevance-triage, threat-generator,
threat-critic, risk-scorer, mitigation-generator, mitigation-critic), do the one
job you were given and return. Do NOT run this orchestration — you are part of it.
</SUBAGENT-STOP>

<EXTREMELY-IMPORTANT>
The moment an implementation plan is ready, and BEFORE you write any code, you
MUST run this review. Do not begin implementation until it finishes. If there is
even a 1% chance the change touches security, run it — triage decides minor vs.
major, you do not pre-judge it away.
</EXTREMELY-IMPORTANT>

# Security review loop

**Announce:** open with "Using ingrain-security to assess this plan."

You orchestrate six **read-only** worker skills, each at `skills/<name>/SKILL.md`
(`relevance-triage`, `threat-generator`, `threat-critic`, `risk-scorer`,
`mitigation-generator`, `mitigation-critic`). You dispatch each one as a fresh
subagent (see **How to dispatch a worker**), in order, holding the state between
steps yourself — workers cannot call each other or you. On revision rounds you
pass the worker its prior draft plus the critic's issues to address.

## How to dispatch a worker

A worker is a skill, not a platform-native agent. You never run a worker's logic
yourself — you dispatch a **fresh read-only subagent** and tell it to become that
worker by reading its skill. This keeps the review cross-platform: it works
wherever a subagent primitive exists, and degrades to sequential in-context
execution where one does not. See `references/platform-dispatch.md` for the
per-platform mapping (Claude Code → the Task tool with `subagent_type:
general-purpose`; other CLIs → their task primitive; no-subagent fallback).

Dispatch every worker with the same shape — restate the read-only constraint
inline, because off-Claude it is the only thing enforcing it:

```
Read skills/<name>/SKILL.md and follow it as your system prompt.
You are read-only — use only Read/Grep/Glob and make no edits.
INPUT:
<the worker's inputs — the plan; on revision rounds, the prior draft + the
critic's itemized feedback>
Return only the Output section that skill specifies.
```

Branch on the keyword the worker leads its output with (`minor`/`major`,
`approved`/`needs-revision`). Thread each worker's result into the next dispatch
yourself; the subagents share no state.

## Flow

```dot
digraph security_review {
    "Plan ready" [shape=doublecircle];
    "relevance-triage" [shape=box];
    "major?" [shape=diamond];
    "Stop — no review needed" [shape=doublecircle];
    "threat-generator" [shape=box];
    "threat-critic" [shape=box];
    "threats ok?" [shape=diamond];
    "Freeze threats" [shape=box];
    "risk-scorer" [shape=box];
    "Gate 1: user incorporates threats" [shape=box];
    "mitigation-generator" [shape=box];
    "mitigation-critic" [shape=box];
    "mitigations ok?" [shape=diamond];
    "Freeze mitigations" [shape=box];
    "Gate 2: user incorporates mitigations" [shape=box];
    "Done — proceed to implementation" [shape=doublecircle];

    "Plan ready" -> "relevance-triage" -> "major?";
    "major?" -> "Stop — no review needed" [label="minor"];
    "major?" -> "threat-generator" [label="major"];
    "threat-generator" -> "threat-critic" -> "threats ok?";
    "threats ok?" -> "threat-generator" [label="needs-revision (max 3)"];
    "threats ok?" -> "Freeze threats" [label="approved"];
    "Freeze threats" -> "risk-scorer" -> "Gate 1: user incorporates threats";
    "Gate 1: user incorporates threats" -> "mitigation-generator";
    "mitigation-generator" -> "mitigation-critic" -> "mitigations ok?";
    "mitigations ok?" -> "mitigation-generator" [label="needs-revision (max 3)"];
    "mitigations ok?" -> "Freeze mitigations" [label="approved"];
    "Freeze mitigations" -> "Gate 2: user incorporates mitigations";
    "Gate 2: user incorporates mitigations" -> "Done — proceed to implementation";
}
```

## Steps — in strict order

0. **Triage** — dispatch the `relevance-triage` worker with the plan.
   - If the verdict is `minor`: state "no security review needed — minor change"
     and **stop here**. Do not dispatch any other worker; proceed with implementation.
   - If the verdict is `major`: keep its **Surfaces** notes — you forward them to
     the generator in Step 1 — and continue to run the full cycle.
1. **Threats** — dispatch the `threat-generator` worker with the plan **and the
   triage Surfaces notes** (its starting points, not a ceiling) → threat list (`T1…`).
2. **Critique threats** *(loop, max 3)* — dispatch the `threat-critic` worker. On
   `needs-revision`, re-dispatch `threat-generator` with the prior list + critique
   and repeat. Then **freeze** the threats.
3. **Risk score** — dispatch the `risk-scorer` worker with the frozen threats →
   per-threat 0–100 (likelihood × impact) plus an overall plan score and criticality band.
4. **Ask user — incorporate findings (Gate 1).** Present the scored threats and
   ask, via AskUserQuestion, which findings to add into the implementation plan.
   The user is deciding whether a threat is worth acting on, so each option must
   let them understand the threat without re-reading the plan. For every threat,
   write the option `label` as the risk band + short title (e.g. `T3 · high —
   unauthenticated token refresh`) and the option `description` so it answers
   three things, in plain language:
   - **What can go wrong** — the concrete failure, drawn from the threat's
     Vector/Description (not a generic category).
   - **Why it matters** — the consequence if realized, grounded in the
     risk-scorer's impact and 0–100 score (e.g. what an attacker gains, what data
     or guarantee is lost).
   - **Local impact in the plan** — which specific part of *this* change the
     threat lands on (the component, file, or step from the plan), so the user
     sees where in their own work it bites.

   Order the options by risk score (highest first) and keep this set faithful to
   the frozen threats and scores — don't invent, soften, or re-score. Use
   `multiSelect: true` so the user can pick several.
   **Incorporate the accepted findings into the plan.** The selected threats then
   proceed to mitigation.
5. **Mitigate** — dispatch the `mitigation-generator` worker with the selected threats.
6. **Critique mitigations** *(loop, max 3)* — dispatch the `mitigation-critic`
   worker; re-dispatch `mitigation-generator` on `needs-revision`. Then **freeze**
   the mitigations.
7. **Ask user — incorporate findings (Gate 2).** Present the mitigations and ask,
   via AskUserQuestion, which to add into the implementation plan. **Incorporate
   the accepted mitigations into the plan.** This is the last step — close with a
   one-line verdict, then proceed to implementation.

## Red flags — stop if you catch yourself thinking…

| Thought | Reality |
|---------|---------|
| "This change is obviously trivial, skip triage" | Triage decides minor/major, not you. Run it. |
| "I'll start coding while the review runs" | No implementation until the review finishes. |
| "Let me score risk before the threats are settled" | Never score before threats are frozen. |
| "I'll write mitigations for threats the user didn't pick" | Only the Gate 1 selections proceed to mitigation. |
| "The critic flagged issues but it's good enough" | Re-run the generator with the feedback (up to 3 rounds). |
| "This loop could keep improving forever" | Cap each critic loop at 3 rounds; surface what's unresolved. |
| "I'll just answer the worker's job myself instead of dispatching" | Each worker runs in its own read-only subagent — dispatch it, don't inline it. |

## Rules

- **Read-only review; writes only at the gates.** Workers are dispatched as
  read-only subagents (Read/Grep/Glob only) and make no code changes — restate
  that constraint in every dispatch, since off-Claude it is advisory. The process
  writes in exactly two places: **incorporating accepted findings into the
  implementation plan** at Gate 1 and Gate 2 (the plan file when in plan mode). It
  reflects only what the user accepted at the gates — never unreviewed or rejected
  findings.
- **Triage first.** Run the full cycle only when `relevance-triage` returns
  `major`; bias to `major` when uncertain.
- **No skipping / no reordering.** Never score before threats are frozen, never
  mitigate before Gate 1, never present mitigations before they are frozen.
- **Bounded loops.** Cap each critic loop at 3 rounds; surface anything left
  unresolved rather than looping forever or hiding it.
