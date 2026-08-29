/**
 * Path exclusions for `scan.ts`'s SCANNING SURFACE — `scanCopySourceTree`'s
 * directory walk — never to be confused with `scan.ts`'s existing
 * `ExclusionReason`/`ExcludedLiteral`, a DIFFERENT feature this file does
 * not touch. Read `scan.ts`'s own top doc comment ("THE BOUNDARY") before
 * this one: that mechanism decides, for a LITERAL already found inside a
 * file that IS being scanned, whether that one literal is real copy or
 * something structural (an import specifier, a CSS class, an aria label,
 * ...) — a per-LITERAL classification made from the few dozen characters of
 * context immediately around it. This file answers a completely different
 * question, at a completely different granularity: should this FILE be
 * looked at for copy candidates AT ALL, before a single character of it is
 * ever tokenized? That is a per-FILE scope decision, made once, from the
 * file's own path alone — extending `ExclusionReason` to cover it would be
 * a coincidence of both being named "exclusion", not a shared mechanism;
 * this is why it is a new, separate type (`PathExclusion`) and a new,
 * separate `ScanResult` field (`excludedFiles`), not a tenth
 * `ExclusionReason`.
 *
 * THE MOTIVATING CASE ("mention vs. use"): a style guide or README that
 * documents this voice's own banned terms — "never say X, say Y instead" —
 * necessarily CONTAINS the literal banned text, as a MENTION, not a USE.
 * Scanned like any other file, that mention looks identical to real,
 * unregistered product copy to `checkCopyTraceability` (`copy-gate.ts`):
 * the traceability gate has no notion of "this file's job is to talk about
 * copy, not ship it". A `PathExclusion` on that one file's path is the fix
 * — the file is never tokenized at all, so it can never produce a
 * candidate, `unregistered-copy` finding, or citation. See this file's
 * README section, "Path exclusions vs. per-literal exclusions", for the
 * fuller argument, including why this stays scoped to `scan.ts`'s existing
 * scanning surface (copy TRACEABILITY) rather than inventing a new
 * directory-scanning feature for VOICE/glossary rules, which this package
 * does not otherwise have — a consumer building their own "walk a
 * directory, then run each file's text through `checkCopy`" tool gets the
 * identical mention-vs-use protection by reusing THIS mechanism (call
 * `scanCopySourceTree` with `pathExclusions`, then feed its candidates'
 * text through `checkCopy` themselves) rather than this package growing a
 * second, redundant exclusion list.
 *
 * FAILS CLOSED, mirroring `checker.ts`'s `VoiceCheckWaiver` handling (the
 * established precedent for "a caller-supplied list of exceptions" in this
 * package's ecosystem) almost exactly:
 *
 *   - A MALFORMED entry (not an object, `path`/`reason` missing or not a
 *     non-empty string, or a `path` this file's own small pattern language
 *     cannot parse — see `classifyPathExclusionPattern`) is never applied:
 *     it exempts NOTHING, and is reported as its own `"error"`-severity
 *     `PathExclusionFinding` — the exact "a malformed exclusion entry is a
 *     finding, never a silent exemption" requirement. This mirrors
 *     `"waiver:invalid"`.
 *   - An exclusion that never matched a single scanned file is dead
 *     configuration — reported as its own `"warning"`-severity
 *     `PathExclusionFinding`, mirroring `"waiver:unused"`, so a stale
 *     exclusion (the file it named was renamed or deleted) cannot silently
 *     sit in a config forever looking like it is still doing something.
 */

export interface PathExclusion {
  /**
   * A repo-relative, `/`-joined path pattern — see
   * `classifyPathExclusionPattern`'s doc comment for the exact, small,
   * hand-rolled pattern language this supports (no glob library — this
   * package's zero-runtime-dependency rule applies here too).
   */
  path: string;
  /** Required — an exclusion with no stated reason is not auditable, the same discipline `GlossaryEntry.reason` and `VoiceCheckWaiver.reason` already hold every other exception in this package's ecosystem to. */
  reason: string;
}

/** One file `scanCopySourceTree` skipped entirely because its path matched a `PathExclusion` — never tokenized, contributes zero candidates/excluded-literals/citations/unchecked-items. */
export interface ExcludedPath {
  file: string;
  reason: string;
  /** The `PathExclusion.path` pattern that matched, for audit. */
  pattern: string;
}

export type PathExclusionFindingRule = "path-exclusion-invalid" | "path-exclusion-unused";

/** One problem with the `pathExclusions` CONFIGURATION itself — never about a scanned file's content. See this file's top doc comment for the fail-closed contract both rules implement. */
export interface PathExclusionFinding {
  rule: PathExclusionFindingRule;
  /** `"error"` for a malformed entry (never applied); `"warning"` for a well-formed entry that matched nothing this run (applied as designed, just possibly stale). */
  severity: "error" | "warning";
  message: string;
  /** The exclusion's own `path` pattern, when there is one to point at (absent only for a top-level shape error, e.g. `pathExclusions` itself not being an array). */
  path?: string;
}

/** One validated `PathExclusion`, tagged with which of this file's three supported pattern shapes it is — computed once by `validatePathExclusions` so `matchesPathExclusion` never has to re-derive it (and never has to re-validate what was already validated). */
export interface ValidatedPathExclusion extends PathExclusion {
  kind: "exact" | "subtree" | "segment-wildcard";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Classifies `pattern` into one of this file's three supported shapes, or
 * `undefined` if it matches none of them — the entire "glob" grammar this
 * package supports, deliberately small (no glob library, per this
 * repository's zero-runtime-dependency rule):
 *
 *   1. `"exact"` — no `*` anywhere. Matches only the identical repo-relative
 *      path, e.g. `"docs/style-guide.ts"`.
 *   2. `"subtree"` — ends in exactly `"/**"`, with no other `*` anywhere
 *      else in the pattern. Matches every file under that directory,
 *      recursively, e.g. `"docs/**"` matches `"docs/style-guide.ts"` AND
 *      `"docs/internal/glossary.ts"`.
 *   3. `"segment-wildcard"` — exactly one `*` (not `**`), confined to the
 *      pattern's FINAL `/`-separated segment, e.g. `"docs/*.ts"`. Every
 *      segment before the last must match exactly; the last segment's `*`
 *      matches any run of characters (including none) within that one
 *      segment only — it does not cross a `/`.
 *
 * A `*`/`**` anywhere else (mid-path, more than one `*` in the final
 * segment, a `**` not forming the whole-pattern `"/**"` suffix, an empty
 * pattern) is rejected — `undefined` — by design: this is a fixed-scope
 * exclusion mechanism for known files/directories, not a general glob
 * engine, and a caller who needs more expressive matching should use
 * `"subtree"` on a containing directory instead.
 */
function classifyPathExclusionPattern(pattern: string): ValidatedPathExclusion["kind"] | undefined {
  if (pattern.length === 0) return undefined;
  if (!pattern.includes("*")) return "exact";

  if (pattern.endsWith("/**") && pattern.indexOf("*") === pattern.length - 2) {
    // The only "*" characters are the trailing "**" pair, and nothing
    // precedes them but a "/" — reject a bare "**" with no directory prefix
    // (nothing meaningful to scope to) and reject any other "*" earlier in
    // the string (already true here: `indexOf` found the FIRST "*" at the
    // trailing pair's position, so there is no earlier one).
    const prefix = pattern.slice(0, -3);
    return prefix.length > 0 && !prefix.includes("*") ? "subtree" : undefined;
  }

  const lastSlash = pattern.lastIndexOf("/");
  const lastSegment = lastSlash === -1 ? pattern : pattern.slice(lastSlash + 1);
  const priorSegments = lastSlash === -1 ? "" : pattern.slice(0, lastSlash);
  const starCount = (lastSegment.match(/\*/g) ?? []).length;
  if (starCount === 1 && !lastSegment.includes("**") && !priorSegments.includes("*")) {
    return "segment-wildcard";
  }

  return undefined;
}

/**
 * Matches `relPath` (already `/`-joined, repo-relative — the same shape
 * `scanCopySourceTree` produces for every `CopyCandidate.file`) against one
 * already-classified exclusion. Never called with a pattern that failed
 * `classifyPathExclusionPattern` — `validatePathExclusions` filters those
 * out before anything reaches here, so this function does not re-validate.
 */
export function matchesPathExclusion(relPath: string, exclusion: ValidatedPathExclusion): boolean {
  switch (exclusion.kind) {
    case "exact":
      return relPath === exclusion.path;
    case "subtree": {
      const prefix = exclusion.path.slice(0, -2); // "docs/**" -> "docs/"
      return relPath.startsWith(prefix);
    }
    case "segment-wildcard": {
      const lastSlash = exclusion.path.lastIndexOf("/");
      const priorSegments = lastSlash === -1 ? "" : exclusion.path.slice(0, lastSlash + 1);
      const lastSegmentPattern = lastSlash === -1 ? exclusion.path : exclusion.path.slice(lastSlash + 1);
      if (!relPath.startsWith(priorSegments)) return false;
      const relRest = relPath.slice(priorSegments.length);
      if (relRest.includes("/")) return false; // the wildcard segment never crosses a "/"
      const [before, after] = lastSegmentPattern.split("*") as [string, string];
      return relRest.startsWith(before) && relRest.endsWith(after) && relRest.length >= before.length + after.length;
    }
    default: {
      const unhandled: never = exclusion.kind;
      throw new Error(`matchesPathExclusion: unknown pattern kind ${JSON.stringify(unhandled)}`);
    }
  }
}

export interface PathExclusionValidation {
  /** Every exclusion that passed shape+pattern validation — safe to match files against. */
  valid: ValidatedPathExclusion[];
  /** Malformed entries, as `"error"`-severity findings. Never includes `"path-exclusion-unused"` — that rule is only ever added later, once the walk has actually run; see `scanCopySourceTree`. */
  findings: PathExclusionFinding[];
}

/**
 * Validates `value` (`ScanOptions.pathExclusions`, or any raw candidate list
 * — this is called on a TYPED `PathExclusion[]` from a TypeScript caller,
 * but re-validates every field anyway, the same defense-in-depth this
 * repository's other schema functions apply to already-typed input: see
 * `@clossys/writer/voice`'s `schema.ts` header comment for why a
 * plain-JS caller, or a value that merely satisfies the type at compile
 * time without conforming at runtime, is exactly the case this guards
 * against). Never throws.
 */
export function validatePathExclusions(value: unknown): PathExclusionValidation {
  if (value === undefined) return { valid: [], findings: [] };
  if (!Array.isArray(value)) {
    return {
      valid: [],
      findings: [
        {
          rule: "path-exclusion-invalid",
          severity: "error",
          message: `pathExclusions must be an array when present, got ${JSON.stringify(value)}.`,
        },
      ],
    };
  }

  const valid: ValidatedPathExclusion[] = [];
  const findings: PathExclusionFinding[] = [];

  value.forEach((raw, i) => {
    if (!isPlainObject(raw)) {
      findings.push({
        rule: "path-exclusion-invalid",
        severity: "error",
        message: `pathExclusions[${i}] must be an object with "path" and "reason", got ${JSON.stringify(raw)}.`,
      });
      return;
    }
    const path = raw.path;
    const reason = raw.reason;

    if (!isNonEmptyString(path)) {
      findings.push({
        rule: "path-exclusion-invalid",
        severity: "error",
        message: `pathExclusions[${i}].path must be a non-empty string, got ${JSON.stringify(path)}.`,
      });
      return;
    }
    if (!isNonEmptyString(reason)) {
      findings.push({
        rule: "path-exclusion-invalid",
        severity: "error",
        message: `pathExclusions[${i}].reason must be a non-empty string, got ${JSON.stringify(reason)}. An exclusion with no stated reason is not auditable.`,
        path,
      });
      return;
    }

    const kind = classifyPathExclusionPattern(path);
    if (kind === undefined) {
      findings.push({
        rule: "path-exclusion-invalid",
        severity: "error",
        message: `pathExclusions[${i}].path "${path}" is not a supported pattern — supported shapes are an exact path, a "dir/**" subtree, or a single "*" confined to the final path segment. See path-exclusions.ts's classifyPathExclusionPattern doc comment.`,
        path,
      });
      return;
    }

    valid.push({ path, reason, kind });
  });

  return { valid, findings };
}
