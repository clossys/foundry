import type { CSSProperties, ReactNode } from "react";

import { CardLinkTitle, type CardLinkFrame } from "../stretched-link.js";
import type { SectionGround } from "../section-ground.js";
import { componentLeaf } from "../../runtime/component-leaf.js";

const Card = componentLeaf<typeof import("../../components/preview-runtime/components/card/card.js").Card>("components.card");
const CardContent = componentLeaf<typeof import("../../components/preview-runtime/components/card/card.js").CardContent>("components.card", "CardContent");
const SemanticContent = componentLeaf<typeof import("../../components/SemanticContent.js").SemanticContent>("components.semantic-content");

/** Shared title and single-anchor anatomy. Each private policy owns its exact historical tags/classes. */
export function ItemHeading({ as: Tag, heading, href, variant, ground, className, anchorClassName, iconSize, ...attributes }: {
  as: "p" | "span" | "h3" | "h4"; heading: ReactNode; href?: string; variant: CardLinkFrame; ground: SectionGround;
  className: string; anchorClassName?: string; iconSize?: "sm" | "md"; "data-item-heading"?: string;
}) {
  const content = href === undefined ? heading : <CardLinkTitle href={href} frame={variant} ground={ground} className={anchorClassName} iconSize={iconSize}>{heading}</CardLinkTitle>;
  if (Tag === "h3") return <SemanticContent as="h3" {...attributes} className={className}>{content}</SemanticContent>;
  if (Tag === "h4") return <SemanticContent as="h4" {...attributes} className={className}>{content}</SemanticContent>;
  if (Tag === "span") return <SemanticContent as="span" {...attributes} className={className}>{content}</SemanticContent>;
  return <SemanticContent as="p" {...attributes} className={className}>{content}</SemanticContent>;
}
/** Caller chooses presence semantics; canonical zero and legacy truthiness remain separate. */
export function ItemIcon({ children, className }: { children: ReactNode; className: string }) {
  return <SemanticContent as="span" aria-hidden="true" className={className}>{children}</SemanticContent>;
}
export function ItemDescription({ as: Tag = "p", children, className, ...attributes }: { as?: "p" | "span"; children: ReactNode; className: string; "data-item-description"?: string; "data-link-grid-description"?: string }) {
  return Tag === "span"
    ? <SemanticContent as="span" {...attributes} className={className}>{children}</SemanticContent>
    : <SemanticContent as="p" {...attributes} className={className}>{children}</SemanticContent>;
}
/** The selected native Card owns its content surface; collection shells remain private. */
export function ItemPlate({ ground: _ground, children, className, style, ...attributes }: { ground: SectionGround; children: ReactNode; className: string; style?: CSSProperties; [key: `data-${string}`]: string | boolean | undefined }) {
  return <Card className={className} style={style} {...attributes}><CardContent>{children}</CardContent></Card>;
}
