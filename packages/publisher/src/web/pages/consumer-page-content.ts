import { libraryHash, runtimeHash, runtimeSnapshot } from "@clossys/designer/catalog";
import type { ContentRegistry } from "../../content/model.js";
import { computeContentDigest } from "../../content/digest.js";
import { isContentJson } from "../../content/json.js";
import { localePathFor } from "../../content/hreflang.js";
import type { Composition } from "../../content/composition.js";
import type { RevisionId } from "../../content/vocabulary.js";
import type { SectionFill } from "../../core/instance-binding.js";
import { normalizeRegionPageRoute } from "../../core/route-identities.js";
import { selectContentRoute } from "../content-route-binding.js";
import { prepareRegisteredRoute } from "../registered-route-binding.js";
import type { RegisteredRouteRuntime, RegisteredRouteHeaderActions } from "../registered-route-binding.js";
import { createConsumerPageRegistry } from "./admin-page.js";
import type { ConsumerPageRegistryOptions } from "./admin-page.js";
import type { AdminPageCopy } from "./admin-copy.js";

/** Plain consumer composition bytes live in the existing candidate revision.
 * The Writer resolver is a runtime capability, never serialized as authority. */
export interface ConsumerPageCompositionSnapshot extends Omit<ConsumerPageRegistryOptions,"copy"> { readonly version: 1 }
export interface ConsumerPageContentIdentity {
  readonly routeId: string; readonly slotId: string; readonly candidateId: string;
  readonly revision: RevisionId; readonly digest: string;
}
export interface ConsumerPageContentInput {
  readonly registry: ContentRegistry; readonly locale: string;
  readonly selections: readonly ConsumerPageContentIdentity[]; readonly copy: AdminPageCopy;
}
const keys = ["version","publication","map","channel","configs","manifests","brand","sources","itemL0","itemTitles"];
function snapshot(value: unknown): ConsumerPageCompositionSnapshot {
  if (!isContentJson(value) || !value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some(key => !keys.includes(key)) || (value as {version?:unknown}).version !== 1) throw new TypeError("A closed consumer composition snapshot is required in candidate.typeSettings.consumerPage");
  return value as unknown as ConsumerPageCompositionSnapshot;
}
function data(value: ConsumerPageCompositionSnapshot, copy: AdminPageCopy) {
  const {version:_version,...options} = snapshot(value);
  if (!Array.isArray(options.configs) || options.configs.some(config=>!Object.hasOwn(config,"pageModule"))) throw new TypeError("Checked consumer configs require an explicit pageModule SectionFill or null");
  return createConsumerPageRegistry({...options,copy});
}
/** Project existing Composition identities from the actual selected page tree.
 * Legacy Composition calls an omitted base config `default`; native bindings
 * retain their original omission and never invent a named native config. */
export function consumerPageContentSelection(value: ConsumerPageCompositionSnapshot, routeId: string, copy: AdminPageCopy): Pick<Composition,"frame"> & {readonly sections: readonly Pick<Composition["sections"][number],"key"|"sectionId"|"configId">[]} {
  const registry = data(value,copy).registry, route = registry.routes.find(row => row.routeId === routeId);
  if (!route) throw new TypeError("Selected consumer route is missing from its composition snapshot");
  const sections: {key:string;sectionId:string;configId:string}[] = [];
  const visit = (fill: SectionFill, key: string) => { sections.push({key,sectionId:fill.section,configId:fill.config ?? "default"}); fill.children?.forEach((child,index) => visit(child,`${key}.children.${index}`)); };
  const native = normalizeRegionPageRoute(registry,route).composition.binding;
  for (const [slot,fills] of Object.entries(native.fills)) fills.forEach((fill,index) => visit(fill,`fills.${slot}.${index}`));
  for (const [slot,fill] of Object.entries(native.frame.slotFills ?? {})) visit(fill,`frame.${slot}`);
  return runtimeSnapshot({frame:{frameId:registry.publication!.frame.leaf,configId:registry.publication!.frame.config ?? "default"},sections});
}
function selected(input: ConsumerPageContentInput) {
  if (!input || !Array.isArray(input.selections) || !input.selections.length || new Set(input.selections.map(row=>row.routeId)).size !== input.selections.length || new Set(input.selections.map(row=>row.slotId)).size !== input.selections.length) throw new TypeError("Unique canonical route and slot selections are required");
  let composition: ConsumerPageCompositionSnapshot | undefined;
  const identities: Record<string,ConsumerPageContentIdentity> = {};
  for (const pin of input.selections) {
    if (!pin || typeof pin !== "object" || Array.isArray(pin) || !isContentJson(pin as unknown) || Object.keys(pin).sort().join() !== ["routeId","slotId","candidateId","revision","digest"].sort().join()) throw new TypeError("Closed route selection identity required");
    const {slot,candidate} = selectContentRoute(input.registry,pin.slotId,input.locale);
    if (slot.kind !== "content") throw new TypeError("A consumer page requires a canonical content slot");
    const revision = candidate.history.at(-1)!;
    if (candidate.id !== pin.candidateId || candidate.revision !== pin.revision || revision.digest !== pin.digest || computeContentDigest(candidate) !== pin.digest) throw new TypeError("Consumer page selection differs from its canonical active revision");
    const current = snapshot(candidate.typeSettings.consumerPage);
    if (composition && runtimeHash(composition) !== runtimeHash(current)) throw new TypeError("Selected route candidates must own the same consumer composition bytes");
    composition = current;
    const entry = current.map.entries.find(row=>row.id === pin.routeId);
    if (!entry || entry.kind !== "page" || entry.path !== localePathFor(slot.route!,input.locale,input.registry.workspace.defaultLocale) || current.publication.context.consumer !== input.registry.workspace.consumerId) throw new TypeError("Consumer route path or workspace differs from its canonical slot");
    const native = consumerPageContentSelection(current,pin.routeId,input.copy), actual = candidate.composition!;
    if (runtimeHash(native.frame) !== runtimeHash(actual.frame) || runtimeHash(native.sections) !== runtimeHash(actual.sections.map(({key,sectionId,configId})=>({key,sectionId,configId})))) throw new TypeError("Canonical candidate frame or Section selection differs from consumer composition");
    identities[pin.routeId] = { ...pin };
  }
  const owned = runtimeSnapshot(composition!);
  const result = data(owned,input.copy);
  if (runtimeHash(result.registry.routes.map(row=>row.routeId).sort()) !== runtimeHash(Object.keys(identities).sort())) throw new TypeError("Every consumer route needs its exact canonical slot and active candidate selection");
  return {composition:owned,identities:runtimeSnapshot(identities),result};
}
const contexts = new WeakMap<object,{input:ConsumerPageContentInput;compositionHash:string;identityHash:string;copy:AdminPageCopy}>();
export type PreparedConsumerPageRegistry = ReturnType<typeof createConsumerPageRegistry> & { readonly identities: Readonly<Record<string,ConsumerPageContentIdentity>> };
function freeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value && typeof value === "object" && !seen.has(value)) { seen.add(value); Object.values(value).forEach(child=>freeze(child,seen)); Object.freeze(value); }
  return value;
}
/** Checked server boundary. Generated native routes consume the composition
 * stored by exact active Publisher revisions; caller-owned alternatives refuse.
 * This is display/assembly identity, not owner approval or release clearance. */
export function prepareConsumerPageRegistry(input: ConsumerPageContentInput): PreparedConsumerPageRegistry {
  const current = selected(input), result = {...current.result,identities:current.identities};
  result.registry = runtimeSnapshot(result.registry); result.map = runtimeSnapshot(result.map);
  contexts.set(result,{input,compositionHash:runtimeHash(current.composition),identityHash:runtimeHash(current.identities),copy:input.copy});
  return freeze(result);
}
/** Revalidate current immutable revision selection before native Designer gates.
 * Source, config, members, renderer and content receipts remain native checks. */
export function prepareConsumerPageRoute(bound: PreparedConsumerPageRegistry, routeId: string, runtime: RegisteredRouteRuntime, renderActions?: RegisteredRouteHeaderActions) {
  const context = contexts.get(bound);
  if (!context || context.input.copy !== context.copy) throw new TypeError("Current checked consumer page selection is required");
  const current = selected(context.input);
  if (runtimeHash(current.composition) !== context.compositionHash || runtimeHash(current.identities) !== context.identityHash || runtimeHash(bound.registry) !== runtimeHash(current.result.registry)) throw new TypeError("Consumer content selection or composition snapshot changed after preparation");
  const pin = current.identities[routeId];
  if (!pin) throw new TypeError("Route is outside the selected content registry");
  const selection = selectContentRoute(context.input.registry,pin.slotId,context.input.locale);
  if (!runtime?.assembly?.engine || selection.candidate.composition!.libraryVersion !== libraryHash(runtime.assembly.engine.library) || runtime.assembly.engine.library.source.id !== context.input.registry.workspace.consumerId) throw new TypeError("Canonical candidate requires the exact current native consumer library");
  return prepareRegisteredRoute(current.result.registry,routeId,runtime,renderActions);
}
