/**
 * Generic POSIX shell helpers shared by the variant runner and its platform
 * launchers. Nothing OS-specific lives here — single-quoting is identical across
 * any POSIX shell.
 */

/**
 * Single-quote a string for safe embedding in a shell command. Wraps in single
 * quotes and escapes embedded single quotes via the `'\''` idiom, so the result
 * is one inert literal argument regardless of its contents.
 */
export const shQuote = (s: string): string => `'${s.replaceAll("'", `'\\''`)}'`;
