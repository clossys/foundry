/**
 * `validateVoiceRecordShape` — turns Zod's own validation of a candidate
 * `VoiceRecord` into this repository's own `VoiceFinding[]` shape, so a
 * caller that already knows how to handle a `VoiceFinding` (from
 * `checkCopy`) does not need a second error model just for schema
 * problems. Zod remains the actual validator; this is a thin, honest
 * adapter over `VoiceRecordSchema.safeParse`, nothing more.
 */

import { VoiceRecordSchema } from "./types.js";
import type { VoiceFinding, VoiceRecord } from "./types.js";

/**
 * Validates that `value` conforms to `VoiceRecordSchema`. Returns a
 * `VoiceFinding[]`; empty means `value` is a well-formed `VoiceRecord`.
 * Never throws — any input, including `null`, a string, or a wildly
 * malformed object, produces findings rather than an exception, the same
 * discipline `@vespeneventures/policy`'s `validateBindingShape` holds to.
 *
 * Each Zod issue becomes one `VoiceFinding` with `rule:
 * "schema:<dotted.path>"` (or `"schema:root"` for an issue with no path,
 * e.g. "value must be an object") and Zod's own message carried through
 * unchanged. All schema findings are `"error"` severity — a `VoiceRecord`
 * that does not match its own schema is not a matter of degree.
 */
export function validateVoiceRecordShape(value: unknown): VoiceFinding[] {
  const result = VoiceRecordSchema.safeParse(value);
  if (result.success) return [];

  return result.error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : undefined;
    return {
      rule: `schema:${path ?? "root"}`,
      severity: "error",
      message: issue.message,
      path,
    };
  });
}

/**
 * Parses `value` as a `VoiceRecord`, throwing a plain `Error` (never a
 * `VoiceFinding[]`) if it does not conform. For a caller that wants
 * fail-fast construction — a config-loading step, say — rather than
 * `validateVoiceRecordShape`'s "collect every problem and keep going"
 * shape. The thrown message includes every issue `validateVoiceRecordShape`
 * would have reported, joined, so nothing is lost by throwing instead of
 * returning.
 */
export function parseVoiceRecord(value: unknown): VoiceRecord {
  const findings = validateVoiceRecordShape(value);
  if (findings.length > 0) {
    const detail = findings.map((f) => `  - ${f.path ?? "(root)"}: ${f.message}`).join("\n");
    throw new Error(`parseVoiceRecord: value is not a valid VoiceRecord:\n${detail}`);
  }
  // Safe: validateVoiceRecordShape returning no findings means
  // VoiceRecordSchema.safeParse(value) succeeded, so re-running .parse on
  // the same value cannot fail (Zod schemas are deterministic and pure).
  return VoiceRecordSchema.parse(value);
}
