import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { MatrixRenderer } from "./Matrix.js";
import type { SectionGround } from "./section-ground.js";

/** Which heading element each side's label renders as. */
export type ComparisonHeadingLevel = 2 | 3 | 4 | 5 | 6;

export interface ComparisonSide {
  /** Short name for the side ("Today", "With the new process"). Rendered as the side's heading. */
  label: ReactNode;
  /** Optional line under the label. */
  heading?: ReactNode;
  /** One paragraph. Use this or `points`, the same on both sides. */
  description?: ReactNode;
  /** 2 to 4 parallel lines, the same count on both sides. */
  points?: readonly ReactNode[];
  /** Optional visual under the text (typically a one-panel `Specimen`), on both sides or neither. */
  visual?: ReactNode;
}

export interface ComparisonProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  /** The first side, rendered on the same plate as the second. */
  before: ComparisonSide;
  /** The second side, carrying the featured accent rule. */
  after: ComparisonSide;
  /** Which heading element each side's label uses: one below the section heading. @default 3 */
  headingLevel?: ComparisonHeadingLevel;
  /** The ground the comparison sits on. @default "base" */
  ground?: SectionGround;
  className?: string;
  style?: CSSProperties;
}

/** Before and after on equal plates; retains the optional headings and decorative arrow. */
export function Comparison({ before, after, ...rest }: ComparisonProps) {
  return <MatrixRenderer {...rest} comparison featured="after" sides={[{ ...before, id: "before" }, { ...after, id: "after" }]} />;
}
