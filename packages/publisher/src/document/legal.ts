/**
 * `LegalDocument` — a profile over `StructuredDocument`, not a separate
 * content type. It adds a `legal` block (which kind of document this is, its
 * review status, two dates, three content variables) and a closed, ordered
 * list of top-level section ids per kind, then validates a candidate against
 * both. It ships no legal wording: every leaf of text remains a `CopyRef`
 * owned by the caller's copy registry, and a section that does not apply is
 * declared through `LegalProfile.notApplicable` with a caller-supplied
 * `CopyRef` rather than any built-in sentence.
 *
 * `validateLegalDocument` never throws and accumulates every finding, in the
 * same plain-type-guard style as `validate.ts`. `gateLegalDocument` is the
 * pure, fail-closed decision built on it: a draft may be previewed but never
 * published to production.
 */

import type { CopyRef } from "@clossys/writer";
import type { ComposeFinding } from "../core/index.js";
import type { StructuredDocument } from "./types.js";
import { validateStructuredDocument } from "./validate.js";

// --------------------------------------------------------------- types

export type LegalDocumentKind = "terms" | "privacy";
export type LegalDocumentStatus = "draft" | "counsel-reviewed";
export type LegalGateTarget = "preview" | "production";

/** The top-level `DocumentSection.id`s each kind must contain, exactly once each, in this order. Nested section ids are unconstrained. */
export const LEGAL_SECTION_IDS: Readonly<Record<LegalDocumentKind, readonly string[]>> = {
  terms: [
    "about",
    "acceptance",
    "eligibility",
    "using-the-site",
    "acceptable-use",
    "intellectual-property",
    "your-submissions",
    "third-parties",
    "no-professional-advice",
    "disclaimers",
    "liability",
    "indemnity",
    "changes",
    "suspension",
    "governing-law",
    "general",
    "contact",
  ],
  privacy: [
    "about",
    "scope",
    "what-we-collect",
    "how-we-use",
    "legal-bases",
    "cookies",
    "sharing",
    "international-transfers",
    "retention",
    "security",
    "your-rights",
    "children",
    "changes",
    "contact",
  ],
};

export interface LegalContentVariables {
  entity: string;
  jurisdiction: string;
  contact: string;
}

export interface LegalProfile {
  kind: LegalDocumentKind;
  status: LegalDocumentStatus;
  /** `YYYY-MM-DD`, a real Gregorian calendar date. */
  effectiveDate: string;
  /** `YYYY-MM-DD`, a real Gregorian calendar date. */
  lastUpdated: string;
  variables: LegalContentVariables;
  /** Open facts a human must confirm; required (non-empty) while `status` is `"draft"`. */
  factsToConfirm?: CopyRef[];
  /** Maps a section id to the `CopyRef` of the sentence that states the section does not apply. The section's body must be exactly that one paragraph. */
  notApplicable?: Record<string, CopyRef>;
}

export type LegalDocument = StructuredDocument & { legal: LegalProfile };

export interface LegalGateResult {
  ok: boolean;
  findings: ComposeFinding[];
}

// --------------------------------------------------------------- helpers

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isCopyRef(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  if (!isNonEmptyString(value.id)) return false;
  if (value.locale !== undefined && typeof value.locale !== "string") return false;
  if (value.values !== undefined && !isPlainObject(value.values)) return false;
  return true;
}

function finding(rule: string, message: string, path: string): ComposeFinding {
  return { rule, severity: "error", message, path };
}

const KINDS: readonly string[] = ["terms", "privacy"];
const STATUSES: readonly string[] = ["draft", "counsel-reviewed"];
const TARGETS: readonly string[] = ["preview", "production"];
const VARIABLE_KEYS = ["entity", "jurisdiction", "contact"] as const;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

/** Pure arithmetic on the parsed digits; `Date` parsing is deliberately not used. */
function isValidCalendarDate(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  return day <= daysInMonth(year, month);
}

// --------------------------------------------------------------- legal profile checks

// Rule: legal-status-unknown, legal-draft-facts-missing, legal-facts-shape
function validateStatusAndFacts(legal: Record<string, unknown>, findings: ComposeFinding[]): void {
  if (typeof legal.status !== "string" || !STATUSES.includes(legal.status)) {
    findings.push(finding("legal-status-unknown", `legal.status must be one of ${STATUSES.join(", ")}, got ${JSON.stringify(legal.status)}.`, "legal.status"));
  }

  const facts = legal.factsToConfirm;
  if (facts !== undefined) {
    if (!Array.isArray(facts)) {
      findings.push(finding("legal-facts-shape", "legal.factsToConfirm must be an array of CopyRefs.", "legal.factsToConfirm"));
    } else {
      facts.forEach((fact, index) => {
        if (!isCopyRef(fact)) {
          const path = `legal.factsToConfirm.${index}`;
          findings.push(finding("legal-facts-shape", `${path} must be a CopyRef with a non-empty id.`, path));
        }
      });
    }
  }

  if (legal.status === "draft" && (!Array.isArray(facts) || facts.length === 0)) {
    findings.push(finding("legal-draft-facts-missing", "A draft legal document must list at least one fact to confirm in legal.factsToConfirm.", "legal.factsToConfirm"));
  }
}

// Rule: legal-date-missing, legal-date-invalid
function validateDate(legal: Record<string, unknown>, field: "effectiveDate" | "lastUpdated", findings: ComposeFinding[]): void {
  const path = `legal.${field}`;
  const value = legal[field];
  if (value === undefined) {
    findings.push(finding("legal-date-missing", `${path} is required.`, path));
    return;
  }
  if (typeof value !== "string" || !isValidCalendarDate(value)) {
    findings.push(finding("legal-date-invalid", `${path} must be a real calendar date written YYYY-MM-DD, got ${JSON.stringify(value)}.`, path));
  }
}

// Rule: legal-profile-shape (variables), legal-variable-empty
function validateVariables(legal: Record<string, unknown>, findings: ComposeFinding[]): void {
  const variables = legal.variables;
  if (!isPlainObject(variables)) {
    findings.push(finding("legal-profile-shape", "legal.variables must be an object with entity, jurisdiction, and contact.", "legal.variables"));
    return;
  }
  for (const key of VARIABLE_KEYS) {
    const value = variables[key];
    if (typeof value !== "string" || value.trim().length === 0) {
      const path = `legal.variables.${key}`;
      findings.push(finding("legal-variable-empty", `${path} must be a non-empty string.`, path));
    }
  }
}

// --------------------------------------------------------------- sections

/** The section-order/missing/unexpected checks, over TOP-LEVEL sections only. Returns first-occurrence index per recognised id. */
// Rule: legal-section-missing, legal-section-unexpected, legal-section-order
function validateSectionSet(sections: unknown[], expected: readonly string[], findings: ComposeFinding[]): Map<string, number> {
  const firstIndex = new Map<string, number>();
  const sequence: string[] = [];
  const unexpected: ComposeFinding[] = [];

  sections.forEach((section, index) => {
    if (!isPlainObject(section) || typeof section.id !== "string" || section.id.length === 0) return; // base validator reports it
    const id = section.id;
    const recognised = expected.includes(id);
    if (recognised && !firstIndex.has(id)) {
      firstIndex.set(id, index);
      sequence.push(id);
      return;
    }
    const path = `sections.${index}.id`;
    unexpected.push(
      finding(
        "legal-section-unexpected",
        recognised ? `${path} repeats the required section "${id}"; each required section may appear once.` : `${path} "${id}" is not one of the required top-level sections for this document kind.`,
        path,
      ),
    );
  });

  for (const id of expected) {
    if (!firstIndex.has(id)) findings.push(finding("legal-section-missing", `Required top-level section "${id}" is missing.`, "sections"));
  }
  findings.push(...unexpected);

  const expectedPresent = expected.filter((id) => firstIndex.has(id));
  if (sequence.some((id, i) => id !== expectedPresent[i])) {
    findings.push(finding("legal-section-order", `Top-level sections must appear in this order: ${expectedPresent.join(", ")}.`, "sections"));
  }
  return firstIndex;
}

/** True when `blocks` is exactly one paragraph holding exactly one text inline whose `text.id` is `refId`. */
function isStatementOnly(blocks: unknown[], refId: string): boolean {
  if (blocks.length !== 1) return false;
  const block = blocks[0];
  if (!isPlainObject(block) || block.kind !== "paragraph" || !Array.isArray(block.content) || block.content.length !== 1) return false;
  const inline = block.content[0];
  if (!isPlainObject(inline) || inline.kind !== "text" || !isPlainObject(inline.text)) return false;
  return inline.text.id === refId;
}

// Rule: legal-not-applicable-shape, legal-not-applicable-unknown-section, legal-not-applicable-statement-missing, legal-section-empty
function validateNotApplicableAndEmpty(
  legal: Record<string, unknown>,
  kindKnown: boolean,
  expected: readonly string[],
  sections: unknown[] | undefined,
  firstIndex: Map<string, number>,
  findings: ComposeFinding[],
): void {
  const declared = new Map<string, string>(); // section id -> statement ref id, only well-formed declarations
  const raw = legal.notApplicable;
  if (raw !== undefined) {
    if (!isPlainObject(raw)) {
      findings.push(finding("legal-not-applicable-shape", "legal.notApplicable must be an object mapping a section id to a CopyRef.", "legal.notApplicable"));
    } else {
      for (const [key, value] of Object.entries(raw)) {
        const path = `legal.notApplicable.${key}`;
        if (kindKnown && !expected.includes(key)) {
          findings.push(finding("legal-not-applicable-unknown-section", `${path} names a section id that this document kind does not have.`, path));
          continue;
        }
        if (!isCopyRef(value)) {
          findings.push(finding("legal-not-applicable-shape", `${path} must be a CopyRef with a non-empty id.`, path));
          continue;
        }
        declared.set(key, (value as { id: string }).id);
      }
    }
  }

  if (!kindKnown || sections === undefined) return;

  for (const id of expected) {
    const index = firstIndex.get(id);
    if (index === undefined) continue;
    const section = sections[index];
    if (!isPlainObject(section) || !Array.isArray(section.blocks)) continue; // base validator reports it
    const path = `sections.${index}.blocks`;
    const statementRef = declared.get(id);
    if (statementRef !== undefined) {
      if (!isStatementOnly(section.blocks, statementRef)) {
        findings.push(
          finding(
            "legal-not-applicable-statement-missing",
            `Section "${id}" is declared not applicable, so its blocks must be exactly one paragraph holding one text inline that cites "${statementRef}".`,
            path,
          ),
        );
      }
    } else if (section.blocks.length === 0 && !(raw !== undefined && isPlainObject(raw) && Object.prototype.hasOwnProperty.call(raw, id))) {
      findings.push(finding("legal-section-empty", `Section "${id}" has no blocks; write its content, or declare it not applicable in legal.notApplicable.`, path));
    }
  }
}

// --------------------------------------------------------------- public API

/**
 * Validates a candidate `LegalDocument`: every `validateStructuredDocument`
 * finding, then the legal profile, then the top-level section structure.
 * Never throws; every finding is `severity: "error"`.
 */
export function validateLegalDocument(value: unknown): ComposeFinding[] {
  const findings = validateStructuredDocument(value);
  if (!isPlainObject(value)) return findings;

  const legal = value.legal;
  if (!isPlainObject(legal)) {
    findings.push(finding("legal-profile-shape", "legal must be an object (the legal profile).", "legal"));
    return findings;
  }

  const kindKnown = typeof legal.kind === "string" && KINDS.includes(legal.kind);
  if (!kindKnown) {
    findings.push(finding("legal-kind-unknown", `legal.kind must be one of ${KINDS.join(", ")}, got ${JSON.stringify(legal.kind)}.`, "legal.kind"));
  }

  validateStatusAndFacts(legal, findings);
  validateDate(legal, "effectiveDate", findings);
  validateDate(legal, "lastUpdated", findings);
  validateVariables(legal, findings);

  const expected: readonly string[] = kindKnown ? LEGAL_SECTION_IDS[legal.kind as LegalDocumentKind] : [];
  const sections = Array.isArray(value.sections) ? (value.sections as unknown[]) : undefined;
  const firstIndex = kindKnown && sections !== undefined ? validateSectionSet(sections, expected, findings) : new Map<string, number>();

  validateNotApplicableAndEmpty(legal, kindKnown, expected, sections, firstIndex, findings);
  return findings;
}

/**
 * Pure, fail-closed publication gate. `ok` is true only when the document
 * has zero findings; an unknown target is refused; `"production"` also
 * refuses anything whose status is not exactly `"counsel-reviewed"`.
 */
export function gateLegalDocument(value: unknown, target: unknown): LegalGateResult {
  const findings: ComposeFinding[] = [];

  if (typeof target !== "string" || !TARGETS.includes(target)) {
    findings.push(finding("legal-gate-target-unknown", `target must be one of ${TARGETS.join(", ")}, got ${JSON.stringify(target)}.`, "target"));
  }

  findings.push(...validateLegalDocument(value));

  if (target === "production") {
    const status = isPlainObject(value) && isPlainObject(value.legal) ? value.legal.status : undefined;
    if (status !== "counsel-reviewed") {
      findings.push(
        finding(
          "legal-gate-not-counsel-reviewed",
          `Production refuses a legal document whose legal.status is not "counsel-reviewed" (a draft, an unknown status, or a missing status), got ${JSON.stringify(status)}.`,
          "legal.status",
        ),
      );
    }
  }

  return { ok: findings.length === 0, findings };
}
