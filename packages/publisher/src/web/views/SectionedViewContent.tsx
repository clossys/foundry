import type { ReactNode } from "react";
import type { ResolvedSectionedViewAction, ResolvedSectionedViewDocument, ResolvedSectionedViewSection, SectionedViewGround, SectionedViewStatus, SectionedViewStatusDisposition } from "../../core/sectioned-view.js";
import { RenderError } from "../../internal/errors.js";
import { isSanctionedHref } from "../../internal/href.js";

type HeadingLevel = 2 | 3 | 4 | 5 | 6;
type GroundProps = { id: string; eyebrow?: string; heading: string; description?: string; headingLevel: HeadingLevel; ground: SectionedViewGround };
type StatusListItemProps = { id: string; label: string; detail?: string; state: SectionedViewStatus; disposition?: never } | { id: string; label: string; detail?: string; disposition: SectionedViewStatusDisposition; state?: never };

export interface SectionedViewBlockSet {
  Hero(props: { id: string; eyebrow?: string; heading: string; description?: string; actions?: ReactNode; headingLevel: 1 | 2; ground: SectionedViewGround }): ReactNode;
  FeatureGrid(props: GroundProps & { items: readonly { id: string; heading: string; description?: string }[] }): ReactNode;
  Faq(props: GroundProps & { items: readonly { id: string; question: string; answer: string }[] }): ReactNode;
  OrderedStepSequence(props: GroundProps & { items: readonly { id: string; ordinal: string; label?: string; heading: string; description?: string }[] }): ReactNode;
  /** `groups` and `items` are each optional; the resolved document guarantees exactly one is present. */
  StatusList(props: GroundProps & { labels: Readonly<Record<SectionedViewStatus, string>> & { dispositions: Readonly<Record<SectionedViewStatusDisposition, string>> }; groups?: readonly { id: string; heading: string; items: readonly StatusListItemProps[] }[]; items?: readonly StatusListItemProps[]; legendLabel: string }): ReactNode;
}

/** Whether this view owns the page's `main` landmark or renders inside one the page already owns. */
export type SectionedViewLandmark = "main" | "none";

export interface SectionedViewProps {
  /** Copy has already resolved through resolveSectionedViewDocument; its resolutions remain the sole provenance evidence. */
  document: ResolvedSectionedViewDocument;
  /**
   * `"main"`, the default, renders the section stack inside this view's own
   * `main` landmark: unchanged behaviour, and the right choice when the whole
   * page is this document.
   *
   * `"none"` renders the same sections in a plain grouping element with no
   * landmark role and no accessible name, for a page that mounts the subset
   * this contract can express and renders the rest beside it. Without it, a
   * partial mount has to choose between a second `main` landmark and leaving
   * real content outside the only one, which is why incremental adoption was
   * blocked. Choosing it makes the surrounding page responsible for supplying
   * exactly one `main` landmark that contains this output.
   * @default "main"
   */
  landmark?: SectionedViewLandmark;
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

/** Hero actions arrive resolved: a dense array of closed id/label/href triples whose hrefs already passed the document contract's own rule. */
function assertActions(value: unknown, path: string): void {
  if (value === undefined) return;
  dense(value, path);
  closedItems(value, path, ["id", "label", "href"]);
  itemIds(value, path);
  for (let index = 0; index < value.length; index += 1) {
    const action = value[index] as Record<string, unknown>;
    if (!nonBlank(action.label)) throw new Error(`${path}.${index}.label must be resolved non-blank copy.`);
    if (!isSanctionedHref(action.href)) throw new Error(`${path}.${index}.href must be a sanctioned route target.`);
  }
}

/** Resolved status items, shared between a group's `items` and a status-list section's flat `items`. */
function assertStatusItems(value: unknown, path: string): void {
  dense(value, path);
  closedItems(value, path, ["id", "label", "detail", "state", "disposition"]);
  itemIds(value, path);
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index] as Record<string, unknown>;
    const hasState = Object.hasOwn(item, "state");
    const hasDisposition = Object.hasOwn(item, "disposition");
    if (!nonBlank(item.label) || (item.detail !== undefined && !nonBlank(item.detail)) || hasState === hasDisposition || (hasState && !STATUSES.includes(item.state as SectionedViewStatus)) || (hasDisposition && !DISPOSITIONS.includes(item.disposition as SectionedViewStatusDisposition))) throw new Error(`${path}.${index} is not a resolved status item or off-axis disposition.`);
  }
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
    if (!plain(section) || !closed(section, ["id", "kind", "ground", "eyebrow", "heading", "description", "actions", "items", "labels", "groups"])) throw new Error(`${path} must be a closed resolved section object.`);
    const record = section as Record<string, unknown>;
    if (!nonBlank(record.id) || !FRAGMENT_ID.test(record.id)) throw new Error(`${path}.id must be a unique fragment-safe id.`);
    if (sectionIds.has(record.id)) throw new Error(`${path}.id duplicates an earlier section.`);
    sectionIds.add(record.id);
    if (typeof record.kind !== "string" || !["hero", "feature-grid", "faq", "ordered-step-sequence", "status-list"].includes(record.kind)) throw new Error(`${path}.kind is not a supported SectionedView kind.`);
    if (record.kind === "hero") heroCount += 1;
    if (!GROUNDS.includes(record.ground as SectionedViewGround)) throw new Error(`${path}.ground is not a supported section ground.`);
    copyFields(record, path, ["heading"], ["eyebrow", "description"]);
    if (record.kind === "hero") {
      if (!closed(record, ["id", "kind", "ground", "eyebrow", "heading", "description", "actions"])) throw new Error(`${path} has keys not allowed for a hero section.`);
      assertActions(record.actions, `${path}.actions`);
      continue;
    }
    if (record.kind === "status-list") {
      if (!closed(record, ["id", "kind", "ground", "eyebrow", "heading", "description", "labels", "groups", "items"])) throw new Error(`${path} has keys not allowed for a status-list section.`);
      const labels = record.labels;
      if (!plain(labels) || !closed(labels, [...STATUSES, "dispositions"])) throw new Error(`${path}.labels must contain resolved labels for every status and disposition.`);
      const dispositions = labels.dispositions;
      if (STATUSES.some((status) => !nonBlank(labels[status])) || !plain(dispositions) || !closed(dispositions, DISPOSITIONS) || DISPOSITIONS.some((disposition) => !nonBlank(dispositions[disposition]))) throw new Error(`${path}.labels must contain resolved labels for every status and disposition.`);
      const hasGroups = Object.hasOwn(record, "groups");
      const hasItems = Object.hasOwn(record, "items");
      if (hasGroups === hasItems) throw new Error(`${path} must have exactly one of groups or items.`);
      if (hasItems) {
        assertStatusItems(record.items, `${path}.items`);
        continue;
      }
      dense(record.groups, `${path}.groups`);
      closedItems(record.groups, `${path}.groups`, ["id", "heading", "items"]);
      itemIds(record.groups, `${path}.groups`);
      for (let groupIndex = 0; groupIndex < record.groups.length; groupIndex += 1) {
        const group = record.groups[groupIndex] as Record<string, unknown>;
        if (!nonBlank(group.heading)) throw new Error(`${path}.groups.${groupIndex}.heading must be resolved non-blank copy.`);
        assertStatusItems(group.items, `${path}.groups.${groupIndex}.items`);
      }
      continue;
    }
    const sectionKeys = ["id", "kind", "ground", "eyebrow", "heading", "description", "items"];
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
  if (heroCount > 1) throw new Error("sections must contain at most one hero section.");
}

const SECTION_STACK = "flex flex-col gap-2xl py-2xl";
const LANDMARKS: readonly SectionedViewLandmark[] = ["main", "none"];

export function createSectionedView(blocks: SectionedViewBlockSet) {
  const { Hero, FeatureGrid, Faq, OrderedStepSequence, StatusList } = blocks;
  return function SectionedView({ document, landmark = "main" }: SectionedViewProps) {
    try {
      assertRenderableSectionedViewDocument(document);
      if (!LANDMARKS.includes(landmark)) throw new Error(`landmark must be one of ${LANDMARKS.join(", ")}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown invalid resolved model";
      throw new RenderError("resolution-failed", `SectionedView refused an invalid resolved document: ${message}`);
    }
    const sections = document.sections.map((section, index) => renderSection(section, index, { Hero, FeatureGrid, Faq, OrderedStepSequence, StatusList }));
    // No landmark role and no aria-label here: an accessible name on a plain
    // grouping element is not exposed, and the page that opted out of this
    // view's landmark owns the one that contains these sections.
    if (landmark === "none") return <div className={SECTION_STACK}>{sections}</div>;
    return (
      <main aria-label={document.id} className={SECTION_STACK}>
        {sections}
      </main>
    );
  };
}

/**
 * Ink for a document-declared hero action, by the ground the hero sits on.
 * Base and sunken take the checked link ink; the inverse ground has no
 * checked link token, so an action there takes the same on-inverse ink the
 * rest of that section uses. The underline, not the colour, is what marks
 * these as links on every ground.
 */
const ACTION_INK: Record<SectionedViewGround, string> = {
  base: "text-ink-link",
  sunken: "text-ink-link",
  inverse: "text-ink-on-inverse",
};

function renderActions(actions: readonly ResolvedSectionedViewAction[] | undefined, ground: SectionedViewGround): ReactNode {
  if (actions === undefined) return undefined;
  return actions.map((action) => (
    <a key={action.id} href={action.href} className={`text-body font-body underline ${ACTION_INK[ground]}`}>
      {action.label}
    </a>
  ));
}

function renderSection(section: ResolvedSectionedViewSection, index: number, blocks: SectionedViewBlockSet): ReactNode {
  switch (section.kind) {
    case "hero": return <blocks.Hero key={section.id} id={section.id} eyebrow={section.eyebrow} heading={section.heading} description={section.description} actions={renderActions(section.actions, section.ground)} headingLevel={index === 0 ? 1 : 2} ground={section.ground} />;
    case "feature-grid": return <blocks.FeatureGrid key={section.id} id={section.id} eyebrow={section.eyebrow} heading={section.heading} description={section.description} items={section.items} headingLevel={2} ground={section.ground} />;
    case "faq": return <blocks.Faq key={section.id} id={section.id} eyebrow={section.eyebrow} heading={section.heading} description={section.description} items={section.items} headingLevel={2} ground={section.ground} />;
    case "ordered-step-sequence": return <blocks.OrderedStepSequence key={section.id} id={section.id} eyebrow={section.eyebrow} heading={section.heading} description={section.description} items={section.items} headingLevel={2} ground={section.ground} />;
    case "status-list": return <blocks.StatusList key={section.id} id={section.id} eyebrow={section.eyebrow} heading={section.heading} description={section.description} labels={section.labels} groups={section.groups} items={section.items} legendLabel={section.heading} headingLevel={2} ground={section.ground} />;
  }
}
