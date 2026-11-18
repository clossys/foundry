/**
 * interactive.backdrop (foundry-build-0048 A4, owner narrowing 2026-11-18): an interactive backdrop
 * is plain data, a descriptor `{component, params}` over one of the Foundry-shipped backdrop
 * components (`@clossys/designer/blocks`). It rides as `meta.backdrop` on the hero's own code
 * candidate, never as a candidate of its own: the code stays under its own source and the verbatim
 * rule, and only the descriptor is judged here, as data, against the Designer's own component list
 * and per-component param schema (`interactiveBackdropDescriptorIssues`, the same function the
 * slot-model validator, Publisher install and the React component call), and against the slot contract.
 */
import { interactiveBackdropDescriptorIssues } from "@clossys/designer/catalog";
import { isRecord, strings } from "../../core/lib.js";
import type { Criterion } from "../../core/types.js";
import { metaOf } from "./lib.js";

/**
 * interactive.backdrop: a candidate without `meta.backdrop` is not judged here. One that carries it
 * passes only on a slot whose contract (`params.contract`, bound with "$contract") declares
 * `interactive.components`, with its descriptor naming one of those components and every param
 * inside that component's schema.
 */
export const interactiveBackdrop: Criterion = (subject, params) => {
  const meta = metaOf(subject);
  if (!meta || !Object.hasOwn(meta, "backdrop")) return [];
  const contract = isRecord(params.contract) ? params.contract : undefined;
  const allowed = isRecord(contract?.interactive) ? strings(contract.interactive.components) : [];
  if (!allowed.length) return ["the slot contract allows no interactive backdrop (contract.interactive.components); meta.backdrop is refused here"];
  const failures = interactiveBackdropDescriptorIssues(meta.backdrop);
  const component = isRecord(meta.backdrop) ? meta.backdrop.component : undefined;
  if (typeof component === "string" && !allowed.includes(component)) failures.push(`the slot contract allows the interactive backdrops ${allowed.join(", ")}, not ${component}`);
  return failures;
};
