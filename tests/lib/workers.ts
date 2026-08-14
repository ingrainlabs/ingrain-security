/**
 * The worker reference files the orchestrator dispatches, in flow order.
 *
 * Single source on purpose. Three suites need this list — the static lint over
 * the reference files, SKILL.md's roster check, and `dispatchedWorkers`, which
 * *filters* on it. A stale copy of the filter silently empties every trace it
 * builds, turning `assertEquals(order.includes(w), false)` into a tautology; that
 * is exactly how the guidance-generator halt assertions went vacuous through the
 * mitigation → guidance rename. Import it, never restate it.
 */
export const WORKERS = [
  "ingrain-threat-generator",
  "ingrain-threat-critic",
  "ingrain-risk-scorer",
  "ingrain-rule-critic",
  "ingrain-guidance-generator",
  "ingrain-guidance-critic",
] as const;

/**
 * The Testing pass's two verifiers, which `WORKERS` deliberately does not carry: that list
 * is the **Development flow order**, and `dispatchedWorkers` filters traces on it.
 *
 * They are dispatched exactly as the seven above are (`verification-pass.md`), but they are
 * the *inverse* worker: read-only, writing nothing, returning a verdict the orchestrator
 * records. So the Development lint's central assertions — names a write target, must not
 * call itself read-only — are not merely inapplicable but backwards for them, which is why
 * they get their own lint rather than a place in that loop.
 *
 * Kept beside `WORKERS` because the failure this file exists to prevent is a roster that
 * silently covers less than it appears to: for months these two were dispatched with no
 * frontmatter, description or ROLE lint at all, and nothing said so.
 */
export const VERIFIERS = [
  "ingrain-threat-verifier",
  "ingrain-rule-verifier",
] as const;

/** Widened for `includes` against an arbitrary string. */
export const isWorker = (name: string): boolean => (WORKERS as readonly string[]).includes(name);
