import { Icon, type IconNode } from "@clossys/designer/atoms/server";
import { AnatomyCallouts, ContentSection, Items, RecordLedger, Scene, Specimen } from "@clossys/designer/blocks/server";
import type { ItemData, SpecimenPanelItem, SpecimenPart } from "@clossys/designer/blocks/server";
import { Briefcase, Building2, Calendar, Clock, FileCheck, FileText, Folder, Globe, Landmark, Layers, Lock, Receipt, Scale, Search, ShieldCheck, Users } from "@clossys/designer/icons";
import type { ReactNode } from "react";
import type { ContentIconName, ResolvedSectionedViewContentBlock, ResolvedSectionedViewContentSection, ResolvedSectionedViewSpecimenPanel, ResolvedSectionedViewSpecimenPart, ResolvedSectionedViewMedia, ResolvedSectionedViewSection, SectionedViewGround } from "../../core/sectioned-view.js";
import { RenderError } from "../../internal/errors.js";

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

/** Entry-specific published FAQ rows; ordinary and react-server keep their own implementation. */
export type ContentSectionFaq = (props: { items: readonly { id: string; question: string; answer: string }[]; headingLevel: 2; ground: SectionedViewGround }) => ReactNode;
export interface ContentSectionBlockProps {
  section: ResolvedSectionedViewContentSection;
  actions?: ReactNode;
  className?: string;
  after?: ReactNode;
  /** Private compatibility bridge for the published top-level FAQ kind. */
  publishedFaq?: Extract<ResolvedSectionedViewSection, { kind: "faq" }>;
}
function dependency(capability: "ordered or disclosed items" | "matrix" | "specimen metadata and meter markers", path: string): never {
  throw new RenderError("resolution-failed", `${path}: renderer capability unavailable for ${capability}.`);
}
function renderFootnote(footnote: ResolvedSectionedViewContentSection["footnote"]): ReactNode {
  if (footnote === undefined) return undefined;
  if (footnote.link === undefined) return footnote.text;
  return <>{footnote.text}{footnote.text === undefined ? null : " "}<a href={footnote.link.href} className="text-inherit underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">{footnote.link.label}</a></>;
}
function icon(name: ContentIconName | undefined): ReactNode { return name === undefined ? undefined : <Icon glyph={CONTENT_ICONS[name]} decorative size="md" />; }
function partData(part: ResolvedSectionedViewSpecimenPart): SpecimenPart {
  if (part.type === "meter") {
    if (part.previous !== undefined || part.previousText !== undefined) dependency("specimen metadata and meter markers", `part.${part.id}.previous`);
    const { previous: _previous, previousText: _previousText, ...available } = part;
    return available;
  }
  if (part.type === "status-rows") {
    if (part.mobileRows !== undefined) dependency("specimen metadata and meter markers", `part.${part.id}.mobileRows`);
    const { mobileRows: _mobileRows, ...available } = part;
    return available;
  }
  return part;
}
function panelData(panel: ResolvedSectionedViewSpecimenPanel): SpecimenPanelItem {
  if (panel.badge !== undefined) dependency("specimen metadata and meter markers", `panel.${panel.id}.badge`);
  const { badge: _badge, parts, ...available } = panel;
  return { ...available, parts: parts.map(partData) };
}
function partSpecimen(part: ResolvedSectionedViewSpecimenPart | undefined, id: string, heading: string): ReactNode {
  if (part === undefined) return undefined;
  return <Specimen label={part.label ?? heading} panels={[{ id, parts: [partData(part)] }]} />;
}
function renderMedia(media: ResolvedSectionedViewMedia, section: ResolvedSectionedViewContentSection): ReactNode {
  switch (media.type) {
    case "specimen": {
      const panel = panelData(media.panel);
      return media.key === undefined ? <Specimen label={media.label} panels={[panel]} /> : <AnatomyCallouts id={`${section.id}-specimen`} label={media.label} panel={panel} markers={media.key.items} keyLabel={media.key.label} legendSide={media.key.side} headingLevel={3} ground={section.ground} />;
    }
    case "record": return <RecordLedger form="record" id={media.id} head={media.head} columns={media.columns} groups={media.groups} caption={media.caption} flagLabel={media.flagLabel} headingLevel={3} ground={section.ground} />;
    case "scene": return <Scene id={`${section.id}-scene`} input={media.input} label={media.label} relationLabel={media.relationLabel} />;
    default: { const exhaustive: never = media; return exhaustive; }
  }
}
function renderBlock(block: ResolvedSectionedViewContentBlock, section: ResolvedSectionedViewContentSection): ReactNode {
  switch (block.type) {
    case "matrix": return dependency("matrix", `section.${section.id}.block`);
    case "items": {
      if (block.order !== "none" || block.reveal !== "all") dependency("ordered or disclosed items", `section.${section.id}.block`);
      const items: ItemData[] = block.items.map(item => ({ id: item.id, heading: item.heading, description: item.description, eyebrow: item.eyebrow, icon: icon(item.icon), meta: item.meta, badge: item.badge, href: item.href, featured: item.featured, span: item.span, visual: partSpecimen(item.visual, item.id, item.heading) }));
      return <Items items={items} arrangement={block.arrangement} columns={block.columns} treatment={block.treatment} emphasis={block.emphasis} size={section.size === "display" ? "display" : "standard"} groups={block.groups} headingLevel={3} ground={section.ground} />;
    }
    default: { const exhaustive: never = block; return exhaustive; }
  }
}
/** Canonical frame and available unordered Items/media adapters. Pending capabilities refuse explicitly. */
export function createContentSectionBlock(Faq: ContentSectionFaq) {
  return function ContentSectionBlock({ section, actions, className, after, publishedFaq }: ContentSectionBlockProps) {
    if (publishedFaq !== undefined) {
      if (publishedFaq.kind !== "faq" || publishedFaq.layout !== "split" || publishedFaq.id !== section.id) throw new RenderError("resolution-failed", "Invalid published FAQ compatibility bridge.");
      return <ContentSection id={publishedFaq.id} eyebrow={publishedFaq.eyebrow} heading={publishedFaq.heading} description={publishedFaq.description} headingLevel={2} ground={publishedFaq.ground} layout="split" media={<Faq items={publishedFaq.items} headingLevel={2} ground={publishedFaq.ground} />} data-content-section-faq="" className={[className, "tablet-lg:items-start"].filter(Boolean).join(" ")}>{after}</ContentSection>;
    }
    const block = section.block === undefined ? null : renderBlock(section.block, section);
    const media = section.media === undefined ? undefined : renderMedia(section.media, section);
    const header = { id: section.id, eyebrow: section.eyebrow, heading: section.heading, description: section.description, actions, footnote: renderFootnote(section.footnote), headingLevel: 2 as const, size: section.size, ground: section.ground, className };
    if (section.layout !== "stacked") return <ContentSection {...header} layout={section.layout} media={media}>{block}{after}</ContentSection>;
    return <ContentSection {...header} layout="stacked" align={section.align} media={media}>{block}{after}</ContentSection>;
  };
}
