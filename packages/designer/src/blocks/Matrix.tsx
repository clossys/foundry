import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { Card } from "../atoms/Card.js";
import { Icon } from "../atoms/Icon.js";
import type { StatusMarkTone } from "../atoms/StatusMark.js";
import { cx } from "../atoms/internal/cx.js";
import { UI_BORDER_HAIRLINE } from "../atoms/internal/ui-vars.js";
import { Check } from "../icons/Check.js";
import { hasContent } from "./items/policies.js";
import { SECTION_GROUND_CLASSES, type SectionGround } from "./section-ground.js";
import { MatrixGrid } from "./matrix/grid.js";

/** Heading element for each side's primary heading. */
export type MatrixHeadingLevel = 2 | 3 | 4 | 5 | 6;

/** One side of a two-sided matrix. */
interface MatrixSideBase {
  id: string;
  label?: ReactNode;
  heading: ReactNode;
  description?: ReactNode;
}

export type MatrixSide = MatrixSideBase & (
  /** Two to four points, with the same count on both sides. */
  | { points: readonly ReactNode[]; visual?: never }
  /** A supplied visual; cannot accompany points. */
  | { visual: ReactNode; points?: never }
);

export interface MatrixQuadrantProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  arrangement?: "sides";
  sides: readonly [MatrixSide, MatrixSide];
  /** The stable id of the side carrying the accent rule. */
  featured?: string;
  /** @default 3 */
  headingLevel?: MatrixHeadingLevel;
  /** @default "base" */
  ground?: SectionGround;
  className?: string;
  style?: CSSProperties;
}

export type MatrixCellData =
  | { type: "text"; text: ReactNode }
  | { type: "figure"; value: ReactNode; delta?: ReactNode; trend?: "up" | "down" | "neutral" }
  | { type: "status"; tone: StatusMarkTone; label: ReactNode }
  | { type: "mark"; value: 0 | 1 | 2 | 3 | 4 }
  | { type: "empty" };

export interface MatrixGridProps extends Omit<HTMLAttributes<HTMLTableElement>, "title"> {
  arrangement: "grid";
  sides?: never;
  columns: readonly { id: string; label: ReactNode }[];
  rows: readonly { id: string; label: ReactNode; description?: ReactNode; cells: Readonly<Record<string, MatrixCellData>> }[];
  featured?: { row: string; column?: never } | { column: string; row?: never };
  featuredLabel?: ReactNode;
  emptyLabel?: ReactNode;
  markLabels?: readonly [ReactNode, ReactNode, ReactNode, ReactNode, ReactNode];
  keyLabel?: ReactNode;
  headingLevel?: MatrixHeadingLevel;
  ground?: SectionGround;
}

/** Two parallel sides, or a responsive comparison table with authored cells. */
export type MatrixProps = MatrixQuadrantProps | MatrixGridProps;

const HEADING_TAGS = { 2: "h2", 3: "h3", 4: "h4", 5: "h5", 6: "h6" } as const;
const DASH_CLASSES: Record<SectionGround, string> = {
  base: "block h-px w-sm bg-ink-muted",
  sunken: "block h-px w-sm bg-ink-muted",
  inverse: "block h-px w-sm bg-ink-on-inverse-muted",
};
const CHECK_CLASSES: Record<SectionGround, string> = {
  base: "text-accent", sunken: "text-accent", inverse: "text-accent-on-inverse",
};
const FEATURED_CLASSES: Record<SectionGround, string> = {
  base: "border-t-accent", sunken: "border-t-accent", inverse: "border-t-accent-on-inverse",
};
const SIDE_ROW_CLASSES = {
  plain: {
    1: "tablet:row-span-1 tablet:grid tablet:grid-rows-subgrid",
    2: "tablet:row-span-2 tablet:grid tablet:grid-rows-subgrid",
    3: "tablet:row-span-3 tablet:grid tablet:grid-rows-subgrid",
    4: "tablet:row-span-4 tablet:grid tablet:grid-rows-subgrid",
  },
  visual: {
    1: "tablet-lg:row-span-1 tablet-lg:grid tablet-lg:grid-rows-subgrid",
    2: "tablet-lg:row-span-2 tablet-lg:grid tablet-lg:grid-rows-subgrid",
    3: "tablet-lg:row-span-3 tablet-lg:grid tablet-lg:grid-rows-subgrid",
    4: "tablet-lg:row-span-4 tablet-lg:grid tablet-lg:grid-rows-subgrid",
  },
} as const;

function hasNode(node: ReactNode): boolean {
  return node !== undefined && node !== null && node !== false;
}

interface SharedRows { description: boolean; points: boolean; visual: boolean }

function assertMatrix({ sides, featured, ground = "base", headingLevel = 3 }: MatrixQuadrantProps): void {
  if (ground !== "base" && ground !== "sunken" && ground !== "inverse") throw new TypeError("Matrix: unknown ground.");
  if (![2, 3, 4, 5, 6].includes(headingLevel)) throw new TypeError("Matrix: unknown heading level.");
  if (!Array.isArray(sides) || sides.length !== 2) throw new TypeError("Matrix: exactly two sides are required.");
  const ids = new Set<string>();
  const forms: string[] = [];
  for (let index = 0; index < sides.length; index++) {
    if (!Object.hasOwn(sides, index)) throw new TypeError("Matrix: sides must be dense.");
    const side = sides[index];
    if (!side || typeof side !== "object" || Array.isArray(side)) throw new TypeError("Matrix: each side must be an object.");
    if (typeof side.id !== "string" || !side.id || /\s/.test(side.id) || ids.has(side.id)) throw new TypeError("Matrix: side ids must be distinct and whitespace-free.");
    ids.add(side.id);
    if ((side.label !== undefined && !hasContent(side.label)) || !hasContent(side.heading)) throw new TypeError("Matrix: each side needs a heading and any supplied label must have content.");
    if (side.points !== undefined) {
      if (!Array.isArray(side.points) || side.points.length < 2 || side.points.length > 4) throw new TypeError("Matrix: points must contain two to four entries.");
      for (let point = 0; point < side.points.length; point++) {
        if (!Object.hasOwn(side.points, point) || !hasContent(side.points[point])) throw new TypeError("Matrix: points must be dense and nonempty.");
      }
      if (hasNode(side.visual)) throw new TypeError("Matrix: points and visual cannot be combined.");
    }
    if (hasNode(side.visual) && !hasContent(side.visual)) throw new TypeError("Matrix: visual must contain content.");
    const form = hasContent(side.visual) ? "visual" : side.points !== undefined ? "points" : undefined;
    if (form === undefined) throw new TypeError("Matrix: each side needs points or visual; description is an optional lead.");
    forms.push(form);
  }
  if (sides.some(side => (side.label !== undefined) !== (sides[0].label !== undefined))) throw new TypeError("Matrix: both sides must have labels or neither side may have a label.");
  if (forms[0] !== forms[1]) throw new TypeError("Matrix: sides must share the same primary form.");
  if (sides[0].points?.length !== sides[1].points?.length) throw new TypeError("Matrix: sides need an equal point count.");
  if (featured !== undefined && !ids.has(featured)) throw new TypeError("Matrix: featured must name a side id.");
}

function SideBody({ side, featured, headingLevel, ground, shared }: {
  side: MatrixSide; featured: boolean; headingLevel: MatrixHeadingLevel; ground: SectionGround; shared: SharedRows;
}) {
  const HeadingTag = HEADING_TAGS[headingLevel];
  const colors = SECTION_GROUND_CLASSES[ground];
  const emptyRow = shared.visual ? "hidden tablet-lg:block" : "hidden tablet:block";
  return <>
    <div className="flex flex-col gap-xs">
      {hasNode(side.label) ? <p className={cx("text-body-s font-medium uppercase tracking-label", colors.secondary)}>{side.label}</p> : null}
      <HeadingTag className={cx("text-h2 font-display leading-heading text-balance", colors.primary)}>{side.heading}</HeadingTag>
    </div>
    {shared.description ? hasNode(side.description) ? <p data-matrix-description="" className={cx("text-body text-pretty", colors.primary)}>{side.description}</p> : <div aria-hidden="true" data-matrix-empty-row="description" className={emptyRow} /> : null}
    {shared.points ? side.points && side.points.length > 0 ? <ul className="flex flex-col gap-sm">
      {side.points.map((point, index) => <li key={index} className={cx("flex items-start gap-sm text-body", colors.primary)}>
        <span aria-hidden="true" className="mt-xs flex size-lg shrink-0 items-center justify-center">
          {featured ? <Icon glyph={Check} decorative size="sm" className={CHECK_CLASSES[ground]} /> : <span className={DASH_CLASSES[ground]} />}
        </span>
        <span className="min-w-0">{point}</span>
      </li>)}
    </ul> : <div aria-hidden="true" data-matrix-empty-row="points" className={emptyRow} /> : null}
    {shared.visual ? hasNode(side.visual) ? <div data-matrix-visual="" className="w-full min-w-0 pt-md">{side.visual}</div> : <div aria-hidden="true" data-matrix-empty-row="visual" className={emptyRow} /> : null}
  </>;
}

/** Private layout renderer for the validated two-sided matrix. */
export function MatrixRenderer({ arrangement: _arrangement, sides, featured, headingLevel = 3, ground = "base", className, style, ...rest }: MatrixQuadrantProps) {
  const shared: SharedRows = {
    description: sides.some(side => hasNode(side.description)),
    points: sides.some(side => side.points !== undefined && side.points.length > 0),
    visual: sides.some(side => hasNode(side.visual)),
  };
  const rows = (1 + Number(shared.description) + Number(shared.points) + Number(shared.visual)) as 1 | 2 | 3 | 4;
  const sideGrid = SIDE_ROW_CLASSES[shared.visual ? "visual" : "plain"][rows];
  return <div {...rest} data-matrix="" data-matrix-rows={rows} className={cx(
    shared.visual ? "relative grid grid-cols-1 gap-lg tablet-lg:grid-cols-2 tablet-lg:gap-x-4xl" : "relative grid grid-cols-1 gap-lg tablet:grid-cols-2 tablet:gap-x-4xl", className,
  )} style={style}>
    {sides.map(side => <section key={side.id} data-matrix-side={side.id} className={cx("flex min-w-0 flex-col gap-md", sideGrid)}>
      <Card variant="plate" ground={ground} data-featured={side.id === featured ? "true" : undefined} className={cx("flex flex-1 flex-col gap-md tablet:p-xl", sideGrid, side.id === featured ? "border-t" : undefined, side.id === featured ? FEATURED_CLASSES[ground] : undefined)} style={side.id === featured ? { borderBlockStartWidth: UI_BORDER_HAIRLINE } : undefined}>
        <SideBody side={side} featured={side.id === featured} headingLevel={headingLevel} ground={ground} shared={shared} />
      </Card>
    </section>)}
  </div>;
}

/** Two equal plates or one responsive comparison table. Server-safe. */
export function Matrix(props: MatrixProps) {
  if (props.arrangement === "grid") return <MatrixGrid {...props} />;
  if (props.arrangement !== undefined && props.arrangement !== "sides") throw new TypeError("Matrix: unknown arrangement.");
  assertMatrix(props);
  return <MatrixRenderer {...props} />;
}
