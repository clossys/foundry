import { Icon, type IconNode } from "@clossys/designer/atoms/server";
import { CardGrid, Comparison, ContentSection, FeatureGrid, OrderedStepSequence, Specimen, TopicList } from "@clossys/designer/blocks/server";
import type { SpecimenPanelItem, SpecimenPart } from "@clossys/designer/blocks/server";
import {
  Briefcase,
  Building2,
  Calendar,
  Clock,
  FileCheck,
  FileText,
  Folder,
  Globe,
  Landmark,
  Layers,
  Lock,
  Receipt,
  Scale,
  Search,
  ShieldCheck,
  Users,
} from "@clossys/designer/icons";
import type { ReactNode } from "react";
import type {
  ContentIconName,
  ResolvedSectionedViewContentBlock,
  ResolvedSectionedViewContentSection,
  ResolvedSectionedViewSpecimenMedia,
  ResolvedSectionedViewSpecimenPanel,
  ResolvedSectionedViewSpecimenPart,
  SectionedViewGround,
} from "../../core/sectioned-view.js";

/**
 * Each closed `ContentIconName` mapped to its Designer glyph by explicit
 * import: no name registry, so a bundle carries only these sixteen glyphs.
 */
const CONTENT_ICONS: Readonly<Record<ContentIconName, IconNode>> = {
  briefcase: Briefcase,
  "building-2": Building2,
  calendar: Calendar,
  clock: Clock,
  "file-check": FileCheck,
  "file-text": FileText,
  folder: Folder,
  globe: Globe,
  landmark: Landmark,
  layers: Layers,
  lock: Lock,
  receipt: Receipt,
  scale: Scale,
  search: Search,
  "shield-check": ShieldCheck,
  users: Users,
};

/** The FAQ rows a content section renders: the entry's own `Faq` (React Aria on the client entry, native disclosure on the server entry). */
export type ContentSectionFaq = (props: { items: readonly { id: string; question: string; answer: string }[]; headingLevel: 2; ground: SectionedViewGround }) => ReactNode;

export interface ContentSectionBlockProps {
  /** The validated, resolved section. */
  section: ResolvedSectionedViewContentSection;
  /** The section's actions, already rendered through the emphasis ladder. */
  actions?: ReactNode;
  /** Classes for the section root (SectionedView paints the section's ground here; a band leaves it to its frame). */
  className?: string;
  /** Content placed after the text block, before any visual. */
  after?: ReactNode;
}

/**
 * The footnote line's content: its text, then its one optional link,
 * underlined in the line's own ink (the only underlined link a section body
 * carries), with the package-standard focus outline.
 */
function renderFootnote(footnote: ResolvedSectionedViewContentSection["footnote"]): ReactNode {
  if (footnote === undefined) return undefined;
  if (footnote.link === undefined) return footnote.text;
  return (
    <>
      {footnote.text}{" "}
      <a href={footnote.link.href} className="text-inherit underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
        {footnote.link.label}
      </a>
    </>
  );
}

function icon(name: ContentIconName | undefined): ReactNode {
  return name === undefined ? undefined : <Icon glyph={CONTENT_ICONS[name]} decorative size="md" />;
}

/** A panel visual (a step or a comparison side) as its own labelled single-panel figure, named by the panel title. */
function panelSpecimen(panel: ResolvedSectionedViewSpecimenPanel | undefined): ReactNode {
  if (panel === undefined) return undefined;
  const item: SpecimenPanelItem = panel;
  return <Specimen label={panel.title} panels={[item]} />;
}

/** A card's one-part visual as a labelled single-panel figure without a title row: the card heading names the record. */
function partSpecimen(part: ResolvedSectionedViewSpecimenPart | undefined, cardHeading: string): ReactNode {
  if (part === undefined) return undefined;
  const designerPart: SpecimenPart = part;
  return <Specimen label={part.label ?? cardHeading} panels={[{ id: part.id, parts: [designerPart] }]} />;
}

function mediaSpecimen(media: ResolvedSectionedViewSpecimenMedia): ReactNode {
  const panels: readonly SpecimenPanelItem[] = media.panels;
  return <Specimen label={media.label} arrangement={media.arrangement} connector={media.connector} panels={panels} />;
}

/**
 * The contract's `feature-grid` defaults, passed explicitly: Designer's
 * `FeatureGrid` takes its catalog layout only when one of these is set.
 */
const FEATURE_GRID_DEFAULTS = { columns: 3, treatment: "plain", emphasis: "item" } as const;

function renderBlock(block: ResolvedSectionedViewContentBlock, ground: SectionedViewGround, Faq: ContentSectionFaq, headingId?: string): ReactNode {
  switch (block.type) {
    case "feature-grid":
      return (
        <FeatureGrid
          items={block.items.map((item) => ({ id: item.id, icon: icon(item.icon), eyebrow: item.eyebrow, heading: item.heading, description: item.description, href: item.href }))}
          columns={block.columns ?? FEATURE_GRID_DEFAULTS.columns}
          treatment={block.treatment ?? FEATURE_GRID_DEFAULTS.treatment}
          emphasis={block.emphasis ?? FEATURE_GRID_DEFAULTS.emphasis}
          ground={ground}
        />
      );
    case "card-grid":
      return (
        <CardGrid
          items={block.items.map((card) => ({
            id: card.id,
            icon: icon(card.icon),
            eyebrow: card.eyebrow,
            heading: card.heading,
            description: card.description,
            span: card.span,
            visual: partSpecimen(card.visual, card.heading),
            href: card.href,
          }))}
          headingLevel={3}
          ground={ground}
        />
      );
    case "comparison": {
      const side = (value: typeof block.before) => ({ label: value.label, heading: value.heading, description: value.description, points: value.points, visual: panelSpecimen(value.visual) });
      return <Comparison before={side(block.before)} after={side(block.after)} headingLevel={3} ground={ground} />;
    }
    case "topic-list":
      return (
        <TopicList
          items={block.items.map((item) => ({ id: item.id, icon: icon(item.icon), heading: item.heading, description: item.description, href: item.href }))}
          columns={block.columns ?? 2}
          ground={ground}
        />
      );
    case "ordered-step-sequence":
      return (
        <OrderedStepSequence
          items={block.items.map((step) => ({ id: step.id, ordinal: step.ordinal, label: step.label, heading: step.heading, description: step.description, visual: panelSpecimen(step.visual), href: step.href, lane: step.lane }))}
          headingLevel={2}
          ground={ground}
          lanes={block.lanes}
          caption={block.caption}
          end={block.end}
          endLabel={block.endLabel}
          continuesLabel={block.continuesLabel}
          labelledBy={block.lanes === undefined ? undefined : headingId}
        />
      );
    case "faq":
      return <Faq items={block.items} headingLevel={2} ground={ground} />;
  }
}

/**
 * The `content-section` block for one entry's FAQ implementation. One
 * Designer `ContentSection` at `<h2>`: the header group (with the section's
 * button actions), then the text block and anything placed after it,
 * then the specimen, then the optional footnote line. A `split` puts the text beside the specimen; a split FAQ
 * block is the FAQ band, its rows taking the visual column beside a
 * top-aligned header, and a text-only split (topics or features, no media)
 * places its block in the visual column the same way. A stacked section
 * with no block, no media and nothing placed after it is a statement band: its heading takes the
 * `display` emphasis. Block item headings are one level below the section.
 *
 * Actions: a split keeps them in its text column; a stacked band takes them
 * only when it is header-only, so a stacked band with a block or media never
 * renders them. A linked block item (`href`) renders as Designer's stretched
 * link: the item's title is its one link.
 */
export function createContentSectionBlock(Faq: ContentSectionFaq) {
  return function ContentSectionBlock({ section, actions, className, after }: ContentSectionBlockProps) {
    const { ground } = section;
    const headingId = section.block?.type === "ordered-step-sequence" && section.block.lanes !== undefined ? `${section.id}:heading` : undefined;
    const block = section.block === undefined ? null : renderBlock(section.block, ground, Faq, headingId);
    const header = { id: section.id, headingId, eyebrow: section.eyebrow, heading: section.heading, description: section.description, actions, footnote: renderFootnote(section.footnote), headingLevel: 2 as const, ground };
    if (section.layout === "split" && section.block?.type === "faq") {
      return (
        <ContentSection {...header} layout="split" mediaSide={section.mediaSide} media={block} data-content-section-faq="" className={[className, "tablet-lg:items-start"].filter(Boolean).join(" ")}>
          {after}
        </ContentSection>
      );
    }
    if (section.layout === "split" && section.media === undefined) {
      // A text-only split: the topic-list or feature-grid block takes the visual column, top-aligned beside the header.
      return (
        <ContentSection {...header} layout="split" mediaSide={section.mediaSide} media={block} data-content-section-text-split="" className={[className, "tablet-lg:items-start"].filter(Boolean).join(" ")}>
          {after}
        </ContentSection>
      );
    }
    if (section.layout === "split" && section.media !== undefined) {
      return (
        <ContentSection {...header} layout="split" mediaSide={section.mediaSide} media={mediaSpecimen(section.media)} className={className}>
          {block}
          {after}
        </ContentSection>
      );
    }
    // A statement band (no block, no media, nothing placed after it: a header and its actions) carries the page's display scale instead of repeating a thin section shape.
    const statement = section.block === undefined && section.media === undefined && (after === undefined || after === null);
    // A stacked band followed by a block or a visual takes no actions (the contract refuses them; this keeps the render honest too).
    const headerOnly = section.block === undefined && section.media === undefined;
    return (
      <ContentSection
        {...header}
        actions={headerOnly ? actions : undefined}
        align={section.align}
        emphasis={statement ? "display" : "section"}
        media={section.media === undefined ? undefined : mediaSpecimen(section.media)}
        data-content-section-statement={statement ? "" : undefined}
        className={className}
      >
        {block}
        {after}
      </ContentSection>
    );
  };
}
