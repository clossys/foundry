import type { CSSProperties, ReactNode } from "react";
import { TOKENS } from "../../tokens/tokens.js";
import { cx } from "../../atoms/internal/cx.js";
import { UI_BORDER_HAIRLINE } from "../../atoms/internal/ui-vars.js";
import { Item } from "../items/Item.js";
import { hasContent } from "../items/policies.js";
import type { ItemData } from "../items/types.js";
import { SECTION_GROUND_CLASSES, type SectionGround } from "../section-ground.js";
import { assertTree } from "./policies.js";

/** A passive Item node and its single incoming editorial relation. */
export type TreeNodeData = Pick<ItemData, "id" | "heading" | "description" | "eyebrow" | "meta" | "figure" | "status" | "badge"> & {
  /** Omit on the single root; otherwise refer to another node's id. */
  parent?: string;
  edgeLabel?: ReactNode;
};

export interface TreeProps {
  nodes: readonly TreeNodeData[];
  /** The list becomes a diagram from tablet-lg. @default "right" */
  orientation?: "right" | "down";
  /** Existing external heading id; Tree generates no label or id. */
  labelledBy?: string;
  /** @default "base" */
  ground?: SectionGround;
  className?: string;
}

const RIGHT_COLUMN_CLASSES: Record<number, string> = {
  1: "tablet-lg:grid-cols-2", 2: "tablet-lg:grid-cols-3", 3: "tablet-lg:grid-cols-4",
};
const DOWN_ROW_CLASSES: Record<number, string> = {
  1: "tablet-lg:grid-rows-2",
  2: "tablet-lg:grid-rows-3",
};
const DOWN_COLUMN_CLASSES: Record<number, string> = {
  2: "tablet-lg:grid-cols-2", 3: "tablet-lg:grid-cols-3", 4: "tablet-lg:grid-cols-4", 5: "tablet-lg:grid-cols-5", 6: "tablet-lg:grid-cols-6",
};
const GROUND_CLASSES: Record<SectionGround, { plate: string; line: string; pseudo: string }> = {
  base: { plate: "tablet-lg:bg-surface-sunken", line: "border-line-strong", pseudo: "tablet-lg:before:bg-line-strong" },
  sunken: { plate: "tablet-lg:bg-surface-raised", line: "border-line-strong", pseudo: "tablet-lg:before:bg-line-strong" },
  inverse: { plate: "tablet-lg:bg-surface-inverse-raised", line: "border-line-on-inverse", pseudo: "tablet-lg:before:bg-line-on-inverse" },
};
const LIST = "m-0 flex min-w-0 list-none flex-col gap-lg p-0 print:block tablet-lg:print:block";
const CHILD_LIST = "relative ms-0 mt-lg border-s ps-lg tablet-lg:ms-0 tablet-lg:mt-0 tablet-lg:border-none tablet-lg:ps-0 print:mt-lg print:border-solid print:ps-lg tablet-lg:print:border-solid tablet-lg:print:ps-lg";
const CELL = "relative min-w-0 print:block print:mt-lg tablet-lg:print:block";
const PLATE = "relative flex min-w-0 flex-col gap-sm tablet-lg:rounded-panel tablet-lg:p-lg print:rounded-none print:bg-transparent print:p-0 tablet-lg:print:rounded-none tablet-lg:print:bg-transparent tablet-lg:print:p-0";
const RIGHT_CELL = "tablet-lg:col-span-full tablet-lg:grid tablet-lg:grid-cols-subgrid tablet-lg:items-center";
const RIGHT_CHILDREN = "tablet-lg:col-start-2 tablet-lg:col-end-[-1] tablet-lg:row-start-1 tablet-lg:grid tablet-lg:grid-cols-subgrid tablet-lg:gap-x-2xl tablet-lg:gap-y-lg";
const DOWN_CELL = "tablet-lg:row-span-full tablet-lg:grid tablet-lg:grid-cols-1 tablet-lg:grid-rows-subgrid";
const DOWN_CHILDREN = "tablet-lg:col-start-1 tablet-lg:row-start-2 tablet-lg:row-end-[-1] tablet-lg:grid tablet-lg:grid-rows-subgrid tablet-lg:gap-x-lg tablet-lg:gap-y-2xl";
const DOWN_PLATE = "tablet-lg:col-start-1 tablet-lg:row-start-1 tablet-lg:w-full tablet-lg:justify-self-center tablet-lg:self-stretch";
const STROKE = "pointer-events-none absolute hidden tablet-lg:block print:hidden tablet-lg:print:hidden tablet-lg:before:absolute tablet-lg:before:inset-0 tablet-lg:before:content-['']";
const HALF_COLUMN_GAP = `calc(var(--spacing-2xl, ${TOKENS["--spacing-2xl"]!.value}) / 2)`;
const NEGATIVE_HALF_COLUMN_GAP = `calc(var(--spacing-2xl, ${TOKENS["--spacing-2xl"]!.value}) / -2)`;
const NEGATIVE_HALF_ROW_GAP = `calc(var(--spacing-lg, ${TOKENS["--spacing-lg"]!.value}) / -2)`;

/** One semantic nested list, with purely CSS diagram geometry on wider screens. */
export function Tree(props: TreeProps) {
  const { root, children, depth } = assertTree(props);
  const { orientation = "right", labelledBy, ground = "base", className } = props;
  const right = orientation === "right";
  const colors = SECTION_GROUND_CLASSES[ground];
  const tokens = GROUND_CLASSES[ground];
  function stroke(part: string, style: CSSProperties) {
    return <span data-diagram-connector={part} aria-hidden="true" className={cx(STROKE, tokens.pseudo)} style={style} />;
  }
  function row(node: TreeNodeData, isRoot = false, siblingIndex = 0, siblingCount = 1): ReactNode {
    const descendants = children.get(node.id)!;
    const hasChildren = descendants.length !== 0;
    const { parent: _parent, edgeLabel, ...item } = node;
    return <li key={node.id} className={cx(CELL, right ? RIGHT_CELL : DOWN_CELL)}>
      {right && !isRoot ? <>
        {stroke("horizontal-incoming", { insetInlineStart: NEGATIVE_HALF_COLUMN_GAP, insetBlockStart: "50%", inlineSize: HALF_COLUMN_GAP, blockSize: UI_BORDER_HAIRLINE })}
        {stroke("horizontal-spine", { insetInlineStart: NEGATIVE_HALF_COLUMN_GAP, insetBlockStart: siblingIndex === 0 ? "50%" : NEGATIVE_HALF_ROW_GAP, insetBlockEnd: siblingIndex === siblingCount - 1 ? "50%" : NEGATIVE_HALF_ROW_GAP, inlineSize: UI_BORDER_HAIRLINE })}
      </> : null}
      {!right && !isRoot && siblingIndex === 0 ? stroke("down-spine", { insetInlineStart: "50%", insetBlockStart: NEGATIVE_HALF_COLUMN_GAP, inlineSize: `calc((100% + var(--spacing-lg, ${TOKENS["--spacing-lg"]!.value})) * ${siblingCount - 1})`, blockSize: UI_BORDER_HAIRLINE }) : null}
      <div data-diagram-node={node.id} style={right ? undefined : { maxInlineSize: `calc(var(--ui-width-prose-max, ${TOKENS["--ui-width-prose-max"]!.value}) / 3)` }} className={cx(PLATE, tokens.plate, right ? "tablet-lg:col-start-1 tablet-lg:row-start-1 tablet-lg:self-center" : DOWN_PLATE)}>
        {!isRoot && hasContent(edgeLabel) ? <p data-diagram-edge="" className={cx("m-0 text-caption font-body", colors.secondary)}>{edgeLabel}</p> : null}
        <Item {...item} treatment="plain" size="standard" ground={ground} headingLevel={isRoot ? 3 : 4} />
        {right && hasChildren ? stroke("horizontal-outgoing", { insetInlineStart: "100%", insetBlockStart: "50%", inlineSize: HALF_COLUMN_GAP, blockSize: UI_BORDER_HAIRLINE }) : null}
        {!right && !isRoot ? stroke("down-incoming", { insetInlineStart: "50%", insetBlockStart: NEGATIVE_HALF_COLUMN_GAP, inlineSize: UI_BORDER_HAIRLINE, blockSize: HALF_COLUMN_GAP }) : null}
        {!right && hasChildren ? stroke("down-outgoing", { insetInlineStart: "50%", insetBlockStart: "100%", inlineSize: UI_BORDER_HAIRLINE, blockSize: HALF_COLUMN_GAP }) : null}
      </div>
      {hasChildren ? <ul role="list" style={{ borderInlineStartWidth: UI_BORDER_HAIRLINE }} className={cx(LIST, CHILD_LIST, tokens.line, right ? RIGHT_CHILDREN : cx(DOWN_CHILDREN, DOWN_COLUMN_CLASSES[descendants.length]))}>
        {descendants.map((child, index) => row(child, false, index, descendants.length))}
      </ul> : null}
    </li>;
  }
  return <ul role="list" data-tree="" data-orientation={orientation} aria-labelledby={labelledBy} className={cx(LIST, colors.surface, right ? cx("tablet-lg:grid tablet-lg:gap-x-2xl", RIGHT_COLUMN_CLASSES[depth]) : cx("tablet-lg:grid tablet-lg:grid-cols-1 tablet-lg:gap-y-2xl", DOWN_ROW_CLASSES[depth]), className)}>
    {row(root, true)}
  </ul>;
}
