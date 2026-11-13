export interface ValidationIssue {

  path: string;
  message: string;
}

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; issues: ValidationIssue[] };


export type Validator<T> = (value: unknown) => ValidationResult<T>;

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}


export function isOneOf<T extends string>(value: unknown, list: readonly T[]): value is T {
  return typeof value === "string" && (list as readonly string[]).includes(value);
}


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


export function optionalStringArray(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  opts?: { minLength?: number; itemMinLength?: number },
): string[] | undefined {
  if (value === undefined) return undefined;
  return requireStringArray(value, path, issues, opts);
}


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


export function summarizeIssues(issues: ValidationIssue[]): string {
  return issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
}
