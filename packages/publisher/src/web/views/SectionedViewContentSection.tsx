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
  ResolvedSectionedViewContentModule,
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
  /** The section's actions, already rendered as full-size buttons. */
  actions?: ReactNode;
  /** Classes for the section root (SectionedView paints the section's ground here; a band leaves it to its frame). */
  className?: string;
  /** Content placed after the text module, before any visual. */
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
 * The contract's `features` defaults, passed explicitly: Designer's
 * `FeatureGrid` takes its catalog layout only when one of these is set.
 */
const FEATURES_DEFAULTS = { columns: 3, treatment: "plain", emphasis: "item" } as const;

function renderModule(module: ResolvedSectionedViewContentModule, ground: SectionedViewGround, Faq: ContentSectionFaq): ReactNode {
  switch (module.type) {
    case "features":
      return (
        <FeatureGrid
          items={module.items.map((item) => ({ id: item.id, icon: icon(item.icon), eyebrow: item.eyebrow, heading: item.heading, description: item.description }))}
          columns={module.columns ?? FEATURES_DEFAULTS.columns}
          treatment={module.treatment ?? FEATURES_DEFAULTS.treatment}
          emphasis={module.emphasis ?? FEATURES_DEFAULTS.emphasis}
          ground={ground}
        />
      );
    case "cards":
      return (
        <CardGrid
          items={module.items.map((card) => ({
            id: card.id,
            icon: icon(card.icon),
            eyebrow: card.eyebrow,
            heading: card.heading,
            description: card.description,
            span: card.span,
            visual: partSpecimen(card.visual, card.heading),
          }))}
          headingLevel={3}
          ground={ground}
        />
      );
    case "comparison": {
      const side = (value: typeof module.before) => ({ label: value.label, heading: value.heading, description: value.description, points: value.points, visual: panelSpecimen(value.visual) });
      return <Comparison before={side(module.before)} after={side(module.after)} headingLevel={3} ground={ground} />;
    }
    case "topics":
      return (
        <TopicList
          items={module.items.map((item) => ({ id: item.id, icon: icon(item.icon), heading: item.heading, description: item.description }))}
          columns={module.columns ?? 2}
          ground={ground}
        />
      );
    case "steps":
      return (
        <OrderedStepSequence
          items={module.items.map((step) => ({ id: step.id, ordinal: step.ordinal, label: step.label, heading: step.heading, description: step.description, visual: panelSpecimen(step.visual) }))}
          headingLevel={2}
          ground={ground}
        />
      );
    case "faq":
      return <Faq items={module.items} headingLevel={2} ground={ground} />;
  }
}

/**
 * The `content-section` block for one entry's FAQ implementation. One
 * Designer `ContentSection` at `<h2>`: the header group (with the section's
 * button actions), then the text module and anything placed after it,
 * then the specimen, then the optional footnote line. A `split` puts the text beside the specimen; a split FAQ
 * module is the FAQ band, its rows taking the visual column beside a
 * top-aligned header, and a text-only split (topics or features, no media)
 * places its module in the visual column the same way. A stacked section
 * with no module, no media and nothing placed after it is a statement band: its heading takes the
 * `display` emphasis. Module item headings are one level below the section.
 */
export function createContentSectionBlock(Faq: ContentSectionFaq) {
  return function ContentSectionBlock({ section, actions, className, after }: ContentSectionBlockProps) {
    const { ground } = section;
    const module = section.module === undefined ? null : renderModule(section.module, ground, Faq);
    const header = { id: section.id, eyebrow: section.eyebrow, heading: section.heading, description: section.description, actions, footnote: renderFootnote(section.footnote), headingLevel: 2 as const, ground };
    if (section.layout === "split" && section.module?.type === "faq") {
      return (
        <ContentSection {...header} layout="split" mediaSide={section.mediaSide} media={module} data-content-section-faq="" className={[className, "tablet-lg:items-start"].filter(Boolean).join(" ")}>
          {after}
        </ContentSection>
      );
    }
    if (section.layout === "split" && section.media === undefined) {
      // A text-only split: the topics or features module takes the visual column, top-aligned beside the header.
      return (
        <ContentSection {...header} layout="split" mediaSide={section.mediaSide} media={module} data-content-section-text-split="" className={[className, "tablet-lg:items-start"].filter(Boolean).join(" ")}>
          {after}
        </ContentSection>
      );
    }
    if (section.layout === "split" && section.media !== undefined) {
      return (
        <ContentSection {...header} layout="split" mediaSide={section.mediaSide} media={mediaSpecimen(section.media)} className={className}>
          {module}
          {after}
        </ContentSection>
      );
    }
    // A statement band (no module, no media, nothing placed after it: a header and its actions) carries the page's display scale instead of repeating a thin section shape.
    const statement = section.module === undefined && section.media === undefined && (after === undefined || after === null);
    return (
      <ContentSection
        {...header}
        align={section.align}
        emphasis={statement ? "display" : "section"}
        media={section.media === undefined ? undefined : mediaSpecimen(section.media)}
        data-content-section-statement={statement ? "" : undefined}
        className={className}
      >
        {module}
        {after}
      </ContentSection>
    );
  };
}
