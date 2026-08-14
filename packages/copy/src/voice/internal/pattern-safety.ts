/**
 * The regex-safety gate for `PatternRule.pattern` (see `../types.ts`) —
 * shared by `../schema.ts` (registration-time validation, when a
 * `VoiceRecord` is parsed from raw data) and `../checker.ts`
 * (defense-in-depth at check time, since `checkCopy` deliberately does not
 * trust its `VoiceRecord` argument — see that file's own doc comment).
 *
 * THE POSITION THIS PACKAGE TAKES ON REGEX SAFETY, STATED ONCE, IN FULL:
 * bound the pattern at REGISTRATION TIME, never at run time. There is no
 * runtime timeout, no worker thread, no execution sandbox anywhere in this
 * package — Node has no synchronous way to cancel a regex mid-match, and a
 * background-thread-plus-timeout scheme is real infrastructure this
 * package's zero-dependency, synchronous, pure-function design (see
 * `../types.ts`'s header comment) has no room for. Instead, `checkPatternSafety`
 * below performs a STATIC analysis of the pattern's SOURCE TEXT and refuses
 * to compile — reports as a finding, never silently drops (see `../schema.ts`
 * and `../checker.ts`) — any pattern this analysis cannot bound:
 *
 *   1. Disallowed flags. Only `i` (case-insensitive), `u` (unicode), and `s`
 *      (dotAll) are accepted. `g`/`y` (global/sticky) are rejected because
 *      this package always does its own counting pass (see
 *      `countPatternMatches`) — accepting a caller's own `g`/`y` would only
 *      invite `lastIndex`-statefulness bugs for zero benefit. `m`
 *      (multiline) is rejected too: this package matches a pattern against a
 *      single piece of copy, never multi-line source text where `^`/`$`
 *      anchors are meant to bind per-line — accepting `m` would silently
 *      change what `^`/`$` mean in exactly the case most likely to surprise
 *      an author.
 *   2. Pattern length. `source.length > MAX_PATTERN_SOURCE_LENGTH` (200) is
 *      rejected outright — a voice rule is a short, auditable phrase or
 *      character ban, never a novel-length expression, and a hard length
 *      cap bounds every other check's own work too.
 *   3. Backreferences (`\1`-`\9`, `\k<name>`). A well-known, independent
 *      source of catastrophic backtracking, and one a voice/glossary rule
 *      has essentially no legitimate use for — rejected outright, no
 *      attempt to bound them.
 *   4. Oversized bounded repetition (`{m,n}` or `{m}` whose effective upper
 *      bound exceeds `MAX_QUANTIFIER_BOUND`, 50). A large-but-bounded repeat
 *      count is still a real cost multiplier, especially combined with
 *      other repeats elsewhere in the same pattern.
 *   5. NESTED QUANTIFIERS — the classic `(a+)+` / `(a*)*` / `(.*)+` shape
 *      that causes real exponential-time catastrophic backtracking.
 *      Detected via a hand-rolled structural scan (`analyzePatternSource`
 *      below): any quantifier (bounded or unbounded — `*`, `+`, `{m,}`, or
 *      `{m,n}`) applied to a GROUP whose own top-level content already
 *      contains an UNBOUNDED quantifier (`*`, `+`, or `{m,}` with no upper
 *      bound) is rejected. Deliberately conservative in the direction of
 *      REJECTING more than strictly necessary: a false positive (a pattern
 *      that would actually have run fine) is merely annoying to its author;
 *      a false negative here is a hung scanner, which this package will
 *      never accept as the trade.
 *
 * WHAT THIS DOES NOT CATCH — stated honestly, not silently:
 *
 *   - Overlapping-alternation blowup (`(a|a)+`, `(a|ab)*`) that involves no
 *     nested quantifier at all. A real, known ReDoS shape this static scan
 *     does not detect — a full fix requires real regex-AST analysis (what
 *     tools like `safe-regex` do), which this package's zero-dependency,
 *     hand-rolled-scanner design does not attempt. Bounded in practice by
 *     the length cap (rule 2) and the fact that this package only ever
 *     matches a pattern against one short piece of product/marketing copy,
 *     never arbitrary-length adversarial input — but this is a mitigation,
 *     not a guarantee.
 *   - Aggregate cost across many pattern rules evaluated against the same
 *     `copy` string. Each pattern is bounded individually; the total cost of
 *     a large `patterns` list is a volume concern for the record's author,
 *     not something this gate polices.
 *
 * This is a real, bounded, DOCUMENTED static gate — not a general ReDoS
 * detector, and this file does not claim to be one.
 */

/** Regex flags this package will construct a `RegExp` with. Anything else is rejected — see this file's top doc comment, point 1. */
export const PATTERN_ALLOWED_FLAGS: ReadonlySet<string> = new Set(["i", "u", "s"]);

/** Hard cap on `pattern.source.length` — see this file's top doc comment, point 2. */
export const MAX_PATTERN_SOURCE_LENGTH = 200;

/** Hard cap on a bounded quantifier's effective upper bound (`{m,n}`/`{m}`) — see this file's top doc comment, point 4. */
export const MAX_QUANTIFIER_BOUND = 50;

export type PatternSafetyIssue =
  | "pattern-source-shape"
  | "pattern-flags-shape"
  | "pattern-too-long"
  | "pattern-backreference"
  | "pattern-quantifier-bound-too-large"
  | "pattern-nested-quantifier"
  | "pattern-does-not-compile";

export interface PatternSafetyOk {
  ok: true;
  regex: RegExp;
}

export interface PatternSafetyFailure {
  ok: false;
  issue: PatternSafetyIssue;
  detail: string;
}

export type PatternSafetyResult = PatternSafetyOk | PatternSafetyFailure;

function fail(issue: PatternSafetyIssue, detail: string): PatternSafetyFailure {
  return { ok: false, issue, detail };
}

interface GroupFrame {
  /** Did THIS group's own top-level content (not a nested group's) contain an unbounded quantifier? */
  hasUnboundedQuantifier: boolean;
}

/**
 * Structural scan for backreferences and nested/oversized quantifiers — see
 * this file's top doc comment for exactly what is and is not caught. Walks
 * `source` one character at a time, tracking character-class state (`[...]`)
 * and a group-nesting stack, exactly the same bounded, hand-rolled style
 * `../../scan.ts`'s own tokenizer uses for JS/JSX (see that file's top doc
 * comment) — no regex-of-regexes, no parser library. Returns the FIRST
 * issue found, or `undefined` if the source passes this scan (compilation
 * itself is checked separately, by the caller, via `new RegExp`).
 */
function analyzePatternSource(source: string): PatternSafetyFailure | undefined {
  const n = source.length;
  let i = 0;
  let inClass = false;
  const stack: GroupFrame[] = [{ hasUnboundedQuantifier: false }];
  // The frame belonging to the group that was JUST closed by the immediately
  // preceding ")" — cleared by every other kind of token, since only a
  // quantifier reading this value RIGHT AFTER a ")" means "applies to that
  // group".
  let lastClosedGroupFrame: GroupFrame | undefined;

  const applyUnboundedQuantifier = (): PatternSafetyFailure | undefined => {
    if (lastClosedGroupFrame?.hasUnboundedQuantifier) {
      return fail(
        "pattern-nested-quantifier",
        `a quantifier at offset ${i} applies to a group that itself contains an unbounded quantifier — this is the classic catastrophic-backtracking shape (e.g. "(a+)+"); rejected without attempting to run it`,
      );
    }
    const top = stack[stack.length - 1];
    if (top) top.hasUnboundedQuantifier = true;
    return undefined;
  };

  while (i < n) {
    const c = source[i] as string;

    if (inClass) {
      if (c === "\\") {
        i += 2;
      } else if (c === "]") {
        inClass = false;
        i++;
      } else {
        i++;
      }
      lastClosedGroupFrame = undefined;
      continue;
    }

    if (c === "\\") {
      const next = source[i + 1];
      if (next !== undefined && next >= "1" && next <= "9") {
        return fail(
          "pattern-backreference",
          `backreference "\\${next}" at offset ${i} — a known independent source of catastrophic backtracking, rejected outright`,
        );
      }
      if (next === "k" && source[i + 2] === "<") {
        return fail(
          "pattern-backreference",
          `named backreference "\\k<...>" at offset ${i} — a known independent source of catastrophic backtracking, rejected outright`,
        );
      }
      i += 2;
      lastClosedGroupFrame = undefined;
      continue;
    }

    if (c === "[") {
      inClass = true;
      i++;
      lastClosedGroupFrame = undefined;
      continue;
    }

    if (c === "(") {
      stack.push({ hasUnboundedQuantifier: false });
      i++;
      lastClosedGroupFrame = undefined;
      continue;
    }

    if (c === ")") {
      const closed = stack.pop();
      if (!closed) return fail("pattern-does-not-compile", `unmatched ")" at offset ${i}`);
      i++;
      lastClosedGroupFrame = closed;
      continue;
    }

    if (c === "*" || c === "+") {
      const issue = applyUnboundedQuantifier();
      if (issue) return issue;
      i++;
      if (source[i] === "?") i++; // lazy modifier — still unbounded, does not change the analysis
      lastClosedGroupFrame = undefined;
      continue;
    }

    if (c === "?") {
      // A bounded (0-1) quantifier on the previous atom/group. Never marks
      // the enclosing frame as unbounded, and a group with an inner
      // unbounded quantifier wrapped as "(...)?" (applied at most once) is
      // NOT the nested-quantifier shape this scan exists to catch.
      i++;
      lastClosedGroupFrame = undefined;
      continue;
    }

    if (c === "{") {
      const close = source.indexOf("}", i);
      const body = close === -1 ? undefined : source.slice(i + 1, close);
      const match = body === undefined ? null : /^(\d+)(,(\d*))?$/.exec(body);
      if (!match) {
        // Not valid `{n}`/`{n,}`/`{n,m}` quantifier syntax — JS treats a
        // lone "{" that doesn't form one of these as a literal character,
        // not an error, so this scan does the same.
        i++;
        lastClosedGroupFrame = undefined;
        continue;
      }
      const hasComma = match[2] !== undefined;
      const upperText = match[3];
      const unbounded = hasComma && (upperText === undefined || upperText === "");
      if (unbounded) {
        const issue = applyUnboundedQuantifier();
        if (issue) return issue;
      } else {
        const upper = hasComma ? Number(upperText) : Number(match[1]);
        if (upper > MAX_QUANTIFIER_BOUND) {
          return fail(
            "pattern-quantifier-bound-too-large",
            `quantifier "{${body}}" at offset ${i} has an upper bound of ${upper}, exceeding the maximum of ${MAX_QUANTIFIER_BOUND}`,
          );
        }
        if (lastClosedGroupFrame?.hasUnboundedQuantifier) {
          return fail(
            "pattern-nested-quantifier",
            `quantifier "{${body}}" at offset ${i} applies to a group that itself contains an unbounded quantifier`,
          );
        }
      }
      i = (close as number) + 1;
      if (source[i] === "?") i++;
      lastClosedGroupFrame = undefined;
      continue;
    }

    i++;
    lastClosedGroupFrame = undefined;
  }

  if (stack.length !== 1) {
    return fail("pattern-does-not-compile", `unbalanced "(" — ${stack.length - 1} group(s) never closed`);
  }
  return undefined;
}

/**
 * The full registration-time (and defense-in-depth check-time) safety gate
 * for one `VoicePattern`. `pattern` is `unknown`, not the `{ source, flags
 * }` shape it will usually already be — this is called from both
 * `../schema.ts` (validating raw, untrusted JSON, where `pattern` may be
 * anything) and `../checker.ts` (re-checking a typed `VoiceRecord` this
 * package's own `checkCopy` does not otherwise trust — see that file's doc
 * comment; a hostile or malformed in-memory record could still hand this a
 * non-object). Never throws, for any input.
 */
export function checkPatternSafety(pattern: unknown): PatternSafetyResult {
  if (typeof pattern !== "object" || pattern === null || Array.isArray(pattern)) {
    return fail("pattern-source-shape", `pattern must be an object with a "source" string, got ${JSON.stringify(pattern)}`);
  }
  const source = (pattern as { source?: unknown }).source;
  if (typeof source !== "string" || source.length === 0) {
    return fail("pattern-source-shape", `pattern.source must be a non-empty string, got ${JSON.stringify(source)}`);
  }
  if (source.length > MAX_PATTERN_SOURCE_LENGTH) {
    return fail(
      "pattern-too-long",
      `pattern.source is ${source.length} character(s), exceeding the maximum of ${MAX_PATTERN_SOURCE_LENGTH}`,
    );
  }

  const flags = (pattern as { flags?: unknown }).flags;
  if (flags !== undefined) {
    if (typeof flags !== "string") {
      return fail("pattern-flags-shape", `pattern.flags must be a string when present, got ${JSON.stringify(flags)}`);
    }
    for (const flag of flags) {
      if (!PATTERN_ALLOWED_FLAGS.has(flag)) {
        return fail(
          "pattern-flags-shape",
          `pattern.flags "${flags}" contains "${flag}", which is not one of the allowed flags (${[...PATTERN_ALLOWED_FLAGS].join(", ")}) — see this file's top doc comment for why "g"/"y"/"m" are rejected`,
        );
      }
    }
  }

  const structuralIssue = analyzePatternSource(source);
  if (structuralIssue) return structuralIssue;

  try {
    const regex = new RegExp(source, flags ?? "");
    return { ok: true, regex };
  } catch (error) {
    return fail("pattern-does-not-compile", error instanceof Error ? error.message : String(error));
  }
}

/**
 * Runs an ALREADY-SAFE (passed `checkPatternSafety`) regex against `copy`,
 * counting non-overlapping matches — the pattern-rule analog of
 * `../checker.ts`'s own `countMatches`, except this never wraps the source
 * in `\b...\b`: a pattern rule's whole point is that the caller's regex IS
 * the expression, unmodified. Always adds "g" for counting, regardless of
 * what flags were validated — "g" is never an allowed caller-supplied flag
 * (see `checkPatternSafety`), so this is the one place it is ever added,
 * and only for this internal counting pass.
 */
export function countPatternMatches(copy: string, regex: RegExp): number {
  const counting = new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : `${regex.flags}g`);
  const matches = copy.match(counting);
  return matches ? matches.length : 0;
}
