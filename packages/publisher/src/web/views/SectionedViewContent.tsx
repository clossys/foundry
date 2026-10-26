import { applyContentGrounds, planContentGrounds } from "../../core/content-ground.js";
import { projectStatusListItems } from "../../core/status-list-catalog.js";
import { assertClosedData, assertCanonicalContentSection } from "./SectionedViewCanonical.js";
import { resolveActionEmphasis } from "../../core/page-flow.js";
import { desugarRecipe, SECTIONED_VIEW_CONTENT_CONTRACT } from "../../core/content-contract.js";
import { resolveRoleActionEmphasis } from "../../core/sectioned-view.js";
import { renderAction, renderRoleActions } from "./SectionedViewActions.js";
import { SectionHeader, SECTION_GROUND_CLASSES } from "@clossys/designer/blocks/server";
import type { ReactNode } from "react";
import type { ResolvedSectionedViewAction, ResolvedSectionedViewContentAction, ResolvedSectionedViewContentSection, ResolvedSectionedViewDocument, ResolvedSectionedViewHeroMedia, ResolvedSectionedViewSection, SectionedViewGround, SectionedViewStatTrend, SectionedViewStatus, SectionedViewStatusDisposition } from "../../core/sectioned-view.js";
import { isRenderAsset } from "../../internal/assets.js";
import { RenderError } from "../../internal/errors.js";
import { isSanctionedHref } from "../../internal/href.js";
import type { AssetResolver } from "../types.js";
import { buildAssetElement } from "../buildAssetElement.js";
import type { ContentSectionBlockProps } from "./SectionedViewContentSection.js";

type HeadingLevel = 2 | 3 | 4 | 5 | 6;
type GroundProps = { id: string; eyebrow?: string; heading: string; description?: string; headingLevel: HeadingLevel; ground: SectionedViewGround };
type StatusListItemProps = { id: string; label: string; detail?: string; state: SectionedViewStatus; disposition?: never } | { id: string; label: string; detail?: string; disposition: SectionedViewStatusDisposition; state?: never };

export interface SectionedViewBlockSet {
  Hero(props: { id: string; eyebrow?: string; eyebrowTone?: "accent" | "muted"; measure?: "prose" | "wide"; headingScale?: "default" | "display"; heading: string; description?: string; actions?: ReactNode; media?: ReactNode; composition?: "editorial" | "split"; size?: "default" | "compact"; headingLevel: 1 | 2; ground: SectionedViewGround }): ReactNode;
  FeatureGrid(props: GroundProps & { items: readonly { id: string; heading: string; description?: string }[] }): ReactNode;
  OrderedStepSequence(props: GroundProps & { items: readonly { id: string; ordinal: string; label?: string; heading: string; description?: string }[] }): ReactNode;
  /** `groups` and `items` are each optional; the resolved document guarantees exactly one is present. */
  StatusList(props: GroundProps & { labels: Readonly<Record<SectionedViewStatus, string>> & { dispositions: Readonly<Record<SectionedViewStatusDisposition, string>> }; groups?: readonly { id: string; heading: string; items: readonly StatusListItemProps[] }[]; items?: readonly StatusListItemProps[]; legendLabel: string }): ReactNode;
  Stat(props: { id: string; label: string; value: string; delta?: string; trend?: SectionedViewStatTrend; description?: string }): ReactNode;
  PricingTable(props: {
    id: string;
    eyebrow?: string;
    heading: string;
    description?: string;
    items: readonly { id: string; name: string; price: string; description?: string; features: readonly string[]; cta?: string }[];
    headingLevel: HeadingLevel;
    ground: SectionedViewGround;
  }): ReactNode;
  Testimonial(props: { quote: string; attributorName: string; attributorRole?: string }): ReactNode;
  /** One `content-section` band; the section arrives validated by `assertRenderableSectionedViewDocument`. */
  ContentSection(props: ContentSectionBlockProps): ReactNode;
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
  /**
   * Resolves hero and canonical content `media.assetId` into a paintable asset — the same seam
   * `renderWebDocument` uses for `heroMedia`. Required whenever the
   * resolved document carries asset media; unresolved ids fail closed at
   * render time and name the authored path.
   */
  resolveAssetId?: AssetResolver;
  /** When `true`, applies each video asset's `reducedMotion` policy — see `renderWebDocument`. */
  prefersReducedMotion?: boolean;
}

const GROUNDS: readonly SectionedViewGround[] = ["base", "sunken", "inverse"];
const STATUSES: readonly SectionedViewStatus[] = ["available", "partial", "planned"];
const DISPOSITIONS: readonly SectionedViewStatusDisposition[] = ["not-offered"];
const STAT_TRENDS: readonly SectionedViewStatTrend[] = ["up", "down", "neutral"];
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

function validResolutionApproval(value: unknown): boolean {
  if (value === undefined) return true;
  if (!plain(value)) return false;
  if (value.approvedBy === "owner") return closed(value, ["approvedBy", "pendingOwnerReview"]) && value.pendingOwnerReview === false;
  return value.approvedBy === "delegate" && closed(value, ["approvedBy", "pendingOwnerReview", "authorizingPlanDigest"]) && typeof value.pendingOwnerReview === "boolean" && (value.authorizingPlanDigest === undefined || typeof value.authorizingPlanDigest === "string");
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
function assertHeroMedia(value: unknown, path: string): void {
  if (value === undefined) return;
  if (!plain(value) || !closed(value, ["assetId", "alt"]) || !nonBlank(value.assetId) || !nonBlank(value.alt)) {
    throw new Error(`${path} must be a closed resolved hero media object with a non-blank assetId and alt.`);
  }
}

function assertStringArray(value: unknown, path: string): void {
  if (!Array.isArray(value)) throw new Error(`${path} must be a resolved string array.`);
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) throw new Error(`${path}.${index} is a sparse array hole.`);
    if (!nonBlank(value[index])) throw new Error(`${path}.${index} must be resolved non-blank copy.`);
  }
}

function assertPricingItems(value: unknown, path: string): void {
  dense(value, path);
  closedItems(value, path, ["id", "name", "price", "description", "features", "cta"]);
  itemIds(value, path);
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index] as Record<string, unknown>;
    if (!nonBlank(item.name) || !nonBlank(item.price) || (item.description !== undefined && !nonBlank(item.description)) || (item.cta !== undefined && !nonBlank(item.cta))) {
      throw new Error(`${path}.${index} must carry resolved non-blank name and price copy.`);
    }
    assertStringArray(item.features, `${path}.${index}.features`);
  }
}

function assertTestimonialItems(value: unknown, path: string): void {
  dense(value, path);
  closedItems(value, path, ["id", "quote", "attributorName", "attributorRole"]);
  itemIds(value, path);
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index] as Record<string, unknown>;
    if (!nonBlank(item.quote) || !nonBlank(item.attributorName) || (item.attributorRole !== undefined && !nonBlank(item.attributorRole))) {
      throw new Error(`${path}.${index} must carry resolved non-blank quote and attributorName copy.`);
    }
  }
}

function assertStatSectionItems(value: unknown, path: string): void {
  dense(value, path);
  closedItems(value, path, ["id", "label", "value", "delta"]);
  itemIds(value, path);
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index] as Record<string, unknown>;
    if (!nonBlank(item.label) || !nonBlank(item.value) || (item.delta !== undefined && !nonBlank(item.delta))) {
      throw new Error(`${path}.${index} must carry resolved non-blank label and value copy.`);
    }
  }
}

function assertStatItems(value: unknown, path: string): void {
  dense(value, path);
  closedItems(value, path, ["id", "label", "value", "delta", "description", "trend"]);
  itemIds(value, path);
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index] as Record<string, unknown>;
    if (!nonBlank(item.label) || !nonBlank(item.value) || (item.delta !== undefined && !nonBlank(item.delta)) || (item.description !== undefined && !nonBlank(item.description))) {
      throw new Error(`${path}.${index} must carry resolved non-blank label and value copy.`);
    }
    const hasTrend = Object.hasOwn(item, "trend");
    const hasDelta = Object.hasOwn(item, "delta");
    if (hasTrend && !STAT_TRENDS.includes(item.trend as SectionedViewStatTrend)) throw new Error(`${path}.${index}.trend is not a supported stat trend.`);
    if (hasTrend && !hasDelta) throw new Error(`${path}.${index}.trend requires ${path}.${index}.delta.`);
  }
}

function assertActions(value: unknown, path: string, content = false): void {
  if (value === undefined) return;
  dense(value, path);
  closedItems(value, path, ["id", "label", "href", "emphasis"]);
  itemIds(value, path);
  for (let index = 0; index < value.length; index += 1) {
    const action = value[index] as Record<string, unknown>;
    if (!nonBlank(action.label)) throw new Error(`${path}.${index}.label must be resolved non-blank copy.`);
    if (!isSanctionedHref(action.href)) throw new Error(`${path}.${index}.href must be a sanctioned route target.`);
  }
  value.forEach((action, index) => oneOf((action as Record<string, unknown>).emphasis, content ? ["primary", "secondary", "tertiary", "quiet"] : ["primary", "secondary", "quiet"], `${path}.${index}.emphasis`, "action emphasis"));
  if (value.length > 2) throw new Error(`${path} holds ${value.length} actions; a ${content ? "content section" : "hero section"} holds at most 2.`);
  const primaries = value.filter((action, index) => content ? (action as Record<string, unknown>).emphasis === "primary" : resolveRoleActionEmphasis((action as ResolvedSectionedViewAction).emphasis, index) === "primary").length;
  if (primaries > 1) throw new Error(`${path} holds more than one ${content ? "primary" : "effective primary"} action.`);
  if (!content && value.length === 1 && primaries !== 1) throw new Error(`${path}'s lone action must be primary.`);
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

function oneOf(value: unknown, allowed: readonly unknown[], path: string, what: string): void {
  if (value !== undefined && !allowed.includes(value)) throw new Error(`${path} is not a supported ${what}; supported values are ${allowed.join(", ")}.`);
}

function assertContentSection(record: Record<string, unknown>, path: string): void {
  assertCanonicalContentSection(record, path);
}

/** Validates the direct resolved-model boundary before any Designer block receives props. */
export function assertRenderableSectionedViewDocument(document: unknown): asserts document is ResolvedSectionedViewDocument {
  assertClosedData(document, "document");
  if (!plain(document) || !closed(document, ["id", "sections", "resolutions", "viewGrounds"]) || !Object.hasOwn(document, "id") || !Object.hasOwn(document, "sections") || !Object.hasOwn(document, "resolutions") || !nonBlank(document.id)) throw new Error("document must be a closed object with a non-blank id, sections, and resolutions.");
  const candidate = document as { sections?: unknown; resolutions?: unknown };
  dense(candidate.sections, "sections");
  if (!Array.isArray(candidate.resolutions) || candidate.resolutions.length === 0) throw new Error("resolutions must be a non-empty array carrying CopyResolution provenance.");
  for (let index = 0; index < candidate.resolutions.length; index += 1) {
    if (!Object.hasOwn(candidate.resolutions, index)) throw new Error(`resolutions.${index} is a sparse provenance hole.`);
    const resolution = candidate.resolutions[index];
    if (!plain(resolution) || !closed(resolution, ["ref", "text", "recordId", "revision", "locale", "source", "entryId", "approval"]) || !nonBlank(resolution.text) || !nonBlank(resolution.recordId) || !nonBlank(resolution.revision) || !nonBlank(resolution.locale) || !nonBlank(resolution.entryId) || !validCopyRef(resolution.ref) || !validResolutionApproval(resolution.approval) || !plain(resolution.source) || !closed(resolution.source, ["kind", "reference"]) || !["consumer", "generated", "imported"].includes(resolution.source.kind as string) || !nonBlank(resolution.source.reference)) {
      throw new Error(`resolutions.${index} must be complete CopyResolution provenance.`);
    }
  }
  const sectionIds = new Set<string>();
  let heroCount = 0;
  for (let index = 0; index < candidate.sections.length; index += 1) {
    const path = `sections.${index}`;
    const section = candidate.sections[index];
    if (!plain(section) || !closed(section, ["id", "kind", "ground", "eyebrow", "eyebrowTone", "measure", "headingScale", "heading", "description", "actions", "media", "items", "labels", "groups", "layout", "mediaSide", "align", "block", "footnote", "size"])) throw new Error(`${path} must be a closed resolved section object.`);
    const record = section as Record<string, unknown>;
    if (!nonBlank(record.id) || !FRAGMENT_ID.test(record.id)) throw new Error(`${path}.id must be a unique fragment-safe id.`);
    if (sectionIds.has(record.id)) throw new Error(`${path}.id duplicates an earlier section.`);
    sectionIds.add(record.id);
    if (
      typeof record.kind !== "string"
      || !["hero", "feature-grid", "faq", "ordered-step-sequence", "status-list", "stat-grid", "pricing", "testimonial", "stat", "content-section"].includes(record.kind)
    ) throw new Error(`${path}.kind is not a supported SectionedView kind.`);
    if (record.kind === "hero") heroCount += 1;
    if (!GROUNDS.includes(record.ground as SectionedViewGround)) throw new Error(`${path}.ground is not a supported section ground.`);
    if (record.kind === "testimonial" || record.kind === "stat") {
      copyFields(record, path, [], ["heading"]);
    } else {
      copyFields(record, path, ["heading"], ["eyebrow", "description"]);
    }
    if (record.kind === "hero") {
      if (!closed(record, ["id", "kind", "ground", "eyebrow", "eyebrowTone", "measure", "headingScale", "heading", "description", "actions", "media", "size"])) throw new Error(`${path} has keys not allowed for a hero section.`);
      assertActions(record.actions, `${path}.actions`);
      if (record.size !== undefined && !["compact", "display"].includes(record.size as string)) throw new Error(`${path}.size must be compact or display.`);
      if (record.eyebrowTone !== undefined && !["accent", "muted"].includes(record.eyebrowTone as string)) throw new Error(`${path}.eyebrowTone must be accent or muted.`);
      if (record.measure !== undefined && !["prose", "wide"].includes(record.measure as string)) throw new Error(`${path}.measure must be prose or wide.`);
      if (record.headingScale !== undefined && !["default", "display"].includes(record.headingScale as string)) throw new Error(`${path}.headingScale must be default or display.`);
      if (record.size === "compact" && record.media !== undefined) throw new Error(`${path} cannot combine a compact hero with media.`);
      assertHeroMedia(record.media, `${path}.media`);
      continue;
    }
    if (record.kind === "content-section") {
      assertContentSection(record, path);
      continue;
    }
    if (record.kind === "stat-grid") {
      if (!closed(record, ["id", "kind", "ground", "eyebrow", "heading", "description", "items"])) throw new Error(`${path} has keys not allowed for a stat-grid section.`);
      assertStatItems(record.items, `${path}.items`);
      continue;
    }
    if (record.kind === "pricing") {
      if (!closed(record, ["id", "kind", "ground", "eyebrow", "heading", "description", "items"])) throw new Error(`${path} has keys not allowed for a pricing section.`);
      assertPricingItems(record.items, `${path}.items`);
      continue;
    }
    if (record.kind === "testimonial") {
      if (!closed(record, ["id", "kind", "ground", "heading", "items"])) throw new Error(`${path} has keys not allowed for a testimonial section.`);
      assertTestimonialItems(record.items, `${path}.items`);
      continue;
    }
    if (record.kind === "stat") {
      if (!closed(record, ["id", "kind", "ground", "heading", "items"])) throw new Error(`${path} has keys not allowed for a stat section.`);
      assertStatSectionItems(record.items, `${path}.items`);
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
        statusListSection(record as unknown as Extract<ResolvedSectionedViewSection, { kind: "status-list" }>, path);
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
      statusListSection(record as unknown as Extract<ResolvedSectionedViewSection, { kind: "status-list" }>, path);
      continue;
    }
    const sectionKeys = record.kind === "faq" ? ["id", "kind", "ground", "eyebrow", "heading", "description", "layout", "items"] : ["id", "kind", "ground", "eyebrow", "heading", "description", "items"];
    if (!closed(record, sectionKeys)) throw new Error(`${path} has keys not allowed for its section kind.`);
    if (record.kind === "faq") oneOf(record.layout, ["stacked", "split"], `${path}.layout`, "faq layout");
    dense(record.items, `${path}.items`);
    if (record.kind === "faq") {
      const [min, max] = SECTIONED_VIEW_CONTENT_CONTRACT.counts.disclose;
      if (record.items.length < min || record.items.length > max) throw new Error(`${path}.items must hold ${min}-${max} FAQ rows.`);
    }
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
  if (Object.hasOwn(document, "viewGrounds")) {
    const viewGrounds = (document as { viewGrounds?: unknown }).viewGrounds;
    if (!Array.isArray(viewGrounds)) throw new Error("viewGrounds must be an array of section ids.");
    const seen = new Set<string>();
    for (let index = 0; index < viewGrounds.length; index += 1) {
      const id: unknown = Object.hasOwn(viewGrounds, index) ? viewGrounds[index] : undefined;
      if (!nonBlank(id) || !sectionIds.has(id) || seen.has(id)) throw new Error(`viewGrounds.${index} must name a section of this document once.`);
      seen.add(id);
    }
  }
}

const SECTION_STACK = "flex flex-col gap-2xl py-2xl";
const LANDMARKS: readonly SectionedViewLandmark[] = ["main", "none"];

/** One validated section and the node its block rendered. */
export interface RenderedSectionedViewSection {
  readonly section: ResolvedSectionedViewSection;
  readonly node: ReactNode;
}

/**
 * Validate a resolved document and render each of its sections through
 * `blocks`, without a page wrapper or landmark. Package-internal: views
 * that lay sections out themselves (`LandingView`) share the exact boundary
 * and block mapping `SectionedView` uses. A hero renders as `h1` only at
 * index 0, as in `SectionedView`; a view can pin the level in its own blocks.
 */
export function renderSectionedViewSections(document: unknown, blocks: SectionedViewBlockSet, options: SectionedViewRenderOptions, viewName = "SectionedView"): RenderedSectionedViewSection[] {
  try {
    assertRenderableSectionedViewDocument(document);
    return document.sections.map((section, index) => ({ section, node: renderSection(section, index, blocks, options) }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown invalid resolved model";
    throw new RenderError("resolution-failed", `${viewName} refused an invalid resolved document: ${message}`);
  }
}

export function createSectionedView(blocks: SectionedViewBlockSet) {
  const { Hero, FeatureGrid, OrderedStepSequence, StatusList, Stat, PricingTable, Testimonial, ContentSection } = blocks;
  return function SectionedView({ document, landmark = "main", resolveAssetId, prefersReducedMotion }: SectionedViewProps) {
    try {
      assertRenderableSectionedViewDocument(document);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown invalid resolved model";
      throw new RenderError("resolution-failed", `SectionedView refused an invalid resolved document: ${message}`);
    }
    const [planned] = applyContentGrounds(planContentGrounds([document]), [document]);
    const sections = renderSectionedViewSections(planned!, { Hero, FeatureGrid, OrderedStepSequence, StatusList, Stat, PricingTable, Testimonial, ContentSection },{ resolveAssetId, prefersReducedMotion }).map(({ node }) => node);
    if (!LANDMARKS.includes(landmark)) {
      throw new RenderError("resolution-failed", `SectionedView refused an invalid resolved document: landmark must be one of ${LANDMARKS.join(", ")}.`);
    }
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

/** How a hero's document-declared actions render: underlined text links, or the LandingView emphasis ladder. */
export type SectionedViewHeroActions = "link" | "button";

/**
 * A text-link action keeps its underlined body type but takes the shared
 * 44px tap target (`--ui-layout-tap-target`), centred, so it is a full
 * touch target on a phone without looking like a button.
 */
const TEXT_LINK_ACTION_STYLE = { minHeight: "var(--ui-layout-tap-target, 44px)" } as const;

/**
 * A content section's actions use the shared weight resolver and
 * ground-aware ladder. Explicit emphasis is rendered as authored.
 */
function renderContentActions(section: ResolvedSectionedViewContentSection): ReactNode {
  return section.actions?.map((action, index) => renderAction(action, resolveActionEmphasis(section, index), section.ground, "md"));
}

function renderActions(actions: readonly ResolvedSectionedViewAction[] | undefined, ground: SectionedViewGround, look: SectionedViewHeroActions, centered = false, size: "md" | "lg"): ReactNode {
  if (look === "button") return renderRoleActions(actions, ground, centered, size);
  return actions?.map((action) => <a key={action.id} href={action.href} className={`inline-flex items-center text-body font-body underline ${ACTION_INK[ground]}`} style={TEXT_LINK_ACTION_STYLE}>{action.label}</a>);
}

export interface SectionedViewRenderOptions {
  resolveAssetId?: AssetResolver;
  prefersReducedMotion?: boolean;
  /**
   * How hero actions render. `"link"` (the SectionedView default) keeps
   * underlined text links; `"button"` uses the LandingView emphasis ladder
   * and a responsive action row shared with the closing band.
   * @default "link"
   */
  heroActions?: SectionedViewHeroActions;
  /** Alignment of the LandingView-owned responsive hero action row. */
  heroActionsCentered?: boolean;
}

function resolveHeroMedia(media: ResolvedSectionedViewHeroMedia | undefined, path: string, options: SectionedViewRenderOptions): ReactNode {
  if (media === undefined) return undefined;
  if (typeof options.resolveAssetId !== "function") {
    throw new Error(`${path}.assetId could not be resolved (options.resolveAssetId is missing).`);
  }
  let looked: unknown;
  try {
    looked = options.resolveAssetId(media.assetId);
  } catch {
    throw new Error(`${path}.assetId could not be resolved.`);
  }
  if (!isRenderAsset(looked)) {
    throw new Error(`${path}.assetId did not resolve to a paintable asset.`);
  }
  return buildAssetElement(looked, { prefersReducedMotion: options.prefersReducedMotion, altOverride: media.alt });
}

function renderStatGrid(section: Extract<ResolvedSectionedViewSection, { kind: "stat-grid" }>, blocks: SectionedViewBlockSet): ReactNode {
  const colors = STAT_GRID_GROUND[section.ground];
  const hasHeadingRegion = section.eyebrow !== undefined || section.heading !== undefined || section.description !== undefined;
  return (
    <div key={section.id} id={section.id} className={`flex flex-col gap-lg ${colors.surface}`}>
      {hasHeadingRegion ? (
        <SectionHeader density="standard" level={2} ground={section.ground}
          eyebrow={section.eyebrow} title={section.heading} description={section.description} />
      ) : null}
      <div className="grid grid-cols-1 gap-lg tablet:grid-cols-2 desktop:grid-cols-4">
        {section.items.map((item) => (
          <blocks.Stat key={item.id} id={item.id} label={item.label} value={item.value} delta={item.delta} trend={item.trend} description={item.description} />
        ))}
      </div>
    </div>
  );
}

/** Ground ink/surface classes for the stat-grid section chrome — mirrors Designer `SECTION_GROUND_CLASSES` without importing it here. */
const STAT_GRID_GROUND: Record<SectionedViewGround, { surface: string; primary: string; secondary: string; muted: string }> = {
  base: { surface: "", primary: "text-ink-primary", secondary: "text-ink-secondary", muted: "text-ink-muted" },
  sunken: { surface: "bg-surface-sunken", primary: "text-ink-primary", secondary: "text-ink-secondary", muted: "text-ink-muted" },
  inverse: { surface: "bg-surface-inverse", primary: "text-ink-on-inverse", secondary: "text-ink-on-inverse-muted", muted: "text-ink-on-inverse-muted" },
};

/** Adapt the published question/answer shape to the canonical Index FAQ recipe. */
function faqSection(section: Extract<ResolvedSectionedViewSection, { kind: "faq" }>): ResolvedSectionedViewContentSection {
  const { arrangement, columns, order, reveal, treatment, scale } = desugarRecipe({ type: "items", recipe: "faq", items: [] });
  return {
    id: section.id,
    kind: "content-section",
    ground: section.ground,
    ...(section.eyebrow === undefined ? {} : { eyebrow: section.eyebrow }),
    heading: section.heading,
    ...(section.description === undefined ? {} : { description: section.description }),
    size: "standard",
    layout: section.layout === "split" ? "split-end" : "stacked",
    block: { type: "items", recipe: "faq", arrangement, columns, order, reveal, treatment, scale, items: section.items.map(item => ({ id: item.id, heading: item.question, description: item.answer })) },
  };
}

/** Keep original status data and resolutions intact; only render its validated catalog projection. */
function statusListSection(section: Extract<ResolvedSectionedViewSection, { kind: "status-list" }>, path: string): ResolvedSectionedViewContentSection {
  const projected: ResolvedSectionedViewContentSection = {
    id: section.id,
    kind: "content-section",
    ground: section.ground,
    ...(section.eyebrow === undefined ? {} : { eyebrow: section.eyebrow }),
    heading: section.heading,
    ...(section.description === undefined ? {} : { description: section.description }),
    size: "standard",
    layout: "stacked",
    block: projectStatusListItems(section),
  };
  assertCanonicalContentSection(projected as unknown as Record<string, unknown>, path);
  return projected;
}

function renderSection(section: ResolvedSectionedViewSection, index: number, blocks: SectionedViewBlockSet, options: SectionedViewRenderOptions): ReactNode {
  const mediaPath = `sections.${index}.media`;
  switch (section.kind) {
    case "hero": {
      const heroMedia = resolveHeroMedia(section.media, mediaPath, options);
      return (
        <blocks.Hero
          key={section.id}
          id={section.id}
          eyebrow={section.eyebrow}
          eyebrowTone={section.eyebrowTone}
          measure={section.measure}
          headingScale={section.headingScale}
          heading={section.heading}
          description={section.description}
          actions={renderActions(section.actions, section.ground, options.heroActions ?? "link", options.heroActionsCentered, section.size === "compact" ? "md" : "lg")}
          media={heroMedia}
          {...(section.size === "compact" ? { size: "compact" as const } : {})}
          {...(heroMedia ? { composition: "split" as const } : {})}
          headingLevel={index === 0 ? 1 : 2}
          ground={section.ground}
        />
      );
    }
    case "feature-grid": return <blocks.FeatureGrid key={section.id} id={section.id} eyebrow={section.eyebrow} heading={section.heading} description={section.description} items={section.items} headingLevel={2} ground={section.ground} />;
    case "faq":
      // LandingView consumes publishedKind for band anchors; the canonical adapter ignores it.
      return <blocks.ContentSection key={section.id} section={faqSection(section)} publishedKind="faq" className={SECTION_GROUND_CLASSES[section.ground].surface || undefined} />;
    case "ordered-step-sequence": return <blocks.OrderedStepSequence key={section.id} id={section.id} eyebrow={section.eyebrow} heading={section.heading} description={section.description} items={section.items} headingLevel={2} ground={section.ground} />;
    case "status-list": return <blocks.ContentSection key={section.id} section={statusListSection(section, `sections.${index}`)} className={SECTION_GROUND_CLASSES[section.ground].surface || undefined} />;
    case "stat-grid": return renderStatGrid(section, blocks);
    case "content-section":
      return <blocks.ContentSection key={section.id} section={section} actions={renderContentActions(section)} resolveAssetId={options.resolveAssetId} prefersReducedMotion={options.prefersReducedMotion} className={SECTION_GROUND_CLASSES[section.ground].surface || undefined} />;
    case "pricing":
      return (
        <blocks.PricingTable
          key={section.id}
          id={section.id}
          eyebrow={section.eyebrow}
          heading={section.heading}
          description={section.description}
          items={section.items}
          headingLevel={2}
          ground={section.ground}
        />
      );
    case "testimonial": {
      const colors = SECTION_GROUND_CLASSES[section.ground];
      const surface = SECTION_GROUND_CLASSES[section.ground].surface;
      return (
        <div key={section.id} id={section.id} className={`flex flex-col gap-lg ${surface}`}>
          {section.heading ? (
            <h2 className={`text-h2 font-display ${colors.primary}`}>{section.heading}</h2>
          ) : null}
          <div className="grid grid-cols-1 gap-lg tablet:grid-cols-2">
            {section.items.map((item) => (
              <blocks.Testimonial
                key={item.id}
                quote={item.quote}
                attributorName={item.attributorName}
                attributorRole={item.attributorRole}
              />
            ))}
          </div>
        </div>
      );
    }
    case "stat": {
      const colors = SECTION_GROUND_CLASSES[section.ground];
      const surface = SECTION_GROUND_CLASSES[section.ground].surface;
      return (
        <div key={section.id} id={section.id} className={`flex flex-col gap-lg ${surface}`}>
          {section.heading ? (
            <h2 className={`text-h2 font-display ${colors.primary}`}>{section.heading}</h2>
          ) : null}
          <div className="grid grid-cols-1 gap-lg tablet:grid-cols-2 desktop:grid-cols-4">
            {section.items.map((item) => (
              <blocks.Stat key={item.id} id={item.id} label={item.label} value={item.value} delta={item.delta} />
            ))}
          </div>
        </div>
      );
    }
  }
}
