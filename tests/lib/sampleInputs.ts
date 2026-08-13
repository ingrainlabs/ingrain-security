/**
 * Sample inputs for the live tests. Plans are deliberately unambiguous so the
 * loose, shape-based assertions stay stable across model runs.
 */

/** Clearly security-relevant: auth + password storage + DB query. */
export const MAJOR_PLAN = `# Implementation plan: user login

## Task 1: Add POST /login endpoint
- Accept email + password from the request body.
- Look up the user by email with a SQL query against the \`users\` table.
- Verify the submitted password against the stored password.
- On success, issue a session token and return it to the client.

## Task 2: Store credentials
- Persist new users' passwords in the \`users\` table during signup.
`;

/** Clearly NOT security-relevant: cosmetic + a doc typo. */
export const MINOR_PLAN = `# Implementation plan: tidy up the landing page

## Task 1: Restyle the hero button
- Change the primary button color from blue (#1d4ed8) to green (#16a34a).
- Bump its font-size by 2px and add 4px of vertical padding.

## Task 2: Fix a typo
- In README.md, fix "recieve" -> "receive" in the intro paragraph.
`;

/**
 * A frozen threat list under the generator's working tags, for ingrain-risk-scorer /
 * guidance inputs. The tags are deliberately NOT in risk order — SQL injection, the
 * most severe of the three, arrives last — so a scorer that leaves the tags alone fails
 * the risk-order assertion instead of passing by luck.
 */
export const FROZEN_THREATS = `Frozen threat list for the login feature:

T1 - Weak session tokens: predictable session tokens let an attacker hijack sessions.
T2 - Plaintext password storage: passwords are stored without hashing, so a database
     breach exposes every user's credentials.
T3 - SQL injection: the email is concatenated into the users-table query, allowing
     an attacker to read or modify arbitrary rows.
`;

/** A subset the user "selected" at the threat gate, for ingrain-guidance-generator. */
export const SELECTED_THREATS = `Selected threats to address:

T1 - SQL injection in the users-table lookup query.
T2 - Plaintext password storage in the users table.
`;

/** A deliberately thin threat model, to bias ingrain-threat-critic toward needs-revision. */
export const THREAT_MODEL_WEAK = `Threat model for the login feature:

T1 - Someone might guess a password.
`;

/** Sample implementation guidance to feed ingrain-guidance-critic.
 *
 * Field names are the ARTIFACT's, not the wire's. This carried `threatTags:` — the wire key —
 * so the worker whose whole job is catching contract violations was being exercised against a
 * field that does not exist in the schema it grades. */
export const GUIDANCE_SAMPLE = `Proposed implementation guidance:

- Description: Use parameterized queries / prepared statements for the users-table
  lookup so user input can never alter the query structure.
  Yield: High. Effort: Low. Threats: T1
- Description: Hash passwords with a slow, salted algorithm (bcrypt/argon2) before
  storing them; never store plaintext.
  Yield: High. Effort: Medium. Threats: T2
`;

/** A single task + threats blob, for the critic agents that take both. */
export const TASK_AND_WEAK_MODEL = `Task:\n${MAJOR_PLAN}\n\n${THREAT_MODEL_WEAK}`;
export const TASK_AND_FROZEN_THREATS = `Task:\n${MAJOR_PLAN}\n\n${FROZEN_THREATS}`;
export const THREAT_AND_GUIDANCE = `${SELECTED_THREATS}\n\n${GUIDANCE_SAMPLE}`;

/**
 * The rule gate's other axis: retrieved org rules awaiting a verdict, for
 * ingrain-rule-critic. One clearly governs the change, one clearly does not — broad
 * retrieval's characteristic mix, and what the critic exists to separate.
 */
export const RETRIEVED_RULES = `Task:\n${MAJOR_PLAN}\n
Retrieved org rules, each awaiting an applicability verdict:

### 0f7b0e6f-edd6-4a5f-ac59-c867f1be7e8f — Hash credentials at rest
Selection: —
Passwords and other long-lived credentials are stored only as a slow, salted hash
(bcrypt or argon2id). Plaintext or reversible storage is never acceptable.

### c611c934-151b-4fb9-8e7a-5b765e660837 — Retain build artifacts for 90 days
Selection: —
CI build artifacts are kept for 90 days so a release can be reproduced from the exact
bytes that shipped.
`;
