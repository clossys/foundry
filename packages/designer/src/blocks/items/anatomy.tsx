import type { CSSProperties, ElementType, ReactNode } from "react";
import { Card } from "../../selected-components/Card.js";
import { CardLinkTitle, type CardLinkFrame } from "../stretched-link.js";
import type { SectionGround } from "../section-ground.js";

/** Shared title and single-anchor anatomy. Each private policy owns its exact historical tags/classes. */
export function ItemHeading({ as: Tag, heading, href, variant, ground, className, anchorClassName, iconSize, ...attributes }: {
  as: ElementType; heading: ReactNode; href?: string; variant: CardLinkFrame; ground: SectionGround;
  className: string; anchorClassName?: string; iconSize?: "sm" | "md"; "data-item-heading"?: string;
}) {
  return <Tag {...attributes} className={className}>{href === undefined ? heading : <CardLinkTitle href={href} frame={variant} ground={ground} className={anchorClassName} iconSize={iconSize}>{heading}</CardLinkTitle>}</Tag>;
}
/** Caller chooses presence semantics; canonical zero and legacy truthiness remain separate. */
export function ItemIcon({ children, className }: { children: ReactNode; className: string }) {
  return <span aria-hidden="true" className={className}>{children}</span>;
}
export function ItemDescription({ as: Tag = "p", children, className, ...attributes }: { as?: ElementType; children: ReactNode; className: string; "data-item-description"?: string; "data-link-grid-description"?: string }) {
  return <Tag {...attributes} className={className}>{children}</Tag>;
}
/** A plate's surface policy and slot ownership are shared; collection shells remain private. */
export function ItemPlate({ ground, children, className, style, ...attributes }: { ground: SectionGround; children: ReactNode; className: string; style?: CSSProperties; [key: `data-${string}`]: string | boolean | undefined }) {
  return <Card variant="plate" ground={ground} className={className} style={style} {...attributes}>{children}</Card>;
}
