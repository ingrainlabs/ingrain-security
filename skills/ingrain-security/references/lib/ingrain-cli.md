# Ingrain CLI reference

The org's security rules are ingested knowledge — how *this* team implements auth, validation,
secrets, crypto — reached by semantic search over the `ingrain` CLI. This file owns **how to
drive that CLI**: the availability probe, the retrieval command, the shape of what comes back,
and how to classify a failure.

The same CLI also carries the finished assessment **back** to the platform, so the team sees the
threats a change introduced, what was decided about them, and whether it was verified. This file
owns **how to drive that CLI** for both directions.

This file owns the mechanics; the caller owns what to *do* about a given outcome — `references/development/flow.md`
§ Development — the flow for the orchestrator's retrieval pass, which is **forked alongside the
threat chain** and keys on the plan, the `## Triage` Surfaces and `## Affected paths` — never on a
gate's selections — and the two finalizes for the syncs below.

## Availability probe

```bash
ingrain --version
```

A purely local check, so it isolates "is the binary present?" from every failure that turns on
config or the network. Probe before querying.

## Retrieval

```bash
ingrain context security_rules "<query>" --assessment "<assessment_abs>" --json
```

- **Retrieve broadly.** Missing a governing rule is the costly failure, and precision is not
  this step's job: the **rule critic** prunes what does not apply before the user sees anything,
  and the rule gate decides the rest. So cast a wide net — more questions, higher limits — and
  let the round after you sharpen it.
- **Queries are matched on meaning** — phrase them as questions ("how do we authenticate
  service-to-service calls").
- **One query per distinct question.** Run several, each covering one topic. A query is
  matched as a *single point* in meaning-space, so one covering two topics lands between
  them and surfaces both worse than either would alone. Breadth comes from **more queries**,
  which is why "several" here means every security feature the change touches, not a token few.
- **Issue the whole set in ONE call**, not a turn per question — see the loop below. Nothing about
  one query depends on another's answer, so a turn each turns breadth into round trips, and the
  pass that most wants to ask a lot becomes the one that pays most for it.
- **`--limit N`** — default 10, accepted range 1–50. Raise it when a **single** topic is
  broad; with a critique round downstream, a generous limit costs little. It is still not a way
  to cover more ground: a larger limit returns more neighbours of the same point, so it cannot
  reach a topic the query did not aim at. Splitting the query is what covers more ground.
- **`--assessment <abs>`** — the assessment file, so the CLI can read `## Affected paths` and
  narrow the search to the org rules governing the code this change will touch. Pass it on
  every query; the paths are read fresh each time, so a section written after an earlier query
  still takes effect.

### The retrieval loop — every question in one call

The command takes one query, so asking several means running it several times. Do that **inside a
single call**, delimiting each result with the question that produced it — otherwise the arrays
arrive concatenated and nothing says which rules answered which question:

```bash
for q in "how do we authenticate service-to-service calls" \
         "how do we store and rotate secrets" \
         "how do we validate user input at API boundaries"; do
  printf '\n=== %s\n' "$q"
  ingrain context security_rules "$q" --assessment "<assessment_abs>" --json
done
```

Substitute your own questions and the absolute assessment path. **Run it sequentially — no `&`:**
the invocations write to one stdout, so backgrounding them interleaves the JSON mid-array and
costs you the whole batch to save a few seconds.

One call means one permission prompt covering every query, rather than one per question — which
matters most on the hosts where each `ingrain` invocation would otherwise be asked about
separately.

**Scoping never fails a query — but "no scope sent" and "scope resolved to nothing" are different
outcomes.** No scope reaches the platform when `## Affected paths` is unwritten, the file cannot be
read, or every path is dropped as malformed; the search then runs unscoped and org-wide, exactly as
it would without the flag. When paths **are** sent and the platform cannot resolve them, the scope
comes back empty rather than absent — and an empty scope matches **zero rules**.

**So an unregistered repository returns nothing at all, and that is not "the org has no rules".**
Registering a repository is how an org states which rules govern it, so this is the platform's
answer rather than a CLI failure. Treat it as **No matches** and carry on — but **read stderr
before you write the line explaining an empty `## Org rules`**: on an empty result the CLI names
the repository it narrowed to and says outright that an unregistered one returns nothing.
Reporting "no org rules apply" when the truth is "this repository is not registered" sends the
user looking in the wrong place for the fix.

`security_rules` is **the** subcommand. An older build that lacks it does **not** print an error
you can match on — it prints the command's help to stderr and exits `2`. Treat *help text plus
exit 2* as an unsupported build and degrade gracefully; matching for an error string would wait
for one that never arrives.

## Output shape

`--json` returns a JSON array of rule objects:

```json
[{ "id": "...", "title": "...", "body": "..." }]
```

`body` is the org's authoritative guidance on *how to implement* the control. Keep it
**verbatim** wherever it is written down, and record exactly the rules the CLI returned — the
id, title and body as they came back are the whole of what you have to work with.

## Recording the assessment

Two commands, one per phase's finalize. Both take the **absolute** minted paths, and both are
**best-effort** — see **A failed sync never fails a review** below.

```bash
ingrain record design       --assessment "<assessment_abs>"
ingrain record verification --assessment "<assessment_abs>"
```

- **`design`** — run at the **Development finalize**, after the file has been finalized in place.
  Sends the analysis: threats with their gate decisions, the gated org-rule set (selected **and**
  excluded), the risk score, and the implementation guidance with the drivers each entry names.
- **`verification`** — run at the **Testing finalize**, after the verdicts are written. Sends a
  robustness verdict per selected threat and an adherence verdict per selected rule, against the
  revision they judged. **It requires a design sync to have landed first**: a verification
  describes an analysis revision, so with none recorded the CLI rejects it rather than inventing
  one. A Development sync that was declined at the permission prompt therefore guarantees this
  one is rejected — see **No revision** below.

**Order matters within a phase: finalize the file first, then sync it.** The CLI reads the file
off disk; syncing before the write would send the previous state.

**One file, one flag.** The org rules ride in the assessment's own `## Org rules` section, so
there is no second path to pass. The `--rules` flag is gone with the sidecar — and so is the
failure class it created, where a caller who omitted it got a sync that silently recorded no rule
at all and a later verification rejecting its verdicts with nothing on screen to explain why.

**You never build the payload.** The CLI owns the wire contract entirely — this skill stays
platform-agnostic, and nothing about the backend's shape belongs in these files.

### A failed sync never fails a review

The review's output is the assessment file and the report; the sync is a courtesy on top. So:
**report the failure in one line and carry on.** Never retry in a loop, never block the finalize,
and never leave the user thinking the review itself failed. A non-zero exit from either command
classifies exactly as in the taxonomy below.

The one thing worth surfacing plainly: if `record` reports the assessment did not validate, that
is a defect in the **file** — run `ingrain validate --assessment "<assessment_abs>"`, which needs
no configuration and no network, and reports every problem at once.

## Failure taxonomy

| Symptom | Classification |
| --- | --- |
| `command not found` | **Not installed** — no org rules store is wired up in this repo |
| Config error; no search runs (missing `INGRAIN_SYNC_URL` / `INGRAIN_API_TOKEN`) | **Unconfigured** |
| Unknown-subcommand error | **Unsupported build** |
| Query succeeds, returns an empty array | **No matches** |
| `record` reports the assessment did not validate | **Malformed artifact** — the file, not the CLI |
| `record verification` reports no assessment is recorded for this task | **No revision** — the design sync never landed |
| `record` reports the assessment is an untouched skeleton | **Nothing to sync** — the review has written nothing yet |
| `record verification` reports the file is not at `Latest stage: testing` | **Wrong stage** — set it in the finalize write, then re-run |
| "operation not permitted" / sandbox-denied / permission-required | **Access denied** |

**No revision** is the one with a remedy in your own hands: run `ingrain record design
--assessment "<assessment_abs>"` first, then re-run the verification sync. It is not a CLI fault
and not a file fault — it is ordering, and the CLI names it in its own error.

All but the last **degrade gracefully** — a permission grant would leave them unchanged, so note
why in one line and carry on. Both directions are best-effort: retrieval proceeds without rules,
and a review completes without syncing. **Malformed artifact** is the one worth acting on, since
it is fixable here and now: run `ingrain validate` and correct the file.

**Access denied is recoverable.** The binary and config are fine and the rules *are*
reachable; the host has yet to grant this command exec. The caller owns the recovery — re-run
so the host's native "allow this command?" prompt reaches the user, and fall back only if the
user declines.
