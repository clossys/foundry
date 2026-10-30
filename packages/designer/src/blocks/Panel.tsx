import type { ReactNode } from "react";
import type { CardProps } from "../components/Card.types.js";
import { cx } from "../components/internal/cx.js";

import { componentLeaf } from "../runtime/component-leaf.js";

const Card = componentLeaf<typeof import("../components/preview-runtime/components/card/card.js").Card>("components.card");

const CardHeader = componentLeaf<typeof import("../components/preview-runtime/components/card/card.js").CardHeader>("components.card", "CardHeader");
const CardContent = componentLeaf<typeof import("../components/preview-runtime/components/card/card.js").CardContent>("components.card", "CardContent");
const CardFooter = componentLeaf<typeof import("../components/preview-runtime/components/card/card.js").CardFooter>("components.card", "CardFooter");

export interface PanelProps extends Omit<CardProps, "header" | "children"> {
  /** Optional leading controls or heading, inside the panel surface. */
  header?: ReactNode;
  /** The panel's primary content. */
  children: ReactNode;
  /** Optional trailing controls or supporting content. */
  footer?: ReactNode;
}

/** A Material Block: one native Card with explicit header, content and footer regions. */
export function Panel({ header, children, footer, className, ...rest }: PanelProps) {
  return (
    <Card
      {...rest} data-panel=""
      className={cx("flex min-h-0 min-w-0 flex-col gap-md", className)}
    >
      {header !== undefined && header !== null && header !== false && (
        <CardHeader data-panel-region="header" className="shrink-0">{header}</CardHeader>
      )}
      <CardContent data-panel-region="content" className="min-h-0 min-w-0 flex-1 overflow-auto">{children}</CardContent>
      {footer !== undefined && footer !== null && footer !== false && (
        <CardFooter data-panel-region="footer" className="shrink-0">{footer}</CardFooter>
      )}
    </Card>
  );
}
