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
 * mitigation inputs. The tags are deliberately NOT in risk order — SQL injection, the
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

/** A subset the user "selected" at Gate 1, for ingrain-mitigation-generator. */
export const SELECTED_THREATS = `Selected threats to mitigate:

T1 - SQL injection in the users-table lookup query.
T2 - Plaintext password storage in the users table.
`;

/** A deliberately thin threat model, to bias ingrain-threat-critic toward needs-revision. */
export const THREAT_MODEL_WEAK = `Threat model for the login feature:

T1 - Someone might guess a password.
`;

/** Sample mitigations to feed ingrain-mitigation-critic. */
export const MITIGATIONS_SAMPLE = `Proposed mitigations:

- Description: Use parameterized queries / prepared statements for the users-table
  lookup so user input can never alter the query structure.
  Yield: High. Effort: Low. threatTags: T1
- Description: Hash passwords with a slow, salted algorithm (bcrypt/argon2) before
  storing them; never store plaintext.
  Yield: High. Effort: Medium. threatTags: T2
`;

/** A single task + threats blob, for the critic agents that take both. */
export const TASK_AND_WEAK_MODEL = `Task:\n${MAJOR_PLAN}\n\n${THREAT_MODEL_WEAK}`;
export const TASK_AND_FROZEN_THREATS = `Task:\n${MAJOR_PLAN}\n\n${FROZEN_THREATS}`;
export const THREAT_AND_MITIGATIONS = `${SELECTED_THREATS}\n\n${MITIGATIONS_SAMPLE}`;
