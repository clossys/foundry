import type { ReactNode } from "react";
import type { ResolvedSectionedViewDocument, ResolvedSectionedViewSection, SectionedViewGround, SectionedViewStatus, SectionedViewStatusDisposition } from "../../core/sectioned-view.js";
import { RenderError } from "../../internal/errors.js";

type HeadingLevel = 2 | 3 | 4 | 5 | 6;
type GroundProps = { id: string; heading: string; description?: string; headingLevel: HeadingLevel; ground: SectionedViewGround };

export interface SectionedViewBlockSet {
  Hero(props: { id: string; eyebrow?: string; heading: string; description?: string; headingLevel: 1 | 2; ground: SectionedViewGround }): ReactNode;
  FeatureGrid(props: GroundProps & { items: readonly { id: string; heading: string; description?: string }[] }): ReactNode;
  Faq(props: GroundProps & { items: readonly { id: string; question: string; answer: string }[] }): ReactNode;
  OrderedStepSequence(props: GroundProps & { items: readonly { id: string; ordinal: string; label?: string; heading: string; description?: string }[] }): ReactNode;
  StatusList(props: GroundProps & { labels: Readonly<Record<SectionedViewStatus, string>> & { dispositions: Readonly<Record<SectionedViewStatusDisposition, string>> }; groups: readonly { id: string; heading: string; items: readonly ({ id: string; label: string; state: SectionedViewStatus; disposition?: never } | { id: string; label: string; disposition: SectionedViewStatusDisposition; state?: never })[] }[]; legendLabel: string }): ReactNode;
}

export interface SectionedViewProps {
  /** Copy has already resolved through resolveSectionedViewDocument; its resolutions remain the sole provenance evidence. */
  document: ResolvedSectionedViewDocument;
}

const GROUNDS: readonly SectionedViewGround[] = ["base", "sunken", "inverse"];
const STATUSES: readonly SectionedViewStatus[] = ["available", "partial", "planned"];
const DISPOSITIONS: readonly SectionedViewStatusDisposition[] = ["not-offered"];
const FRAGMENT_ID = /^[a-z][a-z0-9-]*$/;

function nonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function plain(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function closed(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Reflect.ownKeys(value).every((key) => typeof key === "string" && keys.includes(key) && (() => { const descriptor = Object.getOwnPropertyDescriptor(value, key); return descriptor !== undefined && descriptor.enumerable && "value" in descriptor; })());
}

function validCopyRef(value: unknown): boolean {
  if (!plain(value) || !closed(value, ["id", "locale", "values"]) || !Object.hasOwn(value, "id") || !nonBlank(value.id) || (value.locale !== undefined && !nonBlank(value.locale))) return false;
  if (value.values === undefined) return true;
  if (!plain(value.values)) return false;
  return Reflect.ownKeys(value.values).every((key) => {
    if (typeof key !== "string") return false;
    const descriptor = Object.getOwnPropertyDescriptor(value.values, key);
    return descriptor !== undefined && descriptor.enumerable && "value" in descriptor && ["string", "number", "boolean"].includes(typeof descriptor.value);
  });
}

function dense(value: unknown, path: string): asserts value is unknown[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${path} must be a non-empty dense array.`);
  for (let index = 0; index < value.length; index += 1) if (!Object.hasOwn(value, index)) throw new Error(`${path}.${index} is a sparse array hole.`);
}

function itemIds(items: unknown[], path: string): void {
  const ids = new Set<string>();
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (typeof item !== "object" || item === null || !nonBlank((item as { id?: unknown }).id)) throw new Error(`${path}.${index}.id must be a non-blank string.`);
    const id = (item as { id: string }).id;
    if (ids.has(id)) throw new Error(`${path}.${index}.id duplicates an earlier item.`);
    ids.add(id);
  }
}

function closedItems(items: unknown[], path: string, keys: readonly string[]): void {
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!plain(item) || !closed(item, keys)) throw new Error(`${path}.${index} must be a closed resolved item object.`);
  }
}

function copyFields(section: Record<string, unknown>, path: string, required: readonly string[], optional: readonly string[] = []): void {
  for (const field of required) if (!nonBlank(section[field])) throw new Error(`${path}.${field} must be resolved non-blank copy.`);
  for (const field of optional) if (section[field] !== undefined && !nonBlank(section[field])) throw new Error(`${path}.${field} must be resolved non-blank copy.`);
}

/** Validates the direct resolved-model boundary before any Designer block receives props. */
export function assertRenderableSectionedViewDocument(document: unknown): asserts document is ResolvedSectionedViewDocument {
  if (!plain(document) || !closed(document, ["id", "sections", "resolutions"]) || !Object.hasOwn(document, "id") || !Object.hasOwn(document, "sections") || !Object.hasOwn(document, "resolutions") || !nonBlank(document.id)) throw new Error("document must be a closed object with a non-blank id, sections, and resolutions.");
  const candidate = document as { sections?: unknown; resolutions?: unknown };
  dense(candidate.sections, "sections");
  if (!Array.isArray(candidate.resolutions) || candidate.resolutions.length === 0) throw new Error("resolutions must be a non-empty array carrying CopyResolution provenance.");
  for (let index = 0; index < candidate.resolutions.length; index += 1) {
    if (!Object.hasOwn(candidate.resolutions, index)) throw new Error(`resolutions.${index} is a sparse provenance hole.`);
    const resolution = candidate.resolutions[index];
    if (!plain(resolution) || !closed(resolution, ["ref", "text", "recordId", "revision", "locale", "source", "entryId"]) || !nonBlank(resolution.text) || !nonBlank(resolution.recordId) || !nonBlank(resolution.revision) || !nonBlank(resolution.locale) || !nonBlank(resolution.entryId) || !validCopyRef(resolution.ref) || !plain(resolution.source) || !closed(resolution.source, ["kind", "reference"]) || !["consumer", "generated", "imported"].includes(resolution.source.kind as string) || !nonBlank(resolution.source.reference)) {
      throw new Error(`resolutions.${index} must be complete CopyResolution provenance.`);
    }
  }
  const sectionIds = new Set<string>();
  let heroCount = 0;
  for (let index = 0; index < candidate.sections.length; index += 1) {
    const path = `sections.${index}`;
    const section = candidate.sections[index];
    if (!plain(section) || !closed(section, ["id", "kind", "ground", "eyebrow", "heading", "description", "items", "labels", "groups"])) throw new Error(`${path} must be a closed resolved section object.`);
    const record = section as Record<string, unknown>;
    if (!nonBlank(record.id) || !FRAGMENT_ID.test(record.id)) throw new Error(`${path}.id must be a unique fragment-safe id.`);
    if (sectionIds.has(record.id)) throw new Error(`${path}.id duplicates an earlier section.`);
    sectionIds.add(record.id);
    if (typeof record.kind !== "string" || !["hero", "feature-grid", "faq", "ordered-step-sequence", "status-list"].includes(record.kind)) throw new Error(`${path}.kind is not a supported SectionedView kind.`);
    if (record.kind === "hero") heroCount += 1;
    if (!GROUNDS.includes(record.ground as SectionedViewGround)) throw new Error(`${path}.ground is not a supported section ground.`);
    copyFields(record, path, ["heading"], record.kind === "hero" ? ["eyebrow", "description"] : ["description"]);
    if (record.kind === "hero") {
      if (!closed(record, ["id", "kind", "ground", "eyebrow", "heading", "description"])) throw new Error(`${path} has keys not allowed for a hero section.`);
      continue;
    }
    if (record.kind === "status-list") {
      if (!closed(record, ["id", "kind", "ground", "heading", "description", "labels", "groups"])) throw new Error(`${path} has keys not allowed for a status-list section.`);
      const labels = record.labels;
      if (!plain(labels) || !closed(labels, [...STATUSES, "dispositions"])) throw new Error(`${path}.labels must contain resolved labels for every status and disposition.`);
      const dispositions = labels.dispositions;
      if (STATUSES.some((status) => !nonBlank(labels[status])) || !plain(dispositions) || !closed(dispositions, DISPOSITIONS) || DISPOSITIONS.some((disposition) => !nonBlank(dispositions[disposition]))) throw new Error(`${path}.labels must contain resolved labels for every status and disposition.`);
      dense(record.groups, `${path}.groups`);
      closedItems(record.groups, `${path}.groups`, ["id", "heading", "items"]);
      itemIds(record.groups, `${path}.groups`);
      for (let groupIndex = 0; groupIndex < record.groups.length; groupIndex += 1) {
        const group = record.groups[groupIndex] as Record<string, unknown>;
        if (!nonBlank(group.heading)) throw new Error(`${path}.groups.${groupIndex}.heading must be resolved non-blank copy.`);
        dense(group.items, `${path}.groups.${groupIndex}.items`);
        closedItems(group.items, `${path}.groups.${groupIndex}.items`, ["id", "label", "state", "disposition"]);
        itemIds(group.items, `${path}.groups.${groupIndex}.items`);
        for (let itemIndex = 0; itemIndex < group.items.length; itemIndex += 1) {
          const item = group.items[itemIndex] as Record<string, unknown>;
          const hasState = Object.hasOwn(item, "state");
          const hasDisposition = Object.hasOwn(item, "disposition");
          if (!nonBlank(item.label) || hasState === hasDisposition || (hasState && !STATUSES.includes(item.state as SectionedViewStatus)) || (hasDisposition && !DISPOSITIONS.includes(item.disposition as SectionedViewStatusDisposition))) throw new Error(`${path}.groups.${groupIndex}.items.${itemIndex} is not a resolved status item or off-axis disposition.`);
        }
      }
      continue;
    }
    const sectionKeys = record.kind === "feature-grid"
      ? ["id", "kind", "ground", "heading", "description", "items"]
      : record.kind === "faq"
        ? ["id", "kind", "ground", "heading", "description", "items"]
        : ["id", "kind", "ground", "heading", "description", "items"];
    if (!closed(record, sectionKeys)) throw new Error(`${path} has keys not allowed for its section kind.`);
    dense(record.items, `${path}.items`);
    const itemKeys = record.kind === "faq" ? ["id", "question", "answer"] : record.kind === "ordered-step-sequence" ? ["id", "ordinal", "label", "heading", "description"] : ["id", "heading", "description"];
    closedItems(record.items, `${path}.items`, itemKeys);
    itemIds(record.items, `${path}.items`);
    for (let itemIndex = 0; itemIndex < record.items.length; itemIndex += 1) {
      const item = record.items[itemIndex] as Record<string, unknown>;
      const required = record.kind === "faq" ? ["question", "answer"] : record.kind === "ordered-step-sequence" ? ["ordinal", "heading"] : ["heading"];
      const optional = record.kind === "ordered-step-sequence" ? ["label", "description"] : ["description"];
      copyFields(item, `${path}.items.${itemIndex}`, required, optional);
    }
  }
  if ((candidate.sections[0] as { kind?: unknown }).kind !== "hero" || heroCount !== 1) throw new Error("sections must begin with exactly one hero for the fixed h1/h2/h3 outline.");
}

export function createSectionedView(blocks: SectionedViewBlockSet) {
  const { Hero, FeatureGrid, Faq, OrderedStepSequence, StatusList } = blocks;
  return function SectionedView({ document }: SectionedViewProps) {
    try {
      assertRenderableSectionedViewDocument(document);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown invalid resolved model";
      throw new RenderError("resolution-failed", `SectionedView refused an invalid resolved document: ${message}`);
    }
    return (
      <main aria-label={document.id} className="flex flex-col gap-2xl py-2xl">
        {document.sections.map((section, index) => renderSection(section, index, { Hero, FeatureGrid, Faq, OrderedStepSequence, StatusList }))}
      </main>
    );
  };
}

function renderSection(section: ResolvedSectionedViewSection, index: number, blocks: SectionedViewBlockSet): ReactNode {
  switch (section.kind) {
    case "hero": return <blocks.Hero key={section.id} id={section.id} eyebrow={section.eyebrow} heading={section.heading} description={section.description} headingLevel={index === 0 ? 1 : 2} ground={section.ground} />;
    case "feature-grid": return <blocks.FeatureGrid key={section.id} id={section.id} heading={section.heading} description={section.description} items={section.items} headingLevel={2} ground={section.ground} />;
    case "faq": return <blocks.Faq key={section.id} id={section.id} heading={section.heading} description={section.description} items={section.items} headingLevel={2} ground={section.ground} />;
    case "ordered-step-sequence": return <blocks.OrderedStepSequence key={section.id} id={section.id} heading={section.heading} description={section.description} items={section.items} headingLevel={2} ground={section.ground} />;
    case "status-list": return <blocks.StatusList key={section.id} id={section.id} heading={section.heading} description={section.description} labels={section.labels} groups={section.groups} legendLabel={section.heading} headingLevel={2} ground={section.ground} />;
  }
}
