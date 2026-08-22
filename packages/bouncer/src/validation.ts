/**
 * Shared, dependency-free validation primitives for `schema.ts`. This package
 * hand-rolls its record validation rather than depending on a schema library
 * — see `schema.ts`'s own header for why, and `@vespeneventures/strategist`'s
 * `validation.ts` for the precedent this file follows: plain type guards over
 * `unknown`, accumulating findings into an array, never throwing.
 *
 * Every `require*` helper below takes the same three leading arguments —
 * `value` (the candidate, still `unknown`), `path` (an absolute,
 * human-readable location like `"grants[2].expiresAt"`), and `issues` (the
 * caller's shared, mutated-in-place array) — and returns either the narrowed
 * value or `undefined`. A caller never has to inspect the return value to
 * know whether something went wrong: every failure is also recorded into
 * `issues` at the moment it is discovered, so the standard pattern (used
 * throughout `schema.ts`) is to snapshot `issues.length` before validating an
 * object's fields and compare it after — if it grew, something in this object
 * failed, regardless of which field.
 *
 * WHY A MALFORMED RECORD IS NEVER COERCED
 * ----------------------------------------
 * None of these helpers substitutes a default for a value it could not read.
 * That is not fastidiousness: this package's entire job is to compare what is
 * live locally against what a provider still backs, and every substitution is
 * a chance for a grant nobody can account for to read as one that reconciles.
 * A timestamp this cannot parse must not become "now"; a missing ceiling must
 * not become "unlimited"; an unreadable status must not become "active". Each
 * of those is a fail-open, and each of them is silent.
 */

export interface ValidationIssue {
  /** Absolute, dot/bracket-joined location, e.g. `"grants[0].actorId"`, or `"(root)"` for a whole-value shape problem. */
  path: string;
  message: string;
}

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; issues: ValidationIssue[] };

/** A hand-rolled validator: takes an unknown value, returns a `ValidationResult<T>`. Never throws. */
export type Validator<T> = (value: unknown) => ValidationResult<T>;

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A closed-vocabulary check. Membership is decided by the caller's own literal list, never by a shape heuristic. */
export function isOneOf<T extends string>(value: unknown, list: readonly T[]): value is T {
  return typeof value === "string" && (list as readonly string[]).includes(value);
}

/**
 * A short, readable description of an arbitrary value for an error message —
 * never the value's full content. A record here can name a real person's
 * identifier, and an error message is the least controlled surface in any
 * program: it goes to logs, to CI output, and into issue reports.
 */
export function describeValue(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (Array.isArray(value)) return `an array (${value.length} item(s))`;
  const type = typeof value;
  if (type === "object") return "an object";
  if (type === "string") return JSON.stringify(value);
  return String(value);
}

export function pushIssue(issues: ValidationIssue[], path: string, message: string): void {
  issues.push({ path, message });
}

export function requireString(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  opts?: { minLength?: number },
): string | undefined {
  if (typeof value !== "string") {
    pushIssue(issues, path, `must be a string, got ${describeValue(value)}`);
    return undefined;
  }
  const minLength = opts?.minLength ?? 0;
  if (value.trim().length < minLength) {
    pushIssue(issues, path, `must be at least ${minLength} non-whitespace character(s) long`);
    return undefined;
  }
  return value;
}

/** Same as `requireString`, except `undefined` is valid (the field is optional) and produces no issue. */
export function optionalString(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  opts?: { minLength?: number },
): string | undefined {
  if (value === undefined) return undefined;
  return requireString(value, path, issues, opts);
}

/**
 * A timestamp this package can actually order and subtract. A record whose
 * time cannot be parsed is a validation failure, never a record silently
 * treated as "now" — the reconciliation gate does arithmetic on these values,
 * and a fabricated one would make an expired grant read as current.
 */
export function requireTimestamp(value: unknown, path: string, issues: ValidationIssue[]): string | undefined {
  const asString = requireString(value, path, issues, { minLength: 1 });
  if (asString === undefined) return undefined;
  if (Number.isNaN(Date.parse(asString))) {
    pushIssue(issues, path, `must be a parseable timestamp, got ${describeValue(value)}`);
    return undefined;
  }
  return asString;
}

/** Same as `requireTimestamp`, except `undefined` is valid (the field is optional) and produces no issue. */
export function optionalTimestamp(value: unknown, path: string, issues: ValidationIssue[]): string | undefined {
  if (value === undefined) return undefined;
  return requireTimestamp(value, path, issues);
}

export function requireNumber(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  opts?: { min?: number; max?: number; integer?: boolean },
): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    pushIssue(issues, path, `must be a finite number, got ${describeValue(value)}`);
    return undefined;
  }
  if (opts?.integer === true && !Number.isInteger(value)) {
    pushIssue(issues, path, `must be a whole number, got ${describeValue(value)}`);
    return undefined;
  }
  if (opts?.min !== undefined && value < opts.min) {
    pushIssue(issues, path, `must be at least ${opts.min}, got ${describeValue(value)}`);
    return undefined;
  }
  if (opts?.max !== undefined && value > opts.max) {
    pushIssue(issues, path, `must be at most ${opts.max}, got ${describeValue(value)}`);
    return undefined;
  }
  return value;
}

/**
 * A number OR an explicit `null`, with `undefined` — the field being absent
 * altogether — kept distinct from both.
 *
 * This distinction is the whole of `checkDelegationCeiling`'s subject matter.
 * `null` is an operator saying "this actor has no monetary surface"; absent
 * is nobody having said anything. They must not validate to the same value,
 * because the gate's finding is about the second and not necessarily the
 * first.
 */
export function requireNumberOrNull(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  opts?: { min?: number },
): number | null | undefined {
  if (value === null) return null;
  return requireNumber(value, path, issues, opts);
}

/** A real boolean, never a truthy string or number. `"false"` is a string, and a string is not an answer. */
export function requireBoolean(value: unknown, path: string, issues: ValidationIssue[]): boolean | undefined {
  if (typeof value !== "boolean") {
    pushIssue(issues, path, `must be a boolean, got ${describeValue(value)}`);
    return undefined;
  }
  return value;
}

/**
 * An array where each item is read by `itemReader` — the same
 * `(value, path, issues) => T | undefined` shape every function in this file
 * follows, so an entity's own per-object reader (e.g. `readGrant` in
 * `schema.ts`) plugs directly into this without an adapter.
 */
export function requireArrayOf<T>(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  itemReader: (item: unknown, itemPath: string, issues: ValidationIssue[]) => T | undefined,
): T[] | undefined {
  if (!Array.isArray(value)) {
    pushIssue(issues, path, `must be an array, got ${describeValue(value)}`);
    return undefined;
  }
  const out: T[] = [];
  let ok = true;
  value.forEach((item, index) => {
    const result = itemReader(item, `${path}[${index}]`, issues);
    if (result === undefined) ok = false;
    else out.push(result);
  });
  return ok ? out : undefined;
}

/** An array of non-empty strings. Anything else is a shape problem, never a silently-empty list. */
export function requireStringArray(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): string[] | undefined {
  return requireArrayOf(value, path, issues, (item, itemPath, itemIssues) =>
    requireString(item, itemPath, itemIssues, { minLength: 1 }),
  );
}

/** Joins `ValidationIssue[]` into one-line-per-issue text a CLI can print directly. */
export function summarizeIssues(issues: readonly ValidationIssue[]): string {
  return issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
}
