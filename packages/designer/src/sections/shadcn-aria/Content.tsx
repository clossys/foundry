import type { ContentSectionProps } from "../../blocks/ContentSection.js";
import type { ReactNode } from "react";
import { SemanticContent } from "../../components/SemanticContent.js";
import { cx } from "../../components/internal/cx.js";
import { SectionHeader } from "./SectionHeader.js";

/** Card/CardContent anatomy, with section-owned heading and host-owned body slots. */
export function Content({ header, heading, headingId, eyebrow, description, actions, footnote, takeaway, source, headingLevel = 2, emphasis = "section", size, ground = "base", layout = "stacked", mediaSide, align = "start", media, children, className, style, ...rest }: ContentSectionProps & { header?: ReactNode }) {
  const split = layout !== "stacked";
  const start = layout === "split-start" || layout === "split" && mediaSide === "start";
  const padding = size === "display" ? "py-5xl tablet:py-6xl" : size === "standard" ? "py-4xl tablet:py-5xl" : size === "compact" ? "py-3xl tablet:py-4xl" : "";
  return (
    <SemanticContent as="section" {...rest} data-ds-layer="sections" data-ds-leaf="sections.content" data-ds-fill="shadcn@aria/sections.content" data-slot="card" data-layout={layout} className={cx("flex flex-col gap-xl", padding, className)} style={style}>
      <SemanticContent as="div" className={split ? "grid items-start gap-2xl tablet-lg:grid-cols-2" : "flex flex-col gap-xl"}>
        <SemanticContent as="div" className={["flex min-w-0 flex-col gap-xl", split && start ? "tablet-lg:col-start-2 tablet-lg:row-start-1" : ""].filter(Boolean).join(" ")}>
          {header ?? (heading !== undefined || eyebrow || description || actions ? <SectionHeader id={headingId} level={headingLevel} {...(heading !== undefined ? { title: heading } : {})} eyebrow={eyebrow} description={description} actions={actions} align={align} ground={ground} density={size === "display" || emphasis === "display" ? "display" : "standard"} /> : null)}
          {children !== undefined ? <SemanticContent as="div" data-slot="card-content" className="flex min-w-0 flex-col gap-lg">{children}</SemanticContent> : null}
          {footnote ? <SemanticContent as="p" data-slot="card-footer" className={ground === "inverse" ? "text-caption text-ink-on-inverse-muted" : "text-caption text-ink-secondary"}>{footnote}</SemanticContent> : null}
          {source ? <SemanticContent as="p" data-slot="card-source" className={ground === "inverse" ? "text-caption text-ink-on-inverse-muted" : "text-caption text-ink-muted"}>{source}</SemanticContent> : null}
        </SemanticContent>
        {media ? <SemanticContent as="div" data-slot="card-media" className={["min-w-0", split && start ? "tablet-lg:col-start-1 tablet-lg:row-start-1" : ""].filter(Boolean).join(" ")}>{media}</SemanticContent> : null}
      </SemanticContent>
      {takeaway ? <SemanticContent as="div" data-slot="card-takeaway" className="text-body text-ink-primary">{takeaway}</SemanticContent> : null}
    </SemanticContent>
  );
}
