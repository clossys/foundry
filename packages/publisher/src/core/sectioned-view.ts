import type { CopyRef, CopyResolution, CopyResolver } from "@clossys/writer";
import { isSanctionedHref } from "../internal/href.js";
import type { ComposeFinding } from "./types.js";

/** The only grounds a section may name. Rendering maps this vocabulary to design tokens later. */
export type SectionedViewGround = "base" | "sunken" | "inverse";

/**
 * Document-level rhythm for sections that omit `ground`. `inverse` is never
 * applied by rhythm, and an explicit `ground` always wins.
 *
 * - `"base-then-sunken"`: `base`, then `sunken`, in document order.
 * - `"view"`: the rendering view assigns them, from where each section lands
 *   on the page (`LandingView` alternates them upward from its closing band,
 *   across every document it renders). Resolution fills them with `base`,
 *   what a view without its own rhythm renders, and lists their ids in the
 *   resolved document's `viewGrounds`.
 */
export type SectionedViewSectionGroundRhythm = "base-then-sunken" | "view";

const SECTION_GROUND_RHYTHMS: readonly SectionedViewSectionGroundRhythm[] = ["base-then-sunken", "view"];
const RHYTHM_GROUNDS: readonly SectionedViewGround[] = ["base", "sunken"];

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
 * the band's one conversion; `secondary` is outlined at lg; `tertiary` is tonal at md and `quiet`
 * carries text and a decorative chevron at md. Omitted emphasis follows weight.
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
export interface SectionedViewContentFootnote {
  text: CopyRef;
  link?: SectionedViewContentFootnoteLink;
}

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
  heading: CopyRef;
  description?: CopyRef;
  /** Short hero: section-scale heading, with no first-screen fill, peek or scroll cue. */
  compact?: boolean;
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
   * with a split `faq` block renders. Optional and additive: without it (or
   * with `stacked`) the section renders exactly as it did before.
   * @default "stacked"
   */
  layout?: SectionedViewContentLayout;
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
 * A status row. `detail` is the row's own explanation, including the
 * reasoning behind a deliberate non-capability: optional, so every document
 * that validated without it still does, and additive, so a row without one
 * renders unchanged.
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
  /** Optional label above the section heading. Optional and additive: a section without one renders exactly as it did before. */
  eyebrow?: CopyRef;
  heading: CopyRef;
  description?: CopyRef;
  labels: Record<SectionedViewStatus, CopyRef> & { dispositions: Record<SectionedViewStatusDisposition, CopyRef> };
  /** Grouped editorial statements, each under its own heading. Provide this or `items`, never both. */
  groups?: SectionedViewStatusGroup[];
  /**
   * A flat list of statements with no group headings — the common shape for
   * a short trust page that has nothing to group. Provide this or `groups`,
   * never both.
   */
  items?: SectionedViewStatusItem[];
}

// ---------------------------------------------------------------------------
// content-section: one band anatomy (header, text block, visual)
// ---------------------------------------------------------------------------

/** How a content section arranges its text and its visual. `split` puts them side by side and needs `media`, except a split FAQ, whose rows take the visual column. */
export type SectionedViewContentLayout = "stacked" | "split";
/** Which side a split section's visual sits on. Reading order never changes: header, block, then visual. */
export type SectionedViewContentMediaSide = "end" | "start";
/** Header alignment of a stacked section. */
export type SectionedViewContentAlign = "start" | "center";

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
  status?: SectionedViewSpecimenStatus;
  parts: SectionedViewSpecimenPart[];
  footer?: SectionedViewSpecimenFooter;
}

/** How a specimen arranges its panels. `single` (the default) holds exactly one; the others hold two or three. */
export type SectionedViewSpecimenArrangement = "single" | "row" | "stack" | "flow";

/**
 * A section's visual: one labelled figure of 1-3 panels. `label` is the
 * figure's accessible name and describes what is shown. `connector` is the
 * short caption between `flow` panels, and only allowed there.
 */
export interface SectionedViewSpecimenMedia {
  type: "specimen";
  label: CopyRef;
  arrangement?: SectionedViewSpecimenArrangement;
  connector?: CopyRef;
  panels: SectionedViewSpecimenPanel[];
}

/** One parallel item of a feature-grid, card-grid or topic-list block. */
export interface SectionedViewContentItem {
  id: string;
  icon?: ContentIconName;
  /**
   * Card-grid and feature-grid items only; a topic-list item with an eyebrow
   * is refused. A feature-grid item eyebrow is a small label above the item heading and
   * resolves to at most `FEATURE_GRID_ITEM_EYEBROW_MAX_CHARACTERS` characters.
   */
  eyebrow?: CopyRef;
  heading: CopyRef;
  description?: CopyRef;
  /**
   * Links the whole item: the heading becomes the link and its name, with a
   * chevron, and the item's area is the hit target. All items of a block or
   * none, at most 6, each destination once. Not on
   * a `statement` feature grid.
   */
  href?: string;
}

/** A card's share of a 12-column row. */
export type SectionedViewContentCardSpan = "third" | "half" | "two-thirds" | "full";

/** A card: an item with its span and an optional one-part visual (at most 5 rows). */
export interface SectionedViewContentCard extends SectionedViewContentItem {
  span: SectionedViewContentCardSpan;
  visual?: SectionedViewSpecimenPart;
}

/**
 * One side of a comparison: a label, an optional heading, and exactly one of
 * `description` or 2-4 `points`. Both sides use the same form, the same point
 * count, and either both carry a `visual` or neither does.
 */
export interface SectionedViewComparisonSide {
  label: CopyRef;
  heading?: CopyRef;
  description?: CopyRef;
  points?: CopyRef[];
  visual?: SectionedViewSpecimenPanel;
}

export type SectionedViewStepLane = "a" | "b";

export interface SectionedViewContentStep {
  /** Required only in a two-actor lane sequence. */
  lane?: SectionedViewStepLane;
  id: string;
  ordinal: CopyRef;
  /** The actor tag for the step. */
  label?: CopyRef;
  heading: CopyRef;
  description?: CopyRef;
  visual?: SectionedViewSpecimenPanel;
  /** Links the step, as for a content item. Rare: only when each step has its own destination. */
  href?: string;
}

export type SectionedViewFeatureGridTreatment = "plain" | "rule" | "plate";
export type SectionedViewFeatureGridEmphasis = "item" | "statement";

/**
 * Parallel items of equal weight: 2-4 items, exactly 3 with `statement`
 * emphasis. `columns` defaults to 3, `treatment` to `plain`, `emphasis` to
 * `item`. Item icons are allowed with `plain` and `plate` only.
 */
export interface SectionedViewFeatureGridBlock {
  type: "feature-grid";
  columns?: 2 | 3 | 4;
  treatment?: SectionedViewFeatureGridTreatment;
  emphasis?: SectionedViewFeatureGridEmphasis;
  items: SectionedViewContentItem[];
}

/**
 * A mixed card grid of 2-6 cards. Spans fill whole 12-column rows, each row
 * one of: two-thirds + third (either order), three thirds, two halves, or one
 * full card.
 */
export interface SectionedViewCardGridBlock {
  type: "card-grid";
  items: SectionedViewContentCard[];
}

export interface SectionedViewComparisonBlock {
  type: "comparison";
  before: SectionedViewComparisonSide;
  after: SectionedViewComparisonSide;
}

/** Many short, scannable items: 2-8 items, an even count in 2 columns. `columns` defaults to 2. */
export interface SectionedViewTopicListBlock {
  type: "topic-list";
  columns?: 1 | 2;
  items: SectionedViewContentItem[];
}

/** A process of 3-4 steps. */
export interface SectionedViewOrderedStepSequenceBlock {
  type: "ordered-step-sequence";
  items: SectionedViewContentStep[];
  /** Two actors, each named in at most 20 resolved characters; 3 or 5 steps. */
  lanes?: { a: CopyRef; b: CopyRef };
  /** Visual sample/source caption, at most 120 resolved characters. */
  caption?: CopyRef;
  /** Opts an ordinary sequence into its terminal connector. Lanes default to ends. */
  end?: "continues" | "ends";
  /** Visible terminal copy, at most 40 resolved characters. */
  endLabel?: CopyRef;
}

/** 4-6 question and answer pairs. */
export interface SectionedViewFaqBlock {
  type: "faq";
  items: SectionedViewFaqItem[];
}

/** The text block of a content section. */
export type SectionedViewContentBlock =
  | SectionedViewFeatureGridBlock
  | SectionedViewCardGridBlock
  | SectionedViewComparisonBlock
  | SectionedViewTopicListBlock
  | SectionedViewOrderedStepSequenceBlock
  | SectionedViewFaqBlock;

export type SectionedViewContentBlockType = SectionedViewContentBlock["type"];

/**
 * One band: a header (eyebrow, heading, description, one or two button
 * actions), an optional text block, an optional visual and an optional
 * footnote. With neither
 * block nor media it is an intro band. `mediaSide` is allowed only on a
 * `split`, `align` only on a stacked section, and a `split` needs `media`,
 * with two exceptions where the block itself takes the visual column, top
 * aligned beside the header: a split FAQ block (which then takes no
 * `media`), and a text-only split, a `topic-list` block or a two-column
 * `feature-grid` block (not `statement` emphasis) with no `media`.
 *
 * Actions close what they follow, so a stacked band takes them only when it
 * is header only (and then no footnote follows them); a split takes them in
 * its text column. A stacked band with a block or media links its items
 * (`href`) or carries one link in its footnote instead.
 */
export interface SectionedViewContentSection {
  id: string;
  kind: "content-section";
  ground?: SectionedViewGround;
  eyebrow?: CopyRef;
  heading: CopyRef;
  description?: CopyRef;
  /**
   * One or two, at most one `primary`; rendered as full-size buttons. Only
   * on a header-only band (with no footnote) or in a split's text column: a
   * stacked band with a block or media takes none (link the items instead,
   * or use the footnote).
   */
  actions?: SectionedViewContentAction[];
  /** @default "stacked" */
  layout?: SectionedViewContentLayout;
  /** Split only. @default "end" */
  mediaSide?: SectionedViewContentMediaSide;
  /** Stacked only. */
  align?: SectionedViewContentAlign;
  block?: SectionedViewContentBlock;
  media?: SectionedViewSpecimenMedia;
  /** The band's last line: one sentence, at most one inline link. */
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
  | Exclude<ResolvedCopyTree<SectionedViewContentBlock>, { type: "ordered-step-sequence" }>
  | (ResolvedCopyTree<SectionedViewOrderedStepSequenceBlock> & { /** Consumer-resolved hidden continuation copy. */ continuesLabel?: string });
/** A content section with its copy resolved and its ground applied. Absent optional fields stay absent. */
export type ResolvedSectionedViewContentSection = Omit<ResolvedCopyTree<SectionedViewContentSection>, "ground" | "block"> & { ground: SectionedViewGround; block?: ResolvedSectionedViewContentBlock };

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
   * Present only for `sectionGroundRhythm: "view"`: the ids of the sections
   * that omitted `ground`, whose ground the rendering view may assign.
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

function rhythmGroundForSectionIndex(index: number): SectionedViewGround {
  return RHYTHM_GROUNDS[index % RHYTHM_GROUNDS.length]!;
}

/** The ground a `"view"` rhythm resolves an omitted section to, before a view assigns its own. */
const VIEW_RHYTHM_RESOLVED_GROUND: SectionedViewGround = "base";

function applySectionGroundRhythm(document: SectionedViewDocument): SectionedViewDocument {
  if (document.sectionGroundRhythm === undefined) return document;
  if (document.sectionGroundRhythm === "view") {
    return { ...document, sections: document.sections.map((section) => ({ ...section, ground: section.ground ?? VIEW_RHYTHM_RESOLVED_GROUND })) };
  }
  return {
    ...document,
    sections: document.sections.map((section, index) => ({
      ...section,
      ground: section.ground ?? rhythmGroundForSectionIndex(index),
    })),
  };
}

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
    if (!hasGround && !rhythmFillsGround) {
      findings.push(finding("sectioned-view-ground-required", `${path}.ground`, `${path}.ground is required when the document does not set sectionGroundRhythm.`));
    }
    if (hasGround && (!isNonWhitespaceString(section.ground) || !GROUNDS.includes(section.ground as SectionedViewGround))) {
      findings.push(finding("sectioned-view-ground", `${path}.ground`, `${path}.ground must be one of ${GROUNDS.join(", ")}.`));
    }
    if (!FRAGMENT_ID.test(section.id)) findings.push(finding("sectioned-view-section-id-fragment", `${path}.id`, `${path}.id must be a lowercase, fragment-safe identifier (letters, digits, and hyphens; starting with a letter).`));
    if (sectionIds.has(section.id)) findings.push(finding("sectioned-view-section-id-duplicate", `${path}.id`, `${path}.id duplicates another section id.`));
    sectionIds.add(section.id);

    switch (section.kind) {
      case "hero":
        heroCount += 1;
        if (!hasOnlyOwnKeys(section, ["id", "kind", "ground", "eyebrow", "heading", "description", "actions", "media", "compact"]) || !hasOwn(section, "heading")) findings.push(finding("sectioned-view-section-keys", path, `${path} has keys not allowed for hero.`));
        if (section.compact !== undefined && typeof section.compact !== "boolean") findings.push(finding("sectioned-view-hero-shape", `${path}.compact`, `${path}.compact must be a boolean.`));
        if (section.compact === true && section.media !== undefined) findings.push(finding("sectioned-view-hero-compact-media", `${path}.media`, `${path} cannot combine a compact hero with media.`));
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
        validateEnumField(section, "layout", CONTENT_LAYOUTS, "sectioned-view-faq-layout", path, findings);
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
  if (!isPlainObject(value) || !hasOnlyOwnKeys(value, ["text", "link"]) || !hasOwn(value, "text")) {
    findings.push(finding("sectioned-view-content-footnote-shape", path, `${path} must be a plain footnote with text and, optionally, one link.`));
    return;
  }
  validateCopy(value.text, `${path}.text`, findings);
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

const CONTENT_SECTION_KEYS = ["id", "kind", "ground", "eyebrow", "heading", "description", "actions", "layout", "mediaSide", "align", "block", "media", "footnote"] as const;
const ROLE_ACTION_EMPHASES: readonly SectionedViewActionEmphasis[] = ["primary", "secondary", "quiet"];
const CONTENT_ACTION_EMPHASES: readonly SectionedViewContentActionEmphasis[] = ["primary", "secondary", "tertiary", "quiet"];
/** The most actions one content section may hold. */
const CONTENT_ACTIONS_MAX = 2;
const CONTENT_LAYOUTS: readonly SectionedViewContentLayout[] = ["stacked", "split"];
const CONTENT_MEDIA_SIDES: readonly SectionedViewContentMediaSide[] = ["end", "start"];
const CONTENT_ALIGNS: readonly SectionedViewContentAlign[] = ["start", "center"];
const CONTENT_BLOCK_TYPES: readonly SectionedViewContentBlockType[] = ["feature-grid", "card-grid", "comparison", "topic-list", "ordered-step-sequence", "faq"];
const FEATURE_GRID_COLUMNS: readonly number[] = [2, 3, 4];
const FEATURE_GRID_TREATMENTS: readonly SectionedViewFeatureGridTreatment[] = ["plain", "rule", "plate"];
const FEATURE_GRID_EMPHASES: readonly SectionedViewFeatureGridEmphasis[] = ["item", "statement"];
const TOPIC_LIST_COLUMNS: readonly number[] = [1, 2];
const CARD_SPAN_UNITS: Readonly<Record<SectionedViewContentCardSpan, number>> = { third: 4, half: 6, "two-thirds": 8, full: 12 };
const CARD_SPANS = Object.keys(CARD_SPAN_UNITS) as SectionedViewContentCardSpan[];
const CARD_ROW_UNITS = 12;
const SPECIMEN_TONES: readonly SectionedViewSpecimenTone[] = ["success", "warning", "danger", "info", "neutral"];
const SPECIMEN_ARRANGEMENTS: readonly SectionedViewSpecimenArrangement[] = ["single", "row", "stack", "flow"];
const SPECIMEN_PART_TYPES: readonly SectionedViewSpecimenPartType[] = ["fields", "status-rows", "meter", "table", "schedule", "shares", "files"];
const FIELDS_COLUMNS: readonly number[] = [1, 2, 4];
const METER_DIRECTIONS: readonly string[] = ["max", "min"];
const CONTENT_ITEM_KEYS = ["id", "icon", "eyebrow", "heading", "description", "href"] as const;
/** The most linked items one block may hold: a longer run of links stops scanning. */
const CONTENT_LINKED_ITEMS_MAX = 6;
/**
 * The retired short block type names, for the refusal message only: a
 * document that still uses one is refused, never read as the new name.
 */
const RETIRED_BLOCK_TYPE_NAMES: Readonly<Record<string, SectionedViewContentBlockType>> = { features: "feature-grid", cards: "card-grid", topics: "topic-list", steps: "ordered-step-sequence" };
/** Blocks that may take a split's visual column themselves when the split has no media: the text-only split. */
const TEXT_SPLIT_BLOCK_TYPES: readonly SectionedViewContentBlockType[] = ["topic-list", "feature-grid"];
/**
 * The most characters a feature-grid item eyebrow may resolve to: the eyebrow
 * budget of the content cookbook. Checked when copy resolves, since a CopyRef
 * carries no text before then.
 */
export const FEATURE_GRID_ITEM_EYEBROW_MAX_CHARACTERS = 32;
/** Rows one specimen part may hold; a card's visual holds at most `CARD_VISUAL_MAX_ROWS`. */
const PART_MAX_ROWS = 6;
const CARD_VISUAL_MAX_ROWS = 5;
const TABLE_MAX_COLUMNS = 4;
const TABLE_MAX_ROWS = 5;
const PANEL_MAX_PARTS = 3;
const MEDIA_MAX_PANELS = 3;

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

function validateEnumField(record: Record<string, unknown>, key: string, allowed: readonly unknown[], rule: string, path: string, findings: ComposeFinding[]): void {
  if (record[key] !== undefined && !allowed.includes(record[key])) findings.push(finding(rule, `${path}.${key}`, `${path}.${key} must be one of ${allowed.join(", ")}.`));
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
): Record<string, unknown>[] {
  if (!validateDenseArray(value, path, findings, "sectioned-view-items-shape", `${path} must be a non-empty array.`)) return [];
  if (value.length < bounds.min || value.length > bounds.max) findings.push(countFinding(path, bounds, value.length));
  validateItemIds(value, path, findings);
  const records: Record<string, unknown>[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const record = value[index];
    const recordPath = `${path}.${index}`;
    if (!isPlainObject(record) || !hasOnlyOwnKeys(record, keys) || !hasOwnKeys(record, ["id", ...required]) || !isNonWhitespaceString(record.id)) {
      findings.push(finding("sectioned-view-item-shape", recordPath, `${recordPath} must be a plain item with a non-whitespace id, its required fields, and only its own fields.`));
      continue;
    }
    validateRecord(record, recordPath);
    records.push(record);
  }
  return records;
}

function validateContentSection(section: Record<string, unknown>, path: string, findings: ComposeFinding[]): void {
  // The retired `module` key gets its own finding naming the new field, instead of the generic keys finding.
  const retiredModule = hasOwn(section, "module");
  if (retiredModule) {
    findings.push(
      finding(
        "sectioned-view-content-module-retired",
        `${path}.module`,
        `${path}.module is retired: a content section holds its text block in \`block\`, whose type is one of ${CONTENT_BLOCK_TYPES.join(", ")} (the Designer block name in kebab case).`,
      ),
    );
  }
  const allowedKeys: readonly string[] = retiredModule ? [...CONTENT_SECTION_KEYS, "module"] : CONTENT_SECTION_KEYS;
  if (!hasOnlyOwnKeys(section, allowedKeys) || !hasOwn(section, "heading")) findings.push(finding("sectioned-view-section-keys", path, `${path} has keys not allowed for content-section.`));
  validateCopy(section.heading, `${path}.heading`, findings);
  validateOptionalCopyFields(section, ["eyebrow", "description"], path, findings);
  if (section.actions !== undefined) validateContentActions(section.actions, `${path}.actions`, findings);
  if (section.footnote !== undefined) validateContentFootnote(section.footnote, `${path}.footnote`, findings);
  validateEnumField(section, "layout", CONTENT_LAYOUTS, "sectioned-view-content-layout", path, findings);
  validateEnumField(section, "mediaSide", CONTENT_MEDIA_SIDES, "sectioned-view-content-layout", path, findings);
  validateEnumField(section, "align", CONTENT_ALIGNS, "sectioned-view-content-layout", path, findings);
  const split = section.layout === "split";
  if (section.mediaSide !== undefined && !split) findings.push(finding("sectioned-view-content-media-side", `${path}.mediaSide`, `${path}.mediaSide is allowed only when ${path}.layout is split.`));
  if (section.align !== undefined && split) findings.push(finding("sectioned-view-content-align", `${path}.align`, `${path}.align is allowed only on a stacked section.`));
  const faqBlock = isPlainObject(section.block) && section.block.type === "faq";
  if (split && faqBlock && section.media !== undefined) findings.push(finding("sectioned-view-content-faq-split-media", `${path}.media`, `${path} is a split FAQ section; its rows take the visual column, so it takes no media.`));
  if (split && !faqBlock && section.media === undefined) {
    const textBlock = isPlainObject(section.block) && TEXT_SPLIT_BLOCK_TYPES.includes(section.block.type as SectionedViewContentBlockType);
    if (!textBlock) findings.push(finding("sectioned-view-content-split-media", `${path}.media`, `${path} is a split section and needs media, unless its block is faq, topic-list or feature-grid.`));
    else if (isPlainObject(section.block) && section.block.type === "feature-grid" && (section.block.columns !== 2 || section.block.emphasis === "statement")) {
      findings.push(finding("sectioned-view-content-text-split", `${path}.block`, `${path} is a text-only split; its feature-grid block takes the visual column, so it needs columns: 2 and item emphasis.`));
    }
  }
  validateContentActionPlacement(section, path, findings);
  if (split && isPlainObject(section.block) && section.block.type === "ordered-step-sequence" && section.block.lanes !== undefined) findings.push(finding("sectioned-view-content-steps-lanes-layout", `${path}.block`, `${path}.block with lanes needs a stacked section.`));
  if (section.block !== undefined) validateContentBlock(section.block, `${path}.block`, findings);
  if (section.media !== undefined) validateSpecimenMedia(section.media, `${path}.media`, findings);
}

/**
 * Where a content section's actions may go (shared by the document contract
 * and the renderer's resolved-model check). A stacked band whose intro is
 * followed by a block or a visual takes none; a header-only band with actions
 * takes no footnote, since nothing follows an action. A split keeps them in
 * its text column. @internal
 */
export function validateContentActionPlacement(section: Record<string, unknown>, path: string, findings: ComposeFinding[]): void {
  const split = section.layout === "split";
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

/** An item's icon, heading and description; only a card-grid or feature-grid item (`eyebrowAllowed`) carries an eyebrow. */
function validateContentItemFields(item: Record<string, unknown>, path: string, findings: ComposeFinding[], eyebrowAllowed = false): void {
  if (item.icon !== undefined) validateIcon(item.icon, `${path}.icon`, findings);
  validateCopy(item.heading, `${path}.heading`, findings);
  validateOptionalCopyFields(item, ["eyebrow", "description"], path, findings);
  if (item.eyebrow !== undefined && !eyebrowAllowed) findings.push(finding("sectioned-view-content-item-eyebrow", `${path}.eyebrow`, `${path}.eyebrow is allowed only on card-grid and feature-grid items.`));
}

function validateBlockKeys(block: Record<string, unknown>, keys: readonly string[], required: readonly string[], path: string, findings: ComposeFinding[]): void {
  if (!hasOnlyOwnKeys(block, keys) || !hasOwnKeys(block, required)) findings.push(finding("sectioned-view-content-block-shape", path, `${path} has keys not allowed for a ${String(block.type)} block.`));
}

function validateContentBlock(value: unknown, path: string, findings: ComposeFinding[]): void {
  if (!isPlainObject(value) || !hasEnumerableOwnDataKeys(value) || !isNonWhitespaceString(value.type)) {
    findings.push(finding("sectioned-view-content-block-shape", path, `${path} must be a block object with a type.`));
    return;
  }
  switch (value.type) {
    case "feature-grid": {
      validateBlockKeys(value, ["type", "columns", "treatment", "emphasis", "items"], ["items"], path, findings);
      validateEnumField(value, "columns", FEATURE_GRID_COLUMNS, "sectioned-view-content-block-option", path, findings);
      validateEnumField(value, "treatment", FEATURE_GRID_TREATMENTS, "sectioned-view-content-block-option", path, findings);
      validateEnumField(value, "emphasis", FEATURE_GRID_EMPHASES, "sectioned-view-content-block-option", path, findings);
      const statement = value.emphasis === "statement";
      const iconsAllowed = value.treatment !== "rule";
      validateRecords(value.items, `${path}.items`, findings, statement ? { min: 3, max: 3 } : { min: 2, max: 4 }, CONTENT_ITEM_KEYS, ["heading"], (item, itemPath) => {
        validateContentItemFields(item, itemPath, findings, true);
        if (item.icon !== undefined && !iconsAllowed) findings.push(finding("sectioned-view-content-icon-treatment", `${itemPath}.icon`, `${itemPath}.icon is allowed only with the plain and plate treatments.`));
        validateItemHref(item, itemPath, findings, statement);
      });
      if (!statement) validateLinkGroup(value.items, `${path}.items`, findings);
      return;
    }
    case "card-grid": {
      validateBlockKeys(value, ["type", "items"], ["items"], path, findings);
      const cards = validateRecords(value.items, `${path}.items`, findings, { min: 2, max: 6 }, [...CONTENT_ITEM_KEYS, "span", "visual"], ["heading", "span"], (card, cardPath) => {
        validateContentItemFields(card, cardPath, findings, true);
        validateItemHref(card, cardPath, findings);
        validateEnumField(card, "span", CARD_SPANS, "sectioned-view-content-card-span", cardPath, findings);
        if (card.visual !== undefined) validateSpecimenPart(card.visual, `${cardPath}.visual`, findings, CARD_VISUAL_MAX_ROWS);
      });
      if (Array.isArray(value.items) && cards.length === value.items.length && cards.every((card) => CARD_SPANS.includes(card.span as SectionedViewContentCardSpan))) {
        validateCardRows(cards.map((card) => card.span as SectionedViewContentCardSpan), `${path}.items`, findings);
      }
      validateLinkGroup(value.items, `${path}.items`, findings);
      return;
    }
    case "comparison": {
      validateBlockKeys(value, ["type", "before", "after"], ["before", "after"], path, findings);
      const before = validateComparisonSide(value.before, `${path}.before`, findings);
      const after = validateComparisonSide(value.after, `${path}.after`, findings);
      if (before !== undefined && after !== undefined) {
        const form = (side: Record<string, unknown>) => (side.points !== undefined ? `points:${Array.isArray(side.points) ? side.points.length : 0}` : "description");
        if (form(before) !== form(after)) findings.push(finding("sectioned-view-content-comparison-sides", path, `${path}.before and ${path}.after must use the same form: both a description, or both the same number of points.`));
        if ((before.visual === undefined) !== (after.visual === undefined)) findings.push(finding("sectioned-view-content-comparison-sides", path, `${path}.before and ${path}.after must both carry a visual or neither.`));
      }
      return;
    }
    case "topic-list": {
      validateBlockKeys(value, ["type", "columns", "items"], ["items"], path, findings);
      validateEnumField(value, "columns", TOPIC_LIST_COLUMNS, "sectioned-view-content-block-option", path, findings);
      validateRecords(value.items, `${path}.items`, findings, { min: 2, max: 8 }, CONTENT_ITEM_KEYS, ["heading"], (item, itemPath) => {
        validateContentItemFields(item, itemPath, findings);
        validateItemHref(item, itemPath, findings);
      });
      validateLinkGroup(value.items, `${path}.items`, findings);
      const twoColumns = value.columns === undefined || value.columns === 2;
      if (twoColumns && Array.isArray(value.items) && value.items.length % 2 === 1) {
        findings.push(finding("sectioned-view-content-count", `${path}.items`, `${path}.items must hold an even number of items in 2 columns; it holds ${value.items.length}.`));
      }
      return;
    }
    case "ordered-step-sequence": {
      const withLanes = value.lanes !== undefined;
      validateBlockKeys(value, ["type", "items", "lanes", "caption", "end", "endLabel"], ["items"], path, findings);
      validateEnumField(value, "end", ["ends", "continues"], "sectioned-view-content-module-option", path, findings);
      validateOptionalCopyFields(value, ["endLabel", "caption"], path, findings);
      if (withLanes && (!isPlainObject(value.lanes) || !hasOnlyOwnKeys(value.lanes, ["a", "b"]) || !hasOwnKeys(value.lanes, ["a", "b"]) || !isCopyRef(value.lanes.a) || !isCopyRef(value.lanes.b))) {
        findings.push(finding("sectioned-view-content-steps-lanes-shape", `${path}.lanes`, `${path}.lanes must hold exactly two non-empty CopyRefs, a and b.`));
      }
      if (withLanes && Array.isArray(value.items)) {
        if (value.items.length !== 3 && value.items.length !== 5) findings.push(finding("sectioned-view-content-steps-lanes-count", `${path}.items`, `${path}.items must hold 3 or 5 lane steps.`));
        if (value.items.some((step) => isPlainObject(step) && step.visual !== undefined) && value.items.length !== 3) findings.push(finding("sectioned-view-content-steps-count", `${path}.items`, `${path}.items with lane visuals must hold exactly 3 steps.`));
        if (!isPlainObject(value.items[0]) || value.items[0].lane !== "a" || !value.items.some((step) => isPlainObject(step) && step.lane === "b")) findings.push(finding("sectioned-view-content-steps-lane-use", `${path}.items`, `${path}.items must start in lane a and use both actors.`));
      }
      if (value.caption !== undefined && (!Array.isArray(value.items) || !value.items.some((step) => isPlainObject(step) && step.visual !== undefined))) findings.push(finding("sectioned-view-content-steps-caption", `${path}.caption`, `${path}.caption needs a step visual.`));
      validateRecords(value.items, `${path}.items`, findings, withLanes ? { min: 3, max: 5 } : { min: 3, max: 4 }, ["id", "ordinal", "label", "heading", "description", "visual", "href", "lane"], ["ordinal", "heading"], (step, stepPath) => {
        if (withLanes ? step.lane !== "a" && step.lane !== "b" : step.lane !== undefined) findings.push(finding("sectioned-view-content-steps-lane", `${stepPath}.lane`, `${stepPath}.lane must be a or b only when lanes are set.`));
        if (withLanes && step.label !== undefined) findings.push(finding("sectioned-view-content-steps-lane-label", `${stepPath}.label`, `${stepPath}.label conflicts with its actor lane name.`));
        validateCopy(step.ordinal, `${stepPath}.ordinal`, findings);
        validateCopy(step.heading, `${stepPath}.heading`, findings);
        validateOptionalCopyFields(step, ["label", "description"], stepPath, findings);
        if (step.visual !== undefined) validateSpecimenPanel(step.visual, `${stepPath}.visual`, findings);
        validateItemHref(step, stepPath, findings);
      });
      validateLinkGroup(value.items, `${path}.items`, findings);
      return;
    }
    case "faq":
      validateBlockKeys(value, ["type", "items"], ["items"], path, findings);
      validateRecords(value.items, `${path}.items`, findings, { min: 4, max: 6 }, ["id", "question", "answer"], ["question", "answer"], (item, itemPath) => {
        validateCopy(item.question, `${itemPath}.question`, findings);
        validateCopy(item.answer, `${itemPath}.answer`, findings);
      });
      return;
    default:
      findings.push(finding("sectioned-view-content-block-type", `${path}.type`, `${path}.type "${value.type}" is not a content block type; supported types are ${CONTENT_BLOCK_TYPES.join(", ")}.${Object.hasOwn(RETIRED_BLOCK_TYPE_NAMES, value.type) ? ` "${value.type}" is now "${RETIRED_BLOCK_TYPE_NAMES[value.type]}".` : ""}`));
  }
}

/**
 * Cards fill whole 12-column rows in order: two-thirds + third (either
 * order), three thirds, two halves, or one full card. Any other sequence
 * overflows a row or leaves the last one short.
 */
function validateCardRows(spans: readonly SectionedViewContentCardSpan[], path: string, findings: ComposeFinding[]): void {
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

function validateComparisonSide(value: unknown, path: string, findings: ComposeFinding[]): Record<string, unknown> | undefined {
  if (!isPlainObject(value) || !hasOnlyOwnKeys(value, ["label", "heading", "description", "points", "visual"]) || !hasOwn(value, "label")) {
    findings.push(finding("sectioned-view-content-comparison-side", path, `${path} must be a plain side with a label and only label, heading, description, points, and visual.`));
    return undefined;
  }
  validateCopy(value.label, `${path}.label`, findings);
  validateOptionalCopyFields(value, ["heading", "description"], path, findings);
  if ((value.description === undefined) === (value.points === undefined)) {
    findings.push(finding("sectioned-view-content-comparison-side", path, `${path} must have exactly one of description or points.`));
  }
  if (value.points !== undefined && validateDenseArray(value.points, `${path}.points`, findings, "sectioned-view-items-shape", `${path}.points must be a non-empty array of CopyRefs.`)) {
    if (value.points.length < 2 || value.points.length > 4) findings.push(countFinding(`${path}.points`, { min: 2, max: 4 }, value.points.length, "points"));
    value.points.forEach((point, index) => validateCopy(point, `${path}.points.${index}`, findings));
  }
  if (value.visual !== undefined) validateSpecimenPanel(value.visual, `${path}.visual`, findings);
  return value;
}

function validateSpecimenStatus(value: unknown, path: string, findings: ComposeFinding[]): void {
  if (!isPlainObject(value) || !hasOnlyOwnKeys(value, ["tone", "label"]) || !hasOwnKeys(value, ["tone", "label"])) {
    findings.push(finding("sectioned-view-specimen-status-shape", path, `${path} must be a plain { tone, label } status.`));
    return;
  }
  validateEnumField(value, "tone", SPECIMEN_TONES, "sectioned-view-specimen-tone", path, findings);
  validateCopy(value.label, `${path}.label`, findings);
}

function validateOptionalStatus(record: Record<string, unknown>, path: string, findings: ComposeFinding[]): void {
  if (record.status !== undefined) validateSpecimenStatus(record.status, `${path}.status`, findings);
}

function validateSpecimenMedia(value: unknown, path: string, findings: ComposeFinding[]): void {
  if (!isPlainObject(value) || !hasOnlyOwnKeys(value, ["type", "label", "arrangement", "connector", "panels"]) || !hasOwnKeys(value, ["type", "label", "panels"])) {
    findings.push(finding("sectioned-view-content-media-shape", path, `${path} must be a plain specimen with type, label, and panels, and optionally arrangement and connector.`));
    return;
  }
  if (value.type !== "specimen") findings.push(finding("sectioned-view-content-media-type", `${path}.type`, `${path}.type must be specimen.`));
  validateCopy(value.label, `${path}.label`, findings);
  validateEnumField(value, "arrangement", SPECIMEN_ARRANGEMENTS, "sectioned-view-specimen-arrangement", path, findings);
  const arrangement = value.arrangement ?? "single";
  if (value.connector !== undefined) {
    validateCopy(value.connector, `${path}.connector`, findings);
    if (arrangement !== "flow") findings.push(finding("sectioned-view-specimen-connector", `${path}.connector`, `${path}.connector is allowed only with the flow arrangement.`));
  }
  const bounds = arrangement === "single" ? { min: 1, max: 1 } : { min: 2, max: MEDIA_MAX_PANELS };
  if (!validateDenseArray(value.panels, `${path}.panels`, findings, "sectioned-view-items-shape", `${path}.panels must be a non-empty array.`)) return;
  if (value.panels.length < bounds.min || value.panels.length > bounds.max) findings.push(countFinding(`${path}.panels`, bounds, value.panels.length, `panels for the ${String(arrangement)} arrangement`));
  validateItemIds(value.panels, `${path}.panels`, findings);
  value.panels.forEach((panel, index) => validateSpecimenPanel(panel, `${path}.panels.${index}`, findings));
}

function validateSpecimenPanel(value: unknown, path: string, findings: ComposeFinding[]): void {
  if (!isPlainObject(value) || !hasOnlyOwnKeys(value, ["id", "title", "meta", "status", "parts", "footer"]) || !hasOwnKeys(value, ["id", "title", "parts"]) || !isNonWhitespaceString(value.id)) {
    findings.push(finding("sectioned-view-specimen-panel-shape", path, `${path} must be a plain panel with a non-whitespace id, a title, and parts.`));
    return;
  }
  validateCopy(value.title, `${path}.title`, findings);
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
      validatePartKeys(value, ["label", "items"], ["items"], path, findings);
      validateOptionalCopyFields(value, ["label"], path, findings);
      validateRecords(value.items, `${path}.items`, findings, rows, ["id", "label", "detail", "status"], ["label", "status"], (row, rowPath) => {
        validateCopy(row.label, `${rowPath}.label`, findings);
        validateOptionalCopyFields(row, ["detail"], rowPath, findings);
        validateSpecimenStatus(row.status, `${rowPath}.status`, findings);
      });
      return;
    case "meter":
      validatePartKeys(value, ["label", "value", "scaleMax", "limit", "direction", "tone", "valueText", "limitText", "status", "note"], ["label", "value", "scaleMax", "tone", "valueText"], path, findings);
      validateCopy(value.label, `${path}.label`, findings);
      validateCopy(value.valueText, `${path}.valueText`, findings);
      validateOptionalCopyFields(value, ["limitText", "note"], path, findings);
      if (!isNonNegativeNumber(value.value)) findings.push(finding("sectioned-view-specimen-number", `${path}.value`, `${path}.value must be a finite number of zero or more.`));
      if (!isNonNegativeNumber(value.scaleMax) || value.scaleMax === 0) findings.push(finding("sectioned-view-specimen-number", `${path}.scaleMax`, `${path}.scaleMax must be a finite number greater than zero.`));
      if (value.limit !== undefined && !isNonNegativeNumber(value.limit)) findings.push(finding("sectioned-view-specimen-number", `${path}.limit`, `${path}.limit must be a finite number of zero or more.`));
      if (value.limitText !== undefined && value.limit === undefined) findings.push(finding("sectioned-view-specimen-limit-text", `${path}.limitText`, `${path}.limitText is allowed only with ${path}.limit.`));
      validateEnumField(value, "direction", METER_DIRECTIONS, "sectioned-view-specimen-part-option", path, findings);
      validateEnumField(value, "tone", SPECIMEN_TONES, "sectioned-view-specimen-tone", path, findings);
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

/** Resolves every audience-facing field depth-first and returns its provenance-ready CopyResolution list. */
export function resolveSectionedViewDocument(document: SectionedViewDocument, resolver: CopyResolver): ResolvedSectionedViewDocument {
  const findings = validateSectionedViewDocument(document);
  if (findings.length > 0) {
    const unsupportedKinds = findings.filter((entry) => entry.rule === "sectioned-view-section-kind");
    if (unsupportedKinds.length > 0) {
      throw new SectionedViewResolutionError(
        "unsupported-section-kind",
        `resolveSectionedViewDocument refused invalid document: ${unsupportedKinds.map((entry) => entry.message).join("; ")}`,
      );
    }
    throw new SectionedViewResolutionError("invalid-document", `resolveSectionedViewDocument refused invalid document: ${findings.map((entry) => entry.message).join("; ")}`);
  }
  if (typeof resolver !== "function") {
    throw new SectionedViewResolutionError("unresolved-copy", "resolveSectionedViewDocument needs a CopyResolver.");
  }
  const resolutions: CopyResolution[] = [];
  const text = (ref: CopyRef, path: string): string => {
    const resolution = resolver(ref);
    if (resolution === undefined || typeof resolution.text !== "string" || resolution.text.trim().length === 0) {
      throw new SectionedViewResolutionError("unresolved-copy", `resolveSectionedViewDocument could not resolve a CopyRef at ${path}.`);
    }
    resolutions.push(resolution);
    return resolution.text;
  };
  const optional = (ref: CopyRef | undefined, path: string): string | undefined => (ref === undefined ? undefined : text(ref, path));
  const withGrounds = applySectionGroundRhythm(document);
  const sections = withGrounds.sections.map((section, sectionIndex) => resolveSection(assertResolvedSectionGround(section, `sections.${sectionIndex}`), `sections.${sectionIndex}`, text, optional));
  if (document.sectionGroundRhythm === "view") {
    const viewGrounds = document.sections.filter((section) => section.ground === undefined).map((section) => section.id);
    return { id: document.id, sections, resolutions, viewGrounds };
  }
  return { id: document.id, sections, resolutions };
}

function assertResolvedSectionGround(section: SectionedViewSection, path: string): SectionedViewSection & { ground: SectionedViewGround } {
  if (section.ground === undefined) {
    throw new SectionedViewResolutionError("invalid-document", `resolveSectionedViewDocument refused invalid document: ${path}.ground is required after section ground rhythm resolution.`);
  }
  return section as SectionedViewSection & { ground: SectionedViewGround };
}

/** Resolves one status item's label and optional detail; shared between a group's items and a section's flat items. */
function resolveStatusItem(item: SectionedViewStatusItem, path: string, text: (ref: CopyRef, path: string) => string, optional: (ref: CopyRef | undefined, path: string) => string | undefined): ResolvedSectionedViewStatusItem {
  return { ...item, label: text(item.label, `${path}.label`), detail: optional(item.detail, `${path}.detail`) } as ResolvedSectionedViewStatusItem;
}

function resolveSection(section: SectionedViewSection & { ground: SectionedViewGround }, path: string, text: (ref: CopyRef, path: string) => string, optional: (ref: CopyRef | undefined, path: string) => string | undefined): ResolvedSectionedViewSection {
  switch (section.kind) {
    case "hero": {
      const { media: sourceMedia, compact, ...heroBase } = section;
      return {
        ...heroBase,
        ...(compact === undefined ? {} : { compact }),
        eyebrow: optional(section.eyebrow, `${path}.eyebrow`),
        heading: text(section.heading, `${path}.heading`),
        description: optional(section.description, `${path}.description`),
        actions: section.actions?.map((action, index) => ({ ...action, label: text(action.label, `${path}.actions.${index}.label`) })),
        ...(sourceMedia ? { media: { assetId: sourceMedia.assetId, alt: text(sourceMedia.alt, `${path}.media.alt`) } } : {}),
      };
    }
    case "feature-grid":
      return { ...section, eyebrow: optional(section.eyebrow, `${path}.eyebrow`), heading: text(section.heading, `${path}.heading`), description: optional(section.description, `${path}.description`), items: section.items.map((item, index) => ({ ...item, heading: text(item.heading, `${path}.items.${index}.heading`), description: optional(item.description, `${path}.items.${index}.description`) })) };
    case "faq":
      return { ...section, eyebrow: optional(section.eyebrow, `${path}.eyebrow`), heading: text(section.heading, `${path}.heading`), description: optional(section.description, `${path}.description`), items: section.items.map((item, index) => ({ ...item, question: text(item.question, `${path}.items.${index}.question`), answer: text(item.answer, `${path}.items.${index}.answer`) })) };
    case "ordered-step-sequence":
      return { ...section, eyebrow: optional(section.eyebrow, `${path}.eyebrow`), heading: text(section.heading, `${path}.heading`), description: optional(section.description, `${path}.description`), items: section.items.map((item, index) => ({ ...item, ordinal: text(item.ordinal, `${path}.items.${index}.ordinal`), label: optional(item.label, `${path}.items.${index}.label`), heading: text(item.heading, `${path}.items.${index}.heading`), description: optional(item.description, `${path}.items.${index}.description`) })) };
    case "status-list": {
      // `groups` and `items` are destructured OUT of the spread base on purpose:
      // spreading `section` would carry the unresolved shapes and union them with
      // the resolved ones below.
      const { groups: sourceGroups, items: sourceItems, ...base } = section;
      return {
        ...base,
        eyebrow: optional(section.eyebrow, `${path}.eyebrow`),
        heading: text(section.heading, `${path}.heading`),
        description: optional(section.description, `${path}.description`),
        labels: {
          ...Object.fromEntries(STATUSES.map((status) => [status, text(section.labels[status], `${path}.labels.${status}`)])),
          dispositions: Object.fromEntries(DISPOSITIONS.map((disposition) => [disposition, text(section.labels.dispositions[disposition], `${path}.labels.dispositions.${disposition}`)])),
        } as Record<SectionedViewStatus, string> & { dispositions: Record<SectionedViewStatusDisposition, string> },
        // Spread conditionally, never `groups: section.groups?.map(...)`. Optional
        // chaining sets the value to undefined but still creates the key, and the
        // renderer decides grouped-vs-flat with Object.hasOwn, which is true for a
        // key holding undefined. Writing both keys made every status-list section
        // fail the renderer's exactly-one check. Issue #890.
        ...(sourceGroups ? { groups: sourceGroups.map((group, groupIndex) => ({ ...group, heading: text(group.heading, `${path}.groups.${groupIndex}.heading`), items: group.items.map((item, itemIndex) => resolveStatusItem(item, `${path}.groups.${groupIndex}.items.${itemIndex}`, text, optional)) })) } : {}),
        ...(sourceItems ? { items: sourceItems.map((item, itemIndex) => resolveStatusItem(item, `${path}.items.${itemIndex}`, text, optional)) } : {}),
      };
    }
    case "stat-grid":
      return {
        ...section,
        eyebrow: optional(section.eyebrow, `${path}.eyebrow`),
        heading: text(section.heading, `${path}.heading`),
        description: optional(section.description, `${path}.description`),
        items: section.items.map((item, index) => ({
          ...item,
          label: text(item.label, `${path}.items.${index}.label`),
          value: text(item.value, `${path}.items.${index}.value`),
          delta: optional(item.delta, `${path}.items.${index}.delta`),
          description: optional(item.description, `${path}.items.${index}.description`),
        })),
      };
    case "pricing":
      return {
        ...section,
        eyebrow: optional(section.eyebrow, `${path}.eyebrow`),
        heading: text(section.heading, `${path}.heading`),
        description: optional(section.description, `${path}.description`),
        items: section.items.map((item, index) => ({
          ...item,
          name: text(item.name, `${path}.items.${index}.name`),
          price: text(item.price, `${path}.items.${index}.price`),
          description: optional(item.description, `${path}.items.${index}.description`),
          features: item.features.map((feature, featureIndex) => text(feature, `${path}.items.${index}.features.${featureIndex}`)),
          cta: optional(item.cta, `${path}.items.${index}.cta`),
        })),
      };
    case "testimonial":
      return {
        ...section,
        heading: optional(section.heading, `${path}.heading`),
        items: section.items.map((item, index) => ({
          ...item,
          quote: text(item.quote, `${path}.items.${index}.quote`),
          attributorName: text(item.attributorName, `${path}.items.${index}.attributorName`),
          attributorRole: optional(item.attributorRole, `${path}.items.${index}.attributorRole`),
        })),
      };
    case "stat":
      return {
        ...section,
        heading: optional(section.heading, `${path}.heading`),
        items: section.items.map((item, index) => ({
          ...item,
          label: text(item.label, `${path}.items.${index}.label`),
          value: text(item.value, `${path}.items.${index}.value`),
          delta: optional(item.delta, `${path}.items.${index}.delta`),
        })),
      };
    case "content-section":
      return resolveContentSection(section, path, text);
    default:
      throw new SectionedViewResolutionError(
        "unsupported-section-kind",
        `resolveSectionedViewDocument refused section at ${path}: ${unsupportedSectionKindMessage(path, (section as { kind: string }).kind)}`,
      );
  }
}

// ---------------------------------------------------------------------------
// content-section resolution
// ---------------------------------------------------------------------------

type ResolveText = (ref: CopyRef, path: string) => string;

/**
 * `{ [key]: resolved text }` when `ref` is present, otherwise `{}`, so an
 * absent optional field stays absent (never a key holding `undefined`).
 * Spread these in field order: resolution order is the call order.
 */
function copyField<K extends string>(key: K, ref: CopyRef | undefined, path: string, text: ResolveText): Partial<Record<K, string>> {
  return ref === undefined ? {} : ({ [key]: text(ref, `${path}.${key}`) } as Record<K, string>);
}

function resolveSpecimenStatus(status: SectionedViewSpecimenStatus | undefined, path: string, text: ResolveText): { status?: { tone: SectionedViewSpecimenTone; label: string } } {
  return status === undefined ? {} : { status: { tone: status.tone, label: text(status.label, `${path}.status.label`) } };
}

/** A part without its authored `label`, with that label resolved when present. */
function partBase<P extends { label?: CopyRef }>(part: P, path: string, text: ResolveText): Omit<P, "label"> & { label?: string } {
  const { label, ...rest } = part;
  return { ...rest, ...copyField("label", label, path, text) };
}

function resolveSpecimenPart(part: SectionedViewSpecimenPart, path: string, text: ResolveText): ResolvedSectionedViewSpecimenPart {
  switch (part.type) {
    case "fields":
      return { ...partBase(part, path, text), items: part.items.map((item, index) => ({ id: item.id, label: text(item.label, `${path}.items.${index}.label`), value: text(item.value, `${path}.items.${index}.value`) })) };
    case "status-rows":
      return {
        ...partBase(part, path, text),
        items: part.items.map((item, index) => {
          const itemPath = `${path}.items.${index}`;
          return { id: item.id, label: text(item.label, `${itemPath}.label`), ...copyField("detail", item.detail, itemPath, text), status: { tone: item.status.tone, label: text(item.status.label, `${itemPath}.status.label`) } };
        }),
      };
    case "meter":
      return {
        ...part,
        label: text(part.label, `${path}.label`),
        valueText: text(part.valueText, `${path}.valueText`),
        ...copyField("limitText", part.limitText, path, text),
        ...resolveSpecimenStatus(part.status, path, text),
        ...copyField("note", part.note, path, text),
      } as ResolvedSectionedViewSpecimenPart;
    case "table":
      return {
        ...partBase(part, path, text),
        caption: text(part.caption, `${path}.caption`),
        columns: part.columns.map((column, index) => ({ id: column.id, label: text(column.label, `${path}.columns.${index}.label`) })),
        rows: part.rows.map((row, rowIndex) => ({
          id: row.id,
          cells: row.cells.map((cell, cellIndex) => {
            const cellPath = `${path}.rows.${rowIndex}.cells.${cellIndex}`;
            return cell.status !== undefined ? { status: { tone: cell.status.tone, label: text(cell.status.label, `${cellPath}.status.label`) } } : { text: text(cell.text, `${cellPath}.text`) };
          }),
        })),
      } as ResolvedSectionedViewSpecimenPart;
    case "schedule":
      return {
        ...partBase(part, path, text),
        items: part.items.map((item, index) => {
          const itemPath = `${path}.items.${index}`;
          return { id: item.id, date: text(item.date, `${itemPath}.date`), label: text(item.label, `${itemPath}.label`), ...copyField("amount", item.amount, itemPath, text), ...resolveSpecimenStatus(item.status, itemPath, text) };
        }),
      };
    case "shares":
      return {
        ...partBase(part, path, text),
        items: part.items.map((item, index) => {
          const itemPath = `${path}.items.${index}`;
          return { id: item.id, name: text(item.name, `${itemPath}.name`), share: item.share, shareText: text(item.shareText, `${itemPath}.shareText`), ...resolveSpecimenStatus(item.status, itemPath, text) };
        }),
      };
    case "files":
      return {
        ...partBase(part, path, text),
        items: part.items.map((item, index) => {
          const itemPath = `${path}.items.${index}`;
          return { id: item.id, format: text(item.format, `${itemPath}.format`), name: text(item.name, `${itemPath}.name`), ...copyField("source", item.source, itemPath, text) };
        }),
      };
  }
}

function resolveSpecimenPanel(panel: SectionedViewSpecimenPanel, path: string, text: ResolveText): ResolvedSectionedViewSpecimenPanel {
  const footer = panel.footer;
  return {
    id: panel.id,
    title: text(panel.title, `${path}.title`),
    ...copyField("meta", panel.meta, path, text),
    ...resolveSpecimenStatus(panel.status, path, text),
    parts: panel.parts.map((part, index) => resolveSpecimenPart(part, `${path}.parts.${index}`, text)),
    ...(footer === undefined
      ? {}
      : {
          footer: {
            ...(footer.assignee === undefined
              ? {}
              : {
                  assignee: {
                    initials: text(footer.assignee.initials, `${path}.footer.assignee.initials`),
                    name: text(footer.assignee.name, `${path}.footer.assignee.name`),
                    ...copyField("note", footer.assignee.note, `${path}.footer.assignee`, text),
                  },
                }),
            ...copyField("note", footer.note, `${path}.footer`, text),
          },
        }),
  };
}

function resolveContentItem<T extends SectionedViewContentItem>(item: T, path: string, text: ResolveText) {
  return {
    ...item,
    ...copyField("eyebrow", item.eyebrow, path, text),
    heading: text(item.heading, `${path}.heading`),
    ...copyField("description", item.description, path, text),
  };
}

function resolveComparisonSide(side: SectionedViewComparisonSide, path: string, text: ResolveText) {
  return {
    label: text(side.label, `${path}.label`),
    ...copyField("heading", side.heading, path, text),
    ...copyField("description", side.description, path, text),
    ...(side.points === undefined ? {} : { points: side.points.map((point, index) => text(point, `${path}.points.${index}`)) }),
    ...(side.visual === undefined ? {} : { visual: resolveSpecimenPanel(side.visual, `${path}.visual`, text) }),
  };
}

function resolveContentBlock(block: SectionedViewContentBlock, path: string, text: ResolveText): ResolvedSectionedViewContentBlock {
  switch (block.type) {
    case "feature-grid":
      return {
        ...block,
        items: block.items.map((item, index) => {
          const resolved = resolveContentItem(item, `${path}.items.${index}`, text);
          const characters = resolved.eyebrow === undefined ? 0 : [...resolved.eyebrow.trim()].length;
          if (characters > FEATURE_GRID_ITEM_EYEBROW_MAX_CHARACTERS) {
            throw new SectionedViewResolutionError("invalid-document", `resolveSectionedViewDocument refused invalid document: ${path}.items.${index}.eyebrow resolves to ${characters} characters; a feature-grid item eyebrow holds at most ${FEATURE_GRID_ITEM_EYEBROW_MAX_CHARACTERS}.`);
          }
          return resolved;
        }),
      } as ResolvedSectionedViewContentBlock;
    case "topic-list":
      return { ...block, items: block.items.map((item, index) => resolveContentItem(item, `${path}.items.${index}`, text)) } as ResolvedSectionedViewContentBlock;
    case "card-grid":
      return {
        ...block,
        items: block.items.map((card, index) => {
          const cardPath = `${path}.items.${index}`;
          const { visual, ...rest } = resolveContentItem(card, cardPath, text);
          return { ...rest, ...(card.visual === undefined ? {} : { visual: resolveSpecimenPart(card.visual, `${cardPath}.visual`, text) }) };
        }),
      } as ResolvedSectionedViewContentBlock;
    case "comparison":
      return { type: "comparison", before: resolveComparisonSide(block.before, `${path}.before`, text), after: resolveComparisonSide(block.after, `${path}.after`, text) };
    case "ordered-step-sequence": {
      const bounded = (ref: CopyRef, field: string, max: number, code: string): string => {
        const resolved = text(ref, `${path}.${field}`);
        const length = [...resolved.trim()].length;
        if (length > max) throw new SectionedViewResolutionError("invalid-document", `resolveSectionedViewDocument refused invalid document: ${code}: ${path}.${field} resolves to ${length} characters; it holds at most ${max}.`);
        return resolved;
      };
      const foundation = block.lanes !== undefined || block.end !== undefined || block.endLabel !== undefined;
      return {
        ...block,
        ...(block.lanes === undefined ? {} : { lanes: { a: bounded(block.lanes.a, "lanes.a", 20, "sectioned-view-content-steps-lanes-shape"), b: bounded(block.lanes.b, "lanes.b", 20, "sectioned-view-content-steps-lanes-shape") } }),
        ...(block.endLabel === undefined ? {} : { endLabel: bounded(block.endLabel, "endLabel", 40, "sectioned-view-content-module-option") }),
        ...(block.caption === undefined ? {} : { caption: bounded(block.caption, "caption", 120, "sectioned-view-content-steps-caption") }),
        ...(foundation && block.end === "continues" && block.endLabel === undefined ? { continuesLabel: text({ id: "steps.continues" }, `${path}.continuesLabel`) } : {}),
        items: block.items.map((step, index) => {
          const stepPath = `${path}.items.${index}`;
          return {
            id: step.id,
            ...(step.lane === undefined ? {} : { lane: step.lane }),
            ordinal: text(step.ordinal, `${stepPath}.ordinal`),
            ...copyField("label", step.label, stepPath, text),
            heading: text(step.heading, `${stepPath}.heading`),
            ...copyField("description", step.description, stepPath, text),
            ...(step.visual === undefined ? {} : { visual: resolveSpecimenPanel(step.visual, `${stepPath}.visual`, text) }),
            ...(step.href === undefined ? {} : { href: step.href }),
          };
        }),
      } as ResolvedSectionedViewContentBlock;
    }
    case "faq":
      return { ...block, items: block.items.map((item, index) => ({ id: item.id, question: text(item.question, `${path}.items.${index}.question`), answer: text(item.answer, `${path}.items.${index}.answer`) })) };
  }
}

function resolveContentSection(section: SectionedViewContentSection & { ground: SectionedViewGround }, path: string, text: ResolveText): ResolvedSectionedViewContentSection {
  const { block, media, actions, footnote, ...base } = section;
  return {
    ...base,
    ...copyField("eyebrow", section.eyebrow, path, text),
    heading: text(section.heading, `${path}.heading`),
    ...copyField("description", section.description, path, text),
    ...(actions === undefined ? {} : { actions: actions.map((action, index) => ({ ...action, label: text(action.label, `${path}.actions.${index}.label`) })) }),
    ...(block === undefined ? {} : { block: resolveContentBlock(block, `${path}.block`, text) }),
    ...(media === undefined
      ? {}
      : {
          media: {
            ...media,
            label: text(media.label, `${path}.media.label`),
            ...copyField("connector", media.connector, `${path}.media`, text),
            panels: media.panels.map((panel, index) => resolveSpecimenPanel(panel, `${path}.media.panels.${index}`, text)),
          },
        }),
    ...(footnote === undefined
      ? {}
      : {
          footnote: {
            text: text(footnote.text, `${path}.footnote.text`),
            ...(footnote.link === undefined ? {} : { link: { label: text(footnote.link.label, `${path}.footnote.link.label`), href: footnote.link.href } }),
          },
        }),
  } as ResolvedSectionedViewContentSection;
}

// ---------------------------------------------------------------------------
// checkSectionVariety: page rhythm warnings
// ---------------------------------------------------------------------------

/** What the variety lint reads from one section. */
interface BandShape {
  path: string;
  index: number;
  kind: SectionedViewSectionKind;
  layout: SectionedViewContentLayout;
  mediaSide?: SectionedViewContentMediaSide;
  block: string;
  visual: "none" | "specimen" | "lanes";
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

function hasLinkedItems(block: SectionedViewContentBlock | undefined): boolean {
  if (block === undefined || !("items" in block) || !Array.isArray(block.items)) return false;
  return (block.items as readonly unknown[]).some((item) => isPlainObject(item) && item.href !== undefined);
}

function hasBlockVisual(block: SectionedViewContentBlock): boolean {
  switch (block.type) {
    case "card-grid":
      return block.items.some((card) => card.visual !== undefined);
    case "ordered-step-sequence":
      return block.items.some((step) => step.visual !== undefined);
    case "comparison":
      return block.before.visual !== undefined || block.after.visual !== undefined;
    default:
      return false;
  }
}

function blockTreatment(block: SectionedViewContentBlock): string {
  switch (block.type) {
    case "feature-grid":
      return `${block.treatment ?? "plain"}/${block.emphasis ?? "item"}`;
    case "topic-list":
      return `columns-${block.columns ?? 2}`;
    case "ordered-step-sequence":
      return `${block.lanes === undefined ? "" : "lanes/"}${hasBlockVisual(block) ? "visual" : "plain"}`;
    default:
      return "default";
  }
}

function bandShape(section: SectionedViewSection, path: string, index: number): BandShape {
  if (section.kind === "faq" && section.layout === "split") {
    // A split legacy FAQ is the same band as a split content-section FAQ: its rows take the end column.
    return { path, index, kind: section.kind, layout: "split", mediaSide: "end", block: section.kind, visual: "none", dense: false, ground: section.ground, treatment: "default", cardCount: 0, primaryAction: false, hasActions: false, linkedBlock: false };
  }
  if (section.kind !== "content-section") {
    return { path, index, kind: section.kind, layout: "stacked", block: section.kind, visual: "none", dense: false, ground: section.ground, treatment: "default", cardCount: 0, primaryAction: false, hasActions: false, linkedBlock: false };
  }
  const block = section.block;
  const layout = section.layout ?? "stacked";
  return {
    path,
    index,
    kind: section.kind,
    layout,
    ...(layout === "split" ? { mediaSide: section.mediaSide ?? "end" } : {}),
    block: block?.type ?? (section.media === undefined ? "intro" : "none"),
    visual: block?.type === "ordered-step-sequence" && block.lanes !== undefined ? "lanes" : section.media === undefined ? "none" : "specimen",
    dense: section.media !== undefined || (block !== undefined && hasBlockVisual(block)),
    ground: section.ground,
    treatment: block === undefined ? "default" : blockTreatment(block),
    cardCount: block?.type === "card-grid" ? block.items.length : 0,
    primaryAction: Array.isArray(section.actions) && section.actions.some((action) => isPlainObject(action) && action.emphasis === "primary"),
    hasActions: Array.isArray(section.actions) && section.actions.length > 0,
    linkedBlock: hasLinkedItems(block),
  };
}

function varietyWarning(rule: string, path: string, message: string): ComposeFinding {
  return { rule, severity: "warning", path, message };
}

/**
 * Warns where a page's bands repeat or crowd each other. Every finding is a
 * `warning`: the page still validates and resolves; the warnings say where its
 * rhythm reads as a template. Pass one document, or every document one page
 * renders in order (their sections are read as one page, with paths
 * `documents.N.sections.M`). Call it on documents
 * `validateSectionedViewDocument` accepts; malformed sections are skipped.
 *
 * Rules (each finding's `rule` in brackets):
 * 1. Neighbouring bands never share one layout, block type and visual type
 *    [`sectioned-view-variety-repeat`].
 * 2. A split follows a split only with the opposite `mediaSide`
 *    [`sectioned-view-variety-split-side`]; never three splits in a row
 *    [`sectioned-view-variety-split-run`].
 * 3. A dense band (a specimen, as media or inside its block) is followed by
 *    an airy one [`sectioned-view-variety-density`].
 * 4. A specimen never sits on an inverse ground
 *    [`sectioned-view-variety-specimen-ground`]; at most one body band (any
 *    band after the first) is inverse [`sectioned-view-variety-inverse-bands`].
 * 5. At most one band with four or more cards
 *    [`sectioned-view-variety-card-bands`], and at most one comparison
 *    [`sectioned-view-variety-comparison-count`].
 * 6. One block type used twice needs a different treatment
 *    [`sectioned-view-variety-treatment`].
 * 7. At most one band carries a `primary` action
 *    [`sectioned-view-variety-primary-actions`]: the page converts in one
 *    place, and any other band that takes actions takes a secondary one.
 * 8. A band whose block links its items takes no section actions
 *    [`sectioned-view-variety-link-competing`]: linked cards and a button in
 *    one band are two competing ways on. (A stacked band with a block takes
 *    no actions at all, a validation error; this catches the split.)
 *
 * A lone compact hero warns unless the caller explicitly supplies
 * `hasAfterContent` for a known page slot (after-section content or a close).
 * Supply trailing documents in `input` so their sections count as page content.
 *
 * Whether a visual repeats its block's words cannot be judged before copy
 * resolves, so that rule stays with the writer.
 */
export function checkSectionVariety(input: SectionedViewDocument | readonly SectionedViewDocument[], context: { hasAfterContent?: boolean; catalog?: boolean; copyResolver?: CopyResolver } = {}): ComposeFinding[] {
  const documents = Array.isArray(input) ? (input as readonly SectionedViewDocument[]) : [input as SectionedViewDocument];
  const many = Array.isArray(input);
  const bands: BandShape[] = [];
  documents.forEach((document, documentIndex) => {
    if (!isPlainObject(document) || !Array.isArray(document.sections)) return;
    document.sections.forEach((section, sectionIndex) => {
      if (!isPlainObject(section) || !SECTION_KINDS.includes(section.kind)) return;
      const path = many ? `documents.${documentIndex}.sections.${sectionIndex}` : `sections.${sectionIndex}`;
      bands.push(bandShape(section, path, bands.length));
    });
  });

  const findings: ComposeFinding[] = [];
  documents.forEach((document, documentIndex) => {
    if (!Array.isArray(document?.sections)) return;
    document.sections.forEach((section, sectionIndex) => {
      if (section.kind !== "content-section" || section.block?.type !== "ordered-step-sequence") return;
      const block = section.block;
      const path = `${many ? `documents.${documentIndex}.` : ""}sections.${sectionIndex}.block`;
      if (block.end === "continues" && block.endLabel === undefined) findings.push(varietyWarning("sectioned-view-content-steps-end-label", `${path}.endLabel`, `${path} continues; add visible copy naming what follows.`));
      if (context.catalog === true && hasBlockVisual(block)) {
        let caption: string | undefined;
        try { if (block.caption !== undefined && typeof context.copyResolver === "function") caption = context.copyResolver(block.caption)?.text; } catch { /* Unavailable copy cannot prove a sample marker. */ }
        if (typeof caption !== "string" || !/\bsample data\b/i.test(caption)) findings.push(varietyWarning("sectioned-view-content-steps-caption-sample", `${path}.caption`, `${path} has sample visuals; include a Sample data caption.`));
      }
    });
  });
  const onlySection = documents.flatMap((document) => Array.isArray(document?.sections) ? document.sections : []);
  if (onlySection.length === 1 && onlySection[0]?.kind === "hero" && onlySection[0].compact === true && context.hasAfterContent !== true) {
    findings.push(varietyWarning("sectioned-view-hero-compact-content", bands[0]?.path ?? "sections.0", "A compact hero needs content after it; supply page content or use the default hero."));
  }
  bands.forEach((band, position) => {
    const previous = bands[position - 1];
    if (previous === undefined) return;
    if (previous.layout === band.layout && previous.block === band.block && previous.visual === band.visual) {
      findings.push(varietyWarning("sectioned-view-variety-repeat", band.path, `${band.path} repeats the layout, block and visual of the band before it (${band.layout}, ${band.block}, ${band.visual}); vary one of them.`));
    }
    if (previous.layout === "split" && band.layout === "split") {
      if (previous.mediaSide === band.mediaSide) findings.push(varietyWarning("sectioned-view-variety-split-side", band.path, `${band.path} is a split after a split with the same mediaSide (${band.mediaSide}); flip its mediaSide.`));
      if (bands[position - 2]?.layout === "split") findings.push(varietyWarning("sectioned-view-variety-split-run", band.path, `${band.path} is the third split in a row; make one of them stacked.`));
    }
    if (previous.dense && band.dense) findings.push(varietyWarning("sectioned-view-variety-density", band.path, `${band.path} is a dense band right after another; put an airy band (feature-grid, topic-list, ordered-step-sequence without visuals, intro or FAQ) between them.`));
  });

  bands.forEach((band) => {
    if (band.ground === "inverse" && band.dense) findings.push(varietyWarning("sectioned-view-variety-specimen-ground", band.path, `${band.path} puts a specimen on an inverse ground; product UI sits on base or sunken.`));
  });
  const inverseBodyBands = bands.filter((band) => band.index > 0 && band.ground === "inverse");
  inverseBodyBands.slice(1).forEach((band) => findings.push(varietyWarning("sectioned-view-variety-inverse-bands", band.path, `${band.path} is a second inverse body band; keep at most one.`)));
  bands.filter((band) => band.cardCount >= 4).slice(1).forEach((band) => findings.push(varietyWarning("sectioned-view-variety-card-bands", band.path, `${band.path} is a second band with four or more cards; keep at most one.`)));
  bands.filter((band) => band.kind === "content-section" && band.block === "comparison").slice(1).forEach((band) => findings.push(varietyWarning("sectioned-view-variety-comparison-count", band.path, `${band.path} is a second comparison; keep at most one.`)));
  bands.filter((band) => band.primaryAction).slice(1).forEach((band) => findings.push(varietyWarning("sectioned-view-variety-primary-actions", band.path, `${band.path} is a second band with a primary action; keep one, make this one secondary.`)));
  bands.filter((band) => band.linkedBlock && band.hasActions).forEach((band) => findings.push(varietyWarning("sectioned-view-variety-link-competing", band.path, `${band.path} links its block's items and also carries section actions; keep one way on: drop the actions, or unlink the items.`)));

  const seen = new Map<string, BandShape>();
  for (const band of bands) {
    if (band.kind !== "content-section" || band.block === "intro" || band.block === "none" || band.block === "comparison") continue;
    const key = `${band.block}|${band.treatment}`;
    const first = seen.get(key);
    if (first !== undefined) findings.push(varietyWarning("sectioned-view-variety-treatment", band.path, `${band.path} uses the ${band.block} block with the same treatment as ${first.path}; give it a different treatment.`));
    else seen.set(key, band);
  }
  return findings;
}
