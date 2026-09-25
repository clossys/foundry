import { createHash } from "node:crypto";
import { validateAdvisorPlan } from "./status.js";
import type { AdvisorPlan } from "./status.js";

/**
 * The canonical plan digest (issue #1475), implemented from its one
 * definition in this repository's `docs/contracts/advisor-plan-digest.md`.
 * An approval binds this value, so it names exactly which plan was
 * approved. @clossys/launcher implements the same definition separately,
 * and both packages are tested against the same fixture corpus
 * (`docs/contracts/advisor-plan-digest.fixture.json`), so they compute
 * identical digests. Both files are in the public repository, not shipped in this package.
 */

/** The top-level plan members the digest leaves out: when the file was written, and the decisions an approval is recorded in. */
export const PLAN_DIGEST_EXCLUDED_FIELDS: readonly string[] = ["asOf", "decisions"];

const LONE_SURROGATE = /[\uD800-\uDFFF]/u;

function canonicalString(value: string): string {
  // With the `u` flag a surrogate pair is one code point, so this matches only a lone surrogate.
  if (LONE_SURROGATE.test(value)) throw new TypeError("canonical JSON refuses a string that is not well-formed Unicode (a lone surrogate)");
  // For a well-formed string, JSON.stringify produces exactly the RFC 8785 escaping.
  return JSON.stringify(value);
}

/**
 * RFC 8785 (JSON Canonicalization Scheme) serialization: no whitespace,
 * object members sorted by UTF-16 code units, strings escaped only where
 * JSON requires, numbers as ECMAScript writes them. Throws on anything JSON
 * cannot carry (undefined, a function, a non-finite number) and on a lone
 * surrogate, rather than silently dropping or repairing it.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("canonical JSON refuses a non-finite number");
    return Object.is(value, -0) ? "0" : String(value);
  }
  if (typeof value === "string") return canonicalString(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    // Array.prototype.sort's default order compares UTF-16 code units, which is RFC 8785's order.
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${canonicalString(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  throw new TypeError(`canonical JSON refuses a value of type ${typeof value}`);
}

/**
 * `sha256:` and the lowercase hex SHA-256 of the canonical JSON of the plan
 * without `asOf` and `decisions`. Throws when the plan does not validate
 * against the plan contract: an invalid plan has no digest.
 */
export function planDigest(plan: AdvisorPlan): string {
  const findings = validateAdvisorPlan(plan);
  if (findings.length > 0) throw new TypeError(`an invalid plan has no digest: ${findings.map((finding) => finding.message).join("; ")}`);
  const subject = Object.fromEntries(Object.entries(plan).filter(([key]) => !PLAN_DIGEST_EXCLUDED_FIELDS.includes(key)));
  return `sha256:${createHash("sha256").update(canonicalJson(subject), "utf8").digest("hex")}`;
}
