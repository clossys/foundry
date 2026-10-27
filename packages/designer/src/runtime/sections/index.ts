/**
 * Shared Section renderer registry: the three Section groups, adapted to SurfaceRendererEntry and merged
 * with a duplicate check. Each group keeps its own table shape; this file is the only place they meet.
 */
import type { RuntimeJson } from "../../catalog-core/runtime-ports.js";
import { mergeRendererGroups, type SurfaceRendererEntry, type SurfaceRendererGroup, type SurfaceRuntimeLeaf, type SurfaceRuntimeRenderer } from "../contract.js";
import { GROUP_A_SECTION_RENDERERS } from "./group-a.js";
import { GROUP_A_CONTENT, GROUP_A_LEAVES, type GroupALeaf } from "./group-a-dataset.js";
import { sectionRenderers as groupB } from "./group-b.js";
import { sectionRenderers as groupC } from "./group-c.js";

type SampleContent = Readonly<Record<string, RuntimeJson>>;
/** A group's renderer table plus its dataset-bound sample content, as one SurfaceRendererGroup. */
export function adaptSectionGroup(renderers: Readonly<Record<string, SurfaceRuntimeRenderer>>, sample: (leaf: string) => SampleContent | undefined): SurfaceRendererGroup {
  return Object.fromEntries(Object.entries(renderers).map(([leaf, render]): [string, SurfaceRendererEntry] => {
    const content = sample(leaf);
    if (!content) throw new TypeError(`surface runtime: ${leaf} has a renderer but no sample content`);
    return [leaf, { leaf: leaf as SurfaceRuntimeLeaf, render, sample: () => content }];
  }));
}

const groupA = adaptSectionGroup(GROUP_A_SECTION_RENDERERS, leaf => {
  const short = leaf.slice("sections.".length);
  return (GROUP_A_LEAVES as readonly string[]).includes(short) ? GROUP_A_CONTENT[short as GroupALeaf] : undefined;
});

export const sectionRenderers = mergeRendererGroups(groupA, groupB, groupC);
