import type { ReactNode } from "react";
import type { ResolvedSectionedViewDocument, ResolvedSectionedViewSection, SectionedViewGround, SectionedViewStatus } from "../../core/sectioned-view.js";
import { RenderError } from "../../internal/errors.js";

type HeadingLevel = 2 | 3 | 4 | 5 | 6;
type GroundProps = { id: string; heading: string; description?: string; headingLevel: HeadingLevel; ground: SectionedViewGround };

export interface SectionedViewBlockSet {
  Hero(props: { id: string; eyebrow?: string; heading: string; description?: string; headingLevel: 1 | 2; ground: SectionedViewGround }): ReactNode;
  FeatureGrid(props: GroundProps & { items: readonly { id: string; heading: string; description?: string }[] }): ReactNode;
  Faq(props: GroundProps & { items: readonly { id: string; question: string; answer: string }[] }): ReactNode;
  OrderedStepSequence(props: GroundProps & { items: readonly { id: string; ordinal: string; label?: string; heading: string; description?: string }[] }): ReactNode;
  StatusList(props: GroundProps & { labels: Readonly<Record<SectionedViewStatus, string>>; groups: readonly { id: string; heading: string; items: readonly { id: string; label: string; state: SectionedViewStatus }[] }[]; legendLabel: string }): ReactNode;
}

export interface SectionedViewProps {
  /** Copy has already resolved through resolveSectionedViewDocument; its resolutions remain the sole provenance evidence. */
  document: ResolvedSectionedViewDocument;
}

const GROUNDS: readonly SectionedViewGround[] = ["base", "sunken", "inverse"];
const STATUSES: readonly SectionedViewStatus[] = ["available", "partial", "planned"];
const FRAGMENT_ID = /^[a-z][a-z0-9-]*$/;

function nonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
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

function copyFields(section: Record<string, unknown>, path: string, fields: readonly string[]): void {
  for (const field of fields) {
    if (section[field] !== undefined && !nonBlank(section[field])) throw new Error(`${path}.${field} must be resolved non-blank copy.`);
  }
}

/** Validates the direct resolved-model boundary before any Designer block receives props. */
export function assertRenderableSectionedViewDocument(document: unknown): asserts document is ResolvedSectionedViewDocument {
  if (typeof document !== "object" || document === null || !nonBlank((document as { id?: unknown }).id)) throw new Error("document.id must be a non-blank string.");
  const candidate = document as { sections?: unknown; resolutions?: unknown };
  dense(candidate.sections, "sections");
  if (!Array.isArray(candidate.resolutions) || candidate.resolutions.length === 0) throw new Error("resolutions must be a non-empty array carrying CopyResolution provenance.");
  for (let index = 0; index < candidate.resolutions.length; index += 1) {
    if (!Object.hasOwn(candidate.resolutions, index)) throw new Error(`resolutions.${index} is a sparse provenance hole.`);
    const resolution = candidate.resolutions[index];
    if (typeof resolution !== "object" || resolution === null || !nonBlank((resolution as { text?: unknown }).text) || !nonBlank((resolution as { recordId?: unknown }).recordId) || !nonBlank((resolution as { revision?: unknown }).revision) || !nonBlank((resolution as { locale?: unknown }).locale) || !nonBlank((resolution as { entryId?: unknown }).entryId)) {
      throw new Error(`resolutions.${index} must be complete CopyResolution provenance.`);
    }
  }
  const sectionIds = new Set<string>();
  for (let index = 0; index < candidate.sections.length; index += 1) {
    const path = `sections.${index}`;
    const section = candidate.sections[index];
    if (typeof section !== "object" || section === null) throw new Error(`${path} must be a resolved section object.`);
    const record = section as Record<string, unknown>;
    if (!nonBlank(record.id) || !FRAGMENT_ID.test(record.id)) throw new Error(`${path}.id must be a unique fragment-safe id.`);
    if (sectionIds.has(record.id)) throw new Error(`${path}.id duplicates an earlier section.`);
    sectionIds.add(record.id);
    if (typeof record.kind !== "string" || !["hero", "feature-grid", "faq", "ordered-step-sequence", "status-list"].includes(record.kind)) throw new Error(`${path}.kind is not a supported SectionedView kind.`);
    if (!GROUNDS.includes(record.ground as SectionedViewGround)) throw new Error(`${path}.ground is not a supported section ground.`);
    copyFields(record, path, record.kind === "hero" ? ["heading", "eyebrow", "description"] : ["heading", "description"]);
    if (record.kind === "hero") continue;
    if (record.kind === "status-list") {
      const labels = record.labels;
      if (typeof labels !== "object" || labels === null || STATUSES.some((status) => !nonBlank((labels as Record<string, unknown>)[status]))) throw new Error(`${path}.labels must contain resolved labels for every status.`);
      dense(record.groups, `${path}.groups`);
      itemIds(record.groups, `${path}.groups`);
      for (let groupIndex = 0; groupIndex < record.groups.length; groupIndex += 1) {
        const group = record.groups[groupIndex] as Record<string, unknown>;
        if (!nonBlank(group.heading)) throw new Error(`${path}.groups.${groupIndex}.heading must be resolved non-blank copy.`);
        dense(group.items, `${path}.groups.${groupIndex}.items`);
        itemIds(group.items, `${path}.groups.${groupIndex}.items`);
        for (let itemIndex = 0; itemIndex < group.items.length; itemIndex += 1) {
          const item = group.items[itemIndex] as Record<string, unknown>;
          if (!nonBlank(item.label) || !STATUSES.includes(item.state as SectionedViewStatus)) throw new Error(`${path}.groups.${groupIndex}.items.${itemIndex} is not a resolved status item.`);
        }
      }
      continue;
    }
    dense(record.items, `${path}.items`);
    itemIds(record.items, `${path}.items`);
    for (let itemIndex = 0; itemIndex < record.items.length; itemIndex += 1) {
      const item = record.items[itemIndex] as Record<string, unknown>;
      const fields = record.kind === "faq" ? ["question", "answer"] : record.kind === "ordered-step-sequence" ? ["ordinal", "label", "heading", "description"] : ["heading", "description"];
      copyFields(item, `${path}.items.${itemIndex}`, fields);
      if (record.kind === "ordered-step-sequence" && !nonBlank(item.ordinal)) throw new Error(`${path}.items.${itemIndex}.ordinal must be resolved non-blank copy.`);
    }
  }
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
