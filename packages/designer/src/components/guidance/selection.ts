import { COMPONENT_ALIASES, resolveComponentId } from "../../catalog/component-aliases.js";
import type { ComponentComparison } from "./internal/data.js";
import { COMPONENT_GUIDANCE, COMPONENT_API_FACTS, COMPONENT_COMPARISON } from "./internal/data.js";

/** Pinned aliases retain their specific guidance; canonical selection uses the first matching record. */
export function componentSelection(id: string) {
  const records: Readonly<Record<string, unknown>> = COMPONENT_GUIDANCE;
  const legacy = Object.hasOwn(records, id) ? id : Object.keys(COMPONENT_ALIASES).find(alias => COMPONENT_ALIASES[alias] === resolveComponentId(id) && Object.hasOwn(records, alias));
  if (!legacy) return undefined;
  return {
    id: resolveComponentId(legacy),
    guidance: COMPONENT_GUIDANCE[legacy as keyof typeof COMPONENT_GUIDANCE],
    facts: COMPONENT_API_FACTS[legacy as keyof typeof COMPONENT_API_FACTS],
    comparison: (COMPONENT_COMPARISON as Readonly<Partial<Record<string, ComponentComparison>>>)[legacy],
  };
}
