import type { HTMLAttributes, ReactNode } from "react";
import { SemanticContent } from "../../components/SemanticContent.js";
import { cx } from "../../components/internal/cx.js";

/** CardHeader/CardTitle/CardDescription/CardAction anatomy, adapted to a section heading. */
export interface SectionHeaderProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  eyebrow?: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  stats?: ReactNode;
  level?: 1 | 2 | 3 | 4 | 5 | 6;
  density?: "compact" | "standard" | "display";
  align?: "start" | "center";
  ground?: "base" | "sunken" | "inverse";
  titleClassName?: string;
}

export function SectionHeader(props: SectionHeaderProps) {
  const { eyebrow, title, description, actions, stats, level = 2, density = "compact", align = "start", ground = "base", titleClassName, className, ...rest } = props;
  const heading = `h${level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
  const centered = align === "center";
  const inverse = ground === "inverse";
  const titleSize = density === "display" ? "text-display-m tablet:text-display-l" : density === "standard" ? "text-h2" : "text-h3";
  return (
    <SemanticContent as="div" {...rest} data-ds-layer="sections" data-ds-leaf="sections.section-header" data-ds-fill="shadcn@aria/sections.section-header" data-slot="card-header" className={cx("flex flex-col gap-md", centered ? "items-center text-center" : "tablet:flex-row tablet:items-start tablet:justify-between", className)}>
      <SemanticContent as="div" className={["flex min-w-0 flex-col gap-sm", centered ? "items-center" : "items-start"].join(" ")}>
        {eyebrow ? <SemanticContent as="p" data-slot="card-eyebrow" className={["text-caption uppercase tracking-label", inverse ? "text-ink-on-inverse-muted" : "text-ink-muted"].join(" ")}>{eyebrow}</SemanticContent> : null}
        {Object.hasOwn(props, "title") ? <SemanticContent as={heading} data-slot="card-title" className={cx(titleSize, "font-display leading-heading text-balance", inverse ? "text-ink-on-inverse" : "text-ink-primary", titleClassName)}>{title}</SemanticContent> : null}
        {description ? <SemanticContent as="p" data-slot="card-description" className={[density === "display" ? "text-body-l" : "text-body", "text-pretty", inverse ? "text-ink-on-inverse-muted" : "text-ink-secondary"].join(" ")}>{description}</SemanticContent> : null}
        {stats ? <SemanticContent as="div" data-slot="card-stats" className="flex flex-wrap items-center gap-sm">{stats}</SemanticContent> : null}
      </SemanticContent>
      {actions ? <SemanticContent as="div" data-slot="card-action" className={["flex shrink-0 flex-wrap items-center gap-sm", centered ? "justify-center" : "justify-start"].join(" ")}>{actions}</SemanticContent> : null}
    </SemanticContent>
  );
}
