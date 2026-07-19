# Ingrain CLI reference

The org's security rules are ingested knowledge — how *this* team implements auth, validation,
secrets, crypto — reached by semantic search over the `ingrain` CLI. This file owns **how to
drive that CLI**: the availability probe, the retrieval command, the shape of what comes back,
and how to classify a failure.

It owns the mechanics only. What to *do* about a given outcome belongs to the caller — SKILL.md
§5 for the orchestrator's first pass, `references/development/ingrain-rule-expander.md` for
the second.

## Availability probe

```bash
ingrain --version
```

A local check: it reads no config and makes no network call, so it separates "the binary is not
here" from every failure that needs config or the network. Probe before querying.

## Retrieval

```bash
ingrain context security_rules "<query>" --json
```

- **Queries are matched on meaning, not keywords** — phrase them as questions ("how do we
  authenticate service-to-service calls"), not as keyword strings.
- **One query per distinct question.** Run several rather than folding unrelated questions into
  one.
- **`--limit N`** — default 10, accepted range 1–50. Raise it when a topic is broad.

`security_rules` is **the** subcommand. An unknown-subcommand error means the installed CLI is
an unsupported build; there is no alternative spelling to retry.

## Output shape

`--json` returns a JSON array of rule objects:

```json
[{ "id": "...", "title": "...", "body": "..." }]
```

`body` is the org's authoritative guidance on *how to implement* the control. Keep it
**verbatim** wherever it is written down — never summarize it, and never invent a rule, an id,
a title, or a body that the CLI did not return.

## Failure taxonomy

| Symptom | Classification |
| --- | --- |
| `command not found` | **Not installed** — no org rules store is wired up in this repo |
| Config error; no search runs (missing `INGRAIN_SYNC_URL` / API token) | **Unconfigured** |
| Unknown-subcommand error | **Unsupported build** |
| Query succeeds, returns an empty array | **No matches** |
| "operation not permitted" / sandbox-denied / permission-required | **Access denied** |

The first four are **not fixable by the user granting access**, and they all **degrade
gracefully** — retrieve no rules, note why in one line, and carry on. Rule retrieval never
blocks or fails a review.

**Access denied is different, and is not graceful degradation.** The binary and config are
fine; the host simply has not granted this command exec, so the rules *are* reachable. It is
recoverable, and the caller owns the recovery — re-run so the host's native "allow this
command?" prompt reaches the user, and fall back only if the user declines.
