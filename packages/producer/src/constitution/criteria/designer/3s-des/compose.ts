/**
 * compose.layers: a section or frame composes lower layers by slot id. Each part a composition
 * names (`meta.source.parts[].slot`) is a slot id of an allowed layer, so the dependency resolves
 * through that slot's pin and never through a copied file.
 */
import { isRecord, strings } from "../../core/lib.js";
import type { Criterion } from "../../core/types.js";
import { SLOT_ID, sourceOf } from "./lib.js";

/**
 * compose.layers: every `meta.source.parts[].slot` is a Designer slot id under one of
 * `params.layers` (`components`, `sections`, ...), with no slot named twice; a source of kind
 * `composition` names at least one part.
 */
export const composeLayers: Criterion = (subject, params) => {
  const layers = strings(params.layers);
  if (!layers.length) return ["params.layers must list the layers a composition may take parts from"];
  const source = sourceOf(subject);
  if (!isRecord(source)) return ["meta.source is missing"];
  const parts = Array.isArray(source.parts) ? source.parts : [];
  const failures: string[] = [];
  if (source.kind === "composition" && !parts.length) failures.push("a composition names no parts (meta.source.parts[].slot)");
  const seen = new Set<string>();
  for (const part of parts) {
    const slot = isRecord(part) && typeof part.slot === "string" ? part.slot : undefined;
    const match = slot ? SLOT_ID.exec(slot) : null;
    if (!slot || !match || (match[1] && match[1] !== "designer")) { failures.push(`part ${JSON.stringify(slot ?? part)} is not a Designer slot id`); continue; }
    const id = match[2]!;
    if (!layers.includes(id.split(".")[0]!)) failures.push(`part ${id} is from layer ${id.split(".")[0]}, not ${layers.join(" or ")}`);
    if (seen.has(id)) failures.push(`part ${id} is named twice`);
    seen.add(id);
  }
  return failures;
};
