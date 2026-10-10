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
}

/**
 * How a content-section action renders. `primary` is the filled button, for
 * the band's one conversion; `secondary` (the default) is the outlined button
 * of the same size and shape, for the band's next step to a major page.
 */
export type SectionedViewContentActionEmphasis = "primary" | "secondary";

/**
 * One call to action a content section may carry: a hero action plus its
 * emphasis. A section holds at most two, and at most one `primary`; both
 * render as full-size buttons.
 */
export interface SectionedViewContentAction extends SectionedViewAction {
  /** @default "secondary" */
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
   * with a split `faq` module renders. Optional and additive: without it (or
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
// content-section: one band anatomy (header, text module, visual module)
// ---------------------------------------------------------------------------

/** How a content section arranges its text and its visual. `split` puts them side by side and needs `media`, except a split FAQ, whose rows take the visual column. */
export type SectionedViewContentLayout = "stacked" | "split";
/** Which side a split section's visual sits on. Reading order never changes: header, module, then visual. */
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

/** One parallel item of a features, cards or topics module. */
export interface SectionedViewContentItem {
  id: string;
  icon?: ContentIconName;
  /**
   * Cards and features items only; a topics item with an eyebrow is refused.
   * A features item eyebrow is a small label above the item heading and
   * resolves to at most `FEATURES_ITEM_EYEBROW_MAX_CHARACTERS` characters.
   */
  eyebrow?: CopyRef;
  heading: CopyRef;
  description?: CopyRef;
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

export interface SectionedViewContentStep {
  id: string;
  ordinal: CopyRef;
  /** The actor tag for the step. */
  label?: CopyRef;
  heading: CopyRef;
  description?: CopyRef;
  visual?: SectionedViewSpecimenPanel;
}

export type SectionedViewFeaturesTreatment = "plain" | "rule" | "plate";
export type SectionedViewFeaturesEmphasis = "item" | "statement";

/**
 * Parallel items of equal weight: 2-4 items, exactly 3 with `statement`
 * emphasis. `columns` defaults to 3, `treatment` to `plain`, `emphasis` to
 * `item`. Item icons are allowed with `plain` and `plate` only.
 */
export interface SectionedViewFeaturesModule {
  type: "features";
  columns?: 2 | 3 | 4;
  treatment?: SectionedViewFeaturesTreatment;
  emphasis?: SectionedViewFeaturesEmphasis;
  items: SectionedViewContentItem[];
}

/**
 * A mixed card grid of 2-6 cards. Spans fill whole 12-column rows, each row
 * one of: two-thirds + third (either order), three thirds, two halves, or one
 * full card.
 */
export interface SectionedViewCardsModule {
  type: "cards";
  items: SectionedViewContentCard[];
}

export interface SectionedViewComparisonModule {
  type: "comparison";
  before: SectionedViewComparisonSide;
  after: SectionedViewComparisonSide;
}

/** Many short, scannable items: 2-8 items, an even count in 2 columns. `columns` defaults to 2. */
export interface SectionedViewTopicsModule {
  type: "topics";
  columns?: 1 | 2;
  items: SectionedViewContentItem[];
}

/** A process of 3-4 steps. */
export interface SectionedViewStepsModule {
  type: "steps";
  items: SectionedViewContentStep[];
}

/** 4-6 question and answer pairs. */
export interface SectionedViewFaqModule {
  type: "faq";
  items: SectionedViewFaqItem[];
}

/** The text module of a content section. */
export type SectionedViewContentModule =
  | SectionedViewFeaturesModule
  | SectionedViewCardsModule
  | SectionedViewComparisonModule
  | SectionedViewTopicsModule
  | SectionedViewStepsModule
  | SectionedViewFaqModule;

export type SectionedViewContentModuleType = SectionedViewContentModule["type"];

/**
 * One band: a header (eyebrow, heading, description, one or two button
 * actions), an optional text module, an optional visual and an optional
 * footnote. With neither
 * module nor media it is an intro band. `mediaSide` is allowed only on a
 * `split`, `align` only on a stacked section, and a `split` needs `media`,
 * with two exceptions where the module itself takes the visual column, top
 * aligned beside the header: a split FAQ module (which then takes no
 * `media`), and a text-only split, a `topics` module or a two-column
 * `features` module (not `statement` emphasis) with no `media`.
 */
export interface SectionedViewContentSection {
  id: string;
  kind: "content-section";
  ground?: SectionedViewGround;
  eyebrow?: CopyRef;
  heading: CopyRef;
  description?: CopyRef;
  /** One or two, at most one `primary`; rendered as full-size buttons. */
  actions?: SectionedViewContentAction[];
  /** @default "stacked" */
  layout?: SectionedViewContentLayout;
  /** Split only. @default "end" */
  mediaSide?: SectionedViewContentMediaSide;
  /** Stacked only. */
  align?: SectionedViewContentAlign;
  module?: SectionedViewContentModule;
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
export type ResolvedSectionedViewContentModule = ResolvedCopyTree<SectionedViewContentModule>;
/** A content section with its copy resolved and its ground applied. Absent optional fields stay absent. */
export type ResolvedSectionedViewContentSection = Omit<ResolvedCopyTree<SectionedViewContentSection>, "ground"> & { ground: SectionedViewGround };

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
        if (!hasOnlyOwnKeys(section, ["id", "kind", "ground", "eyebrow", "heading", "description", "actions", "media"]) || !hasOwn(section, "heading")) findings.push(finding("sectioned-view-section-keys", path, `${path} has keys not allowed for hero.`));
        validateCopy(section.heading, `${path}.heading`, findings);
        if (section.eyebrow !== undefined) validateCopy(section.eyebrow, `${path}.eyebrow`, findings);
        if (section.description !== undefined) validateCopy(section.description, `${path}.description`, findings);
        if (section.actions !== undefined) validateActions(section.actions, `${path}.actions`, findings);
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
 * Actions, hero or content-section. A content-section action may also carry
 * an `emphasis` (`allowEmphasis`); a hero action may not. Returns the records
 * that passed the shape check.
 */
function validateActions(value: unknown, path: string, findings: ComposeFinding[], allowEmphasis = false): Record<string, unknown>[] {
  if (!validateDenseArray(value, path, findings, "sectioned-view-actions-shape", `${path} must be a non-empty array when present.`)) return [];
  validateItemIds(value, path, findings);
  const keys = allowEmphasis ? ["id", "label", "href", "emphasis"] : ["id", "label", "href"];
  const actions: Record<string, unknown>[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const action = value[index];
    const actionPath = `${path}.${index}`;
    if (!isPlainObject(action) || !hasOnlyOwnKeys(action, keys) || !hasOwnKeys(action, ["id", "label", "href"]) || !isNonWhitespaceString(action.id)) {
      findings.push(finding("sectioned-view-action-shape", actionPath, `${actionPath} must be a plain action with id, label, and href${allowEmphasis ? ", and optionally emphasis" : ""}.`));
      continue;
    }
    validateCopy(action.label, `${actionPath}.label`, findings);
    if (!isSanctionedHref(action.href)) findings.push(finding("sectioned-view-action-href", `${actionPath}.href`, `${actionPath}.href must be a fragment, a one-origin path, an http(s) URL, or a mailto link.`));
    if (allowEmphasis) validateEnumField(action, "emphasis", CONTENT_ACTION_EMPHASES, "sectioned-view-content-action-emphasis", actionPath, findings);
    actions.push(action);
  }
  return actions;
}

/**
 * A content section's actions: one or two, at most one `primary`. The rest
 * are `secondary`, the default. Both render as full-size buttons; an aside
 * that needs a text link is the section's `footnote`.
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

const CONTENT_SECTION_KEYS = ["id", "kind", "ground", "eyebrow", "heading", "description", "actions", "layout", "mediaSide", "align", "module", "media", "footnote"] as const;
const CONTENT_ACTION_EMPHASES: readonly SectionedViewContentActionEmphasis[] = ["primary", "secondary"];
/** The most actions one content section may hold. */
const CONTENT_ACTIONS_MAX = 2;
const CONTENT_LAYOUTS: readonly SectionedViewContentLayout[] = ["stacked", "split"];
const CONTENT_MEDIA_SIDES: readonly SectionedViewContentMediaSide[] = ["end", "start"];
const CONTENT_ALIGNS: readonly SectionedViewContentAlign[] = ["start", "center"];
const CONTENT_MODULE_TYPES: readonly SectionedViewContentModuleType[] = ["features", "cards", "comparison", "topics", "steps", "faq"];
const FEATURES_COLUMNS: readonly number[] = [2, 3, 4];
const FEATURES_TREATMENTS: readonly SectionedViewFeaturesTreatment[] = ["plain", "rule", "plate"];
const FEATURES_EMPHASES: readonly SectionedViewFeaturesEmphasis[] = ["item", "statement"];
const TOPICS_COLUMNS: readonly number[] = [1, 2];
const CARD_SPAN_UNITS: Readonly<Record<SectionedViewContentCardSpan, number>> = { third: 4, half: 6, "two-thirds": 8, full: 12 };
const CARD_SPANS = Object.keys(CARD_SPAN_UNITS) as SectionedViewContentCardSpan[];
const CARD_ROW_UNITS = 12;
const SPECIMEN_TONES: readonly SectionedViewSpecimenTone[] = ["success", "warning", "danger", "info", "neutral"];
const SPECIMEN_ARRANGEMENTS: readonly SectionedViewSpecimenArrangement[] = ["single", "row", "stack", "flow"];
const SPECIMEN_PART_TYPES: readonly SectionedViewSpecimenPartType[] = ["fields", "status-rows", "meter", "table", "schedule", "shares", "files"];
const FIELDS_COLUMNS: readonly number[] = [1, 2, 4];
const METER_DIRECTIONS: readonly string[] = ["max", "min"];
const CONTENT_ITEM_KEYS = ["id", "icon", "eyebrow", "heading", "description"] as const;
/** Modules that may take a split's visual column themselves when the split has no media: the text-only split. */
const TEXT_SPLIT_MODULE_TYPES: readonly SectionedViewContentModuleType[] = ["topics", "features"];
/**
 * The most characters a features item eyebrow may resolve to: the eyebrow
 * budget of the content cookbook. Checked when copy resolves, since a CopyRef
 * carries no text before then.
 */
export const FEATURES_ITEM_EYEBROW_MAX_CHARACTERS = 32;
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
  if (!hasOnlyOwnKeys(section, CONTENT_SECTION_KEYS) || !hasOwn(section, "heading")) findings.push(finding("sectioned-view-section-keys", path, `${path} has keys not allowed for content-section.`));
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
  const faqModule = isPlainObject(section.module) && section.module.type === "faq";
  if (split && faqModule && section.media !== undefined) findings.push(finding("sectioned-view-content-faq-split-media", `${path}.media`, `${path} is a split FAQ section; its rows take the visual column, so it takes no media.`));
  if (split && !faqModule && section.media === undefined) {
    const textModule = isPlainObject(section.module) && TEXT_SPLIT_MODULE_TYPES.includes(section.module.type as SectionedViewContentModuleType);
    if (!textModule) findings.push(finding("sectioned-view-content-split-media", `${path}.media`, `${path} is a split section and needs media, unless its module is faq, topics or features.`));
    else if (isPlainObject(section.module) && section.module.type === "features" && (section.module.columns !== 2 || section.module.emphasis === "statement")) {
      findings.push(finding("sectioned-view-content-text-split", `${path}.module`, `${path} is a text-only split; its features module takes the visual column, so it needs columns: 2 and item emphasis.`));
    }
  }
  if (section.module !== undefined) validateContentModule(section.module, `${path}.module`, findings);
  if (section.media !== undefined) validateSpecimenMedia(section.media, `${path}.media`, findings);
}

/** An item's icon, heading and description; only a cards or features item (`eyebrowAllowed`) carries an eyebrow. */
function validateContentItemFields(item: Record<string, unknown>, path: string, findings: ComposeFinding[], eyebrowAllowed = false): void {
  if (item.icon !== undefined) validateIcon(item.icon, `${path}.icon`, findings);
  validateCopy(item.heading, `${path}.heading`, findings);
  validateOptionalCopyFields(item, ["eyebrow", "description"], path, findings);
  if (item.eyebrow !== undefined && !eyebrowAllowed) findings.push(finding("sectioned-view-content-item-eyebrow", `${path}.eyebrow`, `${path}.eyebrow is allowed only on cards and features items.`));
}

function validateModuleKeys(module: Record<string, unknown>, keys: readonly string[], required: readonly string[], path: string, findings: ComposeFinding[]): void {
  if (!hasOnlyOwnKeys(module, keys) || !hasOwnKeys(module, required)) findings.push(finding("sectioned-view-content-module-shape", path, `${path} has keys not allowed for a ${String(module.type)} module.`));
}

function validateContentModule(value: unknown, path: string, findings: ComposeFinding[]): void {
  if (!isPlainObject(value) || !hasEnumerableOwnDataKeys(value) || !isNonWhitespaceString(value.type)) {
    findings.push(finding("sectioned-view-content-module-shape", path, `${path} must be a module object with a type.`));
    return;
  }
  switch (value.type) {
    case "features": {
      validateModuleKeys(value, ["type", "columns", "treatment", "emphasis", "items"], ["items"], path, findings);
      validateEnumField(value, "columns", FEATURES_COLUMNS, "sectioned-view-content-module-option", path, findings);
      validateEnumField(value, "treatment", FEATURES_TREATMENTS, "sectioned-view-content-module-option", path, findings);
      validateEnumField(value, "emphasis", FEATURES_EMPHASES, "sectioned-view-content-module-option", path, findings);
      const statement = value.emphasis === "statement";
      const iconsAllowed = value.treatment !== "rule";
      validateRecords(value.items, `${path}.items`, findings, statement ? { min: 3, max: 3 } : { min: 2, max: 4 }, CONTENT_ITEM_KEYS, ["heading"], (item, itemPath) => {
        validateContentItemFields(item, itemPath, findings, true);
        if (item.icon !== undefined && !iconsAllowed) findings.push(finding("sectioned-view-content-icon-treatment", `${itemPath}.icon`, `${itemPath}.icon is allowed only with the plain and plate treatments.`));
      });
      return;
    }
    case "cards": {
      validateModuleKeys(value, ["type", "items"], ["items"], path, findings);
      const cards = validateRecords(value.items, `${path}.items`, findings, { min: 2, max: 6 }, [...CONTENT_ITEM_KEYS, "span", "visual"], ["heading", "span"], (card, cardPath) => {
        validateContentItemFields(card, cardPath, findings, true);
        validateEnumField(card, "span", CARD_SPANS, "sectioned-view-content-card-span", cardPath, findings);
        if (card.visual !== undefined) validateSpecimenPart(card.visual, `${cardPath}.visual`, findings, CARD_VISUAL_MAX_ROWS);
      });
      if (Array.isArray(value.items) && cards.length === value.items.length && cards.every((card) => CARD_SPANS.includes(card.span as SectionedViewContentCardSpan))) {
        validateCardRows(cards.map((card) => card.span as SectionedViewContentCardSpan), `${path}.items`, findings);
      }
      return;
    }
    case "comparison": {
      validateModuleKeys(value, ["type", "before", "after"], ["before", "after"], path, findings);
      const before = validateComparisonSide(value.before, `${path}.before`, findings);
      const after = validateComparisonSide(value.after, `${path}.after`, findings);
      if (before !== undefined && after !== undefined) {
        const form = (side: Record<string, unknown>) => (side.points !== undefined ? `points:${Array.isArray(side.points) ? side.points.length : 0}` : "description");
        if (form(before) !== form(after)) findings.push(finding("sectioned-view-content-comparison-sides", path, `${path}.before and ${path}.after must use the same form: both a description, or both the same number of points.`));
        if ((before.visual === undefined) !== (after.visual === undefined)) findings.push(finding("sectioned-view-content-comparison-sides", path, `${path}.before and ${path}.after must both carry a visual or neither.`));
      }
      return;
    }
    case "topics": {
      validateModuleKeys(value, ["type", "columns", "items"], ["items"], path, findings);
      validateEnumField(value, "columns", TOPICS_COLUMNS, "sectioned-view-content-module-option", path, findings);
      validateRecords(value.items, `${path}.items`, findings, { min: 2, max: 8 }, CONTENT_ITEM_KEYS, ["heading"], (item, itemPath) => validateContentItemFields(item, itemPath, findings));
      const twoColumns = value.columns === undefined || value.columns === 2;
      if (twoColumns && Array.isArray(value.items) && value.items.length % 2 === 1) {
        findings.push(finding("sectioned-view-content-count", `${path}.items`, `${path}.items must hold an even number of items in 2 columns; it holds ${value.items.length}.`));
      }
      return;
    }
    case "steps":
      validateModuleKeys(value, ["type", "items"], ["items"], path, findings);
      validateRecords(value.items, `${path}.items`, findings, { min: 3, max: 4 }, ["id", "ordinal", "label", "heading", "description", "visual"], ["ordinal", "heading"], (step, stepPath) => {
        validateCopy(step.ordinal, `${stepPath}.ordinal`, findings);
        validateCopy(step.heading, `${stepPath}.heading`, findings);
        validateOptionalCopyFields(step, ["label", "description"], stepPath, findings);
        if (step.visual !== undefined) validateSpecimenPanel(step.visual, `${stepPath}.visual`, findings);
      });
      return;
    case "faq":
      validateModuleKeys(value, ["type", "items"], ["items"], path, findings);
      validateRecords(value.items, `${path}.items`, findings, { min: 4, max: 6 }, ["id", "question", "answer"], ["question", "answer"], (item, itemPath) => {
        validateCopy(item.question, `${itemPath}.question`, findings);
        validateCopy(item.answer, `${itemPath}.answer`, findings);
      });
      return;
    default:
      findings.push(finding("sectioned-view-content-module-type", `${path}.type`, `${path}.type "${value.type}" is not a content module type; supported types are ${CONTENT_MODULE_TYPES.join(", ")}.`));
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
      validateEnumField(value, "columns", FIELDS_COLUMNS, "sectioned-view-content-module-option", path, findings);
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
      validateEnumField(value, "direction", METER_DIRECTIONS, "sectioned-view-content-module-option", path, findings);
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
      const { media: sourceMedia, ...heroBase } = section;
      return {
        ...heroBase,
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

function resolveContentModule(module: SectionedViewContentModule, path: string, text: ResolveText): ResolvedSectionedViewContentModule {
  switch (module.type) {
    case "features":
      return {
        ...module,
        items: module.items.map((item, index) => {
          const resolved = resolveContentItem(item, `${path}.items.${index}`, text);
          const characters = resolved.eyebrow === undefined ? 0 : [...resolved.eyebrow.trim()].length;
          if (characters > FEATURES_ITEM_EYEBROW_MAX_CHARACTERS) {
            throw new SectionedViewResolutionError("invalid-document", `resolveSectionedViewDocument refused invalid document: ${path}.items.${index}.eyebrow resolves to ${characters} characters; a features item eyebrow holds at most ${FEATURES_ITEM_EYEBROW_MAX_CHARACTERS}.`);
          }
          return resolved;
        }),
      } as ResolvedSectionedViewContentModule;
    case "topics":
      return { ...module, items: module.items.map((item, index) => resolveContentItem(item, `${path}.items.${index}`, text)) } as ResolvedSectionedViewContentModule;
    case "cards":
      return {
        ...module,
        items: module.items.map((card, index) => {
          const cardPath = `${path}.items.${index}`;
          const { visual, ...rest } = resolveContentItem(card, cardPath, text);
          return { ...rest, ...(card.visual === undefined ? {} : { visual: resolveSpecimenPart(card.visual, `${cardPath}.visual`, text) }) };
        }),
      } as ResolvedSectionedViewContentModule;
    case "comparison":
      return { type: "comparison", before: resolveComparisonSide(module.before, `${path}.before`, text), after: resolveComparisonSide(module.after, `${path}.after`, text) };
    case "steps":
      return {
        ...module,
        items: module.items.map((step, index) => {
          const stepPath = `${path}.items.${index}`;
          return {
            id: step.id,
            ordinal: text(step.ordinal, `${stepPath}.ordinal`),
            ...copyField("label", step.label, stepPath, text),
            heading: text(step.heading, `${stepPath}.heading`),
            ...copyField("description", step.description, stepPath, text),
            ...(step.visual === undefined ? {} : { visual: resolveSpecimenPanel(step.visual, `${stepPath}.visual`, text) }),
          };
        }),
      } as ResolvedSectionedViewContentModule;
    case "faq":
      return { ...module, items: module.items.map((item, index) => ({ id: item.id, question: text(item.question, `${path}.items.${index}.question`), answer: text(item.answer, `${path}.items.${index}.answer`) })) };
  }
}

function resolveContentSection(section: SectionedViewContentSection & { ground: SectionedViewGround }, path: string, text: ResolveText): ResolvedSectionedViewContentSection {
  const { module, media, actions, footnote, ...base } = section;
  return {
    ...base,
    ...copyField("eyebrow", section.eyebrow, path, text),
    heading: text(section.heading, `${path}.heading`),
    ...copyField("description", section.description, path, text),
    ...(actions === undefined ? {} : { actions: actions.map((action, index) => ({ ...action, label: text(action.label, `${path}.actions.${index}.label`) })) }),
    ...(module === undefined ? {} : { module: resolveContentModule(module, `${path}.module`, text) }),
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
  module: string;
  visual: "none" | "specimen";
  /** Carries a specimen (as media or inside its module) or a table: a dense band. */
  dense: boolean;
  ground?: SectionedViewGround;
  /** The module's treatment, for telling two uses of one module type apart. */
  treatment: string;
  cardCount: number;
  /** Carries a `primary` content-section action. */
  primaryAction: boolean;
}

function hasModuleVisual(module: SectionedViewContentModule): boolean {
  switch (module.type) {
    case "cards":
      return module.items.some((card) => card.visual !== undefined);
    case "steps":
      return module.items.some((step) => step.visual !== undefined);
    case "comparison":
      return module.before.visual !== undefined || module.after.visual !== undefined;
    default:
      return false;
  }
}

function moduleTreatment(module: SectionedViewContentModule): string {
  switch (module.type) {
    case "features":
      return `${module.treatment ?? "plain"}/${module.emphasis ?? "item"}`;
    case "topics":
      return `columns-${module.columns ?? 2}`;
    case "steps":
      return hasModuleVisual(module) ? "visual" : "plain";
    default:
      return "default";
  }
}

function bandShape(section: SectionedViewSection, path: string, index: number): BandShape {
  if (section.kind === "faq" && section.layout === "split") {
    // A split legacy FAQ is the same band as a split content-section FAQ: its rows take the end column.
    return { path, index, kind: section.kind, layout: "split", mediaSide: "end", module: section.kind, visual: "none", dense: false, ground: section.ground, treatment: "default", cardCount: 0, primaryAction: false };
  }
  if (section.kind !== "content-section") {
    return { path, index, kind: section.kind, layout: "stacked", module: section.kind, visual: "none", dense: false, ground: section.ground, treatment: "default", cardCount: 0, primaryAction: false };
  }
  const module = section.module;
  const layout = section.layout ?? "stacked";
  return {
    path,
    index,
    kind: section.kind,
    layout,
    ...(layout === "split" ? { mediaSide: section.mediaSide ?? "end" } : {}),
    module: module?.type ?? (section.media === undefined ? "intro" : "none"),
    visual: section.media === undefined ? "none" : "specimen",
    dense: section.media !== undefined || (module !== undefined && hasModuleVisual(module)),
    ground: section.ground,
    treatment: module === undefined ? "default" : moduleTreatment(module),
    cardCount: module?.type === "cards" ? module.items.length : 0,
    primaryAction: Array.isArray(section.actions) && section.actions.some((action) => isPlainObject(action) && action.emphasis === "primary"),
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
 * 1. Neighbouring bands never share one layout, module type and visual type
 *    [`sectioned-view-variety-repeat`].
 * 2. A split follows a split only with the opposite `mediaSide`
 *    [`sectioned-view-variety-split-side`]; never three splits in a row
 *    [`sectioned-view-variety-split-run`].
 * 3. A dense band (a specimen, as media or inside its module) is followed by
 *    an airy one [`sectioned-view-variety-density`].
 * 4. A specimen never sits on an inverse ground
 *    [`sectioned-view-variety-specimen-ground`]; at most one body band (any
 *    band after the first) is inverse [`sectioned-view-variety-inverse-bands`].
 * 5. At most one band with four or more cards
 *    [`sectioned-view-variety-card-bands`], and at most one comparison
 *    [`sectioned-view-variety-comparison-count`].
 * 6. One module type used twice needs a different treatment
 *    [`sectioned-view-variety-treatment`].
 * 7. At most one band carries a `primary` action
 *    [`sectioned-view-variety-primary-actions`]: the page converts in one
 *    place, and every other band leads on with a secondary button.
 *
 * Whether a visual repeats its module's words cannot be judged before copy
 * resolves, so that rule stays with the writer.
 */
export function checkSectionVariety(input: SectionedViewDocument | readonly SectionedViewDocument[]): ComposeFinding[] {
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
  bands.forEach((band, position) => {
    const previous = bands[position - 1];
    if (previous === undefined) return;
    if (previous.layout === band.layout && previous.module === band.module && previous.visual === band.visual) {
      findings.push(varietyWarning("sectioned-view-variety-repeat", band.path, `${band.path} repeats the layout, module and visual of the band before it (${band.layout}, ${band.module}, ${band.visual}); vary one of them.`));
    }
    if (previous.layout === "split" && band.layout === "split") {
      if (previous.mediaSide === band.mediaSide) findings.push(varietyWarning("sectioned-view-variety-split-side", band.path, `${band.path} is a split after a split with the same mediaSide (${band.mediaSide}); flip its mediaSide.`));
      if (bands[position - 2]?.layout === "split") findings.push(varietyWarning("sectioned-view-variety-split-run", band.path, `${band.path} is the third split in a row; make one of them stacked.`));
    }
    if (previous.dense && band.dense) findings.push(varietyWarning("sectioned-view-variety-density", band.path, `${band.path} is a dense band right after another; put an airy band (features, topics, plain steps, intro or FAQ) between them.`));
  });

  bands.forEach((band) => {
    if (band.ground === "inverse" && band.dense) findings.push(varietyWarning("sectioned-view-variety-specimen-ground", band.path, `${band.path} puts a specimen on an inverse ground; product UI sits on base or sunken.`));
  });
  const inverseBodyBands = bands.filter((band) => band.index > 0 && band.ground === "inverse");
  inverseBodyBands.slice(1).forEach((band) => findings.push(varietyWarning("sectioned-view-variety-inverse-bands", band.path, `${band.path} is a second inverse body band; keep at most one.`)));
  bands.filter((band) => band.cardCount >= 4).slice(1).forEach((band) => findings.push(varietyWarning("sectioned-view-variety-card-bands", band.path, `${band.path} is a second band with four or more cards; keep at most one.`)));
  bands.filter((band) => band.kind === "content-section" && band.module === "comparison").slice(1).forEach((band) => findings.push(varietyWarning("sectioned-view-variety-comparison-count", band.path, `${band.path} is a second comparison; keep at most one.`)));
  bands.filter((band) => band.primaryAction).slice(1).forEach((band) => findings.push(varietyWarning("sectioned-view-variety-primary-actions", band.path, `${band.path} is a second band with a primary action; keep one, make this one secondary.`)));

  const seen = new Map<string, BandShape>();
  for (const band of bands) {
    if (band.kind !== "content-section" || band.module === "intro" || band.module === "none" || band.module === "comparison") continue;
    const key = `${band.module}|${band.treatment}`;
    const first = seen.get(key);
    if (first !== undefined) findings.push(varietyWarning("sectioned-view-variety-treatment", band.path, `${band.path} uses the ${band.module} module with the same treatment as ${first.path}; give it a different treatment.`));
    else seen.set(key, band);
  }
  return findings;
}
