/**
 * Unit tests for `assertRiskDescendsByTag`. No model calls — the matcher is fed
 * literal fixtures in the bullet shape `ingrain-risk-scorer` is prompted to emit
 * (references/ingrain-risk-scorer.md), so its parsing and its two guarantees are
 * pinned offline rather than only via the live agent test.
 *
 * The guarantees: every risk score parses as a 0-100 value, and risk never rises
 * as the tag index rises (T1 = most critical).
 */

import { AssertionError, assertThrows } from "@std/assert";
import { assertRiskDescendsByTag } from "../lib/matchers.ts";

/** One scored-threat line in the shape the worker is prompted to return. */
const line = (tag: string, risk: string, band = "high") =>
  `- ${tag} — justification — likelihood: medium, impact: high, risk: ${risk} (${band})`;

interface MatcherCase {
  label: string;
  text: string;
  /** Whether the matcher is expected to reject this output. */
  throws: boolean;
}

const CASES: MatcherCase[] = [
  {
    label: "assertRiskDescendsByTag :: risk descending by tag passes",
    text: [line("T1", "82", "critical"), line("T2", "61"), line("T3", "40", "medium")].join("\n"),
    throws: false,
  },
  {
    label: "assertRiskDescendsByTag :: equal adjacent risks pass (non-increasing, not strict)",
    text: [line("T1", "61"), line("T2", "61")].join("\n"),
    throws: false,
  },
  {
    label: "assertRiskDescendsByTag :: T2 outranking T1 throws",
    text: [line("T1", "40", "medium"), line("T2", "82", "critical")].join("\n"),
    throws: true,
  },
  {
    label: "assertRiskDescendsByTag :: an out-of-range score throws",
    text: [line("T1", "150", "critical"), line("T2", "61")].join("\n"),
    throws: true,
  },
  {
    label: "assertRiskDescendsByTag :: a 4-digit score throws rather than truncating to 100",
    text: [line("T1", "1000", "critical"), line("T2", "61")].join("\n"),
    throws: true,
  },
  {
    label: "assertRiskDescendsByTag :: fewer than two tagged scores throws",
    text: line("T1", "82", "critical"),
    throws: true,
  },
];

for (const c of CASES) {
  Deno.test(c.label, () => {
    if (c.throws) {
      assertThrows(() => assertRiskDescendsByTag(c.text), AssertionError);
    } else {
      assertRiskDescendsByTag(c.text);
    }
  });
}
