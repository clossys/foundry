import componentIA from "./ia/components.json" with { type: "json" };
import sectionIA from "./ia/sections.json" with { type: "json" };
import sectionHomes from "./maps/blocks-to-sections.json" with { type: "json" };
import { resolveComponentId } from "./component-aliases.js";

/** Navigation uses the authoritative IA verbatim, including canonical leaf addresses. */
export const COMPONENT_DISPLAY_TREE = componentIA.nodes;
export type ComponentDisplayTree = typeof COMPONENT_DISPLAY_TREE;
export const BLOCK_DISPLAY_TREE = sectionIA.nodes;

export interface DisplayPlacement { readonly l1: string | null; readonly l2: string | null }
function placement(tree: typeof componentIA.nodes, id: string): DisplayPlacement {
  for (const group of tree) for (const family of group.children) {
    if (family.leaves.includes(id)) return { l1: group.id, l2: family.id };
  }
  // A legacy gap without a registered home remains metadata, outside navigation.
  return { l1: null, l2: null };
}
export function componentPlacement(id: string): DisplayPlacement {
  return placement(COMPONENT_DISPLAY_TREE, resolveComponentId(id));
}
export function blockPlacement(id: string): DisplayPlacement {
  const homes: Readonly<Record<string, string>> = sectionHomes;
  return placement(BLOCK_DISPLAY_TREE, homes[id] ?? id);
}
