import type { ReactNode } from "react";
import type { CardProps } from "../components/Card.js";
import { cx } from "../components/internal/cx.js";

import { componentLeaf } from "../runtime/component-leaf.js";

const SemanticContent = componentLeaf<typeof import("../components/SemanticContent.js").SemanticContent>("components.semantic-content");
const Card = componentLeaf<typeof import("../components/Card.js").Card>("components.card");

export interface PanelProps extends Omit<CardProps, "header" | "children" | "variant"> {
  /** Optional leading controls or heading, inside the panel surface. */
  header?: ReactNode;
  /** The panel's primary content. */
  children: ReactNode;
  /** Optional trailing controls or supporting content. */
  footer?: ReactNode;
}

/** A Material Block: one outlined Card with explicit header, content and footer regions. */
export function Panel({ header, children, footer, className, ...rest }: PanelProps) {
  return (
    <Card
      {...rest} variant="outline" data-panel=""
      className={cx("flex min-h-0 min-w-0 flex-col gap-md", className)}
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
