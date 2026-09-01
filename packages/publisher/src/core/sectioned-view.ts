import type { CopyRef, CopyResolution, CopyResolver } from "@clossys/writer";
import type { ComposeFinding } from "./types.js";

/** The only grounds a section may name. Rendering maps this vocabulary to design tokens later. */
export type SectionedViewGround = "base" | "sunken" | "inverse";

/** The closed block vocabulary for a long-form site page. */
export type SectionedViewSectionKind = "hero" | "feature-grid" | "faq" | "ordered-step-sequence" | "status-list";

export interface SectionedViewHeroSection {
  id: string;
  kind: "hero";
  ground: SectionedViewGround;
  eyebrow?: CopyRef;
  heading: CopyRef;
  description?: CopyRef;
}

export interface SectionedViewFeatureItem {
  id: string;
  heading: CopyRef;
  description?: CopyRef;
}

export interface SectionedViewFeatureGridSection {
  id: string;
  kind: "feature-grid";
  ground: SectionedViewGround;
  heading: CopyRef;
  description?: CopyRef;
  items: SectionedViewFeatureItem[];
}

export interface SectionedViewFaqItem {
  id: string;
  question: CopyRef;
  answer: CopyRef;
}

export interface SectionedViewFaqSection {
  id: string;
  kind: "faq";
  ground: SectionedViewGround;
  heading: CopyRef;
  description?: CopyRef;
  items: SectionedViewFaqItem[];
}

export interface SectionedViewOrderedStep {
  id: string;
  ordinal: CopyRef;
  label?: CopyRef;
  heading: CopyRef;
  description?: CopyRef;
}

export interface SectionedViewOrderedStepSequenceSection {
  id: string;
  kind: "ordered-step-sequence";
  ground: SectionedViewGround;
  heading: CopyRef;
  description?: CopyRef;
  items: SectionedViewOrderedStep[];
}

export type SectionedViewStatus = "available" | "partial" | "planned";
/** A deliberate non-capability, kept outside the readiness axis. */
export type SectionedViewStatusDisposition = "not-offered";

export type SectionedViewStatusItem =
  | { id: string; label: CopyRef; state: SectionedViewStatus; disposition?: never }
  | { id: string; label: CopyRef; disposition: SectionedViewStatusDisposition; state?: never };

export interface SectionedViewStatusGroup {
  id: string;
  heading: CopyRef;
  items: SectionedViewStatusItem[];
}

export interface SectionedViewStatusListSection {
  id: string;
  kind: "status-list";
  ground: SectionedViewGround;
  heading: CopyRef;
  description?: CopyRef;
  labels: Record<SectionedViewStatus, CopyRef> & { dispositions: Record<SectionedViewStatusDisposition, CopyRef> };
  groups: SectionedViewStatusGroup[];
}

/** One fully data-shaped section: there is deliberately no node, class, style, or render callback escape hatch. */
export type SectionedViewSection =
  | SectionedViewHeroSection
  | SectionedViewFeatureGridSection
  | SectionedViewFaqSection
  | SectionedViewOrderedStepSequenceSection
  | SectionedViewStatusListSection;

/** Canonical, Designer-independent input for a long public site page. */
export interface SectionedViewDocument {
  id: string;
  sections: SectionedViewSection[];
}

type ResolvedCopy = string;
type ResolvedSectionedViewStatusItem =
  | { id: string; label: ResolvedCopy; state: SectionedViewStatus; disposition?: never }
  | { id: string; label: ResolvedCopy; disposition: SectionedViewStatusDisposition; state?: never };

export type ResolvedSectionedViewSection =
  | Omit<SectionedViewHeroSection, "eyebrow" | "heading" | "description"> & { eyebrow?: ResolvedCopy; heading: ResolvedCopy; description?: ResolvedCopy }
  | Omit<SectionedViewFeatureGridSection, "heading" | "description" | "items"> & { heading: ResolvedCopy; description?: ResolvedCopy; items: Array<Omit<SectionedViewFeatureItem, "heading" | "description"> & { heading: ResolvedCopy; description?: ResolvedCopy }> }
  | Omit<SectionedViewFaqSection, "heading" | "description" | "items"> & { heading: ResolvedCopy; description?: ResolvedCopy; items: Array<Omit<SectionedViewFaqItem, "question" | "answer"> & { question: ResolvedCopy; answer: ResolvedCopy }> }
  | Omit<SectionedViewOrderedStepSequenceSection, "heading" | "description" | "items"> & { heading: ResolvedCopy; description?: ResolvedCopy; items: Array<Omit<SectionedViewOrderedStep, "ordinal" | "label" | "heading" | "description"> & { ordinal: ResolvedCopy; label?: ResolvedCopy; heading: ResolvedCopy; description?: ResolvedCopy }> }
  | Omit<SectionedViewStatusListSection, "heading" | "description" | "labels" | "groups"> & { heading: ResolvedCopy; description?: ResolvedCopy; labels: Record<SectionedViewStatus, ResolvedCopy> & { dispositions: Record<SectionedViewStatusDisposition, ResolvedCopy> }; groups: Array<Omit<SectionedViewStatusGroup, "heading" | "items"> & { heading: ResolvedCopy; items: ResolvedSectionedViewStatusItem[] }> };

export interface ResolvedSectionedViewDocument {
  id: string;
  sections: ResolvedSectionedViewSection[];
  /** Every resolved CopyRef in depth-first authored order; pass directly to collectCopyProvenance. */
  resolutions: CopyResolution[];
}

export type SectionedViewResolutionReason = "invalid-document" | "unresolved-copy";

export class SectionedViewResolutionError extends Error {
  constructor(readonly reason: SectionedViewResolutionReason, message: string) {
    super(message);
    this.name = "SectionedViewResolutionError";
  }
}

const GROUNDS: readonly SectionedViewGround[] = ["base", "sunken", "inverse"];
const STATUSES: readonly SectionedViewStatus[] = ["available", "partial", "planned"];
const DISPOSITIONS: readonly SectionedViewStatusDisposition[] = ["not-offered"];
const FRAGMENT_ID = /^[a-z][a-z0-9-]*$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * This is a public data boundary, not a convenience object check. Every
 * property must be an enumerable own data property so inherited values,
 * symbols, accessors, and hidden keys cannot alter resolution after shape
 * validation has completed.
 */
function hasOnlyOwnKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return hasEnumerableOwnDataKeys(value) && Reflect.ownKeys(value).every((key) => {
    if (typeof key !== "string" || !allowed.includes(key)) return false;
    return true;
  });
}

function hasEnumerableOwnDataKeys(value: Record<string, unknown>): boolean {
  return Reflect.ownKeys(value).every((key) => {
    if (typeof key !== "string") return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && descriptor.enumerable && "value" in descriptor;
  });
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.hasOwn(value, key);
}

function hasOwnKeys(value: Record<string, unknown>, required: readonly string[]): boolean {
  return required.every((key) => hasOwn(value, key));
}

function validateDenseArray(value: unknown, path: string, findings: ComposeFinding[], shapeRule: string, shapeMessage: string): value is unknown[] {
  if (!Array.isArray(value) || value.length === 0) {
    findings.push(finding(shapeRule, path, shapeMessage));
    return false;
  }
  let dense = true;
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      findings.push(finding("sectioned-view-array-hole", `${path}.${index}`, `${path}.${index} must be an authored array item; sparse arrays are not supported.`));
      dense = false;
    }
  }
  return dense;
}

function isNonWhitespaceString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isCopyRef(value: unknown): value is CopyRef {
  if (!isPlainObject(value) || !hasOnlyOwnKeys(value, ["id", "locale", "values"]) || !hasOwn(value, "id") || !isNonWhitespaceString(value.id)) return false;
  if (hasOwn(value, "locale") && !isNonWhitespaceString(value.locale)) return false;
  if (!hasOwn(value, "values")) return true;
  if (!isPlainObject(value.values) || !Reflect.ownKeys(value.values).every((key) => {
    if (typeof key !== "string") return false;
    const descriptor = Object.getOwnPropertyDescriptor(value.values, key);
    return descriptor !== undefined && descriptor.enumerable && "value" in descriptor && ["string", "number", "boolean"].includes(typeof descriptor.value);
  })) return false;
  return true;
}

function finding(rule: string, path: string, message: string): ComposeFinding {
  return { rule, severity: "error", path, message };
}

function validateCopy(value: unknown, path: string, findings: ComposeFinding[]): void {
  if (!isCopyRef(value)) findings.push(finding("sectioned-view-copy-ref-shape", path, `${path} must be a CopyRef with a non-empty id.`));
}

function validateItemIds(items: unknown[], path: string, findings: ComposeFinding[]): void {
  const ids = new Set<string>();
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const itemPath = `${path}.${index}`;
    if (!isPlainObject(item) || !hasEnumerableOwnDataKeys(item) || !isNonWhitespaceString(item.id)) continue;
    if (ids.has(item.id)) findings.push(finding("sectioned-view-item-id-duplicate", `${itemPath}.id`, `${itemPath}.id duplicates another item id in ${path}.`));
    ids.add(item.id);
  }
}

/** Validates the closed, CopyRef-only section model without importing React or Designer. */
export function validateSectionedViewDocument(value: unknown): ComposeFinding[] {
  const findings: ComposeFinding[] = [];
  if (!isPlainObject(value) || !hasOnlyOwnKeys(value, ["id", "sections"]) || !hasOwnKeys(value, ["id", "sections"])) return [finding("sectioned-view-document-shape", "$", "A SectionedViewDocument must be a plain { id, sections } object.")];
  if (!isNonWhitespaceString(value.id)) findings.push(finding("sectioned-view-document-id-shape", "id", "id must be a non-whitespace string."));
  if (!validateDenseArray(value.sections, "sections", findings, "sectioned-view-sections-shape", "sections must be a non-empty array.")) return findings;

  const sectionIds = new Set<string>();
  let heroCount = 0;
  for (let sectionIndex = 0; sectionIndex < value.sections.length; sectionIndex += 1) {
    const section = value.sections[sectionIndex];
    const path = `sections.${sectionIndex}`;
    if (!isPlainObject(section) || !hasEnumerableOwnDataKeys(section) || !hasOwnKeys(section, ["id", "kind", "ground"]) || !isNonWhitespaceString(section.kind) || !isNonWhitespaceString(section.id) || !isNonWhitespaceString(section.ground)) {
      findings.push(finding("sectioned-view-section-shape", path, `${path} must be a section object with id, kind, and ground.`));
      continue;
    }
    if (!FRAGMENT_ID.test(section.id)) findings.push(finding("sectioned-view-section-id-fragment", `${path}.id`, `${path}.id must be a lowercase, fragment-safe identifier (letters, digits, and hyphens; starting with a letter).`));
    if (sectionIds.has(section.id)) findings.push(finding("sectioned-view-section-id-duplicate", `${path}.id`, `${path}.id duplicates another section id.`));
    sectionIds.add(section.id);
    if (!GROUNDS.includes(section.ground as SectionedViewGround)) findings.push(finding("sectioned-view-ground", `${path}.ground`, `${path}.ground must be one of ${GROUNDS.join(", ")}.`));

    switch (section.kind) {
      case "hero":
        heroCount += 1;
        if (sectionIndex !== 0) findings.push(finding("sectioned-view-hero-position", `${path}.kind`, "sections.0 must be the document's only hero section."));
        if (!hasOnlyOwnKeys(section, ["id", "kind", "ground", "eyebrow", "heading", "description"]) || !hasOwn(section, "heading")) findings.push(finding("sectioned-view-section-keys", path, `${path} has keys not allowed for hero.`));
        validateCopy(section.heading, `${path}.heading`, findings);
        if (section.eyebrow !== undefined) validateCopy(section.eyebrow, `${path}.eyebrow`, findings);
        if (section.description !== undefined) validateCopy(section.description, `${path}.description`, findings);
        break;
      case "feature-grid":
        validateRepeatedSection(section, path, ["id", "kind", "ground", "heading", "description", "items"], ["id", "heading", "description"], findings, (item, itemPath) => {
          validateCopy(item.heading, `${itemPath}.heading`, findings);
          if (item.description !== undefined) validateCopy(item.description, `${itemPath}.description`, findings);
        });
        validateCopy(section.heading, `${path}.heading`, findings);
        if (section.description !== undefined) validateCopy(section.description, `${path}.description`, findings);
        break;
      case "faq":
        validateRepeatedSection(section, path, ["id", "kind", "ground", "heading", "description", "items"], ["id", "question", "answer"], findings, (item, itemPath) => {
          validateCopy(item.question, `${itemPath}.question`, findings);
          validateCopy(item.answer, `${itemPath}.answer`, findings);
        });
        validateCopy(section.heading, `${path}.heading`, findings);
        if (section.description !== undefined) validateCopy(section.description, `${path}.description`, findings);
        break;
      case "ordered-step-sequence":
        validateRepeatedSection(section, path, ["id", "kind", "ground", "heading", "description", "items"], ["id", "ordinal", "label", "heading", "description"], findings, (item, itemPath) => {
          validateCopy(item.ordinal, `${itemPath}.ordinal`, findings);
          if (item.label !== undefined) validateCopy(item.label, `${itemPath}.label`, findings);
          validateCopy(item.heading, `${itemPath}.heading`, findings);
          if (item.description !== undefined) validateCopy(item.description, `${itemPath}.description`, findings);
        });
        validateCopy(section.heading, `${path}.heading`, findings);
        if (section.description !== undefined) validateCopy(section.description, `${path}.description`, findings);
        break;
      case "status-list":
        validateStatusListSection(section, path, findings);
        break;
      default:
        findings.push(finding("sectioned-view-section-kind", `${path}.kind`, `${path}.kind must be one of hero, feature-grid, faq, ordered-step-sequence, status-list.`));
    }
  }
  const firstSection = value.sections[0];
  if (!isPlainObject(firstSection) || !hasOwn(firstSection, "kind") || firstSection.kind !== "hero") findings.push(finding("sectioned-view-hero-first", "sections.0.kind", "sections.0.kind must be hero so the page has one h1."));
  if (heroCount !== 1) findings.push(finding("sectioned-view-hero-count", "sections", "A SectionedViewDocument must contain exactly one hero section."));
  return findings;
}

function validateRepeatedSection(section: Record<string, unknown>, path: string, sectionKeys: readonly string[], itemKeys: readonly string[], findings: ComposeFinding[], validateItem: (item: Record<string, unknown>, path: string) => void): void {
  if (!hasOnlyOwnKeys(section, sectionKeys) || !hasOwnKeys(section, ["heading", "items"])) findings.push(finding("sectioned-view-section-keys", path, `${path} has keys not allowed for this section kind.`));
  if (!validateDenseArray(section.items, `${path}.items`, findings, "sectioned-view-items-shape", `${path}.items must be a non-empty array.`)) return;
  validateItemIds(section.items, `${path}.items`, findings);
  for (let itemIndex = 0; itemIndex < section.items.length; itemIndex += 1) {
    const item = section.items[itemIndex];
    const itemPath = `${path}.items.${itemIndex}`;
    const requiredItemKeys = itemKeys.filter((key) => !["description", "label"].includes(key));
    if (!isPlainObject(item) || !hasOnlyOwnKeys(item, itemKeys) || !hasOwnKeys(item, requiredItemKeys) || !isNonWhitespaceString(item.id)) {
      findings.push(finding("sectioned-view-item-shape", itemPath, `${itemPath} must be a plain item with a non-whitespace id and only its kind's fields.`));
      continue;
    }
    validateItem(item, itemPath);
  }
}

function validateStatusListSection(section: Record<string, unknown>, path: string, findings: ComposeFinding[]): void {
  if (!hasOnlyOwnKeys(section, ["id", "kind", "ground", "heading", "description", "labels", "groups"]) || !hasOwnKeys(section, ["heading", "labels", "groups"])) findings.push(finding("sectioned-view-section-keys", path, `${path} has keys not allowed for status-list.`));
  validateCopy(section.heading, `${path}.heading`, findings);
  if (section.description !== undefined) validateCopy(section.description, `${path}.description`, findings);
  const labels = section.labels;
  const labelKeys = [...STATUSES, "dispositions"];
  if (!isPlainObject(labels) || !hasOnlyOwnKeys(labels, labelKeys) || !hasOwnKeys(labels, labelKeys)) {
    findings.push(finding("sectioned-view-status-labels-shape", `${path}.labels`, `${path}.labels must contain exactly available, partial, planned, and dispositions CopyRefs.`));
  } else {
    STATUSES.forEach((status) => validateCopy(labels[status], `${path}.labels.${status}`, findings));
    const dispositions = labels.dispositions;
    if (!isPlainObject(dispositions) || !hasOnlyOwnKeys(dispositions, DISPOSITIONS) || !hasOwnKeys(dispositions, DISPOSITIONS)) {
      findings.push(finding("sectioned-view-status-dispositions-shape", `${path}.labels.dispositions`, `${path}.labels.dispositions must contain exactly not-offered.`));
    } else {
      DISPOSITIONS.forEach((disposition) => validateCopy(dispositions[disposition], `${path}.labels.dispositions.${disposition}`, findings));
    }
  }
  if (!validateDenseArray(section.groups, `${path}.groups`, findings, "sectioned-view-status-groups-shape", `${path}.groups must be a non-empty array.`)) return;
  validateItemIds(section.groups, `${path}.groups`, findings);
  for (let groupIndex = 0; groupIndex < section.groups.length; groupIndex += 1) {
    const group = section.groups[groupIndex];
    const groupPath = `${path}.groups.${groupIndex}`;
    if (!isPlainObject(group) || !hasOnlyOwnKeys(group, ["id", "heading", "items"]) || !hasOwnKeys(group, ["id", "heading", "items"]) || !isNonWhitespaceString(group.id)) {
      findings.push(finding("sectioned-view-status-group-shape", groupPath, `${groupPath} must be a plain group with id, heading, and items.`));
      continue;
    }
    validateCopy(group.heading, `${groupPath}.heading`, findings);
    if (!validateDenseArray(group.items, `${groupPath}.items`, findings, "sectioned-view-status-items-shape", `${groupPath}.items must be a non-empty array.`)) continue;
    validateItemIds(group.items, `${groupPath}.items`, findings);
    for (let itemIndex = 0; itemIndex < group.items.length; itemIndex += 1) {
      const item = group.items[itemIndex];
      const itemPath = `${groupPath}.items.${itemIndex}`;
      if (!isPlainObject(item) || !hasOnlyOwnKeys(item, ["id", "label", "state", "disposition"]) || !hasOwn(item, "id") || !hasOwn(item, "label") || !isNonWhitespaceString(item.id)) {
        findings.push(finding("sectioned-view-status-item-shape", itemPath, `${itemPath} must be a plain status item with id, label, and exactly one of state or disposition.`));
        continue;
      }
      const hasState = hasOwn(item, "state");
      const hasDisposition = hasOwn(item, "disposition");
      if (hasState === hasDisposition) {
        findings.push(finding("sectioned-view-status-item-shape", itemPath, `${itemPath} must be a plain status item with id, label, and exactly one of state or disposition.`));
        continue;
      }
      validateCopy(item.label, `${itemPath}.label`, findings);
      if (hasState && !STATUSES.includes(item.state as SectionedViewStatus)) findings.push(finding("sectioned-view-status-state", `${itemPath}.state`, `${itemPath}.state must be one of ${STATUSES.join(", ")}.`));
      if (hasDisposition && !DISPOSITIONS.includes(item.disposition as SectionedViewStatusDisposition)) findings.push(finding("sectioned-view-status-disposition", `${itemPath}.disposition`, `${itemPath}.disposition must be one of ${DISPOSITIONS.join(", ")}.`));
    }
  }
}

/** Resolves every audience-facing field depth-first and returns its provenance-ready CopyResolution list. */
export function resolveSectionedViewDocument(document: SectionedViewDocument, resolver: CopyResolver): ResolvedSectionedViewDocument {
  const findings = validateSectionedViewDocument(document);
  if (findings.length > 0) throw new SectionedViewResolutionError("invalid-document", `resolveSectionedViewDocument refused invalid document: ${findings.map((entry) => entry.message).join("; ")}`);
  if (typeof resolver !== "function") {
    throw new SectionedViewResolutionError("unresolved-copy", `resolveSectionedViewDocument needs a CopyResolver for document "${document.id}".`);
  }
  const resolutions: CopyResolution[] = [];
  const text = (ref: CopyRef, path: string): string => {
    const resolution = resolver(ref);
    if (resolution === undefined || typeof resolution.text !== "string" || resolution.text.trim().length === 0) {
      throw new SectionedViewResolutionError("unresolved-copy", `resolveSectionedViewDocument could not resolve CopyRef "${ref.id}" at ${path} for document "${document.id}".`);
    }
    resolutions.push(resolution);
    return resolution.text;
  };
  const optional = (ref: CopyRef | undefined, path: string): string | undefined => (ref === undefined ? undefined : text(ref, path));
  const sections = document.sections.map((section, sectionIndex) => resolveSection(section, `sections.${sectionIndex}`, text, optional));
  return { id: document.id, sections, resolutions };
}

function resolveSection(section: SectionedViewSection, path: string, text: (ref: CopyRef, path: string) => string, optional: (ref: CopyRef | undefined, path: string) => string | undefined): ResolvedSectionedViewSection {
  switch (section.kind) {
    case "hero":
      return { ...section, eyebrow: optional(section.eyebrow, `${path}.eyebrow`), heading: text(section.heading, `${path}.heading`), description: optional(section.description, `${path}.description`) };
    case "feature-grid":
      return { ...section, heading: text(section.heading, `${path}.heading`), description: optional(section.description, `${path}.description`), items: section.items.map((item, index) => ({ ...item, heading: text(item.heading, `${path}.items.${index}.heading`), description: optional(item.description, `${path}.items.${index}.description`) })) };
    case "faq":
      return { ...section, heading: text(section.heading, `${path}.heading`), description: optional(section.description, `${path}.description`), items: section.items.map((item, index) => ({ ...item, question: text(item.question, `${path}.items.${index}.question`), answer: text(item.answer, `${path}.items.${index}.answer`) })) };
    case "ordered-step-sequence":
      return { ...section, heading: text(section.heading, `${path}.heading`), description: optional(section.description, `${path}.description`), items: section.items.map((item, index) => ({ ...item, ordinal: text(item.ordinal, `${path}.items.${index}.ordinal`), label: optional(item.label, `${path}.items.${index}.label`), heading: text(item.heading, `${path}.items.${index}.heading`), description: optional(item.description, `${path}.items.${index}.description`) })) };
    case "status-list":
      return {
        ...section,
        heading: text(section.heading, `${path}.heading`),
        description: optional(section.description, `${path}.description`),
        labels: {
          ...Object.fromEntries(STATUSES.map((status) => [status, text(section.labels[status], `${path}.labels.${status}`)])),
          dispositions: Object.fromEntries(DISPOSITIONS.map((disposition) => [disposition, text(section.labels.dispositions[disposition], `${path}.labels.dispositions.${disposition}`)])),
        } as Record<SectionedViewStatus, string> & { dispositions: Record<SectionedViewStatusDisposition, string> },
        groups: section.groups.map((group, groupIndex) => ({ ...group, heading: text(group.heading, `${path}.groups.${groupIndex}.heading`), items: group.items.map((item, itemIndex) => ({ ...item, label: text(item.label, `${path}.groups.${groupIndex}.items.${itemIndex}.label`) })) })),
      };
  }
}
