import { planContentGrounds } from "./content-ground.js";
import { projectStatusListItems } from "./status-list-catalog.js";
import type { CopyRef, CopyResolution, CopyResolver } from "../../copy-contract.js";
import { isSanctionedHref } from "../internal/href.js";
import { proseParagraphTextLength } from "../internal/prose-text.js";
import type { ComposeFinding } from "./types.js";
import { desugarRecipe, SECTIONED_VIEW_CONTENT_CONTRACT, SECTIONED_VIEW_ITEM_RECIPES } from "./content-contract.js";
import type { FrameSize, FrameLayout, SectionedViewItemsBlock, CanonicalSectionedViewItemsBlock, SectionedViewMatrixBlock, SectionedViewProseBlock, SectionedViewItem, SectionedViewItemSpan, SectionedViewMedia, SectionedViewSpecimenMedia, SectionedViewSceneMedia, SectionedViewBadge } from "./content-contract.js";
import { checkContentAssetContract } from "./content-asset.js";
export * from "./content-contract.js";

/** Resolved section grounds; canonical content sections author only inverse or omit ground. */
export type SectionedViewGround = "base" | "sunken" | "inverse";

/**
 * Document-level rhythm for published section kinds that omit `ground`.
 * Canonical content sections always delegate omitted grounds to the view,
 * independently of this setting. An explicit ground always wins.
 *
 * - `"base-then-sunken"`: `base`, then `sunken`, in document order.
 * - `"view"`: the rendering view assigns grounds from page position
 *   (`LandingView` plans cadence across every document and its closing band).
 *   Resolution uses `base` as a placeholder and lists delegated section ids
 *   in the resolved document's `viewGrounds`.
 */
export type SectionedViewSectionGroundRhythm = "base-then-sunken" | "view";

const SECTION_GROUND_RHYTHMS: readonly SectionedViewSectionGroundRhythm[] = ["base-then-sunken", "view"];

/** The closed block vocabulary for a long-form site page. */
export type SectionedViewSectionKind =
  | "hero"
  | "feature-grid"
  | "faq"
  | "ordered-step-sequence"
  | "status-list"
  | "stat-grid"
  | "pricing"
  | "testimonial"
  | "stat"
  | "content-section";

/**
 * The closed set of icon names a content item may carry, one per item, to
 * tell list items apart (never to decorate a heading). Each name is a Designer
 * icon; the web layer imports those icons explicitly by name, so there is no
 * open name registry and an unused icon still tree-shakes away.
 */
export type ContentIconName =
  | "briefcase"
  | "building-2"
  | "calendar"
  | "clock"
  | "file-check"
  | "file-text"
  | "folder"
  | "globe"
  | "landmark"
  | "layers"
  | "lock"
  | "receipt"
  | "scale"
  | "search"
  | "shield-check"
  | "users";

/** Every `ContentIconName`, in a stable order, for validation and for a renderer's exhaustive name-to-icon map. */
export const CONTENT_ICON_NAMES: readonly ContentIconName[] = [
  "briefcase",
  "building-2",
  "calendar",
  "clock",
  "file-check",
  "file-text",
  "folder",
  "globe",
  "landmark",
  "layers",
  "lock",
  "receipt",
  "scale",
  "search",
  "shield-check",
  "users",
];

/** Direction a stat row's optional `delta` represents — mirrors Designer `Stat`'s closed `trend` prop. */
export type SectionedViewStatTrend = "up" | "down" | "neutral";

/**
 * Optional hero companion media: an `assetId` the host resolves at render time
 * plus audience-facing `alt` copy that participates in provenance like every
 * other field here.
 */
export interface SectionedViewHeroMedia {
  assetId: string;
  alt: CopyRef;
}

/**
 * One call to action a hero section may carry. Data only, like every other
 * field here: authored label copy plus a route target held to the same
 * sanctioned-href rule every server-rendered publisher surface uses. There is
 * deliberately no node, class, or handler slot, so a document stays
 * serialisable and the rendering layer keeps ownership of the markup.
 */
export interface SectionedViewAction {
  id: string;
  label: CopyRef;
  href: string;
  /** Omitted hero actions resolve to primary, then secondary. */
  emphasis?: SectionedViewActionEmphasis;
}

/** Hero and view-owned closing actions use this closed subset. */
export type SectionedViewActionEmphasis = "primary" | "secondary" | "quiet";

/** Resolves a hero or closing action before any display reordering. */
export function resolveRoleActionEmphasis(emphasis: SectionedViewActionEmphasis | undefined, index: number): SectionedViewActionEmphasis {
  return emphasis ?? (index === 0 ? "primary" : "secondary");
}

/**
 * How a content-section action renders. `primary` is the filled button, for
 * the band's one conversion; `secondary` is outlined, `tertiary` is tonal and `quiet`
 * carries text and a decorative chevron. Group size follows the frame, independently of emphasis. Omitted emphasis follows weight.
 */
export type SectionedViewContentActionEmphasis = "primary" | "secondary" | "tertiary" | "quiet";

/**
 * One call to action a content section may carry: a hero action plus its
 * emphasis. A section holds at most two, and at most one `primary`.
 */
export interface SectionedViewContentAction extends Omit<SectionedViewAction, "emphasis"> {
  /** Omitted emphasis follows the derived band weight. */
  emphasis?: SectionedViewContentActionEmphasis;
}

/**
 * A content section's footnote: one short sentence closing the band, for an
 * aside rather than the band's next step, with at most one inline link
 * after its text. The only place a section body takes the underlined link
 * look.
 */
export type SectionedViewContentFootnote =
  | { text: CopyRef; link?: SectionedViewContentFootnoteLink }
  | { text?: never; link: SectionedViewContentFootnoteLink };

/** The footnote's one inline link, held to the same sanctioned-href rule as an action. */
export interface SectionedViewContentFootnoteLink {
  label: CopyRef;
  href: string;
}

export interface SectionedViewHeroSection {
  id: string;
  kind: "hero";
  ground?: SectionedViewGround;
  eyebrow?: CopyRef;
  /** Intro label ink. @default "accent" */
  eyebrowTone?: "accent" | "muted";
  /** Intro headline/body measure, independent of the outer page column. @default "prose" */
  measure?: "prose" | "wide";
  /** Intro type ramp. @default "default" */
  headingScale?: "default" | "display";
  heading: CopyRef;
  description?: CopyRef;
  /** Short hero: section-scale heading, with no first-screen fill, peek or scroll cue. */
  size?: "display" | "compact";
  /** Optional calls to action. The Designer Hero block beneath this section has always had the slot; the document can now express it. */
  actions?: SectionedViewAction[];
  /** Optional product-surface or original-art media beside the hero copy — same slot `MarketingView`'s `heroMedia` fills at render time. */
  media?: SectionedViewHeroMedia;
}

export interface SectionedViewStatItem {
  id: string;
  label: CopyRef;
  value: CopyRef;
  delta?: CopyRef;
  trend?: SectionedViewStatTrend;
  description?: CopyRef;
}

export interface SectionedViewStatGridSection {
  id: string;
  kind: "stat-grid";
  ground?: SectionedViewGround;
  eyebrow?: CopyRef;
  heading: CopyRef;
  description?: CopyRef;
  items: SectionedViewStatItem[];
}

export interface SectionedViewFeatureItem {
  id: string;
  /** Optional item icon. Optional and additive: an item without one renders exactly as it did before. */
  icon?: ContentIconName;
  heading: CopyRef;
  description?: CopyRef;
}

export interface SectionedViewFeatureGridSection {
  id: string;
  kind: "feature-grid";
  ground?: SectionedViewGround;
  /** Optional label above the section heading. Optional and additive: a section without one renders exactly as it did before. */
  eyebrow?: CopyRef;
  heading: CopyRef;
  description?: CopyRef;
  items: SectionedViewFeatureItem[];
}

export interface SectionedViewPricingItem {
  id: string;
  name: CopyRef;
  price: CopyRef;
  description?: CopyRef;
  features: CopyRef[];
  cta?: CopyRef;
}

export interface SectionedViewPricingSection {
  id: string;
  kind: "pricing";
  ground?: SectionedViewGround;
  eyebrow?: CopyRef;
  heading: CopyRef;
  description?: CopyRef;
  items: SectionedViewPricingItem[];
}

export interface SectionedViewTestimonialItem {
  id: string;
  quote: CopyRef;
  attributorName: CopyRef;
  attributorRole?: CopyRef;
}

export interface SectionedViewTestimonialSection {
  id: string;
  kind: "testimonial";
  ground?: SectionedViewGround;
  heading?: CopyRef;
  items: SectionedViewTestimonialItem[];
}

export interface SectionedViewStatSectionItem {
  id: string;
  label: CopyRef;
  value: CopyRef;
  delta?: CopyRef;
}

export interface SectionedViewStatSection {
  id: string;
  kind: "stat";
  ground?: SectionedViewGround;
  heading?: CopyRef;
  items: SectionedViewStatSectionItem[];
}

export interface SectionedViewFaqItem {
  id: string;
  question: CopyRef;
  answer: CopyRef;
}

export interface SectionedViewFaqSection {
  id: string;
  kind: "faq";
  ground?: SectionedViewGround;
  /** Optional label above the section heading. Optional and additive: a section without one renders exactly as it did before. */
  eyebrow?: CopyRef;
  heading: CopyRef;
  description?: CopyRef;
  /**
   * `split` sets the header group in the narrow text column and the rows in
   * the wide column beside it, top-aligned, the same band a `content-section`
   * with a split `faq` block renders. Omission selects a stacked band.
   * @default "stacked"
   */
  layout?: "stacked" | "split";
  /** Four to six question/answer rows for the canonical Index FAQ recipe. */
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
  ground?: SectionedViewGround;
  /** Optional label above the section heading. Optional and additive: a section without one renders exactly as it did before. */
  eyebrow?: CopyRef;
  heading: CopyRef;
  description?: CopyRef;
  items: SectionedViewOrderedStep[];
}

export type SectionedViewStatus = "available" | "partial" | "planned";
/** A deliberate non-capability, kept outside the readiness axis. */
export type SectionedViewStatusDisposition = "not-offered";

/**
 * A status row with exactly one readiness state or off-axis disposition.
 * Optional `detail` supplies the canonical Item description, including the
 * reasoning behind a deliberate non-capability.
 */
export type SectionedViewStatusItem =
  | { id: string; label: CopyRef; detail?: CopyRef; state: SectionedViewStatus; disposition?: never }
  | { id: string; label: CopyRef; detail?: CopyRef; disposition: SectionedViewStatusDisposition; state?: never };

export interface SectionedViewStatusGroup {
  id: string;
  heading: CopyRef;
  items: SectionedViewStatusItem[];
}

export interface SectionedViewStatusListSection {
  id: string;
  kind: "status-list";
  ground?: SectionedViewGround;
  /** Optional label above the canonical section heading. */
  eyebrow?: CopyRef;
  heading: CopyRef;
  description?: CopyRef;
  labels: Record<SectionedViewStatus, CopyRef> & { dispositions: Record<SectionedViewStatusDisposition, CopyRef> };
  /** Two to four groups of two to four entries, eight entries total at most. Group headings resolve to at most 24 characters. Provide this or `items`, never both. */
  groups?: SectionedViewStatusGroup[];
  /**
   * A flat list of statements with no group headings — the common shape for
   * a lookup of three to eight entries. Provide this or `groups`,
   * never both.
   */
  items?: SectionedViewStatusItem[];
}

// ---------------------------------------------------------------------------
// content-section: one band anatomy (header, text block, visual)
// ---------------------------------------------------------------------------

/** A band's spacing and arrangement. Split direction names its visual side. */
export type SectionedViewContentLayout = FrameLayout;

/** The closed status tones a specimen may show; the product's own data states, never availability or roadmap. */
export type SectionedViewSpecimenTone = "success" | "warning" | "danger" | "info" | "neutral";

/** A status shown as text with a toned mark. The text always carries the meaning; tone is reinforcement. */
export interface SectionedViewSpecimenStatus {
  tone: SectionedViewSpecimenTone;
  label: CopyRef;
}

export interface SectionedViewSpecimenField {
  id: string;
  label: CopyRef;
  value: CopyRef;
}

/** Key-value pairs. `columns` defaults to 2. */
export interface SectionedViewSpecimenFieldsPart {
  id: string;
  type: "fields";
  label?: CopyRef;
  columns?: 1 | 2 | 4;
  items: SectionedViewSpecimenField[];
}

export interface SectionedViewSpecimenStatusRow {
  id: string;
  label: CopyRef;
  detail?: CopyRef;
  status: SectionedViewSpecimenStatus;
}

export interface SectionedViewSpecimenStatusRowsPart {
  id: string;
  type: "status-rows";
  label?: CopyRef;
  mobileRows?: 3;
  items: SectionedViewSpecimenStatusRow[];
}

/**
 * One measured value against an optional limit. Numbers are plain, finite and
 * non-negative; `scaleMax` is greater than zero. The visible `valueText` (and
 * `limitText`) carries the meaning; the bar is reinforcement.
 */
export interface SectionedViewSpecimenMeterPart {
  id: string;
  type: "meter";
  label: CopyRef;
  value: number;
  scaleMax: number;
  limit?: number;
  /** Whether the limit is a ceiling (`max`, the default) or a floor (`min`). */
  direction?: "max" | "min";
  tone: SectionedViewSpecimenTone;
  valueText: CopyRef;
  /** Previous measurement and its visible copy are authored together. */
  previous?: number;
  previousText?: CopyRef;
  /** Only with `limit`. */
  limitText?: CopyRef;
  status?: SectionedViewSpecimenStatus;
  note?: CopyRef;
}

export interface SectionedViewSpecimenTableColumn {
  id: string;
  label: CopyRef;
}

/** One table cell: text, or a status. */
export type SectionedViewSpecimenTableCell = { text: CopyRef; status?: never } | { status: SectionedViewSpecimenStatus; text?: never };

export interface SectionedViewSpecimenTableRow {
  id: string;
  /** One cell per column, in column order. The first cell is the row header. */
  cells: SectionedViewSpecimenTableCell[];
}

/** A small real table: at most 4 columns and 5 rows. `caption` names it for assistive technology. */
export interface SectionedViewSpecimenTablePart {
  id: string;
  type: "table";
  label?: CopyRef;
  caption: CopyRef;
  columns: SectionedViewSpecimenTableColumn[];
  rows: SectionedViewSpecimenTableRow[];
}

export interface SectionedViewSpecimenScheduleItem {
  id: string;
  date: CopyRef;
  label: CopyRef;
  amount?: CopyRef;
  status?: SectionedViewSpecimenStatus;
}

export interface SectionedViewSpecimenSchedulePart {
  id: string;
  type: "schedule";
  label?: CopyRef;
  items: SectionedViewSpecimenScheduleItem[];
}

/** One share: a percentage from 0 to 100 with its visible text. */
export interface SectionedViewSpecimenShare {
  id: string;
  name: CopyRef;
  share: number;
  shareText: CopyRef;
  status?: SectionedViewSpecimenStatus;
}

export interface SectionedViewSpecimenSharesPart {
  id: string;
  type: "shares";
  label?: CopyRef;
  items: SectionedViewSpecimenShare[];
}

export interface SectionedViewSpecimenFile {
  id: string;
  /** Short file-type tag, for example a three-letter extension. */
  format: CopyRef;
  name: CopyRef;
  source?: CopyRef;
}

export interface SectionedViewSpecimenFilesPart {
  id: string;
  type: "files";
  label?: CopyRef;
  items: SectionedViewSpecimenFile[];
}

/** One part of a specimen panel. Every part holds at most 6 rows (a table at most 5). */
export type SectionedViewSpecimenPart =
  | SectionedViewSpecimenFieldsPart
  | SectionedViewSpecimenStatusRowsPart
  | SectionedViewSpecimenMeterPart
  | SectionedViewSpecimenTablePart
  | SectionedViewSpecimenSchedulePart
  | SectionedViewSpecimenSharesPart
  | SectionedViewSpecimenFilesPart;

export type SectionedViewSpecimenPartType = SectionedViewSpecimenPart["type"];

export interface SectionedViewSpecimenAssignee {
  initials: CopyRef;
  name: CopyRef;
  note?: CopyRef;
}

/** A panel footer: an assignee, a note, or both. */
export interface SectionedViewSpecimenFooter {
  assignee?: SectionedViewSpecimenAssignee;
  note?: CopyRef;
}

/**
 * One product-UI panel: a title, optional meta and status, 1-3 parts and an
 * optional footer. Static evidence only: no control, link, input or focus
 * stop is expressible here.
 */
export interface SectionedViewSpecimenPanel {
  id: string;
  title: CopyRef;
  meta?: CopyRef;
  badge?: SectionedViewBadge;
  status?: SectionedViewSpecimenStatus;
  parts: SectionedViewSpecimenPart[];
  footer?: SectionedViewSpecimenFooter;
}

/** One canonical collection, comparison or ordered prose block. */
export type SectionedViewContentBlock = SectionedViewItemsBlock | SectionedViewMatrixBlock | SectionedViewProseBlock;
export type SectionedViewContentBlockType = SectionedViewContentBlock["type"];
/** One band: a header, optional content and media, and a closing footnote. */
export interface SectionedViewContentSection {
  id: string;
  kind: "content-section";
  /** Omission lets the view plan the body cadence; inverse is an authored anchor. */
  ground?: "inverse";
  size?: FrameSize;
  layout?: FrameLayout;
  eyebrow?: CopyRef;
  heading: CopyRef;
  description?: CopyRef;
  actions?: SectionedViewContentAction[];
  block?: SectionedViewContentBlock;
  media?: SectionedViewMedia;
  footnote?: SectionedViewContentFootnote;
}

/** One fully data-shaped section: there is deliberately no node, class, style, or render callback escape hatch. */
export type SectionedViewSection =
  | SectionedViewHeroSection
  | SectionedViewFeatureGridSection
  | SectionedViewFaqSection
  | SectionedViewOrderedStepSequenceSection
  | SectionedViewStatusListSection
  | SectionedViewStatGridSection
  | SectionedViewPricingSection
  | SectionedViewTestimonialSection
  | SectionedViewStatSection
  | SectionedViewContentSection;

/** Canonical, Designer-independent input for a long public site page. */
export interface SectionedViewDocument {
  id: string;
  sections: SectionedViewSection[];
  /**
   * When set, sections that omit `ground` receive it from the rhythm
   * (`SectionedViewSectionGroundRhythm`). An explicit `ground` always wins;
   * rhythm never applies `inverse`.
   */
  sectionGroundRhythm?: SectionedViewSectionGroundRhythm;
}

type ResolvedCopy = string;
type ResolvedSectionedViewStatusItem =
  | { id: string; label: ResolvedCopy; detail?: ResolvedCopy; state: SectionedViewStatus; disposition?: never }
  | { id: string; label: ResolvedCopy; detail?: ResolvedCopy; disposition: SectionedViewStatusDisposition; state?: never };

/** A hero action with its label copy resolved; the href travels unchanged. */
export type ResolvedSectionedViewAction = Omit<SectionedViewAction, "label"> & { label: ResolvedCopy };

/** A content-section action with its label copy resolved; href and emphasis travel unchanged. */
export type ResolvedSectionedViewContentAction = Omit<SectionedViewContentAction, "label"> & { label: ResolvedCopy };

export type ResolvedSectionedViewHeroMedia = Omit<SectionedViewHeroMedia, "alt"> & { alt: ResolvedCopy };

/**
 * `T` with every `CopyRef` replaced by its resolved text and every other
 * field kept as authored. An object counts as a `CopyRef` only when it has
 * no keys beyond a CopyRef's own, so an item that carries an `id` is never
 * mistaken for one.
 */
type ResolvedCopyTree<T> = T extends CopyRef
  ? Exclude<keyof T, keyof CopyRef> extends never
    ? ResolvedCopy
    : { [K in keyof T]: ResolvedCopyTree<T[K]> }
  : T extends readonly (infer U)[]
    ? ResolvedCopyTree<U>[]
    : T extends object
      ? { [K in keyof T]: ResolvedCopyTree<T[K]> }
      : T;

/** A specimen with its copy resolved; numbers, tones and arrangement travel unchanged. */
export type ResolvedSectionedViewSpecimenMedia = ResolvedCopyTree<SectionedViewSpecimenMedia>;
export type ResolvedSectionedViewSpecimenPanel = ResolvedCopyTree<SectionedViewSpecimenPanel>;
export type ResolvedSectionedViewSpecimenPart = ResolvedCopyTree<SectionedViewSpecimenPart>;
export type ResolvedSectionedViewContentBlock =
  | (ResolvedCopyTree<CanonicalSectionedViewItemsBlock> & { /** Consumer-resolved hidden continuation copy. */ continuesLabel?: string })
  | ResolvedCopyTree<SectionedViewMatrixBlock>
  | ResolvedCopyTree<SectionedViewProseBlock>;
export type ResolvedSectionedViewMedia = ResolvedCopyTree<SectionedViewMedia>;
/** A content section with its copy resolved and its ground applied. Absent optional fields stay absent. */
export type ResolvedSectionedViewContentSection = Omit<ResolvedCopyTree<SectionedViewContentSection>, "ground" | "block" | "size" | "layout"> & { ground: SectionedViewGround; size: FrameSize; layout: FrameLayout; block?: ResolvedSectionedViewContentBlock };

export type ResolvedSectionedViewSection =
  | Omit<SectionedViewHeroSection, "eyebrow" | "heading" | "description" | "actions" | "media" | "ground"> & { ground: SectionedViewGround; eyebrow?: ResolvedCopy; heading: ResolvedCopy; description?: ResolvedCopy; actions?: ResolvedSectionedViewAction[]; media?: ResolvedSectionedViewHeroMedia }
  | Omit<SectionedViewFeatureGridSection, "eyebrow" | "heading" | "description" | "items" | "ground"> & { ground: SectionedViewGround; eyebrow?: ResolvedCopy; heading: ResolvedCopy; description?: ResolvedCopy; items: Array<Omit<SectionedViewFeatureItem, "heading" | "description"> & { heading: ResolvedCopy; description?: ResolvedCopy }> }
  | Omit<SectionedViewFaqSection, "eyebrow" | "heading" | "description" | "items" | "ground"> & { ground: SectionedViewGround; eyebrow?: ResolvedCopy; heading: ResolvedCopy; description?: ResolvedCopy; items: Array<Omit<SectionedViewFaqItem, "question" | "answer"> & { question: ResolvedCopy; answer: ResolvedCopy }> }
  | Omit<SectionedViewOrderedStepSequenceSection, "eyebrow" | "heading" | "description" | "items" | "ground"> & { ground: SectionedViewGround; eyebrow?: ResolvedCopy; heading: ResolvedCopy; description?: ResolvedCopy; items: Array<Omit<SectionedViewOrderedStep, "ordinal" | "label" | "heading" | "description"> & { ordinal: ResolvedCopy; label?: ResolvedCopy; heading: ResolvedCopy; description?: ResolvedCopy }> }
  | Omit<SectionedViewStatusListSection, "eyebrow" | "heading" | "description" | "labels" | "groups" | "items" | "ground"> & { ground: SectionedViewGround; eyebrow?: ResolvedCopy; heading: ResolvedCopy; description?: ResolvedCopy; labels: Record<SectionedViewStatus, ResolvedCopy> & { dispositions: Record<SectionedViewStatusDisposition, ResolvedCopy> }; groups?: Array<Omit<SectionedViewStatusGroup, "heading" | "items"> & { heading: ResolvedCopy; items: ResolvedSectionedViewStatusItem[] }>; items?: ResolvedSectionedViewStatusItem[] }
  | Omit<SectionedViewStatGridSection, "eyebrow" | "heading" | "description" | "items" | "ground"> & { ground: SectionedViewGround; eyebrow?: ResolvedCopy; heading: ResolvedCopy; description?: ResolvedCopy; items: Array<Omit<SectionedViewStatItem, "label" | "value" | "delta" | "description"> & { label: ResolvedCopy; value: ResolvedCopy; delta?: ResolvedCopy; description?: ResolvedCopy }> }
  | Omit<SectionedViewPricingSection, "eyebrow" | "heading" | "description" | "items" | "ground"> & { ground: SectionedViewGround; eyebrow?: ResolvedCopy; heading: ResolvedCopy; description?: ResolvedCopy; items: Array<Omit<SectionedViewPricingItem, "name" | "price" | "description" | "features" | "cta"> & { name: ResolvedCopy; price: ResolvedCopy; description?: ResolvedCopy; features: ResolvedCopy[]; cta?: ResolvedCopy }> }
  | Omit<SectionedViewTestimonialSection, "heading" | "items" | "ground"> & { ground: SectionedViewGround; heading?: ResolvedCopy; items: Array<Omit<SectionedViewTestimonialItem, "quote" | "attributorName" | "attributorRole"> & { quote: ResolvedCopy; attributorName: ResolvedCopy; attributorRole?: ResolvedCopy }> }
  | Omit<SectionedViewStatSection, "heading" | "items" | "ground"> & { ground: SectionedViewGround; heading?: ResolvedCopy; items: Array<Omit<SectionedViewStatSectionItem, "label" | "value" | "delta"> & { label: ResolvedCopy; value: ResolvedCopy; delta?: ResolvedCopy }> }
  | ResolvedSectionedViewContentSection;

export interface ResolvedSectionedViewDocument {
  id: string;
  sections: ResolvedSectionedViewSection[];
  /** Every resolved CopyRef in depth-first authored order; pass directly to collectCopyProvenance. */
  resolutions: CopyResolution[];
  /**
   * Ids of canonical content sections that omitted `ground`, plus omitted
   * grounds on published section kinds when `sectionGroundRhythm` is `"view"`.
   * The view assigns their effective grounds; resolved `base` is a placeholder.
   * The `"view"` rhythm also preserves this field when the list is empty.
   */
  viewGrounds?: string[];
}

export type SectionedViewResolutionReason = "invalid-document" | "unresolved-copy" | "unsupported-section-kind";

const SECTION_KINDS: readonly SectionedViewSectionKind[] = [
  "hero",
  "feature-grid",
  "faq",
  "ordered-step-sequence",
  "status-list",
  "stat-grid",
  "pricing",
  "testimonial",
  "stat",
  "content-section",
];

const STAT_TRENDS: readonly SectionedViewStatTrend[] = ["up", "down", "neutral"];

function unsupportedSectionKindMessage(path: string, kind: string): string {
  return `${path}.kind "${kind}" is not a supported SectionedView section kind; supported kinds are ${SECTION_KINDS.join(", ")}.`;
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
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length === 0) {
    findings.push(finding(shapeRule, path, shapeMessage));
    return false;
  }
  let dense = true;
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") continue;
    if (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length) {
      findings.push(finding(shapeRule, path, `${path} must contain only authored array items.`));
      dense = false;
    }
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined) {
      findings.push(finding("sectioned-view-array-hole", `${path}.${index}`, `${path}.${index} must be an authored array item; sparse arrays are not supported.`));
      return false;
    } else if (!descriptor.enumerable || !("value" in descriptor)) {
      findings.push(finding(shapeRule, `${path}.${index}`, `${path}.${index} must be an own enumerable data item.`));
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

/** Internal effective grounds deliberately widen the authored canonical inverse-only field. */
type GroundableContentSection = Omit<SectionedViewContentSection, "ground"> & { ground?: SectionedViewGround };
type GroundableSection = Exclude<SectionedViewSection, SectionedViewContentSection> | GroundableContentSection;
type GroundedSection = GroundableSection & { ground: SectionedViewGround };
type GroundableDocument = Omit<SectionedViewDocument, "sections"> & { sections: GroundableSection[] };

function validateCopy(value: unknown, path: string, findings: ComposeFinding[]): void {
  if (!isCopyRef(value)) findings.push(finding("sectioned-view-copy-ref-shape", path, `${path} must be a CopyRef with a non-empty id.`));
}

function validateCopyRefArray(value: unknown, path: string, findings: ComposeFinding[]): void {
  if (!Array.isArray(value)) {
    findings.push(finding("sectioned-view-features-shape", path, `${path} must be an array of CopyRefs.`));
    return;
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      findings.push(finding("sectioned-view-array-hole", `${path}.${index}`, `${path}.${index} must be an authored array item; sparse arrays are not supported.`));
      continue;
    }
    validateCopy(value[index], `${path}.${index}`, findings);
  }
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
  if (!isPlainObject(value) || !hasOnlyOwnKeys(value, ["id", "sections", "sectionGroundRhythm"]) || !hasOwnKeys(value, ["id", "sections"])) return [finding("sectioned-view-document-shape", "$", "A SectionedViewDocument must be a plain { id, sections } object.")];
  if (!isNonWhitespaceString(value.id)) findings.push(finding("sectioned-view-document-id-shape", "id", "id must be a non-whitespace string."));
  const sectionGroundRhythm = value.sectionGroundRhythm;
  if (sectionGroundRhythm !== undefined && !SECTION_GROUND_RHYTHMS.includes(sectionGroundRhythm as SectionedViewSectionGroundRhythm)) {
    findings.push(finding("sectioned-view-section-ground-rhythm", "sectionGroundRhythm", `sectionGroundRhythm must be one of ${SECTION_GROUND_RHYTHMS.join(", ")}.`));
  }
  if (!validateDenseArray(value.sections, "sections", findings, "sectioned-view-sections-shape", "sections must be a non-empty array.")) return findings;

  const sectionIds = new Set<string>();
  const rhythmFillsGround = sectionGroundRhythm !== undefined;
  let heroCount = 0;
  for (let sectionIndex = 0; sectionIndex < value.sections.length; sectionIndex += 1) {
    const section = value.sections[sectionIndex];
    const path = `sections.${sectionIndex}`;
    if (!isPlainObject(section) || !hasEnumerableOwnDataKeys(section) || !hasOwnKeys(section, ["id", "kind"]) || !isNonWhitespaceString(section.kind) || !isNonWhitespaceString(section.id)) {
      findings.push(finding("sectioned-view-section-shape", path, `${path} must be a section object with id and kind.`));
      continue;
    }
    const hasGround = hasOwn(section, "ground");
    if (!hasGround && !rhythmFillsGround && section.kind !== "content-section") {
      findings.push(finding("sectioned-view-ground-required", `${path}.ground`, `${path}.ground is required when the document does not set sectionGroundRhythm.`));
    }
    const authoredGrounds = section.kind === "content-section" ? ["inverse"] : GROUNDS;
    if (hasGround && (!isNonWhitespaceString(section.ground) || !authoredGrounds.includes(section.ground as SectionedViewGround))) {
      findings.push(finding("sectioned-view-ground", `${path}.ground`, section.kind === "content-section" ? `${path}.ground must be inverse or omitted for automatic cadence.` : `${path}.ground must be one of ${GROUNDS.join(", ")}.`));
    }
    if (!FRAGMENT_ID.test(section.id)) findings.push(finding("sectioned-view-section-id-fragment", `${path}.id`, `${path}.id must be a lowercase, fragment-safe identifier (letters, digits, and hyphens; starting with a letter).`));
    if (sectionIds.has(section.id)) findings.push(finding("sectioned-view-section-id-duplicate", `${path}.id`, `${path}.id duplicates another section id.`));
    sectionIds.add(section.id);

    switch (section.kind) {
      case "hero":
        heroCount += 1;
        if (!hasOnlyOwnKeys(section, ["id", "kind", "ground", "eyebrow", "eyebrowTone", "measure", "headingScale", "heading", "description", "actions", "media", "size"]) || !hasOwn(section, "heading")) findings.push(finding("sectioned-view-section-keys", path, `${path} has keys not allowed for hero.`));
        validateEnumField(section, "size", ["display", "compact"], "sectioned-view-hero-shape", path, findings);
        validateEnumField(section, "eyebrowTone", ["accent", "muted"], "sectioned-view-hero-shape", path, findings);
        validateEnumField(section, "measure", ["prose", "wide"], "sectioned-view-hero-shape", path, findings);
        validateEnumField(section, "headingScale", ["default", "display"], "sectioned-view-hero-shape", path, findings);
        if (section.size === "compact" && section.media !== undefined) findings.push(finding("sectioned-view-hero-compact-media", `${path}.media`, `${path} cannot combine a compact hero with media.`));
        validateCopy(section.heading, `${path}.heading`, findings);
        if (section.eyebrow !== undefined) validateCopy(section.eyebrow, `${path}.eyebrow`, findings);
        if (section.description !== undefined) validateCopy(section.description, `${path}.description`, findings);
        if (section.actions !== undefined) validateHeroActions(section.actions, `${path}.actions`, findings);
        if (section.media !== undefined) validateHeroMedia(section.media, `${path}.media`, findings);
        break;
      case "feature-grid":
        validateRepeatedSection(section, path, ["id", "kind", "ground", "eyebrow", "heading", "description", "items"], ["id", "icon", "heading", "description"], findings, (item, itemPath) => {
          if (hasOwn(item, "icon")) validateIcon(item.icon, `${itemPath}.icon`, findings);
          validateCopy(item.heading, `${itemPath}.heading`, findings);
          if (item.description !== undefined) validateCopy(item.description, `${itemPath}.description`, findings);
        });
        validateCopy(section.heading, `${path}.heading`, findings);
        if (section.eyebrow !== undefined) validateCopy(section.eyebrow, `${path}.eyebrow`, findings);
        if (section.description !== undefined) validateCopy(section.description, `${path}.description`, findings);
        break;
      case "faq":
        validateRepeatedSection(section, path, ["id", "kind", "ground", "eyebrow", "heading", "description", "layout", "items"], ["id", "question", "answer"], findings, (item, itemPath) => {
          validateCopy(item.question, `${itemPath}.question`, findings);
          validateCopy(item.answer, `${itemPath}.answer`, findings);
        });
        if (Array.isArray(section.items)) {
          const [min, max] = SECTIONED_VIEW_CONTENT_CONTRACT.counts.disclose;
          if (section.items.length < min || section.items.length > max) findings.push(countFinding(`${path}.items`, { min, max }, section.items.length, "FAQ rows"));
        }
        validateEnumField(section, "layout", ["stacked", "split"], "sectioned-view-faq-layout", path, findings);
        validateCopy(section.heading, `${path}.heading`, findings);
        if (section.eyebrow !== undefined) validateCopy(section.eyebrow, `${path}.eyebrow`, findings);
        if (section.description !== undefined) validateCopy(section.description, `${path}.description`, findings);
        break;
      case "ordered-step-sequence":
        validateRepeatedSection(section, path, ["id", "kind", "ground", "eyebrow", "heading", "description", "items"], ["id", "ordinal", "label", "heading", "description"], findings, (item, itemPath) => {
          validateCopy(item.ordinal, `${itemPath}.ordinal`, findings);
          if (item.label !== undefined) validateCopy(item.label, `${itemPath}.label`, findings);
          validateCopy(item.heading, `${itemPath}.heading`, findings);
          if (item.description !== undefined) validateCopy(item.description, `${itemPath}.description`, findings);
        });
        validateCopy(section.heading, `${path}.heading`, findings);
        if (section.eyebrow !== undefined) validateCopy(section.eyebrow, `${path}.eyebrow`, findings);
        if (section.description !== undefined) validateCopy(section.description, `${path}.description`, findings);
        break;
      case "status-list":
        validateStatusListSection(section, path, findings);
        break;
      case "stat-grid":
        validateRepeatedSection(section, path, ["id", "kind", "ground", "eyebrow", "heading", "description", "items"], ["id", "label", "value", "delta", "description", "trend"], findings, (item, itemPath) => {
          validateCopy(item.label, `${itemPath}.label`, findings);
          validateCopy(item.value, `${itemPath}.value`, findings);
          if (item.delta !== undefined) validateCopy(item.delta, `${itemPath}.delta`, findings);
          if (item.description !== undefined) validateCopy(item.description, `${itemPath}.description`, findings);
          const hasTrend = hasOwn(item, "trend");
          const hasDelta = hasOwn(item, "delta");
          if (hasTrend && !STAT_TRENDS.includes(item.trend as SectionedViewStatTrend)) findings.push(finding("sectioned-view-stat-trend", `${itemPath}.trend`, `${itemPath}.trend must be one of ${STAT_TRENDS.join(", ")}.`));
          if (hasTrend && !hasDelta) findings.push(finding("sectioned-view-stat-trend-without-delta", `${itemPath}.trend`, `${itemPath}.trend requires ${itemPath}.delta.`));
        });
        validateCopy(section.heading, `${path}.heading`, findings);
        if (section.eyebrow !== undefined) validateCopy(section.eyebrow, `${path}.eyebrow`, findings);
        if (section.description !== undefined) validateCopy(section.description, `${path}.description`, findings);
        break;
      case "pricing":
        validateRepeatedSection(section, path, ["id", "kind", "ground", "eyebrow", "heading", "description", "items"], ["id", "name", "price", "description", "features", "cta"], findings, (item, itemPath) => {
          validateCopy(item.name, `${itemPath}.name`, findings);
          validateCopy(item.price, `${itemPath}.price`, findings);
          if (item.description !== undefined) validateCopy(item.description, `${itemPath}.description`, findings);
          if (!hasOwn(item, "features")) findings.push(finding("sectioned-view-item-shape", itemPath, `${itemPath} must include a features array.`));
          else validateCopyRefArray(item.features, `${itemPath}.features`, findings);
          if (item.cta !== undefined) validateCopy(item.cta, `${itemPath}.cta`, findings);
        });
        validateCopy(section.heading, `${path}.heading`, findings);
        if (section.eyebrow !== undefined) validateCopy(section.eyebrow, `${path}.eyebrow`, findings);
        if (section.description !== undefined) validateCopy(section.description, `${path}.description`, findings);
        break;
      case "testimonial":
        validateRepeatedSectionOptionalHeading(section, path, ["id", "kind", "ground", "heading", "items"], ["id", "quote", "attributorName", "attributorRole"], findings, (item, itemPath) => {
          validateCopy(item.quote, `${itemPath}.quote`, findings);
          validateCopy(item.attributorName, `${itemPath}.attributorName`, findings);
          if (item.attributorRole !== undefined) validateCopy(item.attributorRole, `${itemPath}.attributorRole`, findings);
        });
        if (section.heading !== undefined) validateCopy(section.heading, `${path}.heading`, findings);
        break;
      case "stat":
        validateRepeatedSectionOptionalHeading(section, path, ["id", "kind", "ground", "heading", "items"], ["id", "label", "value", "delta"], findings, (item, itemPath) => {
          validateCopy(item.label, `${itemPath}.label`, findings);
          validateCopy(item.value, `${itemPath}.value`, findings);
          if (item.delta !== undefined) validateCopy(item.delta, `${itemPath}.delta`, findings);
        });
        if (section.heading !== undefined) validateCopy(section.heading, `${path}.heading`, findings);
        break;
      case "content-section":
        validateContentSection(section, path, findings);
        break;
      default:
        findings.push(finding("sectioned-view-section-kind", `${path}.kind`, unsupportedSectionKindMessage(path, section.kind)));
    }
  }
  if (heroCount > 1) findings.push(finding("sectioned-view-hero-count", "sections", "A SectionedViewDocument must contain at most one hero section."));
  return findings;
}

function validateRepeatedSection(section: Record<string, unknown>, path: string, sectionKeys: readonly string[], itemKeys: readonly string[], findings: ComposeFinding[], validateItem: (item: Record<string, unknown>, path: string) => void): void {
  if (!hasOnlyOwnKeys(section, sectionKeys) || !hasOwnKeys(section, ["heading", "items"])) findings.push(finding("sectioned-view-section-keys", path, `${path} has keys not allowed for this section kind.`));
  if (!validateDenseArray(section.items, `${path}.items`, findings, "sectioned-view-items-shape", `${path}.items must be a non-empty array.`)) return;
  validateItemIds(section.items, `${path}.items`, findings);
  for (let itemIndex = 0; itemIndex < section.items.length; itemIndex += 1) {
    const item = section.items[itemIndex];
    const itemPath = `${path}.items.${itemIndex}`;
    const requiredItemKeys = itemKeys.filter((key) => !["icon", "description", "label", "delta", "trend", "cta", "attributorRole"].includes(key));
    if (!isPlainObject(item) || !hasOnlyOwnKeys(item, itemKeys) || !hasOwnKeys(item, requiredItemKeys) || !isNonWhitespaceString(item.id)) {
      findings.push(finding("sectioned-view-item-shape", itemPath, `${itemPath} must be a plain item with a non-whitespace id and only its kind's fields.`));
      continue;
    }
    validateItem(item, itemPath);
  }
}

function validateRepeatedSectionOptionalHeading(section: Record<string, unknown>, path: string, sectionKeys: readonly string[], itemKeys: readonly string[], findings: ComposeFinding[], validateItem: (item: Record<string, unknown>, path: string) => void): void {
  if (!hasOnlyOwnKeys(section, sectionKeys) || !hasOwn(section, "items")) findings.push(finding("sectioned-view-section-keys", path, `${path} has keys not allowed for this section kind.`));
  if (!validateDenseArray(section.items, `${path}.items`, findings, "sectioned-view-items-shape", `${path}.items must be a non-empty array.`)) return;
  validateItemIds(section.items, `${path}.items`, findings);
  for (let itemIndex = 0; itemIndex < section.items.length; itemIndex += 1) {
    const item = section.items[itemIndex];
    const itemPath = `${path}.items.${itemIndex}`;
    const requiredItemKeys = itemKeys.filter((key) => !["delta", "attributorRole"].includes(key));
    if (!isPlainObject(item) || !hasOnlyOwnKeys(item, itemKeys) || !hasOwnKeys(item, requiredItemKeys) || !isNonWhitespaceString(item.id)) {
      findings.push(finding("sectioned-view-item-shape", itemPath, `${itemPath} must be a plain item with a non-whitespace id and only its kind's fields.`));
      continue;
    }
    validateItem(item, itemPath);
  }
}

/**
 * Hero actions. Present or absent, never empty: an authored empty array is a
 * missing decision rather than an expressed one, the same rule every other
 * repeated slot in this contract already follows.
 */
function validateHeroMedia(value: unknown, path: string, findings: ComposeFinding[]): void {
  if (!isPlainObject(value) || !hasOnlyOwnKeys(value, ["assetId", "alt"]) || !hasOwnKeys(value, ["assetId", "alt"]) || !isNonWhitespaceString(value.assetId)) {
    findings.push(finding("sectioned-view-hero-media-shape", path, `${path} must be a plain { assetId, alt } object with a non-empty assetId.`));
    return;
  }
  validateCopy(value.alt, `${path}.alt`, findings);
}

/**
 * Actions, hero or content-section. Content actions allow the full ladder;
 * hero actions allow primary, secondary and quiet. Returns the records
 * that passed the shape check.
 */
function validateActions(value: unknown, path: string, findings: ComposeFinding[], allowEmphasis = false): Record<string, unknown>[] {
  if (!validateDenseArray(value, path, findings, "sectioned-view-actions-shape", `${path} must be a non-empty array when present.`)) return [];
  validateItemIds(value, path, findings);
  const keys = ["id", "label", "href", "emphasis"];
  const actions: Record<string, unknown>[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const action = value[index];
    const actionPath = `${path}.${index}`;
    if (!isPlainObject(action) || !hasOnlyOwnKeys(action, keys) || !hasOwnKeys(action, ["id", "label", "href"]) || !isNonWhitespaceString(action.id)) {
      findings.push(finding("sectioned-view-action-shape", actionPath, `${actionPath} must be a plain action with id, label, and href, and optionally emphasis.`));
      continue;
    }
    validateCopy(action.label, `${actionPath}.label`, findings);
    if (!isSanctionedHref(action.href)) findings.push(finding("sectioned-view-action-href", `${actionPath}.href`, `${actionPath}.href must be a fragment, a one-origin path, an http(s) URL, or a mailto link.`));
    validateEnumField(action, "emphasis", allowEmphasis ? CONTENT_ACTION_EMPHASES : ROLE_ACTION_EMPHASES, allowEmphasis ? "sectioned-view-content-action-emphasis" : "sectioned-view-hero-action-emphasis", actionPath, findings);
    actions.push(action);
  }
  return actions;
}

/** Hero limits count effective defaults as well as authored primary emphasis. */
function validateHeroActions(value: unknown, path: string, findings: ComposeFinding[]): void {
  const actions = validateActions(value, path, findings);
  if (Array.isArray(value) && value.length > 2) findings.push(finding("sectioned-view-hero-actions-count", path, `${path} must hold at most two actions.`));
  const primaries = actions.filter((action, index) => resolveRoleActionEmphasis(action.emphasis as SectionedViewActionEmphasis | undefined, index) === "primary").length;
  if (primaries > 1) findings.push(finding("sectioned-view-hero-primary-count", path, `${path} must hold at most one effective primary action.`));
  if (actions.length === 1 && primaries !== 1) findings.push(finding("sectioned-view-hero-lone-action", path, `${path}'s lone action must be primary.`));
}

/**
 * A content section's actions: one or two, at most one authored `primary`.
 * Derived weight determines omitted emphasis; the footnote carries an aside.
 */
function validateContentActions(value: unknown, path: string, findings: ComposeFinding[]): void {
  const actions = validateActions(value, path, findings, true);
  if (Array.isArray(value) && value.length > CONTENT_ACTIONS_MAX) {
    findings.push(finding("sectioned-view-content-actions-count", path, `${path} must hold 1-${CONTENT_ACTIONS_MAX} actions; it holds ${value.length}. Move an aside to the section's footnote.`));
  }
  const primaries = actions.filter((action) => action.emphasis === "primary").length;
  if (primaries > 1) findings.push(finding("sectioned-view-content-primary-count", path, `${path} holds ${primaries} primary actions; keep at most one, the rest secondary.`));
}

/** A footnote: closed `{ text, link? }`, its link closed `{ label, href }` with a sanctioned href. */
function validateContentFootnote(value: unknown, path: string, findings: ComposeFinding[]): void {
  if (!isPlainObject(value) || !hasOnlyOwnKeys(value, ["text", "link"]) || (value.text === undefined && value.link === undefined)) {
    findings.push(finding("sectioned-view-content-footnote-shape", path, `${path} must be a plain footnote with text, a link, or both.`));
    return;
  }
  if (value.text !== undefined) validateCopy(value.text, `${path}.text`, findings);
  if (value.link === undefined) return;
  const link = value.link;
  const linkPath = `${path}.link`;
  if (!isPlainObject(link) || !hasOnlyOwnKeys(link, ["label", "href"]) || !hasOwnKeys(link, ["label", "href"])) {
    findings.push(finding("sectioned-view-content-footnote-shape", linkPath, `${linkPath} must be one plain link with a label and an href.`));
    return;
  }
  validateCopy(link.label, `${linkPath}.label`, findings);
  if (!isSanctionedHref(link.href)) findings.push(finding("sectioned-view-content-footnote-href", `${linkPath}.href`, `${linkPath}.href must be a fragment, a one-origin path, an http(s) URL, or a mailto link.`));
}

function validateStatusListSection(section: Record<string, unknown>, path: string, findings: ComposeFinding[]): void {
  const firstFinding = findings.length;
  if (!hasOnlyOwnKeys(section, ["id", "kind", "ground", "eyebrow", "heading", "description", "labels", "groups", "items"]) || !hasOwnKeys(section, ["heading", "labels"])) findings.push(finding("sectioned-view-section-keys", path, `${path} has keys not allowed for status-list.`));
  validateCopy(section.heading, `${path}.heading`, findings);
  if (section.eyebrow !== undefined) validateCopy(section.eyebrow, `${path}.eyebrow`, findings);
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

  const hasGroups = hasOwn(section, "groups");
  const hasItems = hasOwn(section, "items");
  if (hasGroups === hasItems) {
    findings.push(finding("sectioned-view-status-shape", path, `${path} must have exactly one of groups or items.`));
    return;
  }
  if (hasItems) {
    validateStatusItems(section.items, `${path}.items`, findings);
    validateStatusListProjection(section, path, findings, firstFinding);
    return;
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
    validateStatusItems(group.items, `${groupPath}.items`, findings);
  }
  validateStatusListProjection(section, path, findings, firstFinding);
}

/** The original status shape is complete before the canonical projection is inspected. */
function validateStatusListProjection(section: Record<string, unknown>, path: string, findings: ComposeFinding[], start: number): void {
  if (findings.slice(start).some(entry => entry.severity === "error")) return;
  try {
    const block = projectStatusListItems(section as unknown as SectionedViewStatusListSection);
    validateContentBlock(block, `${path}.block`, findings);
  } catch (error) {
    findings.push(finding("sectioned-view-status-catalog", path, error instanceof Error ? error.message : "Invalid status catalog projection."));
  }
}

/**
 * Validates a dense array of status items, shared between a group's `items`
 * and a status-list section's flat `items`: the row shape and the exactly-
 * one-of-state-or-disposition rule do not depend on whether a group heading
 * sits above the list.
 */
function validateStatusItems(value: unknown, path: string, findings: ComposeFinding[]): void {
  if (!validateDenseArray(value, path, findings, "sectioned-view-status-items-shape", `${path} must be a non-empty array.`)) return;
  validateItemIds(value, path, findings);
  for (let itemIndex = 0; itemIndex < value.length; itemIndex += 1) {
    const item = value[itemIndex];
    const itemPath = `${path}.${itemIndex}`;
    if (!isPlainObject(item) || !hasOnlyOwnKeys(item, ["id", "label", "detail", "state", "disposition"]) || !hasOwn(item, "id") || !hasOwn(item, "label") || !isNonWhitespaceString(item.id)) {
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
    if (item.detail !== undefined) validateCopy(item.detail, `${itemPath}.detail`, findings);
    if (hasState && !STATUSES.includes(item.state as SectionedViewStatus)) findings.push(finding("sectioned-view-status-state", `${itemPath}.state`, `${itemPath}.state must be one of ${STATUSES.join(", ")}.`));
    if (hasDisposition && !DISPOSITIONS.includes(item.disposition as SectionedViewStatusDisposition)) findings.push(finding("sectioned-view-status-disposition", `${itemPath}.disposition`, `${itemPath}.disposition must be one of ${DISPOSITIONS.join(", ")}.`));
  }
}

// ---------------------------------------------------------------------------
// content-section validation
// ---------------------------------------------------------------------------

const CONTENT_SECTION_KEYS = ["id", "kind", "ground", "size", "eyebrow", "heading", "description", "actions", "layout", "block", "media", "footnote"] as const;
const ROLE_ACTION_EMPHASES: readonly SectionedViewActionEmphasis[] = ["primary", "secondary", "quiet"];
const CONTENT_ACTION_EMPHASES: readonly SectionedViewContentActionEmphasis[] = ["primary", "secondary", "tertiary", "quiet"];
const CONTENT_ACTIONS_MAX = 2;
const CONTENT_LAYOUTS = SECTIONED_VIEW_CONTENT_CONTRACT.layouts;
const CARD_SPAN_UNITS = SECTIONED_VIEW_CONTENT_CONTRACT.spans;
const CARD_ROW_UNITS = SECTIONED_VIEW_CONTENT_CONTRACT.counts.rowUnits;
const SPECIMEN_TONES = SECTIONED_VIEW_CONTENT_CONTRACT.tones;
const SPECIMEN_PART_TYPES: readonly SectionedViewSpecimenPartType[] = ["fields", "status-rows", "meter", "table", "schedule", "shares", "files"];
const FIELDS_COLUMNS = [1, 2, 4] as const;
const METER_DIRECTIONS = ["max", "min"] as const;
const CONTENT_LINKED_ITEMS_MAX = SECTIONED_VIEW_CONTENT_CONTRACT.counts.linked;
/** Item eyebrow copy remains short enough to scan above its heading. */
export const CONTENT_ITEM_EYEBROW_MAX_CHARACTERS = 32;
const PART_MAX_ROWS = 6;
const CARD_VISUAL_MAX_ROWS = 5;
const TABLE_MAX_COLUMNS = 4;
const TABLE_MAX_ROWS = 5;
const PANEL_MAX_PARTS = 3;

interface CountBounds {
  min: number;
  max: number;
}

function countFinding(path: string, bounds: CountBounds, count: number, unit = "items"): ComposeFinding {
  const range = bounds.min === bounds.max ? `exactly ${bounds.min}` : `${bounds.min}-${bounds.max}`;
  return finding("sectioned-view-content-count", path, `${path} must hold ${range} ${unit}; it holds ${count}.`);
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function validateEnumField(record: Record<string, unknown>, key: string, allowed: readonly unknown[], rule: string, path: string, findings: ComposeFinding[], required = false, hint = ""): void {
  if ((required || record[key] !== undefined) && !allowed.includes(record[key])) findings.push(finding(rule, `${path}.${key}`, `${path}.${key} must be one of ${allowed.join(", ")}.${hint}`));
}

function validateOptionalCopyFields(record: Record<string, unknown>, keys: readonly string[], path: string, findings: ComposeFinding[]): void {
  for (const key of keys) if (record[key] !== undefined) validateCopy(record[key], `${path}.${key}`, findings);
}

function validateIcon(value: unknown, path: string, findings: ComposeFinding[]): void {
  if (!CONTENT_ICON_NAMES.includes(value as ContentIconName)) findings.push(finding("sectioned-view-content-icon", path, `${path} must be one of ${CONTENT_ICON_NAMES.join(", ")}.`));
}

/**
 * A dense, non-empty array of id-bearing records within its count bounds,
 * each with only `keys` and at least `required`. Returns the records that
 * passed the shape check, after their own field validation.
 */
function validateRecords(
  value: unknown,
  path: string,
  findings: ComposeFinding[],
  bounds: CountBounds,
  keys: readonly string[],
  required: readonly string[],
  validateRecord: (record: Record<string, unknown>, recordPath: string) => void,
  itemRetirementHint = false,
): Record<string, unknown>[] {
  if (!validateDenseArray(value, path, findings, "sectioned-view-items-shape", `${path} must be a non-empty array.`)) return [];
  if (value.length < bounds.min || value.length > bounds.max) findings.push(countFinding(path, bounds, value.length));
  validateItemIds(value, path, findings);
  const records: Record<string, unknown>[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const record = value[index];
    const recordPath = `${path}.${index}`;
    if (!isPlainObject(record) || !hasOnlyOwnKeys(record, keys) || !hasOwnKeys(record, ["id", ...required]) || !isNonWhitespaceString(record.id)) {
      const hint = itemRetirementHint && isPlainObject(record) && hasOwn(record, "featured") && !keys.includes("featured") ? " Item featured is retired; remove featured." : "";
      findings.push(finding("sectioned-view-item-shape", recordPath, `${recordPath} must be a plain item with a non-whitespace id, its required fields, and only its own fields.${hint}`));
      continue;
    }
    validateRecord(record, recordPath);
    records.push(record);
  }
  return records;
}

function validateContentSection(section: Record<string, unknown>, path: string, findings: ComposeFinding[]): void {
  if (hasOwn(section, "module")) findings.push(finding("sectioned-view-content-module-retired", `${path}.module`, `${path}.module is retired; use block with items, matrix or prose.`));
  if (!hasOnlyOwnKeys(section, CONTENT_SECTION_KEYS) || !hasOwn(section, "heading")) findings.push(finding("sectioned-view-section-keys", path, `${path} has keys not allowed for content-section.${hasOwn(section, "align") ? " Alignment is derived; remove align." : ""}`));
  validateCopy(section.heading, `${path}.heading`, findings);
  validateOptionalCopyFields(section, ["eyebrow", "description"], path, findings);
  if (section.actions !== undefined) validateContentActions(section.actions, `${path}.actions`, findings);
  if (section.footnote !== undefined) validateContentFootnote(section.footnote, `${path}.footnote`, findings);
  validateEnumField(section, "size", SECTIONED_VIEW_CONTENT_CONTRACT.sizes, "sectioned-view-content-size", path, findings, false, section.size === "compact" ? " Compact content frames are retired; use standard or display." : "");
  validateEnumField(section, "layout", CONTENT_LAYOUTS, "sectioned-view-content-layout", path, findings);
  validateContentActionPlacement(section, path, findings);
  if (section.block !== undefined) validateContentBlock(section.block, `${path}.block`, findings);
  if (section.media !== undefined) {
    validateContentMedia(section.media, `${path}.media`, findings);
    if ((section.layout === "split-start" || section.layout === "split-end") && isPlainObject(section.media) && hasEnumerableOwnDataKeys(section.media) && section.media.type === "record" && (section.media.columns === 2 || section.media.columns === 3)) findings.push(finding("sectioned-view-record-columns", `${path}.media.columns`, "Multi-column records need a stacked frame."));
    if ((section.layout === "split-start" || section.layout === "split-end") && isPlainObject(section.media) && hasEnumerableOwnDataKeys(section.media) && isPlainObject(section.media.input) && hasEnumerableOwnDataKeys(section.media.input) && typeof section.media.input.template === "string" && ["converge", "approval-chain"].includes(section.media.input.template)) findings.push(finding("sectioned-view-scene-slot-width", `${path}.media`, "This scene needs a stacked frame's full width."));
  }
  if (section.layout !== undefined && section.layout !== "stacked" && isPlainObject(section.block) && hasEnumerableOwnDataKeys(section.block) && section.block.type === "items" && section.block.lanes !== undefined) findings.push(finding("sectioned-view-content-steps-lanes-layout", `${path}.block`, "A lanes block needs a stacked frame."));
}

/**
 * Where a content section's actions may go (shared by the document contract
 * and the renderer's resolved-model check). A stacked band whose intro is
 * followed by a block or a visual takes none; a header-only band with actions
 * takes no footnote, since nothing follows an action. A split keeps them in
 * its text column. @internal
 */
export function validateContentActionPlacement(section: Record<string, unknown>, path: string, findings: ComposeFinding[]): void {
  const split = section.layout === "split-start" || section.layout === "split-end";
  if (!split && section.actions !== undefined && (section.block !== undefined || section.media !== undefined)) {
    findings.push(
      finding(
        "sectioned-view-content-stacked-actions",
        `${path}.actions`,
        `${path} is a stacked band whose intro is followed by a block or visual, so it takes no section actions. Link the cards themselves (item \`href\`), or put one link in the footnote.`,
      ),
    );
  }
  if (!split && section.block === undefined && section.media === undefined && section.actions !== undefined && section.footnote !== undefined) {
    findings.push(
      finding(
        "sectioned-view-content-actions-footnote",
        `${path}.footnote`,
        `${path} is a header-only band with actions, and nothing follows an action: fold the footnote sentence into the description, or drop the actions.`,
      ),
    );
  }
}

/** An item's optional `href`: sanctioned, and never on a statement item (a headline, not a destination). @internal */
export function validateItemHref(item: Record<string, unknown>, path: string, findings: ComposeFinding[], statement = false): void {
  if (item.href === undefined) return;
  if (statement) {
    findings.push(finding("sectioned-view-content-link-statement", `${path}.href`, `${path}.href is not allowed on a statement feature grid: its items are headlines, not destinations. Put one link in the footnote.`));
    return;
  }
  if (!isSanctionedHref(item.href)) findings.push(finding("sectioned-view-content-item-href", `${path}.href`, `${path}.href must be a fragment, a one-origin path, an http(s) URL, or a mailto link.`));
}

/**
 * A destination as a group compares it: without its fragment (unless it is
 * only a fragment) and without a trailing slash (unless it is the root).
 */
function linkDestination(href: string): string {
  const hash = href.indexOf("#");
  const base = hash > 0 ? href.slice(0, hash) : href;
  return base.length > 1 && base.endsWith("/") ? base.slice(0, -1) : base;
}

/**
 * The group rules for a block's linked items: every item linked or none, at
 * most `CONTENT_LINKED_ITEMS_MAX` links, and each destination once. @internal
 */
export function validateLinkGroup(items: unknown, path: string, findings: ComposeFinding[]): void {
  if (!Array.isArray(items)) return;
  const hrefs = items.map((item) => (isPlainObject(item) ? item.href : undefined));
  const linked = hrefs.filter((href) => href !== undefined);
  if (linked.length === 0) return;
  if (linked.length !== items.length) {
    findings.push(finding("sectioned-view-content-link-partial", path, `${path} links ${linked.length} of ${items.length} items; link every item or none, so a reader never has to guess which one is a link.`));
  }
  if (linked.length > CONTENT_LINKED_ITEMS_MAX) {
    findings.push(finding("sectioned-view-content-link-count", path, `${path} links ${linked.length} items; a block links at most ${CONTENT_LINKED_ITEMS_MAX}. Cut the list, or leave it unlinked.`));
  }
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const href of linked) {
    if (typeof href !== "string") continue;
    const destination = linkDestination(href);
    if (seen.has(destination)) repeated.add(destination);
    seen.add(destination);
  }
  for (const destination of repeated) {
    findings.push(finding("sectioned-view-content-link-duplicate", path, `${path} links "${destination}" more than once; each linked item needs its own destination.`));
  }
}

/** Badge metadata is independent of the item or panel meta copy. */
function validateBadge(value: unknown, path: string, findings: ComposeFinding[]): void {
  if (!isPlainObject(value) || !hasOnlyOwnKeys(value, ["label", "tone"]) || !hasOwn(value, "label")) { findings.push(finding("sectioned-view-badge-shape", path, `${path} must hold label and optionally a Badge tone.`)); return; }
  validateCopy(value.label, `${path}.label`, findings);
  validateEnumField(value, "tone", SPECIMEN_TONES, "sectioned-view-badge-tone", path, findings);
}
function validateProse(block: Record<string, unknown>, path: string, findings: ComposeFinding[]): void {
  const shape = "sectioned-view-content-prose-shape";
  if (!hasOnlyOwnKeys(block, ["type", "paragraphs"]) || !hasOwn(block, "paragraphs")) findings.push(finding(shape, path, `${path} must hold only type and paragraphs.`));
  const paragraphsPath = `${path}.paragraphs`;
  if (!validateDenseArray(block.paragraphs, paragraphsPath, findings, shape, `${paragraphsPath} must be a non-empty data array.`)) return;
  const budget = SECTIONED_VIEW_CONTENT_CONTRACT.prose;
  if (block.paragraphs.length > budget.paragraphs) findings.push(countFinding(paragraphsPath, { min: 1, max: budget.paragraphs }, block.paragraphs.length, "paragraphs"));
  block.paragraphs.forEach((paragraph, paragraphIndex) => {
    const paragraphPath = `${paragraphsPath}.${paragraphIndex}`;
    if (!validateDenseArray(paragraph, paragraphPath, findings, shape, `${paragraphPath} must be a non-empty data array of spans.`)) return;
    if (paragraph.length > budget.spansPerParagraph) findings.push(countFinding(paragraphPath, { min: 1, max: budget.spansPerParagraph }, paragraph.length, "spans"));
    let links = 0;
    paragraph.forEach((span, spanIndex) => {
      const spanPath = `${paragraphPath}.${spanIndex}`;
      if (!isPlainObject(span) || !hasEnumerableOwnDataKeys(span)) { findings.push(finding(shape, spanPath, `${spanPath} must be a plain data span.`)); return; }
      if (span.type !== "text" && span.type !== "link") { findings.push(finding(shape, `${spanPath}.type`, `${spanPath}.type must be text or link.`)); return; }
      const keys = span.type === "link" ? ["type", "text", "href"] : ["type", "text"];
      if (!hasOnlyOwnKeys(span, keys) || !hasOwnKeys(span, keys)) findings.push(finding(shape, spanPath, `${spanPath} must hold only ${keys.join(", ")}.`));
      validateCopy(span.text, `${spanPath}.text`, findings);
      if (span.type === "link") {
        links += 1;
        if (!isSanctionedHref(span.href)) findings.push(finding("sectioned-view-content-prose-href", `${spanPath}.href`, `${spanPath}.href must be a fragment, a one-origin path, an http(s) URL, or a mailto link.`));
      }
    });
    if (links > budget.linksPerParagraph) findings.push(countFinding(paragraphPath, { min: 0, max: budget.linksPerParagraph }, links, "links"));
  });
}
function validateContentBlock(value: unknown, path: string, findings: ComposeFinding[]): void {
  if (!isPlainObject(value) || !hasEnumerableOwnDataKeys(value)) { findings.push(finding("sectioned-view-content-block-shape", path, `${path} must be a plain data block.`)); return; }
  if (value.type === "prose") { validateProse(value, path, findings); return; }
  const replacements: Readonly<Record<string, string>> = { "feature-grid": "features", "card-grid": "cards", "topic-list": "topics", "ordered-step-sequence": "steps", faq: "faq", comparison: "comparison" };
  if (typeof value.type === "string" && Object.hasOwn(replacements, value.type)) { findings.push(finding("sectioned-view-content-block-retired", `${path}.type`, `${path}.type ${value.type} is retired; use the ${replacements[value.type]} recipe on ${value.type === "comparison" ? "matrix" : "items"}.`)); return; }
  if (value.type === "matrix") { validateMatrix(value, path, findings); return; }
  if (value.type !== "items") { findings.push(finding("sectioned-view-content-block-type", `${path}.type`, `${path}.type "${typeof value.type === "string" ? value.type : "unknown"}" must be items, matrix or prose.`)); return; }
  if (!hasOnlyOwnKeys(value, ["type", "recipe", "arrangement", "columns", "order", "reveal", "treatment", "scale", "items", "groups", "lanes", "end", "endLabel", "caption"]) || !hasOwn(value, "items")) findings.push(finding("sectioned-view-content-block-shape", path, `${path} has fields outside the items contract.`));
  let block: CanonicalSectionedViewItemsBlock;
  try { block = desugarRecipe(value as unknown as SectionedViewItemsBlock); }
  catch (error) { findings.push(finding("recipe-axis", path, error instanceof Error ? error.message : "recipe-axis: invalid recipe.")); return; }
  const record = block as unknown as Record<string, unknown>;
  for (const [key, allowed] of [["arrangement", SECTIONED_VIEW_CONTENT_CONTRACT.arrangements], ["order", SECTIONED_VIEW_CONTENT_CONTRACT.orders], ["reveal", SECTIONED_VIEW_CONTENT_CONTRACT.reveals], ["treatment", SECTIONED_VIEW_CONTENT_CONTRACT.treatments], ["scale", SECTIONED_VIEW_CONTENT_CONTRACT.scales]] as const) validateEnumField(record, key, allowed, "sectioned-view-content-module-option", path, findings);
  if (block.arrangement === undefined) findings.push(finding("sectioned-view-content-arrangement", `${path}.arrangement`, `${path}.arrangement is required without a recipe.`));
  if (block.arrangement === "columns") validateEnumField(record, "columns", SECTIONED_VIEW_CONTENT_CONTRACT.columnOptions, "sectioned-view-content-columns", path, findings);
  else if (block.arrangement === "rows") validateEnumField(record, "columns", SECTIONED_VIEW_CONTENT_CONTRACT.rowColumnOptions, "sectioned-view-content-columns", path, findings);
  else if (block.columns !== undefined) findings.push(finding("sectioned-view-content-columns", `${path}.columns`, "Only columns and rows arrangements take columns."));
  if (block.order === "connected" && !["columns", "stacked"].includes(block.arrangement)) findings.push(finding("sectioned-view-content-order", `${path}.order`, "Connected order requires columns or stacked."));
  if (block.reveal === "disclose" && block.arrangement !== "rows") findings.push(finding("sectioned-view-content-reveal", `${path}.reveal`, "Disclosure requires rows."));
  if (block.scale === "statement" && (block.arrangement !== "columns" || block.columns !== 3 || !["plain", "rule"].includes(block.treatment))) findings.push(finding("sectioned-view-content-statement", path, "Statement scale needs three plain or ruled columns."));
  validateOptionalCopyFields(record, ["endLabel", "caption"], path, findings);
  validateEnumField(record, "end", ["ends", "continues"], "sectioned-view-content-module-option", path, findings);
  if (block.order !== "connected" && ["lanes", "end", "endLabel", "caption"].some((key) => record[key] !== undefined)) findings.push(finding("sectioned-view-content-order", path, "Lanes, end and caption belong to connected items."));
  const C = SECTIONED_VIEW_CONTENT_CONTRACT.counts;
  const bounds = block.order === "connected" ? C.connected : block.reveal === "disclose" ? C.disclose : block.arrangement === "rows" ? C.rows : block.arrangement === "bento" ? C.bento : block.arrangement === "stacked" ? C.stacked : C.columns;
  const itemRecords = validateRecords(block.items, `${path}.items`, findings, { min: bounds[0], max: bounds[1] }, ["id", "heading", "description", "eyebrow", "icon", "meta", "visual", "href", "span", "lane", "badge"], ["heading"], (item, itemPath) => {
    validateCopy(item.heading, `${itemPath}.heading`, findings);
    validateOptionalCopyFields(item, ["description", "eyebrow", "meta"], itemPath, findings);
    if (block.reveal === "disclose" && (item.description === undefined || item.href !== undefined || item.visual !== undefined)) findings.push(finding("sectioned-view-content-disclosure", itemPath, "Disclosed items require a description and cannot take href or visual."));
    if (item.icon !== undefined) validateIcon(item.icon, `${itemPath}.icon`, findings);
    validateItemHref(item, itemPath, findings, block.scale === "statement");
    if (item.badge !== undefined) validateBadge(item.badge, `${itemPath}.badge`, findings);
    if (item.visual !== undefined) validateSpecimenPart(item.visual, `${itemPath}.visual`, findings, CARD_VISUAL_MAX_ROWS);
    if (item.span !== undefined && (block.arrangement !== "bento" || typeof item.span !== "string" || !Object.hasOwn(CARD_SPAN_UNITS, item.span))) findings.push(finding("sectioned-view-content-card-spans", `${itemPath}.span`, "Span is a closed bento-only field."));
    if (item.lane !== undefined && (block.order !== "connected" || block.lanes === undefined || !isNonWhitespaceString(item.lane))) findings.push(finding("sectioned-view-content-steps-lanes-shape", `${itemPath}.lane`, "Lane requires connected items with declared lanes."));
    const recipe = block.recipe === undefined ? undefined : SECTIONED_VIEW_ITEM_RECIPES[block.recipe];
    if (recipe !== undefined) {
      for (const slot of ["icon", "eyebrow", "href", "meta", "visual", "span", "lane"]) if (item[slot] !== undefined && !recipe.slots.includes(slot)) findings.push(finding("recipe-slot", `${itemPath}.${slot}`, `${block.recipe} does not take ${slot}.`));
      if (recipe.requiredSlot !== undefined && item[recipe.requiredSlot] === undefined) findings.push(finding("recipe-slot", itemPath, `${block.recipe} requires ${recipe.requiredSlot} on every item.`));
    }
    if (block.scale === "statement" && ["icon", "eyebrow", "meta", "visual", "lane"].some((slot) => item[slot] !== undefined)) findings.push(finding("sectioned-view-content-statement", itemPath, "Statement items take heading, description and optional badge only."));
  }, true);
  if (block.order === "connected" && block.caption !== undefined && !itemRecords.some((item) => item.visual !== undefined)) findings.push(finding("sectioned-view-content-steps-caption", `${path}.caption`, "A connected caption requires a step visual."));
  if (!Array.isArray(block.items)) return;
  const count = block.items.length;
  if (block.order === "connected" && block.lanes === undefined && count === 4) findings.push({ rule: "steps-count", severity: "warning", path: `${path}.items`, message: "A connected sequence reads more clearly with three or five items." });
  if (block.order !== "connected" && block.arrangement === "columns" && !(block.columns === 2 ? C.columns2 : C.columns3).includes(count)) findings.push(finding("sectioned-view-content-count", `${path}.items`, "Columns must fill complete rows."));
  if (block.arrangement === "rows" && block.columns === 2 && count % 2 !== 0) findings.push(finding("sectioned-view-content-count", `${path}.items`, "Two-column rows need an even item count."));
  if (block.scale === "statement" && count !== 3) findings.push(finding("sectioned-view-content-count", `${path}.items`, "Statement scale needs exactly three items."));
  validateLinkGroup(itemRecords, `${path}.items`, findings);
  if (block.arrangement === "bento" && itemRecords.length === count && itemRecords.every((item) => item.span === undefined || (typeof item.span === "string" && Object.hasOwn(CARD_SPAN_UNITS, item.span)))) validateCardRows(itemRecords.map((item) => (item.span ?? "half") as SectionedViewItemSpan), `${path}.items`, findings);
  if (block.groups !== undefined) {
    if (block.arrangement !== "rows") findings.push(finding("sectioned-view-content-topics-groups-shape", `${path}.groups`, "Groups require rows."));
    if (block.recipe !== undefined && !SECTIONED_VIEW_ITEM_RECIPES[block.recipe].slots.includes("groups")) findings.push(finding("recipe-slot", `${path}.groups`, `${block.recipe} does not take groups.`));
    const membership: string[] = [];
    validateRecords(block.groups, `${path}.groups`, findings, { min: C.groups[0], max: C.groups[1] }, ["id", "label", "items"], ["label", "items"], (group, groupPath) => {
      validateCopy(group.label, `${groupPath}.label`, findings);
      if (validateDenseArray(group.items, `${groupPath}.items`, findings, "sectioned-view-content-topics-groups-shape", "A group needs item ids.")) {
        if (group.items.length < C.groupItems[0] || group.items.length > C.groupItems[1]) findings.push(finding("sectioned-view-content-topics-groups-shape", `${groupPath}.items`, "A group needs two to four item ids."));
        group.items.forEach((id, index) => { if (!isNonWhitespaceString(id)) findings.push(finding("sectioned-view-content-topics-groups-shape", `${groupPath}.items.${index}`, "Group members must be item ids.")); else membership.push(id); });
      }
    });
    const ids = itemRecords.map((item) => item.id);
    if (membership.length !== ids.length || new Set(membership).size !== membership.length || ids.some((id) => !membership.includes(String(id)))) findings.push(finding("sectioned-view-content-topics-groups-membership", `${path}.groups`, "Groups must partition every item id exactly once."));
  }
  if (block.lanes !== undefined) {
    const lanes = validateRecords(block.lanes, `${path}.lanes`, findings, { min: C.laneDefinitions, max: C.laneDefinitions }, ["id", "label"], ["label"], (lane, lanePath) => validateCopy(lane.label, `${lanePath}.label`, findings));
    if (lanes.length !== C.laneDefinitions || !["columns", "stacked"].includes(block.arrangement) || block.order !== "connected") findings.push(finding("sectioned-view-content-steps-lanes-shape", `${path}.lanes`, "Two lanes require connected columns or stacked items."));
    const ids = lanes.map((lane) => lane.id);
    if (itemRecords.some((item) => !ids.includes(item.lane)) || itemRecords[0]?.lane !== ids[0] || ids.some((id) => !itemRecords.some((item) => item.lane === id))) findings.push(finding("sectioned-view-content-steps-lanes-shape", `${path}.items`, "Every step names a known lane; start in the first lane and use both lanes."));
  }
}
function validateMatrix(block: Record<string, unknown>, path: string, findings: ComposeFinding[]): void {
  if (!hasOnlyOwnKeys(block, ["type", "recipe", "sides", "featured"]) || !hasOwn(block, "sides")) findings.push(finding("sectioned-view-content-matrix-shape", path, "A matrix holds sides and optionally recipe and featured."));
  validateEnumField(block, "recipe", ["comparison"], "recipe-axis", path, findings);
  const sides = validateRecords(block.sides, `${path}.sides`, findings, { min: SECTIONED_VIEW_CONTENT_CONTRACT.counts.matrix, max: SECTIONED_VIEW_CONTENT_CONTRACT.counts.matrix }, ["id", "label", "heading", "description", "points", "visual"], ["heading"], (side, sidePath) => {
    validateOptionalCopyFields(side, ["label"], sidePath, findings); validateCopy(side.heading, `${sidePath}.heading`, findings);
    if (["points", "visual"].every((key) => side[key] === undefined) || (side.points !== undefined && side.visual !== undefined)) findings.push(finding("sectioned-view-content-matrix-form", sidePath, "A side needs points or visual; description is an optional lead and points and visual cannot be combined."));
    validateOptionalCopyFields(side, ["description"], sidePath, findings);
    if (side.points !== undefined && validateDenseArray(side.points, `${sidePath}.points`, findings, "sectioned-view-items-shape", "Points must be CopyRefs.")) { const [min, max] = SECTIONED_VIEW_CONTENT_CONTRACT.counts.points; if (side.points.length < min || side.points.length > max) findings.push(countFinding(`${sidePath}.points`, { min, max }, side.points.length, "points")); side.points.forEach((point, index) => validateCopy(point, `${sidePath}.points.${index}`, findings)); }
    if (side.visual !== undefined) validateSpecimenPanel(side.visual, `${sidePath}.visual`, findings);
  });
  if (sides.some((side) => (side.label !== undefined) !== (sides[0]!.label !== undefined))) findings.push(finding("sectioned-view-content-matrix-labels", `${path}.sides`, "Both sides must have labels or neither side may have a label."));
  const form = (side: Record<string, unknown>) => ["visual", "points"].find((key) => side[key] !== undefined);
  if (sides.some((side) => form(side) !== form(sides[0]!) || (Array.isArray(side.points) && Array.isArray(sides[0]?.points) && side.points.length !== sides[0].points.length))) findings.push(finding("sectioned-view-content-matrix-form", `${path}.sides`, "Sides must share a primary form and an equal point count."));
  if (block.featured !== undefined && (!isNonWhitespaceString(block.featured) || !sides.some((side) => side.id === block.featured))) findings.push(finding("sectioned-view-content-featured", `${path}.featured`, "Featured must name a matrix side id."));
}

/**
 * Cards fill whole 12-column rows in order: two-thirds + third (either
 * order), three thirds, two halves, or one full card. Any other sequence
 * overflows a row or leaves the last one short.
 */
function validateCardRows(spans: readonly SectionedViewItemSpan[], path: string, findings: ComposeFinding[]): void {
  let filled = 0;
  for (let index = 0; index < spans.length; index += 1) {
    filled += CARD_SPAN_UNITS[spans[index]!];
    if (filled > CARD_ROW_UNITS) {
      findings.push(finding("sectioned-view-content-card-spans", `${path}.${index}.span`, `${path}.${index}.span overflows its row; cards must fill whole rows (two-thirds + third, three thirds, two halves, or one full card).`));
      return;
    }
    if (filled === CARD_ROW_UNITS) filled = 0;
  }
  if (filled !== 0) findings.push(finding("sectioned-view-content-card-spans", path, `${path} leaves its last row unfilled; cards must fill whole rows (two-thirds + third, three thirds, two halves, or one full card).`));
}

function validateSpecimenStatus(value: unknown, path: string, findings: ComposeFinding[]): void {
  if (!isPlainObject(value) || !hasOnlyOwnKeys(value, ["tone", "label"]) || !hasOwnKeys(value, ["tone", "label"])) {
    findings.push(finding("sectioned-view-specimen-status-shape", path, `${path} must be a plain { tone, label } status.`));
    return;
  }
  validateEnumField(value, "tone", SPECIMEN_TONES, "sectioned-view-specimen-tone", path, findings, true);
  validateCopy(value.label, `${path}.label`, findings);
}

function validateOptionalStatus(record: Record<string, unknown>, path: string, findings: ComposeFinding[]): void {
  if (record.status !== undefined) validateSpecimenStatus(record.status, `${path}.status`, findings);
}

/** Refuse non-data properties before inspecting any nested field. */
function contentShape(value: unknown, path: string, findings: ComposeFinding[], keys: readonly string[], required: readonly string[], rule = "sectioned-view-content-media-shape", hint = ""): Record<string, unknown> | undefined {
  if (!isPlainObject(value) || !hasOnlyOwnKeys(value, keys) || !hasOwnKeys(value, required)) { findings.push(finding(rule, path, `${path} must be a closed data object with ${required.join(", ")}.${hint}`)); return undefined; }
  return value;
}
function validateContentMedia(value: unknown, path: string, findings: ComposeFinding[]): void {
  if (!isPlainObject(value) || !hasEnumerableOwnDataKeys(value)) { findings.push(finding("sectioned-view-content-media-shape", path, "Media must be one closed data object.")); return; }
  switch (value.type) {
    case "asset": validateAssetMedia(value, path, findings); return;
    case "specimen": validateSpecimenMedia(value, path, findings); return;
    case "record": validateRecordMedia(value, path, findings); return;
    case "scene": validateSceneMedia(value, path, findings); return;
    default: findings.push(finding("sectioned-view-content-media-type", `${path}.type`, "Media type must be specimen, record, scene or asset."));
  }
}
function validateAssetMedia(value: unknown, path: string, findings: ComposeFinding[]): void {
  const media = contentShape(value, path, findings, ["type", "assetId", "purpose", "alt", "caption", "contract"], ["type", "assetId", "purpose", "contract"]);
  if (media === undefined) return;
  if (!isNonWhitespaceString(media.assetId)) findings.push(finding("content-asset-id", `${path}.assetId`, "The asset id must be non-blank."));
  const contract = checkContentAssetContract(media.contract);
  findings.push(...contract.findings.map(entry => ({ ...entry, path: `${path}.contract${entry.path ? `.${entry.path}` : ""}` })));
  if (!contract.ok) return;
  if (media.purpose === "meaningful") validateCopy(media.alt, `${path}.alt`, findings);
  else if (media.purpose !== "decorative" || hasOwn(media, "alt") || (isPlainObject(media.contract) && typeof media.contract.format === "string" && media.contract.format.startsWith("video/"))) findings.push(finding("content-asset-accessibility", path, "Use meaningful media with alt copy, or a decorative image without alt copy."));
  if (media.caption !== undefined) validateCopy(media.caption, `${path}.caption`, findings);
}
function validateSpecimenMedia(value: unknown, path: string, findings: ComposeFinding[]): void {
  const media = contentShape(value, path, findings, ["type", "label", "panel", "key"], ["type", "label", "panel"]);
  if (media === undefined) return;
  validateCopy(media.label, `${path}.label`, findings); validateSpecimenPanel(media.panel, `${path}.panel`, findings);
  if (media.key === undefined) return;
  const key = contentShape(media.key, `${path}.key`, findings, ["label", "items"], ["label", "items"], "sectioned-view-specimen-key-shape", isPlainObject(media.key) && hasOwn(media.key, "side") ? " Key placement is derived; remove side." : "");
  if (key === undefined) return;
  validateCopy(key.label, `${path}.key.label`, findings);
  const order = ["header"]; const labeled = new Set<string>(["header"]);
  if (isPlainObject(media.panel) && hasEnumerableOwnDataKeys(media.panel)) {
    if (validateDenseArray(media.panel.parts, `${path}.panel.parts`, findings, "sectioned-view-items-shape", "Keyed panel parts must be a non-empty data array.")) for (const part of media.panel.parts) if (isPlainObject(part) && hasEnumerableOwnDataKeys(part) && typeof part.id === "string") {
      if (/\s/.test(part.id) || ["header", "footer"].includes(part.id)) findings.push(finding("sectioned-view-specimen-key-target", `${path}.panel.parts`, "Key targets require distinct whitespace-free part ids outside header and footer."));
      else { order.push(part.id); if (isCopyRef(part.label)) labeled.add(part.id); }
    }
    if (media.panel.footer !== undefined) { order.push("footer"); labeled.add("footer"); }
  }
  const used = new Set<string>(); let previous = -1;
  validateRecords(key.items, `${path}.key.items`, findings, { min: 3, max: 5 }, ["id", "target", "heading", "description"], ["target", "heading", "description"], (item, itemPath) => {
    if (/\s/.test(String(item.id))) findings.push(finding("sectioned-view-specimen-key-shape", `${itemPath}.id`, "Key item ids cannot contain whitespace."));
    validateCopy(item.heading, `${itemPath}.heading`, findings); validateCopy(item.description, `${itemPath}.description`, findings);
    const target = typeof item.target === "string" ? item.target : ""; const position = order.indexOf(target);
    if (!labeled.has(target) || used.has(target) || position <= previous) findings.push(finding("sectioned-view-specimen-key-target", `${itemPath}.target`, "Key targets must name distinct labeled slots in panel reading order."));
    used.add(target); previous = position;
  });
}
function validateRecordMedia(value: unknown, path: string, findings: ComposeFinding[]): void {
  const media = contentShape(value, path, findings, ["type", "id", "head", "columns", "groups", "caption", "flagLabel"], ["type", "id", "head", "groups", "caption"]);
  if (media === undefined) return;
  if (!isNonWhitespaceString(media.id) || /\s/.test(media.id)) findings.push(finding("sectioned-view-record-id", `${path}.id`, "Record id must be non-whitespace."));
  const head = contentShape(media.head, `${path}.head`, findings, ["title", "meta", "status"], ["title"]);
  if (head !== undefined) { validateCopy(head.title, `${path}.head.title`, findings); validateOptionalCopyFields(head, ["meta"], `${path}.head`, findings); validateOptionalStatus(head, `${path}.head`, findings); }
  validateCopy(media.caption, `${path}.caption`, findings); validateOptionalCopyFields(media, ["flagLabel"], path, findings);
  validateEnumField(media, "columns", [1, 2, 3], "sectioned-view-record-columns", path, findings);
  let flags = 0;
  const groups = validateRecords(media.groups, `${path}.groups`, findings, { min: 1, max: 3 }, ["id", "label", "rows", "owner", "note"], ["label"], (group, groupPath) => {
    if (/\s/.test(String(group.id))) findings.push(finding("sectioned-view-record-id", `${groupPath}.id`, "Record group ids cannot contain whitespace."));
    validateCopy(group.label, `${groupPath}.label`, findings);
    if ((group.rows === undefined) === (group.owner === undefined)) findings.push(finding("sectioned-view-record-group-shape", groupPath, "A group holds exactly rows or owner."));
    if (group.note !== undefined && group.owner === undefined) findings.push(finding("sectioned-view-record-group-shape", `${groupPath}.note`, "Group note belongs to its owner."));
    validateOptionalCopyFields(group, ["note"], groupPath, findings);
    if (group.owner !== undefined) {
      const owner = contentShape(group.owner, `${groupPath}.owner`, findings, ["initials", "name", "note"], ["initials", "name"], "sectioned-view-record-owner-shape");
      if (owner !== undefined) { validateCopy(owner.initials, `${groupPath}.owner.initials`, findings); validateCopy(owner.name, `${groupPath}.owner.name`, findings); validateOptionalCopyFields(owner, ["note"], `${groupPath}.owner`, findings); }
    }
    if (group.rows !== undefined) {
      const rows = validateRecords(group.rows, `${groupPath}.rows`, findings, { min: 1, max: 6 }, ["id", "label", "detail", "status", "flag"], ["label"], (row, rowPath) => {
        if (/\s/.test(String(row.id))) findings.push(finding("sectioned-view-record-id", `${rowPath}.id`, "Record row ids cannot contain whitespace."));
        validateCopy(row.label, `${rowPath}.label`, findings); validateOptionalCopyFields(row, ["detail"], rowPath, findings); validateOptionalStatus(row, rowPath, findings);
        if (row.flag !== undefined && typeof row.flag !== "boolean") findings.push(finding("sectioned-view-record-flag", `${rowPath}.flag`, "Flag must be a boolean."));
        if (row.flag === true) flags += 1;
      });
      if (rows.some((row) => row.status !== undefined) && rows.some((row) => row.status === undefined && row.detail === undefined)) findings.push(finding("sectioned-view-record-row-detail", `${groupPath}.rows`, "When a row has status, every row needs status or detail."));
    }
  });
  if (groups.slice(0, -1).some((group) => group.owner !== undefined)) findings.push(finding("sectioned-view-record-owner-order", `${path}.groups`, "An owner group must be last."));
  if (typeof media.columns === "number" && media.columns > 1 && groups.length !== media.columns) findings.push(finding("sectioned-view-record-columns", `${path}.groups`, "Multiple columns require one group per column."));
  if (flags > 1 || (flags > 0 && media.flagLabel === undefined)) findings.push(finding("sectioned-view-record-flag", path, "At most one row is flagged, and it needs flagLabel."));
}
function validateSceneStatus(value: unknown, path: string, findings: ComposeFinding[]): void {
  const status = contentShape(value, path, findings, ["tone", "text"], ["tone", "text"], "sectioned-view-scene-shape");
  if (status === undefined) return; validateEnumField(status, "tone", SPECIMEN_TONES, "sectioned-view-scene-shape", path, findings, true); validateCopy(status.text, `${path}.text`, findings);
}
function validateScenePerson(value: unknown, path: string, findings: ComposeFinding[]): void {
  const person = contentShape(value, path, findings, ["initials", "name", "note"], ["initials", "name", "note"], "sectioned-view-scene-shape");
  if (person === undefined) return;
  if (typeof person.initials !== "string" || !/^[A-Za-z]{1,2}$/.test(person.initials)) findings.push(finding("sectioned-view-scene-initials", `${path}.initials`, "Scene initials must be one or two letters."));
  validateCopy(person.name, `${path}.name`, findings); validateCopy(person.note, `${path}.note`, findings);
}
function validateSceneRows(value: unknown, path: string, findings: ComposeFinding[], min: number, max: number): Record<string, unknown>[] {
  return validateRecords(value, path, findings, { min, max }, ["id", "label", "value", "status", "figure", "quiet"], ["label", "value"], (row, rowPath) => {
    validateCopy(row.label, `${rowPath}.label`, findings); validateCopy(row.value, `${rowPath}.value`, findings); validateEnumField(row, "status", SPECIMEN_TONES, "sectioned-view-scene-shape", rowPath, findings);
    for (const key of ["figure", "quiet"]) if (row[key] !== undefined && typeof row[key] !== "boolean") findings.push(finding("sectioned-view-scene-shape", `${rowPath}.${key}`, "Scene flags must be booleans."));
  });
}
function validateSceneDocuments(value: unknown, path: string, findings: ComposeFinding[], min: number, max: number, evidence = false): Record<string, unknown>[] {
  return validateRecords(value, path, findings, { min, max }, ["id", "format", "title", "origin", ...(evidence ? ["cites", "cite"] : [])], ["format", "title", ...(evidence ? ["cites", "cite"] : [])], (source, sourcePath) => {
    validateEnumField(source, "format", ["pdf", "email", "sheet", "doc", "note", "scan", "calendar"], "sectioned-view-scene-shape", sourcePath, findings, true); validateCopy(source.title, `${sourcePath}.title`, findings); validateOptionalCopyFields(source, ["origin"], sourcePath, findings);
    if (evidence) { validateCopy(source.cite, `${sourcePath}.cite`, findings); if (!isNonWhitespaceString(source.cites)) findings.push(finding("sectioned-view-scene-relation-dangling", `${sourcePath}.cites`, "A citation must name one result row.")); }
  });
}
function validateSceneMedia(value: unknown, path: string, findings: ComposeFinding[]): void {
  const media = contentShape(value, path, findings, ["type", "label", "relationLabel", "input"], ["type", "label", "input"], "sectioned-view-scene-shape");
  if (media === undefined) return;
  validateCopy(media.label, `${path}.label`, findings); validateOptionalCopyFields(media, ["relationLabel"], path, findings);
  const input = media.input;
  if (!isPlainObject(input) || !hasEnumerableOwnDataKeys(input)) { findings.push(finding("sectioned-view-scene-shape", `${path}.input`, "Scene input must be plain data.")); return; }
  const inputPath = `${path}.input`;
  if (!isNonWhitespaceString(input.seed)) findings.push(finding("sectioned-view-scene-shape", `${inputPath}.seed`, "Scene seed is required structural data."));
  switch (input.template) {
    case "converge": {
      if (contentShape(input, inputPath, findings, ["template", "seed", "disorder", "sources", "target", "relations"], ["template", "seed", "sources", "target", "relations"], "sectioned-view-scene-shape") === undefined) return;
      validateEnumField(input, "disorder", ["none", "low", "medium"], "sectioned-view-scene-shape", inputPath, findings);
      const sources = contentShape(input.sources, `${inputPath}.sources`, findings, ["heading", "items"], ["heading", "items"], "sectioned-view-scene-shape");
      const target = contentShape(input.target, `${inputPath}.target`, findings, ["heading", "title", "meta", "rows"], ["heading", "title", "rows"], "sectioned-view-scene-shape");
      const docs = sources === undefined ? [] : validateSceneDocuments(sources.items, `${inputPath}.sources.items`, findings, 3, 8);
      if (sources !== undefined) validateCopy(sources.heading, `${inputPath}.sources.heading`, findings);
      const rows = target === undefined ? [] : validateSceneRows(target.rows, `${inputPath}.target.rows`, findings, 2, 6);
      if (target !== undefined) { validateCopy(target.heading, `${inputPath}.target.heading`, findings); validateCopy(target.title, `${inputPath}.target.title`, findings); validateOptionalCopyFields(target, ["meta"], `${inputPath}.target`, findings); }
      if (!validateDenseArray(input.relations, `${inputPath}.relations`, findings, "sectioned-view-scene-count", "Relations must be a non-empty array.")) return;
      if (input.relations.length > 12) findings.push(finding("sectioned-view-scene-count", `${inputPath}.relations`, "At most twelve relations are allowed."));
      const wired = new Map<unknown, number>(); const pairs = new Set<string>(); let emphases = 0;
      input.relations.forEach((value, index) => {
        const relationPath = `${inputPath}.relations.${index}`;
        const relation = contentShape(value, relationPath, findings, ["from", "to", "emphasis"], ["from", "to"], "sectioned-view-scene-shape");
        if (relation === undefined) return;
        if (!isNonWhitespaceString(relation.from) || !isNonWhitespaceString(relation.to)) { findings.push(finding("sectioned-view-scene-relation-dangling", relationPath, "Relation endpoints must be source and row ids.")); return; }
        if (!docs.some((doc) => doc.id === relation.from) || !rows.some((row) => row.id === relation.to)) findings.push(finding("sectioned-view-scene-relation-dangling", relationPath, "Relations must name declared source and row ids."));
        const pair = JSON.stringify([relation.from, relation.to]); if (pairs.has(pair)) findings.push(finding("sectioned-view-scene-relation-dangling", relationPath, "A relation pair may appear only once.")); pairs.add(pair);
        wired.set(relation.from, (wired.get(relation.from) ?? 0) + 1);
        if (relation.emphasis !== undefined && relation.emphasis !== true) findings.push(finding("sectioned-view-scene-emphasis", relationPath, "Emphasis, when authored, is true."));
        if (relation.emphasis === true) emphases += 1;
      });
      if (docs.some((doc) => !wired.has(doc.id) || wired.get(doc.id)! > 2)) findings.push(finding("sectioned-view-scene-source-unwired", `${inputPath}.relations`, "Every source needs one or two relations."));
      if (emphases > 1) findings.push(finding("sectioned-view-scene-emphasis", `${inputPath}.relations`, "At most one relation is emphasized."));
      return;
    }
    case "evidence-trail": {
      if (contentShape(input, inputPath, findings, ["template", "seed", "disorder", "sources", "result"], ["template", "seed", "sources", "result"], "sectioned-view-scene-shape") === undefined) return;
      validateEnumField(input, "disorder", ["none", "low"], "sectioned-view-scene-shape", inputPath, findings);
      const docs = validateSceneDocuments(input.sources, `${inputPath}.sources`, findings, 2, 4, true);
      const result = contentShape(input.result, `${inputPath}.result`, findings, ["title", "meta", "rows", "status", "person"], ["title", "rows", "status"], "sectioned-view-scene-shape");
      if (result === undefined) return;
      validateCopy(result.title, `${inputPath}.result.title`, findings); validateOptionalCopyFields(result, ["meta"], `${inputPath}.result`, findings); validateSceneStatus(result.status, `${inputPath}.result.status`, findings);
      const rows = validateSceneRows(result.rows, `${inputPath}.result.rows`, findings, 2, 5);
      if (result.person !== undefined) validateScenePerson(result.person, `${inputPath}.result.person`, findings);
      if (docs.some((doc) => !rows.some((row) => row.id === doc.cites))) findings.push(finding("sectioned-view-scene-relation-dangling", `${inputPath}.sources`, "Every citation must name a result row."));
      return;
    }
    case "approval-chain": {
      if (contentShape(input, inputPath, findings, ["template", "seed", "disorder", "prepared", "findings", "node", "decision"], ["template", "seed", "prepared", "findings", "node", "decision"], "sectioned-view-scene-shape") === undefined) return;
      validateEnumField(input, "disorder", ["none", "low"], "sectioned-view-scene-shape", inputPath, findings);
      const prepared = contentShape(input.prepared, `${inputPath}.prepared`, findings, ["heading", "meta"], ["heading"], "sectioned-view-scene-shape");
      if (prepared !== undefined) { validateCopy(prepared.heading, `${inputPath}.prepared.heading`, findings); validateOptionalCopyFields(prepared, ["meta"], `${inputPath}.prepared`, findings); }
      const entries = validateRecords(input.findings, `${inputPath}.findings`, findings, { min: 2, max: 4 }, ["id", "fn", "title", "subjectOf", "status", "subject"], ["fn", "title", "subjectOf", "status"], (entry, entryPath) => {
        validateCopy(entry.fn, `${entryPath}.fn`, findings); validateCopy(entry.title, `${entryPath}.title`, findings); validateCopy(entry.subjectOf, `${entryPath}.subjectOf`, findings); validateSceneStatus(entry.status, `${entryPath}.status`, findings);
        if (entry.subject !== undefined && entry.subject !== true) findings.push(finding("sectioned-view-scene-subject", entryPath, "Subject, when authored, is true."));
      });
      if (entries.filter((entry) => entry.subject === true).length !== 1) findings.push(finding("sectioned-view-scene-subject", `${inputPath}.findings`, "Exactly one finding is the subject."));
      const node = contentShape(input.node, `${inputPath}.node`, findings, ["label"], ["label"], "sectioned-view-scene-shape"); if (node !== undefined) validateCopy(node.label, `${inputPath}.node.label`, findings);
      const decision = contentShape(input.decision, `${inputPath}.decision`, findings, ["title", "meta", "status", "rows", "person"], ["title", "status", "rows", "person"], "sectioned-view-scene-shape");
      if (decision !== undefined) { validateCopy(decision.title, `${inputPath}.decision.title`, findings); validateOptionalCopyFields(decision, ["meta"], `${inputPath}.decision`, findings); validateSceneStatus(decision.status, `${inputPath}.decision.status`, findings); validateSceneRows(decision.rows, `${inputPath}.decision.rows`, findings, 2, 4); validateScenePerson(decision.person, `${inputPath}.decision.person`, findings); }
      return;
    }
    default: findings.push(finding("sectioned-view-scene-unknown-template", `${inputPath}.template`, "Scene template must be converge, evidence-trail or approval-chain."));
  }
}

function validateSpecimenPanel(value: unknown, path: string, findings: ComposeFinding[]): void {
  if (!isPlainObject(value) || !hasOnlyOwnKeys(value, ["id", "title", "meta", "badge", "status", "parts", "footer"]) || !hasOwnKeys(value, ["id", "title", "parts"]) || !isNonWhitespaceString(value.id)) {
    findings.push(finding("sectioned-view-specimen-panel-shape", path, `${path} must be a plain panel with a non-whitespace id, a title, and parts.`));
    return;
  }
  validateCopy(value.title, `${path}.title`, findings);
  if (value.badge !== undefined) validateBadge(value.badge, `${path}.badge`, findings);
  validateOptionalCopyFields(value, ["meta"], path, findings);
  validateOptionalStatus(value, path, findings);
  if (validateDenseArray(value.parts, `${path}.parts`, findings, "sectioned-view-items-shape", `${path}.parts must be a non-empty array.`)) {
    if (value.parts.length > PANEL_MAX_PARTS) findings.push(countFinding(`${path}.parts`, { min: 1, max: PANEL_MAX_PARTS }, value.parts.length, "parts"));
    validateItemIds(value.parts, `${path}.parts`, findings);
    value.parts.forEach((part, index) => validateSpecimenPart(part, `${path}.parts.${index}`, findings, PART_MAX_ROWS));
  }
  if (value.footer !== undefined) {
    const footer = value.footer;
    const footerPath = `${path}.footer`;
    if (!isPlainObject(footer) || !hasOnlyOwnKeys(footer, ["assignee", "note"]) || (footer.assignee === undefined && footer.note === undefined)) {
      findings.push(finding("sectioned-view-specimen-footer-shape", footerPath, `${footerPath} must be a plain footer with an assignee, a note, or both.`));
      return;
    }
    validateOptionalCopyFields(footer, ["note"], footerPath, findings);
    if (footer.assignee !== undefined) {
      const assignee = footer.assignee;
      const assigneePath = `${footerPath}.assignee`;
      if (!isPlainObject(assignee) || !hasOnlyOwnKeys(assignee, ["initials", "name", "note"]) || !hasOwnKeys(assignee, ["initials", "name"])) {
        findings.push(finding("sectioned-view-specimen-footer-shape", assigneePath, `${assigneePath} must be a plain assignee with initials and name, and optionally a note.`));
      } else {
        validateCopy(assignee.initials, `${assigneePath}.initials`, findings);
        validateCopy(assignee.name, `${assigneePath}.name`, findings);
        validateOptionalCopyFields(assignee, ["note"], assigneePath, findings);
      }
    }
  }
}

function validatePartKeys(part: Record<string, unknown>, keys: readonly string[], required: readonly string[], path: string, findings: ComposeFinding[]): void {
  if (!hasOnlyOwnKeys(part, ["id", "type", ...keys]) || !hasOwnKeys(part, required)) findings.push(finding("sectioned-view-specimen-part-shape", path, `${path} has keys not allowed for a ${String(part.type)} part.`));
}

function validateSpecimenPart(value: unknown, path: string, findings: ComposeFinding[], maxRows: number): void {
  if (!isPlainObject(value) || !hasEnumerableOwnDataKeys(value) || !isNonWhitespaceString(value.id) || !isNonWhitespaceString(value.type)) {
    findings.push(finding("sectioned-view-specimen-part-shape", path, `${path} must be a specimen part with a non-whitespace id and a type.`));
    return;
  }
  const rows = { min: 1, max: maxRows };
  switch (value.type) {
    case "fields":
      validatePartKeys(value, ["label", "columns", "items"], ["items"], path, findings);
      validateOptionalCopyFields(value, ["label"], path, findings);
      validateEnumField(value, "columns", FIELDS_COLUMNS, "sectioned-view-specimen-part-option", path, findings);
      validateRecords(value.items, `${path}.items`, findings, rows, ["id", "label", "value"], ["label", "value"], (field, fieldPath) => {
        validateCopy(field.label, `${fieldPath}.label`, findings);
        validateCopy(field.value, `${fieldPath}.value`, findings);
      });
      return;
    case "status-rows":
      validatePartKeys(value, ["label", "items", "mobileRows"], ["items"], path, findings);
      validateEnumField(value, "mobileRows", [3], "sectioned-view-specimen-part-option", path, findings);
      validateOptionalCopyFields(value, ["label"], path, findings);
      validateRecords(value.items, `${path}.items`, findings, rows, ["id", "label", "detail", "status"], ["label", "status"], (row, rowPath) => {
        validateCopy(row.label, `${rowPath}.label`, findings);
        validateOptionalCopyFields(row, ["detail"], rowPath, findings);
        validateSpecimenStatus(row.status, `${rowPath}.status`, findings);
      });
      return;
    case "meter":
      validatePartKeys(value, ["label", "value", "scaleMax", "limit", "direction", "tone", "valueText", "limitText", "previous", "previousText", "status", "note"], ["label", "value", "scaleMax", "tone", "valueText"], path, findings);
      validateCopy(value.label, `${path}.label`, findings);
      validateCopy(value.valueText, `${path}.valueText`, findings);
      validateOptionalCopyFields(value, ["limitText", "note", "previousText"], path, findings);
      if ((value.previous === undefined) !== (value.previousText === undefined)) findings.push(finding("sectioned-view-specimen-previous", path, "Previous and previousText must be authored together."));
      if (value.previous !== undefined && (!isNonNegativeNumber(value.previous) || (isNonNegativeNumber(value.scaleMax) && value.previous > value.scaleMax))) findings.push(finding("sectioned-view-specimen-number", `${path}.previous`, "Previous must be finite, non-negative and no greater than scaleMax."));
      if (!isNonNegativeNumber(value.value)) findings.push(finding("sectioned-view-specimen-number", `${path}.value`, `${path}.value must be a finite number of zero or more.`));
      if (!isNonNegativeNumber(value.scaleMax) || value.scaleMax === 0) findings.push(finding("sectioned-view-specimen-number", `${path}.scaleMax`, `${path}.scaleMax must be a finite number greater than zero.`));
      if (value.limit !== undefined && !isNonNegativeNumber(value.limit)) findings.push(finding("sectioned-view-specimen-number", `${path}.limit`, `${path}.limit must be a finite number of zero or more.`));
      if (value.limitText !== undefined && value.limit === undefined) findings.push(finding("sectioned-view-specimen-limit-text", `${path}.limitText`, `${path}.limitText is allowed only with ${path}.limit.`));
      validateEnumField(value, "direction", METER_DIRECTIONS, "sectioned-view-specimen-part-option", path, findings);
      validateEnumField(value, "tone", SPECIMEN_TONES, "sectioned-view-specimen-tone", path, findings, true);
      validateOptionalStatus(value, path, findings);
      return;
    case "table": {
      validatePartKeys(value, ["label", "caption", "columns", "rows"], ["caption", "columns", "rows"], path, findings);
      validateOptionalCopyFields(value, ["label"], path, findings);
      validateCopy(value.caption, `${path}.caption`, findings);
      const columns = validateRecords(value.columns, `${path}.columns`, findings, { min: 1, max: TABLE_MAX_COLUMNS }, ["id", "label"], ["label"], (column, columnPath) => validateCopy(column.label, `${columnPath}.label`, findings));
      const columnCount = Array.isArray(value.columns) && columns.length === value.columns.length ? columns.length : undefined;
      validateRecords(value.rows, `${path}.rows`, findings, { min: 1, max: Math.min(TABLE_MAX_ROWS, maxRows) }, ["id", "cells"], ["cells"], (row, rowPath) => {
        if (!validateDenseArray(row.cells, `${rowPath}.cells`, findings, "sectioned-view-items-shape", `${rowPath}.cells must be a non-empty array.`)) return;
        if (columnCount !== undefined && row.cells.length !== columnCount) findings.push(finding("sectioned-view-specimen-table-cells", `${rowPath}.cells`, `${rowPath}.cells must hold one cell per column (${columnCount}); it holds ${row.cells.length}.`));
        row.cells.forEach((cell, cellIndex) => {
          const cellPath = `${rowPath}.cells.${cellIndex}`;
          if (!isPlainObject(cell) || !hasOnlyOwnKeys(cell, ["text", "status"]) || hasOwn(cell, "text") === hasOwn(cell, "status")) {
            findings.push(finding("sectioned-view-specimen-table-cells", cellPath, `${cellPath} must be a plain cell with exactly one of text or status.`));
            return;
          }
          if (hasOwn(cell, "text")) validateCopy(cell.text, `${cellPath}.text`, findings);
          else validateSpecimenStatus(cell.status, `${cellPath}.status`, findings);
        });
      });
      return;
    }
    case "schedule":
      validatePartKeys(value, ["label", "items"], ["items"], path, findings);
      validateOptionalCopyFields(value, ["label"], path, findings);
      validateRecords(value.items, `${path}.items`, findings, rows, ["id", "date", "label", "amount", "status"], ["date", "label"], (item, itemPath) => {
        validateCopy(item.date, `${itemPath}.date`, findings);
        validateCopy(item.label, `${itemPath}.label`, findings);
        validateOptionalCopyFields(item, ["amount"], itemPath, findings);
        validateOptionalStatus(item, itemPath, findings);
      });
      return;
    case "shares":
      validatePartKeys(value, ["label", "items"], ["items"], path, findings);
      validateOptionalCopyFields(value, ["label"], path, findings);
      validateRecords(value.items, `${path}.items`, findings, rows, ["id", "name", "share", "shareText", "status"], ["name", "share", "shareText"], (item, itemPath) => {
        validateCopy(item.name, `${itemPath}.name`, findings);
        validateCopy(item.shareText, `${itemPath}.shareText`, findings);
        if (!isNonNegativeNumber(item.share) || item.share > 100) findings.push(finding("sectioned-view-specimen-number", `${itemPath}.share`, `${itemPath}.share must be a finite percentage from 0 to 100.`));
        validateOptionalStatus(item, itemPath, findings);
      });
      return;
    case "files":
      validatePartKeys(value, ["label", "items"], ["items"], path, findings);
      validateOptionalCopyFields(value, ["label"], path, findings);
      validateRecords(value.items, `${path}.items`, findings, rows, ["id", "format", "name", "source"], ["format", "name"], (item, itemPath) => {
        validateCopy(item.format, `${itemPath}.format`, findings);
        validateCopy(item.name, `${itemPath}.name`, findings);
        validateOptionalCopyFields(item, ["source"], itemPath, findings);
      });
      return;
    default:
      findings.push(finding("sectioned-view-specimen-part-type", `${path}.type`, `${path}.type "${value.type}" is not a specimen part type; supported types are ${SPECIMEN_PART_TYPES.join(", ")}.`));
  }
}

// ---------------------------------------------------------------------------
// content-section resolution
// ---------------------------------------------------------------------------

type ResolveText = (ref: CopyRef, path: string) => string;

// ---------------------------------------------------------------------------
// checkSectionVariety: page rhythm warnings
// ---------------------------------------------------------------------------

/** What the variety lint reads from one section. */
interface BandShape {
  path: string;
  index: number;
  kind: SectionedViewSectionKind;
  layout: "stacked" | "split";
  mediaSide?: "start" | "end";
  block: string;
  visual: "none" | "specimen" | "record" | "scene" | "asset" | "lanes";
  /** Carries a specimen (as media or inside its block) or a table: a dense band. */
  dense: boolean;
  ground?: SectionedViewGround;
  /** The block's treatment, for telling two uses of one block type apart. */
  treatment: string;
  cardCount: number;
  /** Carries a `primary` content-section action. */
  primaryAction: boolean;
  /** Carries any content-section action. */
  hasActions: boolean;
  /** Its block links its items (`href`). */
  linkedBlock: boolean;
}
