# Branch diff reference

The **branch delta** is everything this branch added since it diverged from the branch it was
cut from — **committed and uncommitted alike**. It is what Phase select routes on and what
Testing verifies against. This file owns **how to resolve it**: the script, the refs it
returns, and the discipline around using them.

It owns the mechanics only. What to *do* with the result belongs to the caller — SKILL.md
§ Phase select for the routing decision, `references/testing/verification-pass.md` for the
capture and the reporting caveats.

## Resolving the fork point

**Do not hand-roll this**, and **never hardcode a trunk name.** Branches are routinely cut
from other feature branches, release branches, and long-lived integration branches, so the
parent is not assumed to be `main`. Hand-rolling a merge-base loop is how Phase select and the
review end up disagreeing about what is under test.

The bundled **`scripts/branch-diff`** script resolves it: it takes every other local and remote
branch, computes its merge-base with `HEAD`, discards any whose merge-base *is* `HEAD` (those
contain no divergence), and keeps the merge-base with the **most recent commit date** — the
nearest branch point. Your SessionStart context carries the ready-to-run command; it is
read-only and writes nothing:

    bash <plugin>/skills/ingrain-security/scripts/branch-diff <host>

Where two refs tie on the same merge-base commit the script prefers the local branch name;
they yield an identical `diff_ref` either way.

## What it returns

It emits one JSON object. Take these fields and obey its `instruction`:

| Field | Meaning |
| --- | --- |
| `base_ref` | the parent branch this one was cut from — for the report |
| `diff_ref` | the merge-base commit — what you actually diff against |
| `delta_empty` | `false` means this branch has commits since the fork point, or an uncommitted change, or both |
| `fallback` | `true` when no fork point resolved; `diff_ref` is then `HEAD` |
| `reason` | which fallback case applies (see the caller's reporting rules) |
| `shallow` | set when `merge-base` failed on a shallow clone |

**`diff_ref` is the run's fixed basis.** Resolve it once, pass it verbatim to every dispatch,
and **never re-derive it mid-run or substitute `HEAD` for it** — `HEAD` shows only uncommitted
work and would hide the committed implementation under review.

The script is deterministic, so a caller already holding its JSON from earlier in the turn
should reuse that rather than paying for it twice.

## A clean tree is not evidence that no code exists

By the time Testing is due, the coding agent has usually **committed** the implementation, so
the uncommitted delta alone may show only a fraction of the code the mitigations were adopted
for. `delta_empty` is the signal; `git status` alone is not. `delta_empty: false` with a clean
working tree means the implementation is committed — precisely the case Testing exists for.

On the `HEAD` fallback, `delta_empty` degrades to the dirty-tree test.
