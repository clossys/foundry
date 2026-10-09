import { buttonLinkClassName } from "@clossys/designer/atoms/server";
import { SECTION_GROUND_CLASSES } from "@clossys/designer/blocks/server";
import type { ReactNode } from "react";
import { CONTENT_ICON_NAMES } from "../../core/sectioned-view.js";
import type { ContentIconName, ResolvedSectionedViewAction, ResolvedSectionedViewDocument, ResolvedSectionedViewHeroMedia, ResolvedSectionedViewSection, SectionedViewGround, SectionedViewStatTrend, SectionedViewStatus, SectionedViewStatusDisposition } from "../../core/sectioned-view.js";
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
  Hero(props: { id: string; eyebrow?: string; heading: string; description?: string; actions?: ReactNode; media?: ReactNode; composition?: "editorial" | "split"; headingLevel: 1 | 2; ground: SectionedViewGround }): ReactNode;
  FeatureGrid(props: GroundProps & { items: readonly { id: string; heading: string; description?: string }[] }): ReactNode;
  Faq(props: GroundProps & { items: readonly { id: string; question: string; answer: string }[] }): ReactNode;
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
   * Resolves hero `media.assetId` into a paintable asset — the same seam
   * `renderWebDocument` uses for `heroMedia`. Required whenever the
   * resolved document carries hero media; unresolved ids fail closed at
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

const CONTENT_SECTION_KEYS = ["id", "kind", "ground", "eyebrow", "heading", "description", "actions", "layout", "mediaSide", "align", "module", "media"] as const;
const CARD_SPAN_UNITS: Readonly<Record<string, number>> = { third: 4, half: 6, "two-thirds": 8, full: 12 };
const SPECIMEN_TONES = ["success", "warning", "danger", "info", "neutral"] as const;
const SPECIMEN_ARRANGEMENTS = ["single", "row", "stack", "flow"] as const;
const PART_MAX_ROWS = 6;
const CARD_VISUAL_MAX_ROWS = 5;
const TABLE_MAX_COLUMNS = 4;
const TABLE_MAX_ROWS = 5;
const PANEL_MAX_PARTS = 3;
const MEDIA_MAX_PANELS = 3;

function oneOf(value: unknown, allowed: readonly unknown[], path: string, what: string): void {
  if (value !== undefined && !allowed.includes(value)) throw new Error(`${path} is not a supported ${what}; supported values are ${allowed.join(", ")}.`);
}

/** A dense, closed, uniquely identified record array of `min`-`max` entries. */
function records(value: unknown, path: string, keys: readonly string[], min: number, max: number, what: string): asserts value is Record<string, unknown>[] {
  dense(value, path);
  closedItems(value, path, keys);
  itemIds(value, path);
  if (value.length < min || value.length > max) throw new Error(`${path} must hold ${min === max ? min : `${min} to ${max}`} ${what}; it holds ${value.length}.`);
}

function nonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function assertSpecimenStatus(value: unknown, path: string, required = false): void {
  if (value === undefined && !required) return;
  if (!plain(value) || !closed(value, ["tone", "label"]) || !nonBlank(value.label)) throw new Error(`${path} must be a closed resolved status with a tone and non-blank label copy.`);
  oneOf(value.tone, SPECIMEN_TONES, `${path}.tone`, "specimen tone");
  if (value.tone === undefined) throw new Error(`${path}.tone is required.`);
}

function assertSpecimenPart(value: unknown, path: string, maxRows: number): void {
  if (!plain(value) || !nonBlank(value.id) || typeof value.type !== "string") throw new Error(`${path} must be a resolved specimen part with a non-blank id and a type.`);
  const part = value;
  const partKeys = (keys: readonly string[]) => {
    if (!closed(part, ["id", "type", ...keys])) throw new Error(`${path} has keys not allowed for a ${String(part.type)} part.`);
  };
  switch (part.type) {
    case "fields":
      partKeys(["label", "columns", "items"]);
      copyFields(part, path, [], ["label"]);
      oneOf(part.columns, [1, 2, 4], `${path}.columns`, "fields column count");
      records(part.items, `${path}.items`, ["id", "label", "value"], 1, maxRows, "rows");
      part.items.forEach((item, index) => copyFields(item, `${path}.items.${index}`, ["label", "value"]));
      return;
    case "status-rows":
      partKeys(["label", "items"]);
      copyFields(part, path, [], ["label"]);
      records(part.items, `${path}.items`, ["id", "label", "detail", "status"], 1, maxRows, "rows");
      part.items.forEach((item, index) => {
        copyFields(item, `${path}.items.${index}`, ["label"], ["detail"]);
        assertSpecimenStatus(item.status, `${path}.items.${index}.status`, true);
      });
      return;
    case "meter":
      partKeys(["label", "value", "scaleMax", "limit", "direction", "tone", "valueText", "limitText", "status", "note"]);
      copyFields(part, path, ["label", "valueText"], ["limitText", "note"]);
      if (!nonNegative(part.value)) throw new Error(`${path}.value must be a finite number of zero or more.`);
      if (!nonNegative(part.scaleMax) || part.scaleMax === 0) throw new Error(`${path}.scaleMax must be a finite number greater than zero.`);
      if (part.limit !== undefined && !nonNegative(part.limit)) throw new Error(`${path}.limit must be a finite number of zero or more.`);
      if (part.limitText !== undefined && part.limit === undefined) throw new Error(`${path}.limitText is allowed only with ${path}.limit.`);
      oneOf(part.direction, ["max", "min"], `${path}.direction`, "meter direction");
      if (part.tone === undefined) throw new Error(`${path}.tone is required.`);
      oneOf(part.tone, SPECIMEN_TONES, `${path}.tone`, "specimen tone");
      assertSpecimenStatus(part.status, `${path}.status`);
      return;
    case "table": {
      partKeys(["label", "caption", "columns", "rows"]);
      copyFields(part, path, ["caption"], ["label"]);
      records(part.columns, `${path}.columns`, ["id", "label"], 1, TABLE_MAX_COLUMNS, "columns");
      part.columns.forEach((column, index) => copyFields(column, `${path}.columns.${index}`, ["label"]));
      records(part.rows, `${path}.rows`, ["id", "cells"], 1, Math.min(TABLE_MAX_ROWS, maxRows), "rows");
      const columnCount = part.columns.length;
      part.rows.forEach((row, rowIndex) => {
        const cellsPath = `${path}.rows.${rowIndex}.cells`;
        dense(row.cells, cellsPath);
        if (row.cells.length !== columnCount) throw new Error(`${cellsPath} must hold one cell per column (${columnCount}); it holds ${row.cells.length}.`);
        row.cells.forEach((cell, cellIndex) => {
          const cellPath = `${cellsPath}.${cellIndex}`;
          if (!plain(cell) || !closed(cell, ["text", "status"]) || Object.hasOwn(cell, "text") === Object.hasOwn(cell, "status")) throw new Error(`${cellPath} must be a closed cell with exactly one of text or status.`);
          if (Object.hasOwn(cell, "text")) copyFields(cell, cellPath, ["text"]);
          else assertSpecimenStatus(cell.status, `${cellPath}.status`, true);
        });
      });
      return;
    }
    case "schedule":
      partKeys(["label", "items"]);
      copyFields(part, path, [], ["label"]);
      records(part.items, `${path}.items`, ["id", "date", "label", "amount", "status"], 1, maxRows, "rows");
      part.items.forEach((item, index) => {
        copyFields(item, `${path}.items.${index}`, ["date", "label"], ["amount"]);
        assertSpecimenStatus(item.status, `${path}.items.${index}.status`);
      });
      return;
    case "shares":
      partKeys(["label", "items"]);
      copyFields(part, path, [], ["label"]);
      records(part.items, `${path}.items`, ["id", "name", "share", "shareText", "status"], 1, maxRows, "rows");
      part.items.forEach((item, index) => {
        copyFields(item, `${path}.items.${index}`, ["name", "shareText"]);
        if (!nonNegative(item.share) || item.share > 100) throw new Error(`${path}.items.${index}.share must be a finite percentage from 0 to 100.`);
        assertSpecimenStatus(item.status, `${path}.items.${index}.status`);
      });
      return;
    case "files":
      partKeys(["label", "items"]);
      copyFields(part, path, [], ["label"]);
      records(part.items, `${path}.items`, ["id", "format", "name", "source"], 1, maxRows, "rows");
      part.items.forEach((item, index) => copyFields(item, `${path}.items.${index}`, ["format", "name"], ["source"]));
      return;
    default:
      throw new Error(`${path}.type is not a supported specimen part type.`);
  }
}

function assertSpecimenPanel(value: unknown, path: string): void {
  if (!plain(value) || !closed(value, ["id", "title", "meta", "status", "parts", "footer"]) || !nonBlank(value.id)) throw new Error(`${path} must be a closed resolved specimen panel with a non-blank id.`);
  copyFields(value, path, ["title"], ["meta"]);
  assertSpecimenStatus(value.status, `${path}.status`);
  dense(value.parts, `${path}.parts`);
  itemIds(value.parts, `${path}.parts`);
  if (value.parts.length > PANEL_MAX_PARTS) throw new Error(`${path}.parts must hold 1 to ${PANEL_MAX_PARTS} parts; it holds ${value.parts.length}.`);
  value.parts.forEach((part, index) => assertSpecimenPart(part, `${path}.parts.${index}`, PART_MAX_ROWS));
  if (value.footer === undefined) return;
  const footer = value.footer;
  if (!plain(footer) || !closed(footer, ["assignee", "note"]) || (footer.assignee === undefined && footer.note === undefined)) throw new Error(`${path}.footer must be a closed footer with an assignee, a note, or both.`);
  copyFields(footer, `${path}.footer`, [], ["note"]);
  if (footer.assignee === undefined) return;
  if (!plain(footer.assignee) || !closed(footer.assignee, ["initials", "name", "note"])) throw new Error(`${path}.footer.assignee must be a closed assignee.`);
  copyFields(footer.assignee, `${path}.footer.assignee`, ["initials", "name"], ["note"]);
}

function assertSpecimenMedia(value: unknown, path: string): void {
  if (!plain(value) || !closed(value, ["type", "label", "arrangement", "connector", "panels"]) || value.type !== "specimen") throw new Error(`${path} must be a closed resolved specimen.`);
  copyFields(value, path, ["label"], ["connector"]);
  oneOf(value.arrangement, SPECIMEN_ARRANGEMENTS, `${path}.arrangement`, "specimen arrangement");
  const arrangement = value.arrangement ?? "single";
  if (value.connector !== undefined && arrangement !== "flow") throw new Error(`${path}.connector is allowed only with the flow arrangement.`);
  dense(value.panels, `${path}.panels`);
  itemIds(value.panels, `${path}.panels`);
  const [min, max] = arrangement === "single" ? [1, 1] : [2, MEDIA_MAX_PANELS];
  if (value.panels.length < min || value.panels.length > max) throw new Error(`${path}.panels must hold ${min === max ? min : `${min} to ${max}`} panels for the ${String(arrangement)} arrangement; it holds ${value.panels.length}.`);
  value.panels.forEach((panel, index) => assertSpecimenPanel(panel, `${path}.panels.${index}`));
}

/** Features and topics items: an icon from the closed set, a heading, an optional description. Only cards carry an item eyebrow. */
function assertContentItems(items: Record<string, unknown>[], path: string, iconsAllowed = true): void {
  items.forEach((item, index) => {
    const itemPath = `${path}.${index}`;
    copyFields(item, itemPath, ["heading"], ["eyebrow", "description"]);
    if (item.icon !== undefined && !CONTENT_ICON_NAMES.includes(item.icon as ContentIconName)) throw new Error(`${itemPath}.icon is not a content icon name.`);
    if (item.icon !== undefined && !iconsAllowed) throw new Error(`${itemPath}.icon is allowed only with the plain and plate treatments.`);
  });
}

function assertComparisonSide(value: unknown, path: string): Record<string, unknown> {
  if (!plain(value) || !closed(value, ["label", "heading", "description", "points", "visual"])) throw new Error(`${path} must be a closed resolved comparison side.`);
  copyFields(value, path, ["label"], ["heading", "description"]);
  if ((value.description === undefined) === (value.points === undefined)) throw new Error(`${path} must have exactly one of description or points.`);
  if (value.points !== undefined) {
    assertStringArray(value.points, `${path}.points`);
    const count = (value.points as unknown[]).length;
    if (count < 2 || count > 4) throw new Error(`${path}.points must hold 2 to 4 points; it holds ${count}.`);
  }
  if (value.visual !== undefined) assertSpecimenPanel(value.visual, `${path}.visual`);
  return value;
}

function assertContentModule(value: unknown, path: string): void {
  if (!plain(value) || typeof value.type !== "string") throw new Error(`${path} must be a resolved module with a type.`);
  const module = value;
  const moduleKeys = (keys: readonly string[]) => {
    if (!closed(module, ["type", ...keys])) throw new Error(`${path} has keys not allowed for a ${String(module.type)} module.`);
  };
  switch (module.type) {
    case "features": {
      moduleKeys(["columns", "treatment", "emphasis", "items"]);
      oneOf(module.columns, [2, 3, 4], `${path}.columns`, "features column count");
      oneOf(module.treatment, ["plain", "rule", "plate"], `${path}.treatment`, "features treatment");
      oneOf(module.emphasis, ["item", "statement"], `${path}.emphasis`, "features emphasis");
      const statement = module.emphasis === "statement";
      records(module.items, `${path}.items`, ["id", "icon", "heading", "description"], statement ? 3 : 2, statement ? 3 : 4, "items");
      assertContentItems(module.items, `${path}.items`, module.treatment !== "rule");
      return;
    }
    case "cards": {
      moduleKeys(["items"]);
      records(module.items, `${path}.items`, ["id", "icon", "eyebrow", "heading", "description", "span", "visual"], 2, 6, "cards");
      assertContentItems(module.items, `${path}.items`);
      let filled = 0;
      module.items.forEach((card, index) => {
        const units = typeof card.span === "string" ? CARD_SPAN_UNITS[card.span] : undefined;
        if (units === undefined) throw new Error(`${path}.items.${index}.span is not a supported card span.`);
        filled += units;
        if (filled > 12) throw new Error(`${path}.items.${index}.span overflows its row; cards must fill whole 12-unit rows.`);
        if (filled === 12) filled = 0;
        if (card.visual !== undefined) assertSpecimenPart(card.visual, `${path}.items.${index}.visual`, CARD_VISUAL_MAX_ROWS);
      });
      if (filled !== 0) throw new Error(`${path}.items leaves its last row unfilled; cards must fill whole 12-unit rows.`);
      return;
    }
    case "comparison": {
      moduleKeys(["before", "after"]);
      const before = assertComparisonSide(module.before, `${path}.before`);
      const after = assertComparisonSide(module.after, `${path}.after`);
      const form = (side: Record<string, unknown>) => (Array.isArray(side.points) ? `points:${side.points.length}` : "description");
      if (form(before) !== form(after)) throw new Error(`${path}.before and ${path}.after must use the same form.`);
      if ((before.visual === undefined) !== (after.visual === undefined)) throw new Error(`${path}.before and ${path}.after must both carry a visual or neither.`);
      return;
    }
    case "topics":
      moduleKeys(["columns", "items"]);
      oneOf(module.columns, [1, 2], `${path}.columns`, "topics column count");
      records(module.items, `${path}.items`, ["id", "icon", "heading", "description"], 2, 8, "items");
      assertContentItems(module.items, `${path}.items`);
      if (module.columns !== 1 && module.items.length % 2 === 1) throw new Error(`${path}.items must hold an even number of items in 2 columns; it holds ${module.items.length}.`);
      return;
    case "steps":
      moduleKeys(["items"]);
      records(module.items, `${path}.items`, ["id", "ordinal", "label", "heading", "description", "visual"], 3, 4, "steps");
      module.items.forEach((step, index) => {
        copyFields(step, `${path}.items.${index}`, ["ordinal", "heading"], ["label", "description"]);
        if (step.visual !== undefined) assertSpecimenPanel(step.visual, `${path}.items.${index}.visual`);
      });
      return;
    case "faq":
      moduleKeys(["items"]);
      records(module.items, `${path}.items`, ["id", "question", "answer"], 4, 6, "items");
      module.items.forEach((item, index) => copyFields(item, `${path}.items.${index}`, ["question", "answer"]));
      return;
    default:
      throw new Error(`${path}.type is not a supported content module type.`);
  }
}

/**
 * A resolved content section, held to the same closed shapes and budgets the
 * document contract validates, so no Designer block throws while rendering.
 * A split needs a specimen, except a split FAQ, whose rows take the visual
 * column and which takes no media.
 */
function assertContentSection(record: Record<string, unknown>, path: string): void {
  if (!closed(record, CONTENT_SECTION_KEYS)) throw new Error(`${path} has keys not allowed for a content-section section.`);
  assertActions(record.actions, `${path}.actions`);
  oneOf(record.layout, ["stacked", "split"], `${path}.layout`, "content layout");
  const split = record.layout === "split";
  oneOf(record.mediaSide, ["end", "start"], `${path}.mediaSide`, "media side");
  oneOf(record.align, ["start", "center"], `${path}.align`, "content alignment");
  if (record.mediaSide !== undefined && !split) throw new Error(`${path}.mediaSide is allowed only on a split section.`);
  if (record.align !== undefined && split) throw new Error(`${path}.align is allowed only on a stacked section.`);
  if (record.module !== undefined) assertContentModule(record.module, `${path}.module`);
  if (record.media !== undefined) assertSpecimenMedia(record.media, `${path}.media`);
  const faq = plain(record.module) && record.module.type === "faq";
  if (split && faq && record.media !== undefined) throw new Error(`${path}.media is not allowed on a split FAQ section; its rows take the visual column.`);
  if (split && !faq && record.media === undefined) throw new Error(`${path} is a split section and needs media.`);
}

/** Validates the direct resolved-model boundary before any Designer block receives props. */
export function assertRenderableSectionedViewDocument(document: unknown): asserts document is ResolvedSectionedViewDocument {
  if (!plain(document) || !closed(document, ["id", "sections", "resolutions", "viewGrounds"]) || !Object.hasOwn(document, "id") || !Object.hasOwn(document, "sections") || !Object.hasOwn(document, "resolutions") || !nonBlank(document.id)) throw new Error("document must be a closed object with a non-blank id, sections, and resolutions.");
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
    if (!plain(section) || !closed(section, ["id", "kind", "ground", "eyebrow", "heading", "description", "actions", "media", "items", "labels", "groups", "layout", "mediaSide", "align", "module"])) throw new Error(`${path} must be a closed resolved section object.`);
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
      if (!closed(record, ["id", "kind", "ground", "eyebrow", "heading", "description", "actions", "media"])) throw new Error(`${path} has keys not allowed for a hero section.`);
      assertActions(record.actions, `${path}.actions`);
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
 * `blocks`, without the stack wrapper or landmark. Package-internal: views
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
  const { Hero, FeatureGrid, Faq, OrderedStepSequence, StatusList, Stat, PricingTable, Testimonial, ContentSection } = blocks;
  return function SectionedView({ document, landmark = "main", resolveAssetId, prefersReducedMotion }: SectionedViewProps) {
    const sections = renderSectionedViewSections(document, { Hero, FeatureGrid, Faq, OrderedStepSequence, StatusList, Stat, PricingTable, Testimonial, ContentSection },{ resolveAssetId, prefersReducedMotion }).map(({ node }) => node);
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

/** How a hero's document-declared actions render: underlined text links, or Designer primary buttons. */
export type SectionedViewHeroActions = "link" | "button";

function renderActions(actions: readonly ResolvedSectionedViewAction[] | undefined, ground: SectionedViewGround, look: SectionedViewHeroActions): ReactNode {
  if (actions === undefined) return undefined;
  const className = look === "button" ? buttonLinkClassName("primary", "lg") : `text-body font-body underline ${ACTION_INK[ground]}`;
  return actions.map((action) => (
    <a key={action.id} href={action.href} className={className}>
      {action.label}
    </a>
  ));
}

export interface SectionedViewRenderOptions {
  resolveAssetId?: AssetResolver;
  prefersReducedMotion?: boolean;
  /**
   * How hero actions render. `"link"` (the SectionedView default) keeps
   * underlined text links; `"button"` renders each as a Designer primary
   * button-styled link (`buttonLinkClassName("primary", "lg")`), the same
   * treatment a marketing page's closing call to action takes.
   * @default "link"
   */
  heroActions?: SectionedViewHeroActions;
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
        <div className="flex flex-col gap-xs">
          {section.eyebrow ? <p className={`text-caption uppercase tracking-label ${colors.muted}`}>{section.eyebrow}</p> : null}
          <h2 className={`text-h2 font-display ${colors.primary}`}>{section.heading}</h2>
          {section.description ? <p className={`text-body ${colors.secondary}`}>{section.description}</p> : null}
        </div>
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
          heading={section.heading}
          description={section.description}
          actions={renderActions(section.actions, section.ground, options.heroActions ?? "link")}
          media={heroMedia}
          {...(heroMedia ? { composition: "split" as const } : {})}
          headingLevel={index === 0 ? 1 : 2}
          ground={section.ground}
        />
      );
    }
    case "feature-grid": return <blocks.FeatureGrid key={section.id} id={section.id} eyebrow={section.eyebrow} heading={section.heading} description={section.description} items={section.items} headingLevel={2} ground={section.ground} />;
    case "faq": return <blocks.Faq key={section.id} id={section.id} eyebrow={section.eyebrow} heading={section.heading} description={section.description} items={section.items} headingLevel={2} ground={section.ground} />;
    case "ordered-step-sequence": return <blocks.OrderedStepSequence key={section.id} id={section.id} eyebrow={section.eyebrow} heading={section.heading} description={section.description} items={section.items} headingLevel={2} ground={section.ground} />;
    case "status-list": return <blocks.StatusList key={section.id} id={section.id} eyebrow={section.eyebrow} heading={section.heading} description={section.description} labels={section.labels} groups={section.groups} items={section.items} legendLabel={section.heading} headingLevel={2} ground={section.ground} />;
    case "stat-grid": return renderStatGrid(section, blocks);
    case "content-section":
      return <blocks.ContentSection key={section.id} section={section} actions={renderActions(section.actions, section.ground, "link")} className={SECTION_GROUND_CLASSES[section.ground].surface || undefined} />;
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
