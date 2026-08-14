/**
 * Structural validation for a candidate `CopyRecord`, hand-rolled in the
 * same plain-type-guard, accumulate-and-keep-going style as
 * `@vespeneventures/strategy`'s `validation.ts` and
 * `@vespeneventures/copy/voice`'s `schema.ts` — no schema library, for the
 * same reason both of those files give: this package's entire job is
 * dependency-free data validation, and a public package should not force
 * every consumer onto one schema library's major version for the sake of
 * shape-checking a handful of nested objects.
 *
 * Every check here is a REAL check, not decoration — this package's own
 * design brief was explicit that a validator whose findings are all
 * mechanically re-derivable from data already present elsewhere is dead
 * weight (this repository has already deleted one whole package,
 * `contract`, for exactly that failure: it validated fields that were all
 * mechanically re-derivable from data already present in the same
 * `package.json`, so its own checks could never produce a real finding).
 * The placeholder check in particular
 * (`validateCopyEntryShape`'s handling of `placeholders`) is the one most
 * likely to be mistaken for decoration and is not: a name declared in
 * `placeholders` but missing from `text` is a real authoring bug — copy
 * was edited and an interpolation was dropped, or the placeholder list
 * drifted from the sentence — and this is the only place in this package
 * that catches it.
 */

import type {
  CopyEntry,
  CopyEntryId,
  CopyEntryStatus,
  CopyFinding,
  CopyRegistry,
  CopyRegistryEntry,
  CopyRecord,
  CopySource,
} from "./types.js";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isCopyEntryStatus(value: unknown): value is CopyEntryStatus {
  return value === "draft" || value === "approved" || value === "retired";
}

/**
 * `CopyEntryId` shape: dot-separated, lowercase, kebab-case within each
 * segment, at least one dot (i.e. at least two segments) — e.g.
 * `"pagination.no-results"`, `"onboarding.step-2.title"`. See
 * `types.ts`'s doc comment on `CopyEntryId` for why a bare, unnamespaced
 * id is rejected rather than merely discouraged.
 */
const COPY_ENTRY_ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+(-[a-z0-9]+)*)+$/;

/**
 * The literal placeholder syntax this package checks `text` against for
 * each declared name in `placeholders`: `{name}`, brace-delimited — the
 * same convention ICU MessageFormat and most i18n libraries already use.
 * A plain substring check, not a regex scan of `text` for placeholder-
 * *shaped* tokens: this function only ever needs to ask "does `{name}`
 * appear in this text for this specific declared name", never "what
 * placeholders does this text contain" — the latter would be scope creep
 * into a job (extracting/parsing interpolation syntax) this package does
 * not need in order to do the one check it actually promises.
 */
function textContainsPlaceholder(text: string, name: string): boolean {
  return text.includes(`{${name}}`);
}

/**
 * Validates a field that is a list of strings — `entries` (elsewhere) and
 * `placeholders` here share this exact shape and this exact validation.
 * `undefined` is valid for `placeholders` (a default of `[]` applies
 * later, in `buildCopyRecord`) — only a present-but-wrong-shaped value is
 * a finding.
 */
function validatePlaceholdersShape(value: unknown, path: string): CopyFinding[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    return [
      {
        rule: "placeholders-shape",
        severity: "error",
        message: `${path} must be an array of non-empty strings when present, got ${JSON.stringify(value)}.`,
        path,
      },
    ];
  }
  const findings: CopyFinding[] = [];
  value.forEach((item, i) => {
    if (!isNonEmptyString(item)) {
      findings.push({
        rule: "placeholders-shape",
        severity: "error",
        message: `${path}.${i} must be a non-empty string, got ${JSON.stringify(item)}.`,
        path: `${path}.${i}`,
      });
    }
  });
  return findings;
}

// Rules: entry-shape, id-shape, id-well-formed, text-shape, context-shape,
// placeholders-shape, placeholder-missing-from-text, fact-ref-shape
function validateCopyEntryShape(value: unknown, path: string): CopyFinding[] {
  if (!isPlainObject(value)) {
    return [{ rule: "entry-shape", severity: "error", message: `${path} must be an object.`, path }];
  }
  // Snapshot every field this function reads, exactly once, before any
  // check runs — mirroring `@vespeneventures/copy/voice`'s `schema.ts` and
  // `@vespeneventures/policy`'s `validateBindingShape`, both of which
  // document why: a hostile or merely-badly-behaved `value` (a field
  // implemented as a getter, or a Proxy) could otherwise return a
  // different result on each property read.
  const id = value.id;
  const text = value.text;
  const context = value.context;
  const placeholders = value.placeholders;
  const factRef = value.factRef;

  const findings: CopyFinding[] = [];

  if (!isNonEmptyString(id)) {
    findings.push({
      rule: "id-shape",
      severity: "error",
      message: `${path}.id must be a non-empty string, got ${JSON.stringify(id)}.`,
      path: `${path}.id`,
    });
  } else if (!COPY_ENTRY_ID_RE.test(id)) {
    findings.push({
      rule: "id-well-formed",
      severity: "error",
      message: `${path}.id "${id}" must be dot-separated and lowercase, with at least one dot (e.g. "pagination.no-results"), got ${JSON.stringify(id)}.`,
      path: `${path}.id`,
    });
  }

  if (!isNonEmptyString(text)) {
    findings.push({
      rule: "text-shape",
      severity: "error",
      message: `${path}.text must be a non-empty string, got ${JSON.stringify(text)}.`,
      path: `${path}.text`,
    });
  }

  if (!isNonEmptyString(context)) {
    findings.push({
      rule: "context-shape",
      severity: "error",
      message: `${path}.context must be a non-empty string, got ${JSON.stringify(context)}. An entry with no stated location cannot be reviewed.`,
      path: `${path}.context`,
    });
  }

  findings.push(...validatePlaceholdersShape(placeholders, `${path}.placeholders`));

  // The real check: a declared placeholder that never actually appears in
  // `text`. Only checkable once both `text` and `placeholders` are
  // individually well-formed — there is no meaningful "is {name} in the
  // text" question to ask against a `text` that failed `text-shape` or a
  // `placeholders` entry that failed `placeholders-shape`, and reporting
  // this rule on top of an already-broken shape would only add noise
  // pointing at the same underlying problem.
  if (isNonEmptyString(text) && Array.isArray(placeholders)) {
    placeholders.forEach((name, i) => {
      if (typeof name === "string" && name.length > 0 && !textContainsPlaceholder(text, name)) {
        findings.push({
          rule: "placeholder-missing-from-text",
          severity: "error",
          message: `${path}.placeholders.${i} declares "${name}" but "{${name}}" does not appear in ${path}.text.`,
          path: `${path}.placeholders.${i}`,
        });
      }
    });
  }

  if (factRef !== undefined && !isNonEmptyString(factRef)) {
    findings.push({
      rule: "fact-ref-shape",
      severity: "error",
      message: `${path}.factRef must be a non-empty string when present, got ${JSON.stringify(factRef)}.`,
      path: `${path}.factRef`,
    });
  }

  return findings;
}

/**
 * Validates that `value` conforms to the `CopyRecord` shape. Returns a
 * `CopyFinding[]`; empty means `value` is a well-formed `CopyRecord`
 * (once defaults are applied — see `parseCopyRecord`). Never throws — any
 * input, including `null`, a string, or a wildly malformed object,
 * produces findings rather than an exception, the same discipline
 * `@vespeneventures/copy/voice`'s `validateVoiceRecordShape` and
 * `@vespeneventures/policy`'s `validateBindingShape` both hold to.
 *
 * Checks, in full: `id` present and non-empty; `entries` present and an
 * array; every entry's own shape (`id` non-empty and well-formed per
 * `COPY_ENTRY_ID_RE`, `text` non-empty, `context` non-empty,
 * `placeholders` — if present — an array of non-empty strings each
 * actually found in `text`, `factRef` — if present — a non-empty
 * string); and, at the record level, that every entry's `id` is unique
 * within the record. `entries` being present but empty (`[]`) is a
 * well-formed, zero-finding `CopyRecord` as far as THIS function is
 * concerned — whether zero entries is itself a problem is a judgment call
 * for a caller with more context than a shape validator has, and is
 * exactly the call `checker.ts`'s `checkCopyRecord` makes (see that
 * file's doc comment): it fails closed on a record with no entries to
 * check, rather than silently reporting a "clean" run that checked
 * nothing.
 */
export function validateCopyRecordShape(value: unknown): CopyFinding[] {
  if (!isPlainObject(value)) {
    return [{ rule: "record-present", severity: "error", message: "A copy record must be an object.", path: "$" }];
  }

  const id = value.id;
  const entries = value.entries;

  const findings: CopyFinding[] = [];

  if (!isNonEmptyString(id)) {
    findings.push({
      rule: "id-shape",
      severity: "error",
      message: `id must be a non-empty string, got ${JSON.stringify(id)}.`,
      path: "id",
    });
  }

  if (!Array.isArray(entries)) {
    findings.push({
      rule: "entries-shape",
      severity: "error",
      message: `entries must be an array, got ${JSON.stringify(entries)}.`,
      path: "entries",
    });
  } else {
    entries.forEach((entry, i) => findings.push(...validateCopyEntryShape(entry, `entries.${i}`)));

    // Uniqueness is a whole-record property, not a per-entry one, so it is
    // checked here rather than inside validateCopyEntryShape. Only entries
    // that already passed their own id-shape check contribute a value to
    // compare — an entry with a missing/malformed id is already reported
    // above by id-shape/id-well-formed, and folding an undefined or
    // non-string id into a "duplicate" comparison would produce a second,
    // misleading finding about the same underlying problem.
    const seen = new Map<CopyEntryId, number>(); // id -> first index seen at
    entries.forEach((entry, i) => {
      if (!isPlainObject(entry)) return;
      const entryId = entry.id;
      if (typeof entryId !== "string" || entryId.length === 0) return;
      const firstIndex = seen.get(entryId);
      if (firstIndex === undefined) {
        seen.set(entryId, i);
      } else {
        findings.push({
          rule: "id-unique",
          severity: "error",
          message: `entries.${i}.id "${entryId}" duplicates entries.${firstIndex}.id — every entry's id must be unique within a CopyRecord.`,
          path: `entries.${i}.id`,
        });
      }
    });
  }

  return findings;
}

/**
 * Validates a `CopyRegistryEntry.translation` field, when present.
 * `undefined` is always valid — see `types.ts`'s doc comment on
 * `CopyTranslationProvenance` for why an entry with no `translation` must
 * remain a fully valid `CopyRegistryEntry` rather than becoming invalid the
 * moment this field was introduced. Only a present-but-malformed value is a
 * finding.
 */
function validateTranslationShape(value: unknown, path: string): CopyFinding[] {
  if (value === undefined) return [];
  if (!isPlainObject(value)) {
    return [
      {
        rule: "translation-shape",
        severity: "error",
        message: `${path} must be an object when present, got ${JSON.stringify(value)}.`,
        path,
      },
    ];
  }

  const sourceFingerprint = value.sourceFingerprint;
  const fingerprintAlgorithm = value.fingerprintAlgorithm;
  const translatedAt = value.translatedAt;
  const translatedBy = value.translatedBy;
  const reviewedAt = value.reviewedAt;
  const reviewedBy = value.reviewedBy;

  const findings: CopyFinding[] = [];

  if (!isNonEmptyString(sourceFingerprint)) {
    findings.push({
      rule: "translation-source-fingerprint-shape",
      severity: "error",
      message: `${path}.sourceFingerprint must be a non-empty string, got ${JSON.stringify(sourceFingerprint)}.`,
      path: `${path}.sourceFingerprint`,
    });
  }

  if (!isNonEmptyString(fingerprintAlgorithm)) {
    findings.push({
      rule: "translation-fingerprint-algorithm-shape",
      severity: "error",
      message: `${path}.fingerprintAlgorithm must be a non-empty string, got ${JSON.stringify(fingerprintAlgorithm)}.`,
      path: `${path}.fingerprintAlgorithm`,
    });
  }

  if (!isNonEmptyString(translatedAt)) {
    findings.push({
      rule: "translation-translated-at-shape",
      severity: "error",
      message: `${path}.translatedAt must be a non-empty ISO-8601 timestamp string, got ${JSON.stringify(translatedAt)}.`,
      path: `${path}.translatedAt`,
    });
  }

  if (translatedBy !== undefined && !isNonEmptyString(translatedBy)) {
    findings.push({
      rule: "translation-translated-by-shape",
      severity: "error",
      message: `${path}.translatedBy must be a non-empty string when present, got ${JSON.stringify(translatedBy)}.`,
      path: `${path}.translatedBy`,
    });
  }

  if (reviewedAt !== undefined && !isNonEmptyString(reviewedAt)) {
    findings.push({
      rule: "translation-reviewed-at-shape",
      severity: "error",
      message: `${path}.reviewedAt must be a non-empty ISO-8601 timestamp string when present, got ${JSON.stringify(reviewedAt)}.`,
      path: `${path}.reviewedAt`,
    });
  }

  if (reviewedBy !== undefined && !isNonEmptyString(reviewedBy)) {
    findings.push({
      rule: "translation-reviewed-by-shape",
      severity: "error",
      message: `${path}.reviewedBy must be a non-empty string when present, got ${JSON.stringify(reviewedBy)}.`,
      path: `${path}.reviewedBy`,
    });
  }

  return findings;
}

/**
 * Validates the stronger registry shape used to resolve `CopyRef`s. A plain
 * `CopyRecord` deliberately remains valid for source scanning and voice
 * checking; it cannot become rendered content until it carries locale,
 * revision, source provenance, and an explicit lifecycle state per entry.
 */
export function validateCopyRegistryShape(value: unknown): CopyFinding[] {
  const findings = validateCopyRecordShape(value);
  if (!isPlainObject(value)) return findings;

  const locale = value.locale;
  const revision = value.revision;
  const source = value.source;
  const entries = value.entries;

  if (!isNonEmptyString(locale)) {
    findings.push({
      rule: "registry-locale-shape",
      severity: "error",
      message: `locale must be a non-empty locale tag, got ${JSON.stringify(locale)}.`,
      path: "locale",
    });
  }

  if (!isNonEmptyString(revision)) {
    findings.push({
      rule: "registry-revision-shape",
      severity: "error",
      message: `revision must be a non-empty provenance revision, got ${JSON.stringify(revision)}.`,
      path: "revision",
    });
  }

  if (!isPlainObject(source)) {
    findings.push({
      rule: "registry-source-shape",
      severity: "error",
      message: `source must be an object with kind and reference, got ${JSON.stringify(source)}.`,
      path: "source",
    });
  } else {
    const kind = source.kind;
    const reference = source.reference;
    if (kind !== "consumer" && kind !== "generated" && kind !== "imported") {
      findings.push({
        rule: "registry-source-kind",
        severity: "error",
        message: `source.kind must be "consumer", "generated", or "imported", got ${JSON.stringify(kind)}.`,
        path: "source.kind",
      });
    }
    if (!isNonEmptyString(reference)) {
      findings.push({
        rule: "registry-source-reference-shape",
        severity: "error",
        message: `source.reference must be a non-empty opaque provenance reference, got ${JSON.stringify(reference)}.`,
        path: "source.reference",
      });
    }
  }

  if (Array.isArray(entries)) {
    entries.forEach((entry, i) => {
      if (!isPlainObject(entry)) return;
      if (!isCopyEntryStatus(entry.status)) {
        findings.push({
          rule: "entry-status-shape",
          severity: "error",
          message: `entries.${i}.status must be "draft", "approved", or "retired", got ${JSON.stringify(entry.status)}.`,
          path: `entries.${i}.status`,
        });
      }
      findings.push(...validateTranslationShape(entry.translation, `entries.${i}.translation`));
    });
  }

  return findings;
}

/**
 * Builds a fully-defaulted `CopyRecord` from `value`, which the caller
 * must already know passed `validateCopyRecordShape` with zero findings
 * — this function does no validation of its own and will throw or
 * produce garbage on unvalidated input. Only called internally, from
 * `parseCopyRecord`, immediately after that check — mirrors
 * `@vespeneventures/copy/voice`'s `buildVoiceRecord` exactly, including that
 * split's reasoning: see this file's `parseCopyRecord` doc comment for
 * why this is a deliberate two-pass design.
 */
function buildCopyRecord(value: Record<string, unknown>): CopyRecord {
  const entriesRaw = value.entries as unknown[];

  const builtEntries: CopyEntry[] = entriesRaw.map((raw) => {
    const entry = raw as Record<string, unknown>;
    return {
      id: entry.id as string,
      text: entry.text as string,
      context: entry.context as string,
      placeholders: [...((entry.placeholders as string[] | undefined) ?? [])],
      factRef: entry.factRef as string | undefined,
    };
  });

  return {
    id: value.id as string,
    entries: builtEntries,
  };
}

function buildCopyRegistry(value: Record<string, unknown>): CopyRegistry {
  const record = buildCopyRecord(value);
  const entries = (value.entries as Array<Record<string, unknown>>).map((entry) => ({
    ...record.entries.find((item) => item.id === entry.id)!,
    status: entry.status as CopyEntryStatus,
    translation: entry.translation as CopyRegistryEntry["translation"],
  })) as CopyRegistryEntry[];

  return {
    ...record,
    locale: value.locale as string,
    revision: value.revision as string,
    source: value.source as CopySource,
    entries,
  };
}

/**
 * Parses `value` as a `CopyRecord`, throwing a plain `Error` (never a
 * `CopyFinding[]`) if it does not conform. For a caller that wants
 * fail-fast construction — `registry.ts`'s `readCopyRecord`, in
 * particular — rather than `validateCopyRecordShape`'s "collect every
 * problem and keep going" shape. The thrown message includes every issue
 * `validateCopyRecordShape` would have reported, joined, so nothing is
 * lost by throwing instead of returning.
 *
 * Calls `validateCopyRecordShape(value)` and, only if it reports zero
 * findings, makes one further pass over `value` (`buildCopyRecord`) to
 * apply this schema's one default (`placeholders: []`) and produce a
 * fully populated `CopyRecord`. This two-pass shape mirrors
 * `@vespeneventures/copy/voice`'s `parseVoiceRecord` — see that function's own
 * doc comment for the fuller TOCTOU-safety argument for why reading twice
 * is a deliberate choice here, not an oversight, given this package's
 * actual threat model (a consumer's own in-memory config object, not a
 * value crossing a real trust boundary).
 */
export function parseCopyRecord(value: unknown): CopyRecord {
  const findings = validateCopyRecordShape(value);
  if (findings.length > 0) {
    const detail = findings.map((f) => `  - ${f.path ?? "(root)"}: ${f.message}`).join("\n");
    throw new Error(`parseCopyRecord: value is not a valid CopyRecord:\n${detail}`);
  }
  // Safe: validateCopyRecordShape returning no findings means every field
  // buildCopyRecord reads below is present and correctly typed.
  return buildCopyRecord(value as Record<string, unknown>);
}

/** Parses a versioned, locale-specific registry or throws every finding. */
export function parseCopyRegistry(value: unknown): CopyRegistry {
  const findings = validateCopyRegistryShape(value);
  if (findings.length > 0) {
    const detail = findings.map((f) => `  - ${f.path ?? "(root)"}: ${f.message}`).join("\n");
    throw new Error(`parseCopyRegistry: value is not a valid CopyRegistry:\n${detail}`);
  }
  return buildCopyRegistry(value as Record<string, unknown>);
}
