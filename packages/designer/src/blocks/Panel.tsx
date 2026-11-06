import type { ReactNode } from "react";
import type { CardProps } from "../components/Card.js";
import { cx } from "../components/internal/cx.js";
import { stockCardGroundClass, type SectionGround } from "./section-ground.js";

import { componentLeaf } from "../runtime/component-leaf.js";

const SemanticContent = componentLeaf<typeof import("../components/SemanticContent.js").SemanticContent>("components.semantic-content");
const Card = componentLeaf<typeof import("../components/Card.js").Card>("components.card");

export interface PanelProps extends Omit<CardProps, "header" | "children" | "variant" | "ground"> {
  /** The ground the panel sits on. The stock Card reads it as tokens only (inverse re-points its surface and ink). @default "base" */
  ground?: SectionGround;
  /** Optional leading controls or heading, inside the panel surface. */
  header?: ReactNode;
  /** The panel's primary content. */
  children: ReactNode;
  /** Optional trailing controls or supporting content. */
  footer?: ReactNode;
}

/** A Material Block: one stock Card with explicit header, content and footer regions. */
export function Panel({ header, children, footer, className, ground = "base", style, ...rest }: PanelProps) {
  // The stock Card is the panel surface (E2, P0 shadcn reset): no Foundry variant/ground props reach it.
  return (
    <Card
      {...rest} data-panel="" style={style}
      className={cx("flex min-h-0 min-w-0 flex-col gap-md", stockCardGroundClass(ground), className)}
    >
      {header !== undefined && header !== null && header !== false && (
        <SemanticContent as="div" data-panel-region="header" className="shrink-0">{header}</SemanticContent>
      )}
      <SemanticContent as="div" data-panel-region="content" className="min-h-0 min-w-0 flex-1 overflow-auto">{children}</SemanticContent>
      {footer !== undefined && footer !== null && footer !== false && (
        <SemanticContent as="div" data-panel-region="footer" className="shrink-0">{footer}</SemanticContent>
      )}
    </Card>
  );
}
