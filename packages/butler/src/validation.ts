/**
 * Shared, dependency-free validation primitives for `schema.ts`. This
 * package hand-rolls its entity validation rather than depending on a
 * schema library — see `schema.ts`'s top-level doc comment for why, and
 * `@vespeneventures/strategist`'s `validation.ts` for the precedent this
 * file follows: plain type guards over `unknown`, accumulating findings
 * into an array, never throwing.
 *
 * Every `require*` helper below takes the same three leading arguments —
 * `value` (the candidate, still `unknown`), `path` (an absolute,
 * human-readable location like `"instructions[2].currency.days"`), and
 * `issues` (the caller's shared, mutated-in-place array) — and returns
 * either the narrowed value or `undefined`. A caller never has to inspect
 * the return value to know whether something went wrong: every failure is
 * also recorded into `issues` at the moment it is discovered, so the
 * standard pattern (used throughout `schema.ts`) is to snapshot
 * `issues.length` before validating an object's fields and compare it
 * after — if it grew, something in this object failed, regardless of which
 * field.
 */

export interface ValidationIssue {
  /** Absolute, dot/bracket-joined location, e.g. `"intents[0].confidence"`, or `"(root)"` for a whole-value shape problem. */
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

/** A short, readable description of an arbitrary value for an error message — never the value's full (potentially huge, potentially person-attributable) content. */
export function describeValue(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (Array.isArray(value)) return `an array (${value.length} item(s))`;
  const t = typeof value;
  if (t === "object") return "an object";
  if (t === "string") return JSON.stringify(value);
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
 * treated as "now" — the currency gate's whole job is arithmetic on these
 * values, and a fabricated one would make an expired instruction read as
 * current.
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

/** A real boolean, never a truthy string or number — the same discipline the donor's `isGpcSignal` applies to `present`. */
export function requireBoolean(value: unknown, path: string, issues: ValidationIssue[]): boolean | undefined {
  if (typeof value !== "boolean") {
    pushIssue(issues, path, `must be a boolean, got ${describeValue(value)}`);
    return undefined;
  }
  return value;
}

/**
 * An array where each item is read by `itemReader` — the same
 * `(value, path, issues) => T | undefined` shape every function in this
 * file follows, so an entity's own per-object reader (e.g. `readIntent` in
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
  value.forEach((item, i) => {
    const result = itemReader(item, `${path}[${i}]`, issues);
    if (result === undefined) ok = false;
    else out.push(result);
  });
  return ok ? out : undefined;
}

/** Joins `ValidationIssue[]` into one-line-per-issue text a CLI can print directly. */
export function summarizeIssues(issues: readonly ValidationIssue[]): string {
  return issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
}
