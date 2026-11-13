/**
 * Shared, dependency-free validation primitives for `schema.ts`. This
 * package hand-rolls its entity validation rather than depending on a
 * schema library — see `schema.ts`'s top-level doc comment for why, and
 * `@example/policy`'s `validate.ts` for the precedent this file
 * follows: plain type guards over `unknown`, accumulating findings into an
 * array, never throwing.
 *
 * Every `require*` helper below takes the same three leading arguments —
 * `value` (the candidate, still `unknown`), `path` (an absolute,
 * human-readable location like `"facts[2].lastUpdatedAt"`), and `issues`
 * (the caller's shared, mutated-in-place array) — and returns either the
 * narrowed value or `undefined`. A caller never has to inspect the return
 * value to know whether something went wrong: every failure is also
 * recorded into `issues` at the moment it's discovered, so the standard
 * pattern (used throughout `schema.ts`) is to snapshot `issues.length`
 * before validating an object's fields and compare it after — if it grew,
 * something in this object failed, regardless of which field.
 */

export interface ValidationIssue {
  /** Absolute, dot/bracket-joined location, e.g. `"values[0].rule"`, or `"(root)"` for a whole-value shape problem. */
  path: string;
  message: string;
}

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; issues: ValidationIssue[] };

/** A hand-rolled validator: takes an unknown value, returns a `ValidationResult<T>`. Never throws. */
export type Validator<T> = (value: unknown) => ValidationResult<T>;

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Mirrors `@example/policy/src/validate.ts`'s own `isOneOf` — a closed-vocabulary check with no schema-library equivalent needed. */
export function isOneOf<T extends string>(value: unknown, list: readonly T[]): value is T {
  return typeof value === "string" && (list as readonly string[]).includes(value);
}

/** A short, readable description of an arbitrary value for an error message — never the value's full (potentially huge, potentially sensitive) content. */
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
  if (value.length < minLength) {
    pushIssue(issues, path, `must be at least ${minLength} character(s) long`);
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

export function requireNumber(value: unknown, path: string, issues: ValidationIssue[]): number | undefined {
  if (typeof value !== "number" || Number.isNaN(value)) {
    pushIssue(issues, path, `must be a number, got ${describeValue(value)}`);
    return undefined;
  }
  return value;
}

export function requireBoolean(value: unknown, path: string, issues: ValidationIssue[]): boolean | undefined {
  if (typeof value !== "boolean") {
    pushIssue(issues, path, `must be a boolean, got ${describeValue(value)}`);
    return undefined;
  }
  return value;
}

export function requirePattern(
  value: string,
  path: string,
  issues: ValidationIssue[],
  pattern: RegExp,
  description: string,
): boolean {
  if (!pattern.test(value)) {
    pushIssue(issues, path, description);
    return false;
  }
  return true;
}

/** An array of strings, each individually checked with `requireString`. */
export function requireStringArray(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  opts?: { minLength?: number; itemMinLength?: number },
): string[] | undefined {
  if (!Array.isArray(value)) {
    pushIssue(issues, path, `must be an array of strings, got ${describeValue(value)}`);
    return undefined;
  }
  if (opts?.minLength !== undefined && value.length < opts.minLength) {
    pushIssue(issues, path, `must have at least ${opts.minLength} item(s)`);
    return undefined;
  }
  const out: string[] = [];
  let ok = true;
  value.forEach((item, i) => {
    const itemOpts = opts?.itemMinLength !== undefined ? { minLength: opts.itemMinLength } : undefined;
    const s = requireString(item, `${path}[${i}]`, issues, itemOpts);
    if (s === undefined) ok = false;
    else out.push(s);
  });
  return ok ? out : undefined;
}

/** Same as `requireStringArray`, except `undefined` is valid (the field is optional) and produces no issue. */
export function optionalStringArray(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  opts?: { minLength?: number; itemMinLength?: number },
): string[] | undefined {
  if (value === undefined) return undefined;
  return requireStringArray(value, path, issues, opts);
}

/**
 * An array where each item is read by `itemReader` — the same
 * `(value, path, issues) => T | undefined` shape every function in this
 * file follows, so an entity's own per-object reader (e.g. `readMarket` in
 * `schema.ts`) plugs directly into this without an adapter.
 */
export function requireArrayOf<T>(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  itemReader: (item: unknown, itemPath: string, issues: ValidationIssue[]) => T | undefined,
  opts?: { minLength?: number },
): T[] | undefined {
  if (!Array.isArray(value)) {
    pushIssue(issues, path, `must be an array, got ${describeValue(value)}`);
    return undefined;
  }
  if (opts?.minLength !== undefined && value.length < opts.minLength) {
    pushIssue(issues, path, `must have at least ${opts.minLength} item(s)`);
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

/** Joins `ValidationIssue[]` into the one-line-per-issue text `reader.ts` records as a `StrategyReadIssue.detail`. */
export function summarizeIssues(issues: ValidationIssue[]): string {
  return issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
}
