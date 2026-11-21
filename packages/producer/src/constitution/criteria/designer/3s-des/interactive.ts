/**
 * interactive.backdrop (foundry-build-0048 A4, U23 owner 2026-11-18): an interactive backdrop is plain
 * data, a descriptor `{component, params}` over one of the adopted backdrop components
 * (`@clossys/designer`). It rides as `meta.backdrop` on the
 * surface's own code candidate, never as a candidate of its own: the code stays under its own source
 * and the verbatim rule, and only the descriptor is judged here, as data, by the same function the
 * slot-model validator, certify's backdrop fit and Publisher install call
 * (`interactiveBackdropMetaIssues`), against the slot contract.
 */
import { interactiveBackdropMetaIssues } from "@clossys/designer/catalog";
import { isRecord } from "../../core/lib.js";
import type { Criterion } from "../../core/types.js";
import { metaOf } from "./lib.js";

/**
 * interactive.backdrop: a candidate without `meta.backdrop` is not judged here. One that carries it
 * passes only on a slot whose contract (`params.contract`, bound with "$contract") declares a
 * backdrop-placed slot, with its descriptor naming an adopted component and every param inside that
 * component's schema.
 */
export const interactiveBackdrop: Criterion = (subject, params) => {
  const meta = metaOf(subject);
  if (!meta || !Object.hasOwn(meta, "backdrop")) return [];
  const contract = isRecord(params.contract) ? params.contract : undefined;
  const name = isRecord(contract) && typeof contract.kind === "string" ? contract.kind : "slot";
  return interactiveBackdropMetaIssues({ meta }, name, contract);
};
