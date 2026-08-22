/**
 * The PASSAGE LAYER — issue #373. `@vespeneventures/copy` (now `writer`,
 * per issue #373's own retargeting comment) has terms (a glossary) and
 * entries (single addressable strings) and nothing between them.
 * `@vespeneventures/designer` has tokens, atoms, AND BLOCKS. This file is the
 * missing middle: a `Passage` composes `CopyEntry`/glossary-term
 * REFERENCES the way a block composes atoms — never a raw sentence of its
 * own. Terms ≈ tokens, entries ≈ atoms, passages ≈ blocks, documents (a
 * later, composition-layer concern, out of scope here — see the issue)
 * ≈ views.
 *
 * WHERE THE MIRROR STOPS. This file deliberately does NOT port
 * `@vespeneventures/designer/tokens`' `brandable` boolean onto a `Passage`
 * field. In tokens, `brandable` marks a subset WITHIN one namespace (154
 * ship, 42 are brandable). The voice record's own consumer/machinery
 * split runs between FILES instead (a consumer's own `VoiceRecord` vs.
 * this package's shipped machinery) — forcing a boolean into a field here
 * would be false symmetry with a split that does not exist at this
 * layer. This file mirrors the LADDER (structure: terms/entries/passages/
 * documents), not the binding mechanism.
 *
 * ============================================================================
 * WHAT A `Passage` IS
 * ============================================================================
 *
 * One reusable, addressable unit of composed language — an empty-state
 * (title + body + action), an FAQ item (question + answer), an error
 * (message + recovery) — never a single string, and never real prose of
 * its own. `fields` is a plain `Record<string, unknown>` AT THE TYPE
 * LEVEL, deliberately: a field's value is exactly what
 * `classifyPassageField`/`checkPassageComposition` below classify at
 * RUNTIME, not what a compile-time type could statically forbid a
 * malformed registry file (real JSON on disk, not TypeScript-checked
 * code) from containing. See "THE TERNARY" below for why a field holding
 * a raw literal string must reach the GATE as a real, reportable
 * violation rather than being rejected upstream as a schema error.
 *
 * This file ships no example content of anyone's real copy — the same
 * "vocabulary layer, never a source of real words" constraint `types.ts`
 * documents for `CopyEntry`/`CopyRecord`. Every fixture in this package's
 * own tests is structural placeholder text, never something a product
 * would actually show a user.
 *
 * ============================================================================
 * THE GATE, WITH THE TERNARY (issue #373)
 * ============================================================================
 *
 *   0 — SATISFIED: every passage references only entries and terms, and
 *       at least one passage was evaluated.
 *   1 — VIOLATED: a passage inlines a literal string instead of
 *       referencing an entry (the verbal equivalent of a hardcoded color
 *       instead of a token), OR a passage references another passage's
 *       OWN INTERNALS (`{ ref: "passage", id, field }`) rather than
 *       composing entries/terms the way a block composes atoms, never
 *       reaching directly into a sibling block's own implementation.
 *   2 — INDETERMINATE: the registry could not be read/parsed/validated,
 *       zero passages were evaluated (an empty `passages: []`), or a
 *       field's value could not be confidently classified as any of the
 *       above (not a string, not a recognized `{ ref: ... }` shape).
 *
 * PRECEDENCE — a real violation outranks an incomplete picture. This
 * package already settled this exact question for a different gate
 * (`addressability.ts`, issue #407/#433): letting "at least one
 * unclassifiable field" outrank a confirmed violation would make the
 * `"violated"` branch practically unreachable the moment a registry ever
 * mixes a genuinely new/unknown field shape in with a real inlined
 * literal — the identical collapse #407 fixed for addressability is fixed
 * here from the start, not discovered later. `checkPassageComposition`
 * applies the same "violated wins" ordering `checkAddressability` does.
 *
 * ============================================================================
 * THE ADVERSARIAL SEPARATION (the weaker tool this gate must beat)
 * ============================================================================
 *
 * A weaker tool that only checks "every referenced entry id exists"
 * passes a passage built ENTIRELY from inline literals, because such a
 * passage has ZERO references for that tool to check — nothing to
 * validate is indistinguishable, to that tool, from everything being
 * valid. The separating fixture: a passage with zero references and real
 * prose sitting directly in its fields. The reference-checker reports
 * clean (0 references, 0 problems). This gate must exit 1 — see
 * `passage.adversarial.test.ts`, which runs both tools against the
 * identical fixture in the same test, plus the sanity check that the weak
 * tool is not simply broken (it correctly reports 0 when references truly
 * do all exist).
 *
 * ============================================================================
 * WHAT THIS GATE DELIBERATELY DOES NOT DO
 * ============================================================================
 *
 *   - It does not verify a referenced entry id or term actually EXISTS in
 *     a real `CopyRecord`/glossary. That is a DIFFERENT, weaker question
 *     ("does this id resolve") than the one this gate answers ("is this
 *     field a reference at all, or a smuggled-in literal") — the same
 *     split `addressability.ts` draws from `copy-gate.ts`'s traceability
 *     check (see that file's own top doc comment: "this gate has no
 *     `CopyRecord` input at all"). A gate with visibility into both a
 *     `PassageRecord` and a real `CopyRecord`/glossary to check
 *     referential integrity is a different, later gate — precisely the
 *     "weaker tool" this file's own adversarial proof names and beats on
 *     the property that actually matters here: composition purity.
 *   - It does not resolve/render a passage into text. Rendering a
 *     `Passage` against a real `CopyRecord`/`VoiceRecord` glossary is a
 *     consumer-owned, later concern — this file only ever validates
 *     SHAPE and COMPOSITION PURITY.
 */

import { readFileSync } from "node:fs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A stable address for one `Passage`, unique within its `PassageRecord`.
 * Same shape as `CopyEntryId` (`types.ts`) — dot-separated, lowercase,
 * kebab-case within each segment, at least one dot — deliberately
 * duplicated as its own regex below rather than importing `CopyEntryId`'s
 * private pattern: `schema.ts` does not export `COPY_ENTRY_ID_RE`, and
 * this package's own precedent (`addressability.ts`'s locally redefined
 * `SKIP_FILE_RE`) is to redefine a small, unexported pattern locally
 * rather than reach across a file boundary for it.
 */
export type PassageId = string;

/**
 * A reference to a registered `CopyEntry`, by id. This — and
 * `PassageTermReference` below — are the ONLY two shapes a `Passage`
 * field may validly hold; see this file's top doc comment, "THE GATE".
 */
export interface PassageEntryReference {
  ref: "entry";
  id: string;
}

/** A reference to a glossary term (see `@vespeneventures/writer/voice`'s `GlossaryEntry.term`), by its term string. */
export interface PassageTermReference {
  ref: "term";
  term: string;
}

/** The two valid reference shapes a `Passage` field may hold. */
export type PassageReference = PassageEntryReference | PassageTermReference;

/**
 * One reusable, addressable unit of composed language. `fields` is
 * intentionally `Record<string, unknown>`, not `Record<string,
 * PassageReference>` — see this file's top doc comment for why a field's
 * actual value is a runtime classification question, not a compile-time
 * type guarantee, for data that arrives as real (possibly malformed) JSON
 * on disk.
 */
export interface Passage {
  /** Stable address. Unique within the `PassageRecord` it belongs to — see `PassageId`. */
  id: PassageId;
  /**
   * Where this passage appears — a screen name, a component, a flow.
   * Required, mirroring `CopyEntry.context`'s own "unlocatable copy is
   * not reviewable copy" rule, restated once more here because it is the
   * identical rule at one layer up: an unlocatable passage is not
   * reviewable either.
   */
  context: string;
  /**
   * Named slots this passage composes — e.g. `{ title: {...}, body:
   * {...}, action: {...} }` for an empty-state. Each value should be a
   * `PassageReference`; whether it actually is one is exactly what
   * `checkPassageComposition` (via `classifyPassageField`) determines.
   */
  fields: Record<string, unknown>;
}

/** One consumer's complete, registered set of passages. The "brand.css" of this file — foundry ships the schema this conforms to, never a real instance of it. */
export interface PassageRecord {
  id: string;
  passages: Passage[];
}

/**
 * One thing `validatePassageRecordShape` found wrong with a candidate
 * `PassageRecord`/`Passage`. Deliberately the same shape as `CopyFinding`
 * (`types.ts`) — `rule`/`severity`/`message`/optional `path` — so a
 * caller already handling one kind of finding in this package does not
 * need a second mental model for this one. Defined fresh here rather than
 * imported: this file does not import from `types.ts` at all (see this
 * file's top doc comment on why passages never reach for a `CopyRecord`).
 */
export interface PassageFinding {
  rule: string;
  severity: "error";
  message: string;
  path?: string;
}

// ---------------------------------------------------------------------------
// Shape validation
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Same shape `COPY_ENTRY_ID_RE` (`schema.ts`) checks a `CopyEntryId` against — see `PassageId`'s own doc comment for why this is redefined locally rather than imported. */
const PASSAGE_ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+(-[a-z0-9]+)*)+$/;

/**
 * Validates one `Passage`'s SHAPE only: `id` present/well-formed,
 * `context` present, `fields` a non-empty object. Deliberately does NOT
 * validate each field VALUE's shape — see this file's top doc comment,
 * "THE GATE": rejecting a field that holds a raw literal string here, as
 * a schema error, would turn every real violation `checkPassageComposition`
 * exists to catch into an "indeterminate" (invalid-schema) read instead
 * of a "violated" one, the exact collapse #407/#433 already fixed for a
 * different gate in this same package.
 */
function validatePassageShape(value: unknown, path: string): PassageFinding[] {
  if (!isPlainObject(value)) {
    return [{ rule: "passage-shape", severity: "error", message: `${path} must be an object.`, path }];
  }
  // Snapshot every field this function reads, exactly once, before any
  // check runs — the same defensive discipline `schema.ts`'s
  // `validateCopyEntryShape` documents (a hostile/badly-behaved `value`
  // could otherwise return a different result on each property read).
  const id = value.id;
  const context = value.context;
  const fields = value.fields;

  const findings: PassageFinding[] = [];

  if (!isNonEmptyString(id)) {
    findings.push({
      rule: "id-shape",
      severity: "error",
      message: `${path}.id must be a non-empty string, got ${JSON.stringify(id)}.`,
      path: `${path}.id`,
    });
  } else if (!PASSAGE_ID_RE.test(id)) {
    findings.push({
      rule: "id-well-formed",
      severity: "error",
      message: `${path}.id "${id}" must be dot-separated and lowercase, with at least one dot (e.g. "onboarding.empty-state"), got ${JSON.stringify(id)}.`,
      path: `${path}.id`,
    });
  }

  if (!isNonEmptyString(context)) {
    findings.push({
      rule: "context-shape",
      severity: "error",
      message: `${path}.context must be a non-empty string, got ${JSON.stringify(context)}. A passage with no stated location cannot be reviewed.`,
      path: `${path}.context`,
    });
  }

  if (!isPlainObject(fields)) {
    findings.push({
      rule: "fields-shape",
      severity: "error",
      message: `${path}.fields must be an object, got ${JSON.stringify(fields)}.`,
      path: `${path}.fields`,
    });
  } else if (Object.keys(fields).length === 0) {
    findings.push({
      rule: "fields-non-empty",
      severity: "error",
      message: `${path}.fields must have at least one field — a passage with zero fields composes nothing.`,
      path: `${path}.fields`,
    });
  }

  return findings;
}

/**
 * Validates that `value` conforms to the `PassageRecord` shape. Returns a
 * `PassageFinding[]`; empty means `value` is a well-formed `PassageRecord`.
 * Never throws — mirrors `schema.ts`'s `validateCopyRecordShape` exactly:
 * any input, including `null`/a string/a wildly malformed object,
 * produces findings rather than an exception.
 */
export function validatePassageRecordShape(value: unknown): PassageFinding[] {
  if (!isPlainObject(value)) {
    return [{ rule: "record-present", severity: "error", message: "A passage record must be an object.", path: "$" }];
  }

  const id = value.id;
  const passages = value.passages;

  const findings: PassageFinding[] = [];

  if (!isNonEmptyString(id)) {
    findings.push({
      rule: "id-shape",
      severity: "error",
      message: `id must be a non-empty string, got ${JSON.stringify(id)}.`,
      path: "id",
    });
  }

  if (!Array.isArray(passages)) {
    findings.push({
      rule: "passages-shape",
      severity: "error",
      message: `passages must be an array, got ${JSON.stringify(passages)}.`,
      path: "passages",
    });
  } else {
    passages.forEach((passage, i) => findings.push(...validatePassageShape(passage, `passages.${i}`)));

    // Uniqueness is a whole-record property, checked here rather than
    // inside validatePassageShape — mirrors validateCopyRecordShape's own
    // id-unique pass exactly, including only comparing passages whose own
    // id already passed shape validation.
    const seen = new Map<string, number>();
    passages.forEach((passage, i) => {
      if (!isPlainObject(passage)) return;
      const passageId = passage.id;
      if (typeof passageId !== "string" || passageId.length === 0) return;
      const firstIndex = seen.get(passageId);
      if (firstIndex === undefined) {
        seen.set(passageId, i);
      } else {
        findings.push({
          rule: "id-unique",
          severity: "error",
          message: `passages.${i}.id "${passageId}" duplicates passages.${firstIndex}.id — every passage's id must be unique within a PassageRecord.`,
          path: `passages.${i}.id`,
        });
      }
    });
  }

  return findings;
}

function buildPassageRecord(value: Record<string, unknown>): PassageRecord {
  const passagesRaw = value.passages as unknown[];
  const built: Passage[] = passagesRaw.map((raw) => {
    const passage = raw as Record<string, unknown>;
    return {
      id: passage.id as string,
      context: passage.context as string,
      fields: { ...(passage.fields as Record<string, unknown>) },
    };
  });

  return {
    id: value.id as string,
    passages: built,
  };
}

/**
 * Parses `value` as a `PassageRecord`, throwing a plain `Error` (never a
 * `PassageFinding[]`) if it does not conform — mirrors `schema.ts`'s
 * `parseCopyRecord` exactly, including the two-pass validate-then-build
 * shape and why (see that function's own doc comment for the fuller
 * argument).
 */
export function parsePassageRecord(value: unknown): PassageRecord {
  const findings = validatePassageRecordShape(value);
  if (findings.length > 0) {
    const detail = findings.map((f) => `  - ${f.path ?? "(root)"}: ${f.message}`).join("\n");
    throw new Error(`parsePassageRecord: value is not a valid PassageRecord:\n${detail}`);
  }
  // Safe: validatePassageRecordShape returning no findings means every
  // field buildPassageRecord reads below is present and correctly typed.
  return buildPassageRecord(value as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// Registry I/O — the one place in this file that touches a filesystem
// ---------------------------------------------------------------------------

/**
 * Why `path` did not become a usable `PassageRecord`. Mirrors
 * `registry.ts`'s `CopyRegistryReadIssueReason` exactly — see that type's
 * own doc comment for what each reason means.
 */
export type PassageRegistryReadIssueReason = "unreadable" | "unparseable" | "invalid-schema";

export interface PassageRegistryReadIssue {
  reason: PassageRegistryReadIssueReason;
  detail: string;
}

export interface PassageRegistryReadResult {
  path: string;
  record?: PassageRecord;
  issues: PassageRegistryReadIssue[];
  /** `true` exactly when `issues` is empty and `record` is populated — see `registry.ts`'s `CopyRegistryReadResult.complete` for why this is the shared one-boolean-read contract across this package. */
  complete: boolean;
}

/**
 * Reads and validates the `PassageRecord` at `path`. Never throws: every
 * failure — an unreadable file, invalid JSON, or a schema violation — is
 * recorded into `issues` and reflected in `.complete`. Mirrors
 * `registry.ts`'s `readCopyRecord` exactly, including the discipline it
 * documents: an unreadable/invalid registry is "could not run" (fed into
 * exit `2` by the CLI), never a clean pass produced from a record this
 * function could not actually trust.
 */
export function readPassageRecord(path: string): PassageRegistryReadResult {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    return {
      path,
      issues: [{ reason: "unreadable", detail: error instanceof Error ? error.message : String(error) }],
      complete: false,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      path,
      issues: [{ reason: "unparseable", detail: error instanceof Error ? error.message : String(error) }],
      complete: false,
    };
  }

  try {
    const record = parsePassageRecord(parsed);
    return { path, record, issues: [], complete: true };
  } catch (error) {
    return {
      path,
      issues: [{ reason: "invalid-schema", detail: error instanceof Error ? error.message : String(error) }],
      complete: false,
    };
  }
}

// ---------------------------------------------------------------------------
// Field classification — the heart of the gate
// ---------------------------------------------------------------------------

export type PassageFieldClassification =
  | "entry-reference"
  | "term-reference"
  | "inline-literal"
  | "passage-internals-reference"
  | "unclassifiable";

interface PassageFieldClassificationResult {
  classification: PassageFieldClassification;
  detail: string;
}

/** A short, length-capped JSON preview of an arbitrary field value, for a finding's own message — never large enough to make a report unreadable. */
function safePreview(value: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(value) ?? String(value);
  } catch {
    text = String(value);
  }
  return text.length > 120 ? `${text.slice(0, 120)}…` : text;
}

/**
 * Classifies one `Passage` field's raw value into exactly one of the five
 * `PassageFieldClassification` outcomes. Pure — no I/O, never throws on
 * any input shape.
 *
 *   - A plain string is ALWAYS `"inline-literal"` — real prose (or
 *     anything else) sitting directly in the field instead of a
 *     reference. This is the shape the adversarial proof's separating
 *     fixture is built from — see this file's top doc comment.
 *   - `{ ref: "entry", id: <non-empty string> }` is `"entry-reference"`.
 *   - `{ ref: "term", term: <non-empty string> }` is `"term-reference"`.
 *   - `{ ref: "passage", ... }` — REGARDLESS of what else it carries — is
 *     always `"passage-internals-reference"`: a passage may compose
 *     entries and terms, never reach directly into another passage's own
 *     fields. This is a VIOLATION, not something this function treats as
 *     merely unclassifiable, because the shape is unambiguous the moment
 *     `ref === "passage"` is seen.
 *   - `{ ref: "entry" | "term", ... }` with a missing/malformed
 *     `id`/`term` is `"unclassifiable"` — the AUTHOR'S intent (compose an
 *     entry or a term) is legible, but the reference itself is broken, so
 *     this function refuses to guess which finding shape to promote it
 *     to rather than silently treating a broken reference as either
 *     "fine" or "definitely a literal."
 *   - Anything else (a number, boolean, null, array, or an object with no
 *     recognized `ref`) is `"unclassifiable"`.
 */
export function classifyPassageField(value: unknown): PassageFieldClassificationResult {
  if (typeof value === "string") {
    return {
      classification: "inline-literal",
      detail: `field holds a literal string ${JSON.stringify(safePreview(value))} instead of a reference to a registered entry — the verbal equivalent of inlining a raw value instead of a token`,
    };
  }

  if (isPlainObject(value)) {
    const ref = value.ref;

    if (ref === "entry") {
      const id = value.id;
      if (isNonEmptyString(id)) {
        return { classification: "entry-reference", detail: `references entry "${id}"` };
      }
      return {
        classification: "unclassifiable",
        detail: `{ ref: "entry" } is missing a valid non-empty "id" (got ${safePreview(id)})`,
      };
    }

    if (ref === "term") {
      const term = value.term;
      if (isNonEmptyString(term)) {
        return { classification: "term-reference", detail: `references term "${term}"` };
      }
      return {
        classification: "unclassifiable",
        detail: `{ ref: "term" } is missing a valid non-empty "term" (got ${safePreview(term)})`,
      };
    }

    if (ref === "passage") {
      const id = typeof value.id === "string" && value.id.length > 0 ? value.id : "?";
      const field = typeof value.field === "string" && value.field.length > 0 ? value.field : "?";
      return {
        classification: "passage-internals-reference",
        detail: `reaches directly into passage "${id}"'s own field "${field}" instead of referencing an entry or a term — a passage may compose entries and terms, never another passage's internals`,
      };
    }
  }

  return {
    classification: "unclassifiable",
    detail: `field value ${safePreview(value)} is neither a literal string, an { ref: "entry" }/{ ref: "term" } reference, nor an { ref: "passage" } internals reference — cannot be classified`,
  };
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

export type PassageViolationRule = "field-inlines-literal" | "field-references-passage-internals";

export interface PassageViolation {
  passageId: PassageId;
  field: string;
  rule: PassageViolationRule;
  message: string;
}

export interface PassageUnclassifiedItem {
  passageId: PassageId;
  field: string;
  detail: string;
}

export type PassageVerdict = "satisfied" | "violated" | "indeterminate";

export interface PassageGateResult {
  verdict: PassageVerdict;
  violations: PassageViolation[];
  /** Every field this gate could not confidently classify — never silently dropped. See `classifyPassageField`'s own doc comment. */
  unclassified: PassageUnclassifiedItem[];
  /** How many passages had at least one field examined. Required to be > 0 for a satisfied verdict — see this file's top doc comment, "THE GATE". */
  passagesEvaluated: number;
  /** Human-readable reasons coverage is incomplete — empty for `"satisfied"`. Non-empty for `"violated"` too is possible (a real violation AND unclassified fields in the same run) — only `"indeterminate"` requires this to be non-empty. */
  reasons: string[];
}

/**
 * Pure — takes an already-parsed `PassageRecord` (see `readPassageRecord`/
 * `parsePassageRecord`), classifies every field of every passage, and
 * decides the ternary verdict. Never throws, does no I/O.
 *
 * PRECEDENCE: a real violation wins over an incomplete picture — see this
 * file's top doc comment, "THE TERNARY", for why this mirrors
 * `checkAddressability`'s own post-#407 ordering rather than the older
 * "indeterminate wins" precedence `checkCopyTraceability`/`scan.ts` still
 * use for a different reason (see `checkAddressability`'s own doc comment
 * for the fuller argument against letting a permanent-in-practice
 * coverage gap make a real violation unreachable).
 */
export function checkPassageComposition(record: PassageRecord): PassageGateResult {
  const violations: PassageViolation[] = [];
  const unclassified: PassageUnclassifiedItem[] = [];
  let passagesEvaluated = 0;

  for (const passage of record.passages) {
    const fieldNames = Object.keys(passage.fields);
    if (fieldNames.length === 0) continue; // defensive only — validatePassageRecordShape already requires >= 1 field
    passagesEvaluated++;

    for (const field of fieldNames) {
      const value = passage.fields[field];
      const { classification, detail } = classifyPassageField(value);

      if (classification === "inline-literal") {
        violations.push({
          passageId: passage.id,
          field,
          rule: "field-inlines-literal",
          message: `${passage.id}.${field}: ${detail}`,
        });
      } else if (classification === "passage-internals-reference") {
        violations.push({
          passageId: passage.id,
          field,
          rule: "field-references-passage-internals",
          message: `${passage.id}.${field}: ${detail}`,
        });
      } else if (classification === "unclassifiable") {
        unclassified.push({ passageId: passage.id, field, detail: `${passage.id}.${field}: ${detail}` });
      }
      // "entry-reference" / "term-reference": exactly the property this gate requires — no finding.
    }
  }

  const reasons: string[] = [];
  if (passagesEvaluated === 0) {
    reasons.push(
      record.passages.length === 0 ? "no passages are registered" : "no passage had at least one field to evaluate",
    );
  }
  if (unclassified.length > 0) {
    reasons.push(`${unclassified.length} field(s) could not be confidently classified`);
  }

  const base = { violations, unclassified, passagesEvaluated };

  // A real violation wins over an incomplete picture — see this file's
  // top doc comment, "THE TERNARY". The coverage gap is not hidden:
  // `reasons`/`unclassified` are still populated and still printed by
  // `cli.ts`'s `printPassagesReport` regardless of verdict.
  if (violations.length > 0) return { verdict: "violated", reasons, ...base };
  if (reasons.length > 0) return { verdict: "indeterminate", reasons, ...base };
  return { verdict: "satisfied", reasons, ...base };
}
