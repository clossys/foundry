// The canonical plan digest (issue #1586), implemented from its one
// definition, docs/contracts/advisor-plan-digest.md -- in the public repository, not shipped in this package.
// An approval binds this value, so it names exactly which plan was approved.
// Every other reader of a plan implements the same definition separately, and
// each is tested against the same fixture corpus,
// docs/contracts/advisor-plan-digest.fixture.json (likewise in the public repository, not shipped in this package),
// so all of them compute identical digests.
// This is a third, separate reading of RFC 8785: strings go through
// JSON.stringify, whose output for well-formed text is exactly the escaping
// RFC 8785 requires, with a lone surrogate refused before it.

import { createHash } from "node:crypto";
import { planViolations } from "./plan-contract.js";

/** The top-level plan members the digest leaves out: when the file was written, and the decisions an approval is recorded in. */
export const PLAN_DIGEST_EXCLUDED_FIELDS: readonly string[] = ["asOf", "decisions"];

const LONE_SURROGATE_CHECK = /[\uD800-\uDFFF]/u;

/** A string as RFC 8785 writes it. Throws on a string that is not well-formed Unicode. */
function canonicalString(text: string): string {
  if (LONE_SURROGATE_CHECK.test(text)) throw new TypeError("canonical JSON refuses a string that is not well-formed Unicode (a lone surrogate)");
  return JSON.stringify(text);
}

/**
 * RFC 8785 (JSON Canonicalization Scheme) serialization: no whitespace,
 * object members sorted by UTF-16 code units, strings escaped only where
 * JSON requires, numbers as ECMAScript writes them. Throws on anything JSON
 * cannot carry (undefined, a function, a bigint, a non-finite number, a hole
 * in an array) and on a lone surrogate, rather than silently dropping or
 * repairing it.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) throw new TypeError("canonical JSON refuses a non-finite number");
      return String(value);
    case "string":
      return canonicalString(value);
    case "object": {
      if (Array.isArray(value)) {
        const items: string[] = [];
        for (let index = 0; index < value.length; index += 1) items.push(canonicalJson(value[index]));
        return `[${items.join(",")}]`;
      }
      const record = value as Record<string, unknown>;
      // The default sort compares UTF-16 code units, which is the order RFC 8785 requires.
      const members = Object.keys(record)
        .sort()
        .map((key) => `${canonicalString(key)}:${canonicalJson(record[key])}`);
      return `{${members.join(",")}}`;
    }
    default:
      throw new TypeError(`canonical JSON refuses a value of type ${typeof value}`);
  }
}

/**
 * `sha256:` and the lowercase hex SHA-256 of the canonical JSON of a plan
 * without `asOf` and `decisions`. Assumes `plan` already passed
 * `planViolations()`: it checks nothing itself.
 */
export function digestOfValidPlan(plan: Readonly<Record<string, unknown>>): string {
  const subject: Record<string, unknown> = {};
  for (const key of Object.keys(plan)) if (!PLAN_DIGEST_EXCLUDED_FIELDS.includes(key)) subject[key] = plan[key];
  return `sha256:${createHash("sha256").update(canonicalJson(subject), "utf8").digest("hex")}`;
}

/**
 * The plan digest. Throws when the plan does not validate against the plan
 * contract, rules included: an invalid plan has no digest.
 */
export function planDigest(plan: unknown): string {
  const violations = planViolations(plan);
  if (violations.length > 0) throw new TypeError(`an invalid plan has no digest: ${violations.map((violation) => violation.message).join("; ")}`);
  return digestOfValidPlan(plan as Readonly<Record<string, unknown>>);
}
