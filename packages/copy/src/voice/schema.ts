/**
 * Structural validation for a candidate `VoiceRecord`, in the same plain
 * type-guard style as `@vespeneventures/policy`'s `validate.ts` — no
 * schema library. See `types.ts`'s doc comment for why: this package's
 * entire job is dependency-free data validation, and a public package
 * should not force every consumer onto one schema library's major version
 * for the sake of shape-checking a handful of nested objects.
 */

import { checkPatternSafety } from "./internal/pattern-safety.js";
import { FORMALITY_LEVELS, GLOSSARY_STATUSES, VOICE_SEVERITIES } from "./types.js";
import type {
  Claim,
  FormalityLevel,
  GlossaryEntry,
  GlossaryStatus,
  PatternRule,
  PersonRule,
  TenseRule,
  VoiceChannel,
  VoiceFinding,
  VoicePattern,
  VoiceRecord,
  VoiceRules,
  VoiceSeverity,
} from "./types.js";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOneOf<T extends string>(value: unknown, list: readonly T[]): value is T {
  return typeof value === "string" && (list as readonly string[]).includes(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * Shape-only validation for an optional `VoiceChannel` field, shared by
 * `validateGlossaryEntryShape` and `validatePatternRuleShape` — see
 * `types.ts`'s `VoiceChannel` doc comment for why this package validates
 * SHAPE only (a non-empty, non-whitespace-only string) and never a closed
 * enum of "valid" channels, exactly mirroring how `registry-locale-shape`
 * (the sibling `../schema.ts`, i.e. this package's root `CopyLocale`
 * validation) treats `locale`.
 */
function validateChannelShape(value: unknown, rule: string, path: string): VoiceFinding[] {
  if (value === undefined) return [];
  if (typeof value !== "string" || value.trim().length === 0) {
    return [
      {
        rule,
        severity: "error",
        message: `${path} must be a non-empty string when present, got ${JSON.stringify(value)}.`,
        path,
      },
    ];
  }
  return [];
}

/**
 * Validates a field that is a list of words/phrases — `forbiddenPronouns`,
 * `forbiddenMarkers`, `tone`, `matchPhrases`: every "plain string list"
 * field in this schema shares this exact shape and this exact validation.
 * `undefined` is valid here (a default of `[]` applies later, in
 * `buildVoiceRecord`) — only a present-but-wrong-shaped value is a finding.
 */
function validateStringListShape(value: unknown, rule: string, path: string): VoiceFinding[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    return [
      {
        rule,
        severity: "error",
        message: `${path} must be an array of non-empty strings when present, got ${JSON.stringify(value)}.`,
        path,
      },
    ];
  }
  const findings: VoiceFinding[] = [];
  value.forEach((item, i) => {
    if (!isNonEmptyString(item)) {
      findings.push({
        rule,
        severity: "error",
        message: `${path}.${i} must be a non-empty string, got ${JSON.stringify(item)}.`,
        path: `${path}.${i}`,
      });
    }
  });
  return findings;
}

// Rules: person-present, person-description-shape, person-forbidden-pronouns-shape
function validatePersonRuleShape(value: unknown, path: string): VoiceFinding[] {
  if (!isPlainObject(value)) {
    return [{ rule: "person-present", severity: "error", message: `${path} must be an object.`, path }];
  }
  // Snapshot every field this function reads, exactly once, before any
  // check runs — see validateVoiceRecordShape's own doc comment for why.
  const description = value.description;
  const forbiddenPronouns = value.forbiddenPronouns;

  const findings: VoiceFinding[] = [];
  if (!isNonEmptyString(description)) {
    findings.push({
      rule: "person-description-shape",
      severity: "error",
      message: `${path}.description must be a non-empty string, got ${JSON.stringify(description)}.`,
      path: `${path}.description`,
    });
  }
  findings.push(
    ...validateStringListShape(forbiddenPronouns, "person-forbidden-pronouns-shape", `${path}.forbiddenPronouns`),
  );
  return findings;
}

// Rules: tense-present, tense-description-shape, tense-forbidden-markers-shape
function validateTenseRuleShape(value: unknown, path: string): VoiceFinding[] {
  if (!isPlainObject(value)) {
    return [{ rule: "tense-present", severity: "error", message: `${path} must be an object.`, path }];
  }
  const description = value.description;
  const forbiddenMarkers = value.forbiddenMarkers;

  const findings: VoiceFinding[] = [];
  if (!isNonEmptyString(description)) {
    findings.push({
      rule: "tense-description-shape",
      severity: "error",
      message: `${path}.description must be a non-empty string, got ${JSON.stringify(description)}.`,
      path: `${path}.description`,
    });
  }
  findings.push(
    ...validateStringListShape(forbiddenMarkers, "tense-forbidden-markers-shape", `${path}.forbiddenMarkers`),
  );
  return findings;
}

// Rules: rules-present, formality-shape, tone-shape (+ person-*, tense-* above)
function validateVoiceRulesShape(value: unknown, path: string): VoiceFinding[] {
  if (!isPlainObject(value)) {
    return [{ rule: "rules-present", severity: "error", message: `${path} must be an object.`, path }];
  }
  const person = value.person;
  const tense = value.tense;
  const formality = value.formality;
  const tone = value.tone;

  const findings: VoiceFinding[] = [];
  findings.push(...validatePersonRuleShape(person, `${path}.person`));
  findings.push(...validateTenseRuleShape(tense, `${path}.tense`));
  if (!isOneOf(formality, FORMALITY_LEVELS)) {
    findings.push({
      rule: "formality-shape",
      severity: "error",
      message: `${path}.formality must be one of ${FORMALITY_LEVELS.join(", ")}, got ${JSON.stringify(formality)}.`,
      path: `${path}.formality`,
    });
  }
  findings.push(...validateStringListShape(tone, "tone-shape", `${path}.tone`));
  return findings;
}

// Rules: glossary-entry-shape, glossary-term-shape, glossary-status-shape,
// glossary-reason-shape, glossary-alternative-shape, glossary-case-sensitive-shape,
// glossary-channel-shape
function validateGlossaryEntryShape(value: unknown, path: string): VoiceFinding[] {
  if (!isPlainObject(value)) {
    return [{ rule: "glossary-entry-shape", severity: "error", message: `${path} must be an object.`, path }];
  }
  const term = value.term;
  const status = value.status;
  const reason = value.reason;
  const alternative = value.alternative;
  const caseSensitive = value.caseSensitive;
  const channel = value.channel;

  const findings: VoiceFinding[] = [];
  if (!isNonEmptyString(term)) {
    findings.push({
      rule: "glossary-term-shape",
      severity: "error",
      message: `${path}.term must be a non-empty string, got ${JSON.stringify(term)}.`,
      path: `${path}.term`,
    });
  }
  if (!isOneOf(status, GLOSSARY_STATUSES)) {
    findings.push({
      rule: "glossary-status-shape",
      severity: "error",
      message: `${path}.status must be one of ${GLOSSARY_STATUSES.join(", ")}, got ${JSON.stringify(status)}.`,
      path: `${path}.status`,
    });
  }
  if (!isNonEmptyString(reason)) {
    findings.push({
      rule: "glossary-reason-shape",
      severity: "error",
      message: `${path}.reason must be a non-empty string, got ${JSON.stringify(reason)}.`,
      path: `${path}.reason`,
    });
  }
  if (alternative !== undefined && !isNonEmptyString(alternative)) {
    findings.push({
      rule: "glossary-alternative-shape",
      severity: "error",
      message: `${path}.alternative must be a non-empty string when present, got ${JSON.stringify(alternative)}.`,
      path: `${path}.alternative`,
    });
  }
  if (caseSensitive !== undefined && typeof caseSensitive !== "boolean") {
    findings.push({
      rule: "glossary-case-sensitive-shape",
      severity: "error",
      message: `${path}.caseSensitive must be a boolean when present, got ${JSON.stringify(caseSensitive)}.`,
      path: `${path}.caseSensitive`,
    });
  }
  findings.push(...validateChannelShape(channel, "glossary-channel-shape", `${path}.channel`));
  return findings;
}

// Rules: pattern-rule-shape, pattern-id-shape, pattern-description-shape,
// pattern-shape (pattern.source/pattern.flags, via checkPatternSafety —
// see internal/pattern-safety.ts), pattern-severity-shape,
// pattern-reason-shape, pattern-alternative-shape, pattern-channel-shape
function validatePatternRuleShape(value: unknown, path: string): VoiceFinding[] {
  if (!isPlainObject(value)) {
    return [{ rule: "pattern-rule-shape", severity: "error", message: `${path} must be an object.`, path }];
  }
  const id = value.id;
  const description = value.description;
  const pattern = value.pattern;
  const severity = value.severity;
  const reason = value.reason;
  const alternative = value.alternative;
  const channel = value.channel;

  const findings: VoiceFinding[] = [];

  if (!isNonEmptyString(id)) {
    findings.push({
      rule: "pattern-id-shape",
      severity: "error",
      message: `${path}.id must be a non-empty string, got ${JSON.stringify(id)}.`,
      path: `${path}.id`,
    });
  }
  if (!isNonEmptyString(description)) {
    findings.push({
      rule: "pattern-description-shape",
      severity: "error",
      message: `${path}.description must be a non-empty string, got ${JSON.stringify(description)}.`,
      path: `${path}.description`,
    });
  }

  // The real safety gate — see internal/pattern-safety.ts's top doc comment
  // for exactly what this rejects and why. A pattern that fails here is a
  // real, unmissable finding: this is this file's mechanical enforcement of
  // the core rule stated in types.ts's own header comment — a check that
  // cannot run must fail, not pass, never a silently dropped rule.
  if (!isPlainObject(pattern)) {
    findings.push({
      rule: "pattern-shape",
      severity: "error",
      message: `${path}.pattern must be an object with a "source" string (and optional "flags"), got ${JSON.stringify(pattern)}.`,
      path: `${path}.pattern`,
    });
  } else {
    const safety = checkPatternSafety(pattern as { source?: unknown; flags?: unknown });
    if (!safety.ok) {
      findings.push({
        rule: `pattern-shape:${safety.issue}`,
        severity: "error",
        message: `${path}.pattern is invalid or unsafe (${safety.issue}): ${safety.detail}`,
        path: `${path}.pattern`,
      });
    }
  }

  if (!isOneOf(severity, VOICE_SEVERITIES)) {
    findings.push({
      rule: "pattern-severity-shape",
      severity: "error",
      message: `${path}.severity must be one of ${VOICE_SEVERITIES.join(", ")}, got ${JSON.stringify(severity)}.`,
      path: `${path}.severity`,
    });
  }
  if (!isNonEmptyString(reason)) {
    findings.push({
      rule: "pattern-reason-shape",
      severity: "error",
      message: `${path}.reason must be a non-empty string, got ${JSON.stringify(reason)}.`,
      path: `${path}.reason`,
    });
  }
  if (alternative !== undefined && !isNonEmptyString(alternative)) {
    findings.push({
      rule: "pattern-alternative-shape",
      severity: "error",
      message: `${path}.alternative must be a non-empty string when present, got ${JSON.stringify(alternative)}.`,
      path: `${path}.alternative`,
    });
  }
  findings.push(...validateChannelShape(channel, "pattern-channel-shape", `${path}.channel`));

  return findings;
}

// Rules: claim-entry-shape, claim-id-shape, claim-text-shape,
// claim-match-phrases-shape, claim-fact-ref-shape, claim-requires-support-shape
function validateClaimShape(value: unknown, path: string): VoiceFinding[] {
  if (!isPlainObject(value)) {
    return [{ rule: "claim-entry-shape", severity: "error", message: `${path} must be an object.`, path }];
  }
  const id = value.id;
  const text = value.text;
  const matchPhrases = value.matchPhrases;
  const factRef = value.factRef;
  const requiresSupport = value.requiresSupport;

  const findings: VoiceFinding[] = [];
  if (!isNonEmptyString(id)) {
    findings.push({
      rule: "claim-id-shape",
      severity: "error",
      message: `${path}.id must be a non-empty string, got ${JSON.stringify(id)}.`,
      path: `${path}.id`,
    });
  }
  if (!isNonEmptyString(text)) {
    findings.push({
      rule: "claim-text-shape",
      severity: "error",
      message: `${path}.text must be a non-empty string, got ${JSON.stringify(text)}.`,
      path: `${path}.text`,
    });
  }
  findings.push(...validateStringListShape(matchPhrases, "claim-match-phrases-shape", `${path}.matchPhrases`));
  if (factRef !== undefined && !isNonEmptyString(factRef)) {
    findings.push({
      rule: "claim-fact-ref-shape",
      severity: "error",
      message: `${path}.factRef must be a non-empty string when present, got ${JSON.stringify(factRef)}.`,
      path: `${path}.factRef`,
    });
  }
  if (requiresSupport !== undefined && typeof requiresSupport !== "boolean") {
    findings.push({
      rule: "claim-requires-support-shape",
      severity: "error",
      message: `${path}.requiresSupport must be a boolean when present, got ${JSON.stringify(requiresSupport)}.`,
      path: `${path}.requiresSupport`,
    });
  }
  return findings;
}

/**
 * Validates that `value` conforms to the `VoiceRecord` shape. Returns a
 * `VoiceFinding[]`; empty means `value` is a well-formed `VoiceRecord`
 * (once defaults are applied — see `parseVoiceRecord`). Never throws — any
 * input, including `null`, a string, or a wildly malformed object,
 * produces findings rather than an exception, the same discipline
 * `@vespeneventures/policy`'s `validateBindingShape` holds to.
 *
 * `glossary`, `claims`, and `patterns` (top level) and `forbiddenPronouns`/
 * `forbiddenMarkers`/`tone`/`matchPhrases` (nested) may all be omitted —
 * a default of `[]` applies to each in `parseVoiceRecord`. Omitting one is
 * therefore not itself a finding; providing one of the wrong shape is.
 *
 * Every object this function (and its helpers) inspects has its fields
 * read exactly once into local variables before any check runs, and only
 * those locals are used from then on — mirroring
 * `@vespeneventures/policy`'s own `validateBindingShape`. Without this, a
 * hostile `value` (a field implemented as a getter, or a Proxy) could
 * return a different result on each property read, passing a check on one
 * read and disagreeing with itself on the next.
 */
export function validateVoiceRecordShape(value: unknown): VoiceFinding[] {
  if (!isPlainObject(value)) {
    return [{ rule: "record-present", severity: "error", message: "A voice record must be an object.", path: "$" }];
  }

  const id = value.id;
  const rules = value.rules;
  const glossary = value.glossary;
  const claims = value.claims;
  const patterns = value.patterns;

  const findings: VoiceFinding[] = [];

  if (!isNonEmptyString(id)) {
    findings.push({
      rule: "id-shape",
      severity: "error",
      message: `id must be a non-empty string, got ${JSON.stringify(id)}.`,
      path: "id",
    });
  }

  findings.push(...validateVoiceRulesShape(rules, "rules"));

  if (glossary !== undefined) {
    if (!Array.isArray(glossary)) {
      findings.push({
        rule: "glossary-shape",
        severity: "error",
        message: `glossary must be an array when present, got ${JSON.stringify(glossary)}.`,
        path: "glossary",
      });
    } else {
      glossary.forEach((entry, i) => findings.push(...validateGlossaryEntryShape(entry, `glossary.${i}`)));
    }
  }

  if (claims !== undefined) {
    if (!Array.isArray(claims)) {
      findings.push({
        rule: "claims-shape",
        severity: "error",
        message: `claims must be an array when present, got ${JSON.stringify(claims)}.`,
        path: "claims",
      });
    } else {
      claims.forEach((entry, i) => findings.push(...validateClaimShape(entry, `claims.${i}`)));
    }
  }

  if (patterns !== undefined) {
    if (!Array.isArray(patterns)) {
      findings.push({
        rule: "patterns-shape",
        severity: "error",
        message: `patterns must be an array when present, got ${JSON.stringify(patterns)}.`,
        path: "patterns",
      });
    } else {
      patterns.forEach((entry, i) => findings.push(...validatePatternRuleShape(entry, `patterns.${i}`)));
    }
  }

  return findings;
}

/**
 * Builds a fully-defaulted `VoiceRecord` from `value`, which the caller
 * must already know passed `validateVoiceRecordShape` with zero findings —
 * this function does no validation of its own and will throw or produce
 * garbage on unvalidated input. Only called internally, from
 * `parseVoiceRecord`, immediately after that check.
 */
function buildVoiceRecord(value: Record<string, unknown>): VoiceRecord {
  const rules = value.rules as Record<string, unknown>;
  const person = rules.person as Record<string, unknown>;
  const tense = rules.tense as Record<string, unknown>;
  const glossaryRaw = (value.glossary as unknown[] | undefined) ?? [];
  const claimsRaw = (value.claims as unknown[] | undefined) ?? [];
  // Deliberately NOT `?? []` like glossary/claims above — see this file's
  // `buildVoiceRecord` return statement and `types.ts`'s `VoiceRecord` doc
  // comment for why `patterns` preserves the distinction between "never
  // declared" (stays `undefined`, all the way through) and "declared,
  // currently empty" (`[]`), a distinction glossary/claims do not need
  // because they are required fields with no "never declared" state to
  // preserve.
  const patternsDeclared = value.patterns !== undefined;
  const patternsRaw = (value.patterns as unknown[] | undefined) ?? [];

  const builtRules: VoiceRules = {
    person: {
      description: person.description as string,
      forbiddenPronouns: [...((person.forbiddenPronouns as string[] | undefined) ?? [])],
    } satisfies PersonRule,
    tense: {
      description: tense.description as string,
      forbiddenMarkers: [...((tense.forbiddenMarkers as string[] | undefined) ?? [])],
    } satisfies TenseRule,
    formality: rules.formality as FormalityLevel,
    tone: [...((rules.tone as string[] | undefined) ?? [])],
  };

  const builtGlossary: GlossaryEntry[] = glossaryRaw.map((raw) => {
    const entry = raw as Record<string, unknown>;
    return {
      term: entry.term as string,
      status: entry.status as GlossaryStatus,
      reason: entry.reason as string,
      alternative: entry.alternative as string | undefined,
      caseSensitive: (entry.caseSensitive as boolean | undefined) ?? false,
      channel: entry.channel as VoiceChannel | undefined,
    };
  });

  const builtClaims: Claim[] = claimsRaw.map((raw) => {
    const entry = raw as Record<string, unknown>;
    return {
      id: entry.id as string,
      text: entry.text as string,
      matchPhrases: [...((entry.matchPhrases as string[] | undefined) ?? [])],
      factRef: entry.factRef as string | undefined,
      requiresSupport: (entry.requiresSupport as boolean | undefined) ?? true,
    };
  });

  const builtPatterns: PatternRule[] = patternsRaw.map((raw) => {
    const entry = raw as Record<string, unknown>;
    const pattern = entry.pattern as Record<string, unknown>;
    return {
      id: entry.id as string,
      description: entry.description as string,
      pattern: {
        source: pattern.source as string,
        flags: pattern.flags as string | undefined,
      } satisfies VoicePattern,
      severity: entry.severity as VoiceSeverity,
      reason: entry.reason as string,
      alternative: entry.alternative as string | undefined,
      channel: entry.channel as VoiceChannel | undefined,
    };
  });

  return {
    id: value.id as string,
    rules: builtRules,
    glossary: builtGlossary,
    claims: builtClaims,
    // Present (as `builtPatterns`, possibly `[]`) only when the input
    // actually declared `patterns` — omitted entirely otherwise, so
    // `record.patterns` stays `undefined` for a `VoiceRecord` built from
    // input that never touched this feature, exactly matching a
    // hand-written literal that omits the field. See the comment on
    // `patternsDeclared` above.
    ...(patternsDeclared ? { patterns: builtPatterns } : {}),
  };
}

/**
 * Parses `value` as a `VoiceRecord`, throwing a plain `Error` (never a
 * `VoiceFinding[]`) if it does not conform. For a caller that wants
 * fail-fast construction — a config-loading step, say — rather than
 * `validateVoiceRecordShape`'s "collect every problem and keep going"
 * shape. The thrown message includes every issue `validateVoiceRecordShape`
 * would have reported, joined, so nothing is lost by throwing instead of
 * returning.
 *
 * Calls `validateVoiceRecordShape(value)` and, only if it reports zero
 * findings, makes one further pass over `value` (`buildVoiceRecord`) to
 * apply this schema's defaults (`glossary: []`, `claims: []`, `tone: []`,
 * `forbiddenPronouns: []`, `forbiddenMarkers: []`, `matchPhrases: []`,
 * `caseSensitive: false`, `requiresSupport: true` — and, ONLY if `value`
 * declared a `patterns` array at all, `patterns` is carried through
 * as-given; if `value` never declared `patterns`, the built record omits
 * the field entirely rather than defaulting it to `[]`, so a caller reading
 * `record.patterns === undefined` can still tell "never touched this
 * feature" apart from "declared it, empty" — see `buildVoiceRecord`) and
 * produce a fully
 * populated `VoiceRecord`. This is a deliberate two-pass design, not an
 * oversight: `@vespeneventures/policy`'s own TOCTOU-safety comments (see
 * `verifyBinding`) explain why reading the same object's fields twice can
 * matter for a hostile `value` (a getter returning a different result on
 * each read). That package's shape is flat enough to snapshot once and
 * reuse for both validation and use; this package's is nested arrays of
 * objects deep enough that a full single-pass snapshot-then-build would
 * add real complexity for a caller-input-shape concern this package's
 * actual threat model (a consumer's own in-memory config object, not a
 * value crossing a real trust boundary) does not call for. Documented here
 * rather than silently accepted.
 */
export function parseVoiceRecord(value: unknown): VoiceRecord {
  const findings = validateVoiceRecordShape(value);
  if (findings.length > 0) {
    const detail = findings.map((f) => `  - ${f.path ?? "(root)"}: ${f.message}`).join("\n");
    throw new Error(`parseVoiceRecord: value is not a valid VoiceRecord:\n${detail}`);
  }
  // Safe: validateVoiceRecordShape returning no findings means every field
  // buildVoiceRecord reads below is present and correctly typed.
  return buildVoiceRecord(value as Record<string, unknown>);
}
