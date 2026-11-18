/**
 * Where a Designer candidate came from (section 5a provenance, the source ladder): its source kind,
 * each ref, the licence and the content hash. A ref is a versioned registry item
 * `<registry>/<item>@<version>` from a listed registry, or another slot cited by its id: never a file
 * path, so a cross-slot dependency always names the slot.
 */
import { isRecord, strings } from "../../core/lib.js";
import type { Criterion } from "../../core/types.js";
import { INTERACTIVE_BACKDROP_KIND } from "./interactive.js";
import { refsOf, SLOT_ID, sourceOf } from "./lib.js";

/** `<registry>/<item>@<version>`; the item may hold a scope or a path (`npm/@xyflow/react@12.12.1`). */
const REGISTRY_REF = /^([a-z0-9][a-z0-9-]*)\/(\S+)@([0-9A-Za-z][\w.+-]*)$/;
const HASH = /^sha256:[0-9a-f]{64}$/;

/** The issue of one ref, or undefined when it is acceptable. */
function refIssue(ref: string, registries: ReadonlySet<string>, slots: boolean): string | undefined {
  const registry = REGISTRY_REF.exec(ref);
  if (registry) return registries.has(registry[1]!) ? undefined : `ref ${ref} is from registry ${registry[1]}, not one of ${[...registries].join(", ") || "(none listed)"}`;
  const slot = SLOT_ID.exec(ref);
  if (slot) return slots ? undefined : `ref ${ref} cites a slot; this standard takes registry items only`;
  if (/\//.test(ref) || /\.[a-z0-9]+(?:#.*)?$/i.test(ref)) return `ref ${ref} is a file path: cite the slot id (or the registry item) it comes from`;
  return `ref ${ref} is neither <registry>/<item>@<version> nor a slot id`;
}

/**
 * source.ref: `meta.source.kind` is one of `params.kinds`; every ref is a versioned item of one of
 * `params.registries` or (unless `params.slots` is false) a slot id; a kind other than `original`
 * names at least one ref (a `composition` names its parts instead, judged by compose.layers); a registry ref carries `meta.source.hash` (sha256); `meta.source.license`
 * is one of `params.licenses` when listed. An `interactive-backdrop` (a descriptor over a Foundry
 * component, foundry-build-0048 A4) is accepted only where the slot contract (`params.contract`)
 * both allows it (`interactive.components`) and judges it (an `interactive.backdrop` requirement), and
 * it cites nothing (`ref` is []).
 */
export const sourceRef: Criterion = (subject, params) => {
  const kinds = strings(params.kinds), registries = new Set(strings(params.registries)), licenses = strings(params.licenses);
  if (!kinds.length) return ["params.kinds must list the source kinds this standard accepts"];
  const source = sourceOf(subject);
  if (!isRecord(source)) return ["meta.source is missing"];
  const failures: string[] = [];
  const kind = typeof source.kind === "string" ? source.kind : undefined;
  if (kind === INTERACTIVE_BACKDROP_KIND) {
    const contract = isRecord(params.contract) ? params.contract : undefined;
    const allows = isRecord(contract?.interactive) && strings(contract.interactive.components).length > 0;
    const judges = Array.isArray(contract?.requirements) && contract.requirements.some(row => isRecord(row) && row.check === "interactive.backdrop");
    if (!allows || !judges) failures.push(`meta.source.kind ${INTERACTIVE_BACKDROP_KIND} needs a slot contract that allows it (contract.interactive) and judges it (an interactive.backdrop requirement); this slot's does not`);
    const cited = Array.isArray(source.ref) ? source.ref : [source.ref];
    if (!Array.isArray(source.ref) || source.ref.length) failures.push(`meta.source.kind ${INTERACTIVE_BACKDROP_KIND} cites nothing: meta.source.ref must be [], not ${JSON.stringify(cited)}`);
    if (licenses.length && !(typeof source.license === "string" && licenses.includes(source.license))) failures.push(`meta.source.license ${String(source.license ?? "(none)")} is not one of ${licenses.join(", ")}`);
    return failures;
  }
  if (!kind || !kinds.includes(kind)) failures.push(`meta.source.kind ${kind ?? "(none)"} is not one of ${kinds.join(", ")}`);
  const refs = refsOf(source);
  if (!refs.length && kind !== "original" && kind !== "composition") failures.push(`meta.source.kind ${kind ?? "(none)"} names no ref`);
  for (const ref of refs) { const issue = refIssue(ref, registries, params.slots !== false); if (issue) failures.push(issue); }
  if (refs.some(ref => REGISTRY_REF.test(ref)) && !(typeof source.hash === "string" && HASH.test(source.hash))) failures.push("a registry ref needs meta.source.hash (sha256:<64 hex>)");
  if (licenses.length && !(typeof source.license === "string" && licenses.includes(source.license))) failures.push(`meta.source.license ${String(source.license ?? "(none)")} is not one of ${licenses.join(", ")}`);
  return failures;
};
