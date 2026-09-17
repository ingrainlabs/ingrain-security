# Branch delta reference

The **branch delta** is everything this branch changed since it diverged from the branch it was
cut from — **committed and uncommitted alike**. It is what Phase select routes on and what
Testing verifies against. This file owns **how to reach it**: the script, everything it returns,
and the discipline around using them.

**One script serves the whole delta**, and it is named for the delta rather than for the diff
because a diff is one rendering of it: the same command gives you the basis to compare against,
the complete list of files that changed, and the change itself as text.

This file owns the mechanics; the caller owns what to *do* with the result — SKILL.md
§ Phase select, which now reads the mint's resolved `phase` rather than deriving one from
`delta_empty` — the same delta, resolved once inside the binary and shared by `ingrain
assessment mint` and `ingrain delta` so the two can never disagree;
`references/testing/verification-pass.md` for how Testing consumes it and the reporting caveats.

## Resolving the fork point

**Resolve this with the shared script, and let it discover the trunk.** Branches are routinely
cut from other feature branches, release branches, and long-lived integration branches, so the
parent is whatever branch this one was actually cut from, which the script works out. One resolver,
shared, keeps Phase select and the review agreed on what is under test.

**`ingrain delta`** resolves it: it takes every other local and remote branch, computes its
merge-base with `HEAD`, discards any whose merge-base *is* `HEAD` (those contain no
divergence), and keeps the merge-base with the **most recent commit date** — the nearest
branch point. It is read-only, touching git state alone:

```ingrain-script
ingrain delta --host <host>
```

Where two refs tie on the same merge-base commit the script prefers the local branch name;
they yield an identical `diff_ref` either way.

## What it returns

It emits one JSON object. Take these fields and obey its `instruction`:

| Field | Meaning |
| --- | --- |
| `base_ref` | the parent branch this one was cut from — for the report |
| `diff_ref` | the merge-base commit — what you actually diff against |
| `changed_files` | **the review's entry point** — the COMPLETE changed-file set, already resolved: `[{path, status}]` over committed, staged, unstaged and untracked, which no single git command covers. `status` is `added`, `modified`, `deleted`, `type-changed` or `untracked` — or, for a state those have no word for, git's own raw letter (`U` unmerged in a half-finished merge, `X`, `B`), which is passed through rather than folded into a catch-all so a pathological tree stays legible. `.gitignore` is honoured, so the self-ignoring assessment folder drops out |
| `delta_empty` | `true` when the branch delta is empty; `false` when this branch has commits since the fork point, an uncommitted change, or both |
| `fallback` | `true` when no fork point resolved; `diff_ref` is then `HEAD` |
| `reason` | which fallback case applies (see the caller's reporting rules) |
| `shallow` | `true` when the clone is shallow — **independently of whether the fork point resolved**. A truncated history *can* defeat `merge-base`, so it is a caveat worth reporting alongside a fallback; on its own it does not mean the resolution failed |

**`changed_files` is a starting point, never a boundary.** It answers "what did this change
touch", and the review's questions are different ones — *can the threat still be realized*,
*does the control exist*. Both are settled by the whole path an attacker walks or the whole
surface a rule governs, most of which is code this change never opened. A control that was
supposed to be added and was not has **no presence in the delta at all**.

**`diff_ref` is the run's fixed basis, and `ingrain delta` pins it.** The pin holds a whole
fan-out of verifiers to one change while the working tree keeps moving under them, so every
later `ingrain delta diff` reads the same basis without being handed it. It is the
merge-base, so it exposes the committed implementation under review, where `HEAD` would show
only uncommitted work.

The script is deterministic, so a caller already holding its JSON from earlier in the turn
should reuse that rather than paying for it twice.

## Reading the change itself

The `diff` subcommand is the **only** way this review reads a diff — nobody writes a git
command by hand, orchestrator or verifier:

```ingrain-script
ingrain delta diff
```

Append one or more repository-relative paths to narrow it to those files:

```ingrain-script
ingrain delta diff path/to/file.ts
```

Three things it does that a hand-written `git diff` does not:

- **An untracked file prints its contents.** git has no blob to compare a new file against, so
  `git diff` on one prints *nothing* — indistinguishable from "unchanged" for the files most
  likely to *be* the change. Here they arrive under a `=== NEW FILE (untracked): <path> ===`
  header, in the whole-delta view and when named directly.
- **Output is pinned plain.** `--no-pager --no-color --no-ext-diff`, so a repo whose config sets
  `color.ui = always` or a `diff.external` driver cannot decide what you read. Centralizing the
  commands would buy nothing if each still rendered differently per machine.
- **The basis is pinned for you.** `ingrain delta` records the fork point it resolved and `diff`
  reads it back, so a fan-out of verifiers holds to one change with nothing passed between them.
  A rebase past that fork point discards the pin, since diffing against it would report the
  parent branch's replayed commits as this branch's work.

An unknown subcommand, and a path that is neither tracked nor on disk, are refused with a
message rather than absorbed — a typo must not come back looking like an empty diff.

## The implementation is usually already committed

By the time Testing is due, the coding agent has usually **committed** the implementation, so
the uncommitted delta alone may show only a fraction of the code the guidance was written
for. Route on `delta_empty`, which counts committed and uncommitted work alike.
`delta_empty: false` with a clean working tree means the implementation is committed — the case
Testing exists for.

On the `HEAD` fallback, `delta_empty` degrades to the dirty-tree test.
