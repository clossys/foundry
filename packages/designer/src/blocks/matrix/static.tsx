import type { ReactNode } from "react";
import type { MatrixQuadrantProps, MatrixSide, MatrixHeadingLevel } from "../Matrix.js";

import { cx } from "../../components/internal/cx.js";
import { UI_BORDER_HAIRLINE } from "../../components/internal/ui-vars.js";
import { Check } from "../../icons/Check.js";
import { hasContent } from "../items/policies.js";
import { SECTION_GROUND_CLASSES, type SectionGround } from "../section-ground.js";
import { componentLeaf } from "../../runtime/component-leaf.js";

const Card = componentLeaf<typeof import("../../components/preview-runtime/components/card/card.js").Card>("components.card");
const CardContent = componentLeaf<typeof import("../../components/preview-runtime/components/card/card.js").CardContent>("components.card", "CardContent");
const Icon = componentLeaf<typeof import("../../components/Icon.js").Icon>("components.icon");
const SemanticContent = componentLeaf<typeof import("../../components/SemanticContent.js").SemanticContent>("components.semantic-content");

// The ordinary mixed dispatcher stays unchanged. Keep this pure sides renderer
// in output parity with it; server reachability must never import its value graph.
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

export function assertMatrix({ sides, featured, ground = "base", headingLevel = 3 }: MatrixQuadrantProps): void {
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
    <SemanticContent as="div" className="flex flex-col gap-xs">
      {hasNode(side.label) ? <SemanticContent as="p" className={cx("text-body-s font-medium uppercase tracking-label", colors.secondary)}>{side.label}</SemanticContent> : null}
      <SemanticContent as={HeadingTag} className={cx("text-h2 font-display leading-heading text-balance", colors.primary)}>{side.heading}</SemanticContent>
    </SemanticContent>
    {shared.description ? hasNode(side.description) ? <SemanticContent as="p" data-matrix-description="" className={cx("text-body text-pretty", colors.primary)}>{side.description}</SemanticContent> : <SemanticContent as="div" aria-hidden="true" data-matrix-empty-row="description" className={emptyRow} /> : null}
    {shared.points ? side.points && side.points.length > 0 ? <SemanticContent as="ul" className="flex flex-col gap-sm">
      {side.points.map((point, index) => <SemanticContent as="li" key={index} className={cx("flex items-start gap-sm text-body", colors.primary)}>
        <SemanticContent as="span" aria-hidden="true" className="mt-xs flex size-lg shrink-0 items-center justify-center">
          {featured ? <Icon glyph={Check} decorative size="sm" className={CHECK_CLASSES[ground]} /> : <SemanticContent as="span" className={DASH_CLASSES[ground]} />}
        </SemanticContent>
        <SemanticContent as="span" className="min-w-0">{point}</SemanticContent>
      </SemanticContent>)}
    </SemanticContent> : <SemanticContent as="div" aria-hidden="true" data-matrix-empty-row="points" className={emptyRow} /> : null}
    {shared.visual ? hasNode(side.visual) ? <SemanticContent as="div" data-matrix-visual="" className="w-full min-w-0 pt-md">{side.visual}</SemanticContent> : <SemanticContent as="div" aria-hidden="true" data-matrix-empty-row="visual" className={emptyRow} /> : null}
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
  return <SemanticContent as="div" {...rest} data-matrix="" data-matrix-rows={rows} className={cx(
    shared.visual ? "relative grid grid-cols-1 gap-lg tablet-lg:grid-cols-2 tablet-lg:gap-x-4xl" : "relative grid grid-cols-1 gap-lg tablet:grid-cols-2 tablet:gap-x-4xl", className,
  )} style={style}>
    {sides.map(side => <SemanticContent as="section" key={side.id} data-matrix-side={side.id} className={cx("flex min-w-0 flex-col gap-md", sideGrid)}>
      <Card data-featured={side.id === featured ? "true" : undefined} className={cx("flex flex-1 flex-col gap-md tablet:p-xl", sideGrid, side.id === featured ? "border-t" : undefined, side.id === featured ? FEATURED_CLASSES[ground] : undefined)} style={side.id === featured ? { borderBlockStartWidth: UI_BORDER_HAIRLINE } : undefined}>
        <CardContent><SideBody side={side} featured={side.id === featured} headingLevel={headingLevel} ground={ground} shared={shared} /></CardContent>
      </Card>
    </SemanticContent>)}
  </SemanticContent>;
}
