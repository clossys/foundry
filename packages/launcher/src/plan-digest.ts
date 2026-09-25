// The canonical plan digest (issue #1475), implemented from its one
// definition in this package's source repository,
// docs/contracts/advisor-plan-digest.md. An approval binds this value, so it
// names exactly which plan was approved. @clossys/advisor implements the same
// definition separately; both packages are tested against the same fixture
// corpus (docs/contracts/advisor-plan-digest.fixture.json), so they compute
// identical digests. Both files are in the public repository, not shipped in this package.
// This implementation writes the RFC 8785 escaping out
// character by character rather than leaning on JSON.stringify, so the
// corpus checks two genuinely separate readings of the definition.

import { createHash } from "node:crypto";
import { validateAdvisorPlan } from "./plan-contract.js";
import type { AdvisorPlan } from "./plan-contract.js";

/** The top-level plan members the digest leaves out: when the file was written, and the decisions an approval is recorded in. */
export const PLAN_DIGEST_EXCLUDED_FIELDS: readonly string[] = ["asOf", "decisions"];

const SHORT_ESCAPES: Readonly<Record<number, string>> = { 0x08: "\\b", 0x09: "\\t", 0x0a: "\\n", 0x0c: "\\f", 0x0d: "\\r", 0x22: '\\"', 0x5c: "\\\\" };

function quote(text: string): string {
  let out = '"';
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = index + 1 < text.length ? text.charCodeAt(index + 1) : -1;
      if (next < 0xdc00 || next > 0xdfff) throw new TypeError("canonical JSON refuses a string that is not well-formed Unicode (a lone surrogate)");
      out += text[index]! + text[index + 1]!;
      index += 1;
      continue;
    }
    if (unit >= 0xdc00 && unit <= 0xdfff) throw new TypeError("canonical JSON refuses a string that is not well-formed Unicode (a lone surrogate)");
    const short = SHORT_ESCAPES[unit];
    if (short !== undefined) out += short;
    else if (unit < 0x20) out += `\\u${unit.toString(16).padStart(4, "0")}`;
    else out += text[index]!;
  }
  return `${out}"`;
}

/** Orders two keys by their UTF-16 code units, as RFC 8785 requires. */
function compareCodeUnits(left: string, right: string): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = left.charCodeAt(index) - right.charCodeAt(index);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

/**
 * RFC 8785 (JSON Canonicalization Scheme) serialization: no whitespace,
 * object members sorted by UTF-16 code units, strings escaped only where
 * JSON requires, numbers as ECMAScript writes them. Throws on anything JSON
 * cannot carry (undefined, a function, a non-finite number) and on a lone
 * surrogate, rather than silently dropping or repairing it.
 */
export function canonicalJson(value: unknown): string {
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "string":
      return quote(value);
    case "number":
      if (!Number.isFinite(value)) throw new TypeError("canonical JSON refuses a non-finite number");
      return value === 0 ? "0" : String(value);
    case "object": {
      if (value === null) return "null";
      if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
      const record = value as Record<string, unknown>;
      const members = Object.keys(record)
        .sort(compareCodeUnits)
        .map((key) => `${quote(key)}:${canonicalJson(record[key])}`);
      return `{${members.join(",")}}`;
    }
    default:
      throw new TypeError(`canonical JSON refuses a value of type ${typeof value}`);
  }
}

/**
 * `sha256:` and the lowercase hex SHA-256 of the canonical JSON of the plan
 * without `asOf` and `decisions`. Throws when the plan does not validate
 * against the plan contract: an invalid plan has no digest.
 */
export function planDigest(plan: AdvisorPlan): string {
  const validation = validateAdvisorPlan(plan);
  if (!validation.valid) throw new TypeError(`an invalid plan has no digest: ${validation.reason}`);
  const subject: Record<string, unknown> = {};
  for (const [key, member] of Object.entries(plan)) if (!PLAN_DIGEST_EXCLUDED_FIELDS.includes(key)) subject[key] = member;
  return `sha256:${createHash("sha256").update(Buffer.from(canonicalJson(subject), "utf8")).digest("hex")}`;
}
