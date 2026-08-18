/**
 * `checkOverrideTargetRanges` — a package.json `overrides` entry's target
 * range must be upper-bounded to the vulnerable major, never a bare
 * `>=x.y.z`.
 *
 * Why this matters: `overrides` exists to force a resolver past a
 * vulnerable transitive version. An unbounded target range (`>=1.2.3`, with
 * nothing above it) does not just clear the vulnerable version — it also
 * lets the resolver hoist every dependent of that package across ANY future
 * major version boundary, silently, the next time `npm install` runs and a
 * newer release exists. A security audit cannot catch this class of break:
 * an audit only confirms the vulnerable version is gone from the tree,
 * never that whatever version the resolver picked instead is still
 * API-compatible with the code that depends on it. Bounding the range to
 * the vulnerable major (`>=1.2.3 <2.0.0`, `~1.2.3`, `^1.2.3`, or an exact
 * pin) keeps the fix scoped to exactly the vulnerability it was written for.
 *
 * Range parsing is hand-rolled — no semver dependency — and deliberately
 * narrow. It understands exactly:
 *   - an exact pin (optionally with a leading `=`): `"1.2.3"`, `"=1.2.3"`
 *   - a `~` (tilde) range: `"~1.2.3"`, `"~1.2"`, `"~1"`
 *   - a `^` (caret) range: `"^1.2.3"`, `"^0.2.3"`
 *   - an explicit space-hyphen-space range: `"1.2.3 - 2.0.0"`
 *   - a single comparator: `"<2.0.0"`, `"<=2.0.0"` (bounded), or `">=1.2.3"`,
 *     `">1.2.3"` (understood, but reported as unbounded — this is the
 *     canonical case this gate exists to catch)
 *   - a two-comparator AND range with exactly one lower (`>=`/`>`) and one
 *     upper (`<`/`<=`) bound, in either order: `">=1.2.3 <2.0.0"`
 *
 * Everything else — OR ranges (`"... || ..."`), `x`/wildcard ranges
 * (`"1.x"`, `"*"`), dist-tags (`"latest"`), git/URL/file/workspace
 * specifiers, three or more space-separated comparators, or any token that
 * does not match a version shape at all — is reported as
 * `"overrides/range-unparseable"`, a finding, not a pass. An unparseable
 * range is exactly the case where this gate must not assume the best: it
 * has no way to confirm the range is bounded, so it does not claim to.
 */

/** One thing wrong with an `overrides` entry. */
export interface OverrideRangeFinding {
  /** Stable identifier for what this finding reports. */
  rule: "overrides/shape" | "overrides/range-empty" | "overrides/range-unparseable" | "overrides/range-unbounded";
  /** Always `"error"` — every rule here is a hard finding. */
  severity: "error";
  /** Human-readable description of the problem. */
  message: string;
  /** Dotted path into the `overrides` object this finding is about, e.g. `"overrides.foo.bar"`. */
  path: string;
}

const VERSION_CORE = String.raw`\d+(?:\.\d+(?:\.\d+)?)?`;
const PRERELEASE = String.raw`(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?`;
const BUILD_METADATA = String.raw`(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?`;
const VERSION = `${VERSION_CORE}${PRERELEASE}${BUILD_METADATA}`;

const EXACT_PIN_PATTERN = new RegExp(`^=?${VERSION}$`);
const TILDE_RANGE_PATTERN = new RegExp(`^~${VERSION}$`);
const CARET_RANGE_PATTERN = new RegExp(`^\\^${VERSION}$`);
// Requires whitespace on both sides of the hyphen. Without that requirement
// a prerelease pin like "1.2.3-beta.1" (no surrounding whitespace) would be
// ambiguous with a hyphen range — EXACT_PIN_PATTERN already matches that
// form and is checked first, so this pattern only needs to cover the
// unambiguous, whitespace-delimited form.
const HYPHEN_RANGE_PATTERN = new RegExp(`^(?:${VERSION})\\s+-\\s+(?:${VERSION})$`);
const COMPARATOR_TOKEN_PATTERN = new RegExp(`^(>=|<=|>|<)?(${VERSION})$`);

interface RangeAnalysis {
  /** `true` when this gate's parser recognized the range's shape at all. */
  understood: boolean;
  /** `true` when the recognized range has an explicit upper bound. Meaningless when `understood` is `false`. */
  bounded: boolean;
}

function analyzeOverrideRange(range: string): RangeAnalysis {
  if (range.includes("||")) return { understood: false, bounded: false };
  if (EXACT_PIN_PATTERN.test(range)) return { understood: true, bounded: true };
  if (TILDE_RANGE_PATTERN.test(range)) return { understood: true, bounded: true };
  if (CARET_RANGE_PATTERN.test(range)) return { understood: true, bounded: true };
  if (HYPHEN_RANGE_PATTERN.test(range)) return { understood: true, bounded: true };

  const tokens = range.split(/\s+/).filter((token) => token.length > 0);
  if (tokens.length === 0 || tokens.length > 2) return { understood: false, bounded: false };

  const parsedTokens = tokens.map((token) => COMPARATOR_TOKEN_PATTERN.exec(token));
  if (parsedTokens.some((match) => match === null)) return { understood: false, bounded: false };
  const operators = parsedTokens.map((match) => (match as RegExpExecArray)[1]);

  if (tokens.length === 1) {
    const op = operators[0];
    if (op === "<" || op === "<=") return { understood: true, bounded: true };
    if (op === ">" || op === ">=") return { understood: true, bounded: false };
    // A bare single token with no operator at all would already have
    // matched EXACT_PIN_PATTERN above, so this branch is unreachable in
    // practice. Treated as unparseable rather than assumed, matching this
    // parser's fail-closed default for anything it cannot classify with
    // confidence.
    return { understood: false, bounded: false };
  }

  // Exactly two tokens: understood only as a classic AND range with one
  // lower comparator and one upper comparator, in either order. Two lowers,
  // two uppers, or anything else is unparseable — this gate does not guess.
  const hasLower = operators.includes(">=") || operators.includes(">");
  const hasUpper = operators.includes("<=") || operators.includes("<");
  const onlyBoundOperators = operators.every((op) => op === ">=" || op === ">" || op === "<=" || op === "<");
  if (hasLower && hasUpper && onlyBoundOperators) return { understood: true, bounded: true };
  return { understood: false, bounded: false };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checkRangeString(range: string, path: string): OverrideRangeFinding[] {
  const trimmed = range.trim();
  if (trimmed.length === 0) {
    return [
      {
        rule: "overrides/range-empty",
        severity: "error",
        message: `Override range at "${path}" must not be empty.`,
        path,
      },
    ];
  }

  const analysis = analyzeOverrideRange(trimmed);
  if (!analysis.understood) {
    return [
      {
        rule: "overrides/range-unparseable",
        severity: "error",
        message:
          `Override range ${JSON.stringify(range)} at "${path}" is not a form this gate's hand-rolled parser ` +
          "understands (only an exact pin, a \"~\"/\"^\" range, an explicit space-hyphen-space range, or a " +
          "single/paired \">=\"/\">\"/\"<\"/\"<=\" comparator range are recognized). An unparseable range is " +
          "exactly the case where this gate must not assume the best — it is reported as a finding, not a pass.",
        path,
      },
    ];
  }

  if (!analysis.bounded) {
    return [
      {
        rule: "overrides/range-unbounded",
        severity: "error",
        message:
          `Override range ${JSON.stringify(range)} at "${path}" has no upper bound. An unbounded target lets a ` +
          "resolver hoist a dependent across a major version boundary and break it at runtime — a security " +
          "audit only confirms the vulnerable version is gone, never that the replacement stays API-compatible " +
          `with what depends on it. Bound it to the vulnerable major, e.g. "${trimmed} <NEXT_MAJOR.0.0", or use ` +
          '"~", "^", or an exact pin instead.',
        path,
      },
    ];
  }

  return [];
}

/**
 * `overrides` supports nesting: a value is either a version range string, or
 * an object whose own `"."` key (if present) is the range for the entry at
 * this path, with every other key naming a further-nested override for one
 * of that package's own dependencies. This walks that shape recursively,
 * checking every string leaf found anywhere in it — nested or not — against
 * `checkRangeString`.
 */
function walkOverrides(node: unknown, path: string, findings: OverrideRangeFinding[]): void {
  if (typeof node === "string") {
    findings.push(...checkRangeString(node, path));
    return;
  }
  if (isPlainObject(node)) {
    for (const [key, value] of Object.entries(node)) {
      walkOverrides(value, key === "." ? path : `${path}.${key}`, findings);
    }
    return;
  }
  findings.push({
    rule: "overrides/shape",
    severity: "error",
    message: `Override entry at "${path}" must be a version range string or a nested overrides object, got ${node === null ? "null" : typeof node}.`,
    path,
  });
}

/**
 * Checks every target range in a package.json `overrides` block. `overrides`
 * is exactly the value of that field, `unknown` because it is exactly the
 * kind of value read straight from a parsed, untrusted package.json.
 *
 * `overrides === undefined` (the field is simply absent — no package.json in
 * this repository declares one today) returns `[]`: there is nothing to
 * check, and an absent block is not itself a finding.
 */
export function checkOverrideTargetRanges(overrides: unknown): OverrideRangeFinding[] {
  if (overrides === undefined) return [];

  if (!isPlainObject(overrides)) {
    return [
      {
        rule: "overrides/shape",
        severity: "error",
        message: `package.json "overrides" must be an object when present, got ${overrides === null ? "null" : Array.isArray(overrides) ? "array" : typeof overrides}.`,
        path: "overrides",
      },
    ];
  }

  const findings: OverrideRangeFinding[] = [];
  for (const [key, value] of Object.entries(overrides)) {
    walkOverrides(value, `overrides.${key}`, findings);
  }
  return findings;
}
