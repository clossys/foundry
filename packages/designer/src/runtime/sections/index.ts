/** Shared Section renderer registry: the three Section groups, merged with a duplicate check. */
import { mergeRendererGroups } from "../contract.js";
import { sectionRenderers as groupA } from "./group-a.js";
import { sectionRenderers as groupB } from "./group-b.js";
import { sectionRenderers as groupC } from "./group-c.js";

export const sectionRenderers = mergeRendererGroups(groupA, groupB, groupC);
