import { Icon, type IconNode } from "@clossys/designer/atoms/server";
import { AnatomyCallouts, ContentSection, Items, Matrix, MediaFigure, RecordLedger, Scene, Specimen, SECTION_GROUND_CLASSES } from "@clossys/designer/blocks/server";
import type { ItemData, ItemsProps, MatrixSide, SpecimenPanelItem, SpecimenPart } from "@clossys/designer/blocks/server";
import { Briefcase, Building2, Calendar, Clock, FileCheck, FileText, Folder, Globe, Landmark, Layers, Lock, Receipt, Scale, Search, ShieldCheck, Users } from "@clossys/designer/icons";
import type { CSSProperties, ReactNode } from "react";
import type { ContentIconName, ResolvedSectionedViewContentBlock, ResolvedSectionedViewContentSection, ResolvedSectionedViewSpecimenPanel, ResolvedSectionedViewSpecimenPart, ResolvedSectionedViewMedia } from "../../core/sectioned-view.js";
import { RenderError } from "../../internal/errors.js";
import { checkContentAssetFill } from "../../core/content-asset.js";
import type { RenderAsset } from "../../internal/assets.js";
import type { AssetResolver } from "../types.js";
import { buildAssetElement } from "../buildAssetElement.js";

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

export interface ContentSectionBlockProps {
  section: ResolvedSectionedViewContentSection;
  actions?: ReactNode;
  className?: string;
  style?: CSSProperties;
  after?: ReactNode;
  resolveAssetId?: AssetResolver;
  prefersReducedMotion?: boolean;
  /** Internal origin marker for published FAQ band spacing and fragment offsets. */
  publishedKind?: "faq";
}
function matrixSideId(sectionId: string, sideId: string): string {
  const encode = (value: string) => { let result = ""; for (let index = 0; index < value.length; index++) result += value.charCodeAt(index).toString(16).padStart(4, "0"); return result; };
  return `side-${encode(sectionId)}-${encode(sideId)}`;
}
function renderFootnote(footnote: ResolvedSectionedViewContentSection["footnote"]): ReactNode {
  if (footnote === undefined) return undefined;
  if (footnote.link === undefined) return footnote.text;
  return <>{footnote.text}{footnote.text === undefined ? null : " "}<a href={footnote.link.href} className="text-inherit underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">{footnote.link.label}</a></>;
}
function icon(name: ContentIconName | undefined): ReactNode { return name === undefined ? undefined : <Icon glyph={CONTENT_ICONS[name]} decorative size="md" />; }
function partData(part: ResolvedSectionedViewSpecimenPart): SpecimenPart {
  return part;
}
function panelData(panel: ResolvedSectionedViewSpecimenPanel): SpecimenPanelItem {
  return { ...panel, parts: panel.parts.map(partData) };
}

function partSpecimen(part: ResolvedSectionedViewSpecimenPart | undefined, id: string, heading: string): ReactNode {
  if (part === undefined) return undefined;
  return <Specimen label={part.label ?? heading} panels={[{ id, parts: [partData(part)] }]} />;
}
function renderMedia(media: ResolvedSectionedViewMedia, section: ResolvedSectionedViewContentSection, options: Pick<ContentSectionBlockProps, "resolveAssetId" | "prefersReducedMotion">): ReactNode {
  switch (media.type) {
    case "asset": {
      let asset: unknown;
      try { asset = options.resolveAssetId?.(media.assetId); }
      catch { throw new RenderError("resolution-failed", `${section.id}.media.assetId could not be resolved.`); }
      const report = checkContentAssetFill(media.contract, asset, media.assetId);
      if (!report.ok) throw new RenderError("resolution-failed", `${section.id}.media: ${report.findings.map(finding => finding.message).join(" ")}`);
      return <MediaFigure ground={section.ground} caption={media.caption}>{buildAssetElement(asset as RenderAsset, { prefersReducedMotion: options.prefersReducedMotion, altOverride: media.purpose === "decorative" ? "" : media.alt, contentPresentation: { loading: media.contract.loading, decorative: media.purpose === "decorative" } })}</MediaFigure>;
    }
    case "specimen": {
      const panel = panelData(media.panel);
      return media.key === undefined ? <Specimen label={media.label} panels={[panel]} /> : <AnatomyCallouts id={`${section.id.length}:${section.id}:8:specimen`} label={media.label} panel={panel} markers={media.key.items} keyLabel={media.key.label} legendSide={section.layout === "stacked" ? "end" : "below"} headingLevel={3} ground={section.ground} />;
    }
    case "record": return <RecordLedger form="record" id={`${section.id.length}:${section.id}:${media.id.length}:${media.id}`} head={media.head} columns={media.columns} groups={media.groups} caption={media.caption} flagLabel={media.flagLabel} headingLevel={3} ground={section.ground} />;
    case "scene": {
      const scene = <Scene id={`${section.id.length}:${section.id}:5:scene`} input={media.input} label={media.label} relationLabel={media.relationLabel} />;
      return section.ground === "inverse" ? <div data-scene-plate="" data-ground="base" className="min-w-0 w-full bg-surface-base text-ink-primary">{scene}</div> : scene;
    }
    default: { const exhaustive: never = media; return exhaustive; }
  }
}
function renderBlock(block: ResolvedSectionedViewContentBlock, section: ResolvedSectionedViewContentSection, ItemsBlock: (props: ItemsProps) => ReactNode): ReactNode {
  switch (block.type) {
    case "prose": return <><style>{"[data-content-section][data-prose] > [data-content-section-modules], [data-content-section][data-prose] > [data-content-section-text] > [data-content-section-modules] { gap: var(--spacing-lg, 16px); }"}</style>{block.paragraphs.map((paragraph, paragraphIndex) => <p key={paragraphIndex} data-prose-paragraph="" className={`text-body text-pretty ${SECTION_GROUND_CLASSES[section.ground].primary}`} style={{ maxWidth: "var(--ui-width-prose-max, 48rem)" }}>
      {paragraph.map((span, spanIndex) => span.type === "text" ? span.text : <a key={spanIndex} href={span.href} className="text-inherit underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">{span.text}</a>)}
    </p>)}</>;
    case "matrix": {
      const ids = new Map(block.sides.map(side => [side.id, matrixSideId(section.id, side.id)]));
      const sideData = (side: typeof block.sides[number]): MatrixSide => side.visual === undefined
        ? { ...side, id: ids.get(side.id)!, points: side.points }
        : { id: ids.get(side.id)!, label: side.label, heading: side.heading, description: side.description, visual: <Specimen label={side.heading} panels={[panelData(side.visual)]} /> };
      return <Matrix sides={[sideData(block.sides[0]!), sideData(block.sides[1]!)]} featured={block.featured === undefined ? undefined : ids.get(block.featured)} headingLevel={3} ground={section.ground} />;
    }
    case "items": {
      const items: ItemData[] = block.items.map(item => ({ id: item.id, heading: item.heading, description: item.description, eyebrow: item.eyebrow, icon: icon(item.icon), meta: item.meta, badge: item.badge, href: item.href, span: item.span, lane: item.lane, visual: partSpecimen(item.visual, item.id, item.heading) }));
      return <><ItemsBlock aria-labelledby={section.heading === undefined ? undefined : `${section.id}:heading`} items={items} order={block.order} reveal={block.reveal} lanes={block.lanes} end={block.end} endLabel={block.endLabel} caption={block.caption} arrangement={block.recipe === "link-index" ? "rows" : block.arrangement} columns={block.columns} treatment={block.treatment} scale={block.scale} size={section.size === "display" ? "display" : "standard"} groups={block.groups} headingLevel={3} ground={section.ground} />{block.end === "continues" && block.endLabel === undefined && block.continuesLabel !== undefined ? <span data-content-continuation="" className="sr-only">{block.continuesLabel}</span> : null}</>;
    }
    default: { const exhaustive: never = block; return exhaustive; }
  }
}
/** Canonical frame, entry-specific collections, Matrix and media adapters. */
export function createContentSectionBlock(ItemsBlock: (props: ItemsProps) => ReactNode = Items) {
  return function ContentSectionBlock({ section, actions, className, style, after, resolveAssetId, prefersReducedMotion }: ContentSectionBlockProps) {
    const block = section.block === undefined ? null : renderBlock(section.block, section, ItemsBlock);
    const media = section.media === undefined ? undefined : renderMedia(section.media, section, { resolveAssetId, prefersReducedMotion });
    const header = { id: section.id, headingId: section.heading === undefined ? undefined : `${section.id}:heading`, eyebrow: section.eyebrow, heading: section.heading, description: section.description, actions, footnote: renderFootnote(section.footnote), headingLevel: 2 as const, size: section.size, ground: section.ground, className, style, "data-prose": section.block?.type === "prose" ? "" : undefined };
    if (section.layout !== "stacked") return <ContentSection {...header} layout={section.layout} media={media}>{block}{after}</ContentSection>;
    return <ContentSection {...header} layout="stacked" align={section.block?.type === "items" && section.block.scale === "statement" ? "center" : "start"} media={media}>{block}{after}</ContentSection>;
  };
}
