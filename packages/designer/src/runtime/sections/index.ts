/**
 * Shared Section renderer registry: the three Section groups, adapted to SurfaceRendererEntry and merged
 * with a duplicate check. Each group keeps its own table shape; this file is the only place they meet.
 */
import type { RuntimeJson } from "../../catalog-core/runtime-ports.js";
import type { SpecimenDataset } from "../../studio/specimen-dataset.js";
import { mergeRendererGroups, type SurfaceRendererEntry, type SurfaceRendererGroup, type SurfaceRuntimeLeaf, type SurfaceRuntimeRenderer } from "../contract.js";
import { GROUP_A_SECTION_RENDERERS } from "./group-a.js";
import { GROUP_A_CONTENT, GROUP_A_LEAVES, type GroupALeaf } from "./group-a-dataset.js";
import { groupBRenderers } from "./group-b.js";
import { groupBDataset } from "./group-b-dataset.js";
import { GROUP_C_LEAVES, sectionDatasetC, sectionRenderersC, type GroupCLeaf } from "./group-c.js";
import { withLibraryBoard } from "./library-board.js";

type SampleContent = Readonly<Record<string, RuntimeJson>>;
type SampleOf = (dataset: SpecimenDataset) => SampleContent;
/**
 * A group's renderer table plus its dataset-bound sample content, as one SurfaceRendererGroup. A renderer
 * without sample content is refused here, so every registered leaf can be drawn by the Studio preview.
 */
export function adaptSectionGroup(renderers: Readonly<Record<string, SurfaceRuntimeRenderer>>, sample: (leaf: string) => SampleOf | undefined): SurfaceRendererGroup {
  return Object.fromEntries(Object.entries(renderers).map(([leaf, render]): [string, SurfaceRendererEntry] => {
    const content = sample(leaf);
    if (!content) throw new TypeError(`surface runtime: ${leaf} has a renderer but no sample content`);
    return [leaf, { leaf: leaf as SurfaceRuntimeLeaf, render, sample: content }];
  }));
}

/** The leaf's name under `sections.` when it belongs to `leaves`. */
function member<Leaf extends string>(leaves: readonly Leaf[], leaf: string): Leaf | undefined {
  const short = leaf.slice("sections.".length);
  return (leaves as readonly string[]).includes(short) ? short as Leaf : undefined;
}

// sections.comparison: the arrangement.library-board member draws the live board through its Section host port.
const groupARenderers = { ...GROUP_A_SECTION_RENDERERS, "sections.comparison": withLibraryBoard(GROUP_A_SECTION_RENDERERS["sections.comparison"]!) };
const groupA = adaptSectionGroup(groupARenderers, leaf => {
  const short = member<GroupALeaf>(GROUP_A_LEAVES, leaf);
  return short ? () => GROUP_A_CONTENT[short] : undefined;
});
const groupB = adaptSectionGroup(groupBRenderers, leaf => {
  const content = Object.hasOwn(groupBDataset, leaf) ? groupBDataset[leaf as `sections.${string}`] : undefined;
  return content ? () => content : undefined;
});
const groupC = adaptSectionGroup(sectionRenderersC, leaf => {
  const short = member<GroupCLeaf>(GROUP_C_LEAVES, leaf);
  return short ? sectionDatasetC[short] : undefined;
});

export const sectionRenderers = mergeRendererGroups(groupA, groupB, groupC);
