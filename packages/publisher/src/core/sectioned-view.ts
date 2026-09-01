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

export interface SectionedViewStatusItem {
  id: string;
  label: CopyRef;
  state: SectionedViewStatus;
}

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
  labels: Record<SectionedViewStatus, CopyRef>;
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

export type ResolvedSectionedViewSection =
  | Omit<SectionedViewHeroSection, "eyebrow" | "heading" | "description"> & { eyebrow?: ResolvedCopy; heading: ResolvedCopy; description?: ResolvedCopy }
  | Omit<SectionedViewFeatureGridSection, "heading" | "description" | "items"> & { heading: ResolvedCopy; description?: ResolvedCopy; items: Array<Omit<SectionedViewFeatureItem, "heading" | "description"> & { heading: ResolvedCopy; description?: ResolvedCopy }> }
  | Omit<SectionedViewFaqSection, "heading" | "description" | "items"> & { heading: ResolvedCopy; description?: ResolvedCopy; items: Array<Omit<SectionedViewFaqItem, "question" | "answer"> & { question: ResolvedCopy; answer: ResolvedCopy }> }
  | Omit<SectionedViewOrderedStepSequenceSection, "heading" | "description" | "items"> & { heading: ResolvedCopy; description?: ResolvedCopy; items: Array<Omit<SectionedViewOrderedStep, "ordinal" | "label" | "heading" | "description"> & { ordinal: ResolvedCopy; label?: ResolvedCopy; heading: ResolvedCopy; description?: ResolvedCopy }> }
  | Omit<SectionedViewStatusListSection, "heading" | "description" | "labels" | "groups"> & { heading: ResolvedCopy; description?: ResolvedCopy; labels: Record<SectionedViewStatus, ResolvedCopy>; groups: Array<Omit<SectionedViewStatusGroup, "heading" | "items"> & { heading: ResolvedCopy; items: Array<Omit<SectionedViewStatusItem, "label"> & { label: ResolvedCopy }> }> };

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
const FRAGMENT_ID = /^[a-z][a-z0-9-]*$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isNonWhitespaceString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isCopyRef(value: unknown): value is CopyRef {
  return isPlainObject(value) && isNonWhitespaceString(value.id);
}

function finding(rule: string, path: string, message: string): ComposeFinding {
  return { rule, severity: "error", path, message };
}

function validateCopy(value: unknown, path: string, findings: ComposeFinding[]): void {
  if (!isCopyRef(value)) findings.push(finding("sectioned-view-copy-ref-shape", path, `${path} must be a CopyRef with a non-empty id.`));
}

function validateItemIds(items: unknown[], path: string, findings: ComposeFinding[]): void {
  const ids = new Set<string>();
  items.forEach((item, index) => {
    const itemPath = `${path}.${index}`;
    if (!isPlainObject(item) || !isNonWhitespaceString(item.id)) return;
    if (ids.has(item.id)) findings.push(finding("sectioned-view-item-id-duplicate", `${itemPath}.id`, `${itemPath}.id duplicates another item id in ${path}.`));
    ids.add(item.id);
  });
}

/** Validates the closed, CopyRef-only section model without importing React or Designer. */
export function validateSectionedViewDocument(value: unknown): ComposeFinding[] {
  const findings: ComposeFinding[] = [];
  if (!isPlainObject(value) || !hasOnlyKeys(value, ["id", "sections"])) return [finding("sectioned-view-document-shape", "$", "A SectionedViewDocument must be a plain { id, sections } object.")];
  if (!isNonWhitespaceString(value.id)) findings.push(finding("sectioned-view-document-id-shape", "id", "id must be a non-whitespace string."));
  if (!Array.isArray(value.sections) || value.sections.length === 0) {
    findings.push(finding("sectioned-view-sections-shape", "sections", "sections must be a non-empty array."));
    return findings;
  }

  const sectionIds = new Set<string>();
  value.sections.forEach((section, sectionIndex) => {
    const path = `sections.${sectionIndex}`;
    if (!isPlainObject(section) || !isNonWhitespaceString(section.kind) || !isNonWhitespaceString(section.id) || !isNonWhitespaceString(section.ground)) {
      findings.push(finding("sectioned-view-section-shape", path, `${path} must be a section object with id, kind, and ground.`));
      return;
    }
    if (!FRAGMENT_ID.test(section.id)) findings.push(finding("sectioned-view-section-id-fragment", `${path}.id`, `${path}.id must be a lowercase, fragment-safe identifier (letters, digits, and hyphens; starting with a letter).`));
    if (sectionIds.has(section.id)) findings.push(finding("sectioned-view-section-id-duplicate", `${path}.id`, `${path}.id duplicates another section id.`));
    sectionIds.add(section.id);
    if (!GROUNDS.includes(section.ground as SectionedViewGround)) findings.push(finding("sectioned-view-ground", `${path}.ground`, `${path}.ground must be one of ${GROUNDS.join(", ")}.`));

    switch (section.kind) {
      case "hero":
        if (!hasOnlyKeys(section, ["id", "kind", "ground", "eyebrow", "heading", "description"])) findings.push(finding("sectioned-view-section-keys", path, `${path} has keys not allowed for hero.`));
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
  });
  return findings;
}

function validateRepeatedSection(section: Record<string, unknown>, path: string, sectionKeys: readonly string[], itemKeys: readonly string[], findings: ComposeFinding[], validateItem: (item: Record<string, unknown>, path: string) => void): void {
  if (!hasOnlyKeys(section, sectionKeys)) findings.push(finding("sectioned-view-section-keys", path, `${path} has keys not allowed for ${String(section.kind)}.`));
  if (!Array.isArray(section.items) || section.items.length === 0) {
    findings.push(finding("sectioned-view-items-shape", `${path}.items`, `${path}.items must be a non-empty array.`));
    return;
  }
  validateItemIds(section.items, `${path}.items`, findings);
  section.items.forEach((item, itemIndex) => {
    const itemPath = `${path}.items.${itemIndex}`;
    if (!isPlainObject(item) || !hasOnlyKeys(item, itemKeys) || !isNonWhitespaceString(item.id)) {
      findings.push(finding("sectioned-view-item-shape", itemPath, `${itemPath} must be a plain item with a non-whitespace id and only its kind's fields.`));
      return;
    }
    validateItem(item, itemPath);
  });
}

function validateStatusListSection(section: Record<string, unknown>, path: string, findings: ComposeFinding[]): void {
  if (!hasOnlyKeys(section, ["id", "kind", "ground", "heading", "description", "labels", "groups"])) findings.push(finding("sectioned-view-section-keys", path, `${path} has keys not allowed for status-list.`));
  validateCopy(section.heading, `${path}.heading`, findings);
  if (section.description !== undefined) validateCopy(section.description, `${path}.description`, findings);
  const labels = section.labels;
  if (!isPlainObject(labels) || !hasOnlyKeys(labels, STATUSES) || STATUSES.some((status) => !Object.hasOwn(labels, status))) {
    findings.push(finding("sectioned-view-status-labels-shape", `${path}.labels`, `${path}.labels must contain exactly available, partial, and planned CopyRefs.`));
  } else {
    STATUSES.forEach((status) => validateCopy(labels[status], `${path}.labels.${status}`, findings));
  }
  if (!Array.isArray(section.groups) || section.groups.length === 0) {
    findings.push(finding("sectioned-view-status-groups-shape", `${path}.groups`, `${path}.groups must be a non-empty array.`));
    return;
  }
  validateItemIds(section.groups, `${path}.groups`, findings);
  section.groups.forEach((group, groupIndex) => {
    const groupPath = `${path}.groups.${groupIndex}`;
    if (!isPlainObject(group) || !hasOnlyKeys(group, ["id", "heading", "items"]) || !isNonWhitespaceString(group.id)) {
      findings.push(finding("sectioned-view-status-group-shape", groupPath, `${groupPath} must be a plain group with id, heading, and items.`));
      return;
    }
    validateCopy(group.heading, `${groupPath}.heading`, findings);
    if (!Array.isArray(group.items) || group.items.length === 0) {
      findings.push(finding("sectioned-view-status-items-shape", `${groupPath}.items`, `${groupPath}.items must be a non-empty array.`));
      return;
    }
    validateItemIds(group.items, `${groupPath}.items`, findings);
    group.items.forEach((item, itemIndex) => {
      const itemPath = `${groupPath}.items.${itemIndex}`;
      if (!isPlainObject(item) || !hasOnlyKeys(item, ["id", "label", "state"]) || !isNonWhitespaceString(item.id)) {
        findings.push(finding("sectioned-view-status-item-shape", itemPath, `${itemPath} must be a plain status item with id, label, and state.`));
        return;
      }
      validateCopy(item.label, `${itemPath}.label`, findings);
      if (!STATUSES.includes(item.state as SectionedViewStatus)) findings.push(finding("sectioned-view-status-state", `${itemPath}.state`, `${itemPath}.state must be one of ${STATUSES.join(", ")}.`));
    });
  });
}

/** Resolves every audience-facing field depth-first and returns its provenance-ready CopyResolution list. */
export function resolveSectionedViewDocument(document: SectionedViewDocument, resolver: CopyResolver): ResolvedSectionedViewDocument {
  const findings = validateSectionedViewDocument(document);
  if (findings.length > 0) throw new SectionedViewResolutionError("invalid-document", `resolveSectionedViewDocument refused invalid document: ${findings.map((entry) => entry.message).join("; ")}`);
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
        labels: Object.fromEntries(STATUSES.map((status) => [status, text(section.labels[status], `${path}.labels.${status}`)])) as Record<SectionedViewStatus, string>,
        groups: section.groups.map((group, groupIndex) => ({ ...group, heading: text(group.heading, `${path}.groups.${groupIndex}.heading`), items: group.items.map((item, itemIndex) => ({ ...item, label: text(item.label, `${path}.groups.${groupIndex}.items.${itemIndex}.label`) })) })),
      };
  }
}
