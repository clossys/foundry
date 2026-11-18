/**
 * interactive.backdrop (foundry-build-0048 A4, owner narrowing 2026-11-18): an interactive backdrop
 * is plain data, a descriptor `{component, params}` over one of the Foundry-shipped backdrop
 * components (`@clossys/designer/blocks`). The consumer never authors backdrop code, so there is
 * nothing to run: the candidate is judged as data, against the Designer's own component list and
 * per-component param schema (`interactiveBackdropCandidateIssues`, the same function the slot-model
 * validator and the React component call), and against the slot contract.
 */
import { INTERACTIVE_BACKDROP_KIND, interactiveBackdropCandidateIssues } from "@clossys/designer/catalog";
import { isRecord, strings } from "../../core/lib.js";
import type { Criterion } from "../../core/types.js";
import { itemOf, metaOf, sourceOf } from "./lib.js";

export { INTERACTIVE_BACKDROP_KIND };

/**
 * interactive.backdrop: a `meta.source.kind` interactive-backdrop candidate passes only on a slot
 * whose contract (`params.contract`, bound with "$contract") declares `interactive.components`, with
 * its descriptor naming one of those components and every param inside that component's schema, and
 * the item carrying nothing but the descriptor (no files, no installer key, no cited ref). Any other
 * kind that carries `meta.backdrop` fails: only this kind is a descriptor, and every other kind stays
 * under the verbatim rule. A candidate of any other kind without `meta.backdrop` is not judged here.
 */
export const interactiveBackdrop: Criterion = (subject, params) => {
  const source = sourceOf(subject);
  const meta = metaOf(subject);
  const kind = isRecord(source) ? source.kind : undefined;
  const claims = !!meta && Object.hasOwn(meta, "backdrop");
  if (kind !== INTERACTIVE_BACKDROP_KIND) {
    return claims ? [`meta.backdrop is only for meta.source.kind ${INTERACTIVE_BACKDROP_KIND}, not ${String(kind ?? "(none)")}: this candidate stays under the verbatim rule`] : [];
  }
  const contract = isRecord(params.contract) ? params.contract : undefined;
  const allowed = isRecord(contract?.interactive) ? strings(contract.interactive.components) : [];
  if (!allowed.length) return [`the slot contract allows no interactive backdrop (contract.interactive.components); ${INTERACTIVE_BACKDROP_KIND} is refused here`];
  const failures = interactiveBackdropCandidateIssues(itemOf(subject) ?? subject.json);
  const backdrop = meta?.backdrop;
  const component = isRecord(backdrop) ? backdrop.component : undefined;
  if (typeof component === "string" && !allowed.includes(component)) failures.push(`the slot contract allows the interactive backdrops ${allowed.join(", ")}, not ${component}`);
  return failures;
};
