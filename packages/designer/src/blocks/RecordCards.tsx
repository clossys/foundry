import type { ComponentType, HTMLAttributes, ReactNode } from "react";
import type { BadgeVariant } from "../components/Badge.js";
import type { Link as LinkType } from "../components/Link.js";
import type { SemanticContent as SemanticContentType } from "../components/SemanticContent.js";
import { componentLeaf } from "../runtime/component-leaf.js";
import { cx } from "../components/internal/cx.js";
import { dsAttrs } from "../catalog-core/provenance-attrs.js";
import { isImageResource, type ImageResource } from "../catalog-assets/media.js";
import { PageHeaderMetadata, type EditorialMetadata } from "./PageHeaderMetadata.js";

const SemanticContent = componentLeaf<typeof SemanticContentType>("components.semantic-content");
const Card = componentLeaf<ComponentType<HTMLAttributes<HTMLDivElement>>>("components.card");
const CardHeader = componentLeaf<ComponentType<HTMLAttributes<HTMLDivElement>>>("components.card", "CardHeader");
const CardTitle = componentLeaf<ComponentType<HTMLAttributes<HTMLDivElement>>>("components.card", "CardTitle");
const CardContent = componentLeaf<ComponentType<HTMLAttributes<HTMLDivElement>>>("components.card", "CardContent");
const Badge = componentLeaf<ComponentType<{ children?: ReactNode; tone?: BadgeVariant; variant?: BadgeVariant }>>("components.badge");
const Link = componentLeaf<typeof LinkType>("components.link");
const SECTION_STAMP = dsAttrs("sections", "sections.cards", "foundry/sections.cards");

export type RecordCardsLayout = "grid" | "list";
export type RecordCardsHeadingLevel = 2 | 3 | 4;
export interface RecordCardsRecord {
  id: string;
  title: ReactNode;
  description?: ReactNode;
  href?: string;
  badge?: { label: ReactNode; variant?: BadgeVariant };
  meta?: ReactNode;
  /** Resolved consumer asset; no image URL or copy is invented by this section. */
  image?: ImageResource;
  editorial?: EditorialMetadata;
}
export interface RecordCardsProps extends Omit<HTMLAttributes<HTMLUListElement>, "children"> {
  records: readonly RecordCardsRecord[];
  config?: "post" | "post-featured" | "case-study";
  locale?: string;
  layout?: RecordCardsLayout;
  headingLevel?: RecordCardsHeadingLevel;
}
const LAYOUT_CLASSES: Record<RecordCardsLayout, string> = {
  grid: "grid grid-cols-1 gap-md tablet:grid-cols-2 desktop:grid-cols-3",
  list: "flex flex-col gap-sm",
};

/** Registered Cards section: editorial presentation consumes the selected component leaves. */
export function RecordCards({ records, config, locale, layout = "grid", headingLevel = 3, className, ...rest }: RecordCardsProps) {
  const heading = headingLevel === 2 ? "h2" : headingLevel === 4 ? "h4" : "h3";
  for (const record of records) if (record.image !== undefined && !isImageResource(record.image)) throw new TypeError("RecordCards requires a valid image resource");
  return <SemanticContent as="ul" {...SECTION_STAMP} {...rest} role="list" data-card-config={config} data-layout={layout}
    className={cx(config === "post-featured" ? LAYOUT_CLASSES.list : LAYOUT_CLASSES[layout], className)}>
    {records.map(record => <SemanticContent as="li" key={record.id} className="flex min-w-0">
      <Card className="flex w-full flex-col gap-sm">
        {record.image ? <SemanticContent as="picture" data-asset-slot="assets.image" className="block w-full overflow-hidden">
          {record.image.sources?.map((source, index) => <SemanticContent as="source" key={index} srcSet={`${source.src} ${source.width}w`} media={source.media} width={source.width} height={source.height} sizes={record.image?.sizes} />)}
          <SemanticContent as="img" src={record.image.src} alt={record.image.decorative ? "" : record.image.alt} width={record.image.width} height={record.image.height}
            sizes={record.image.sizes} className="block h-auto w-full" />
        </SemanticContent> : null}
        <CardHeader className="flex flex-col gap-sm">
          <CardTitle><SemanticContent as={heading} className="m-0 text-body-l font-medium text-ink-primary">
            {record.href ? <Link href={record.href} variant="standalone">{record.title}</Link> : record.title}
          </SemanticContent></CardTitle>
          {record.badge ? record.badge.variant && record.badge.variant !== "neutral" && record.badge.variant !== "danger"
            ? <Badge variant={record.badge.variant}>{record.badge.label}</Badge>
            : <Badge tone={record.badge.variant ?? "neutral"}>{record.badge.label}</Badge> : null}
        </CardHeader>
        <CardContent className="flex flex-col gap-sm">
          {record.description ? <SemanticContent as="p" dir="auto" className="m-0 text-body-s text-ink-secondary">{record.description}</SemanticContent> : null}
          {record.editorial ? <PageHeaderMetadata metadata={record.editorial} locale={locale} /> : null}
          {record.meta ? <SemanticContent as="p" dir="auto" className="m-0 text-caption text-ink-muted">{record.meta}</SemanticContent> : null}
        </CardContent>
      </Card>
    </SemanticContent>)}
  </SemanticContent>;
}
