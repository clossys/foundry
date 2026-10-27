import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { mergeUiClasses } from "@clossys/designer/components/server";
import { SectionFrame } from "@clossys/designer/blocks/server";
import { CARDLESS_PAGE_COLUMN_CLASSES, PAGE_COLUMN_CLASSES, pageColumnStyle } from "../../internal/PageLayout.js";

export interface ViewSectionProps extends Omit<HTMLAttributes<HTMLElement>, "children"> {
  /** The column measure the view's content keeps inside the band. */
  measure: "form" | "prose";
  /** Centre the column in the frame's content slot (status pages). */
  centered?: boolean;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/**
 * A chrome-free view's one placement in `SiteFrame`'s content slot: a `sections.band`
 * (`SectionFrame`) that hosts the view's column, so nothing the view draws sits in the
 * frame's `<main>` outside a Section (E5, WL1). The caller's root attributes go on the
 * Section root; `className` and `style` keep their old target, the content column.
 */
export function ViewSection({ measure, centered = false, children, className, style, ...rest }: ViewSectionProps) {
  return (
    <SectionFrame {...rest} measure="prose" className={centered ? "flex flex-1 flex-col justify-center py-0" : "flex flex-1 flex-col py-0"}>
      {/* The band owns the page gutter and the column keeps the vertical rhythm, so each drops the other's padding. */}
      <div className={mergeUiClasses(centered ? CARDLESS_PAGE_COLUMN_CLASSES : PAGE_COLUMN_CLASSES, "px-0", className)} style={pageColumnStyle(measure, style)}>
        {children}
      </div>
    </SectionFrame>
  );
}
