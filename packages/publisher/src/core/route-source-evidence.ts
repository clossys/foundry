import type { CompositeEngineInput, RuntimeAssemblyIdentity } from "@clossys/designer/catalog";
import { libraryHash, resolve, runtimeHash } from "@clossys/designer/catalog";
import { routeCompositionDigest, routeRegistryDigest } from "./route-registry.js";
import type { RouteRegistration, RouteRegistry } from "./route-registry.js";
import { currentRouteRuntimeMaterialization } from "./route-runtime.js";
import type { RouteRuntimeMaterialization } from "./route-runtime.js";
export interface RegisteredRouteSourceEvidence { readonly routeId: string; readonly registry: `sha256:${string}`; readonly composition: `sha256:${string}`; readonly identity: Extract<RuntimeAssemblyIdentity, { kind: "git" }>; readonly files: Readonly<Record<string, `sha256:${string}`>>; readonly planDigest?: string; readonly materialization?: string; readonly styling?: { readonly profile: string; readonly manifest: string; readonly css: Readonly<Record<string, `sha256:${string}`>> }; }
const verified = new WeakSet<object>();
/** Client re-materializations of a serialized bootstrap. Deliberately a separate set:
 * they satisfy only the live browser route gate, never a Node, lifecycle or bootstrap path. */
const rematerialized = new WeakSet<object>();
export function recordRegisteredRouteSourceEvidence(registry: RouteRegistry, route: RouteRegistration, identity: RegisteredRouteSourceEvidence["identity"], files: RegisteredRouteSourceEvidence["files"], planDigest?: string, styling?: RegisteredRouteSourceEvidence["styling"], materialization?: string): RegisteredRouteSourceEvidence {
  const evidence = Object.freeze({ routeId: route.routeId, registry: routeRegistryDigest(registry), composition: routeCompositionDigest(route), identity, files, ...(planDigest ? { planDigest } : {}), ...(styling ? { styling } : {}), ...(materialization ? { materialization } : {}) });
  verified.add(evidence);
  return evidence;
}
function current(evidence: RegisteredRouteSourceEvidence, registry: RouteRegistry, route: RouteRegistration, materialization?: string): boolean {
  return evidence.materialization === materialization && evidence.registry === routeRegistryDigest(registry) && evidence.routeId === route.routeId && evidence.composition === routeCompositionDigest(route);
}
/** Node-verified only: the checker's own source operation minted this exact object. */
export function isCurrentRegisteredRouteSourceEvidence(evidence: RegisteredRouteSourceEvidence, registry: RouteRegistry, route: RouteRegistration, materialization?: string): boolean {
  return evidence.materialization === materialization && verified.has(evidence) && current(evidence, registry, route, materialization);
}
/** The live browser route gate: Node-verified evidence, or evidence this client minted
 * itself from a checked bootstrap. A plain or copied object is neither. */
export function isCurrentRegisteredRouteLiveSourceEvidence(evidence: RegisteredRouteSourceEvidence, registry: RouteRegistry, route: RouteRegistration, materialization?: string): boolean {
  return !!evidence && (verified.has(evidence) || rematerialized.has(evidence)) && current(evidence, registry, route, materialization);
}

/** Plain JSON data carried from the server page to the client page. It is never
 * evidence itself: the client must re-materialize it through the checked API. */
export interface RegisteredRouteSourceBootstrap {
  readonly kind: "publisher.route-source-bootstrap";
  readonly version: 1;
  /** libraryHash of the engine the Node check selected. */
  readonly library: string;
  readonly source: RegisteredRouteSourceEvidence;
}
const SHA = /^sha256:[a-f0-9]{64}$/, GIT = /^[a-f0-9]{40}$/;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)) && !Object.getOwnPropertySymbols(value).length && Object.values(Object.getOwnPropertyDescriptors(value)).every(descriptor => "value" in descriptor);
const keys = (value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []) => required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const digests = (value: unknown): value is Readonly<Record<string, `sha256:${string}`>> => record(value) && Object.entries(value).every(([key, digest]) => key.length > 0 && typeof digest === "string" && SHA.test(digest));
function deepFreeze<T>(value: T): T { if (value && typeof value === "object") { for (const child of Object.values(value)) deepFreeze(child); Object.freeze(value); } return value; }
/** Server side: a plain JSON copy of current Node-verified evidence, bound to the
 * engine library it was checked against and, for a derived body, to its sealed
 * materialization receipt. Refuses anything the Node check did not mint. */
export function registeredRouteSourceBootstrap(input: { readonly registry: RouteRegistry; readonly route: RouteRegistration; readonly source: RegisteredRouteSourceEvidence; readonly engine: CompositeEngineInput; readonly materialization?: RouteRuntimeMaterialization }): RegisteredRouteSourceBootstrap {
  const { registry, route, source, engine, materialization } = input;
  const derived = route.composition.binding.body?.source.kind === "derived";
  if (derived && !currentRouteRuntimeMaterialization(materialization, route.composition.binding, engine)) throw new Error("Current sealed route materialization required");
  if (!derived && materialization) throw new Error("Static route has no materialization");
  if (!isCurrentRegisteredRouteSourceEvidence(source, registry, route, materialization?.digest)) throw new Error("Current Node-verified route source evidence required");
  if (source.styling && source.styling.profile !== runtimeHash(resolve(engine))) throw new Error("Source evidence styling profile differs from the engine");
  return JSON.parse(JSON.stringify({ kind: "publisher.route-source-bootstrap", version: 1, library: libraryHash(engine.library), source })) as RegisteredRouteSourceBootstrap;
}
export type RegisteredRouteSourceRematerialization = { readonly status: "materialized"; readonly source: RegisteredRouteSourceEvidence } | { readonly status: "pending" | "refused"; readonly findings: readonly string[] };
/** Client side, internal: verify the bootstrap's exact shape, its source match with
 * this registry and route, its library hash against the current engine and its
 * materialization id against a receipt the fixed query just sealed on this client.
 * Only then mint a new frozen evidence identity; the payload object is never minted. */
export function rematerializeRegisteredRouteSourceEvidence(bootstrap: unknown, registry: RouteRegistry, route: RouteRegistration, engine: CompositeEngineInput, materialization: RouteRuntimeMaterialization | undefined): RegisteredRouteSourceRematerialization {
  const refused = (finding: string) => ({ status: "refused" as const, findings: [finding] });
  if (!record(bootstrap) || !keys(bootstrap, ["kind", "version", "library", "source"]) || bootstrap.kind !== "publisher.route-source-bootstrap" || bootstrap.version !== 1 || !text(bootstrap.library)) return refused("Route source bootstrap shape differs");
  const s = bootstrap.source;
  if (!record(s) || !keys(s, ["routeId", "registry", "composition", "identity", "files"], ["planDigest", "materialization", "styling"]) || !text(s.routeId) || !text(s.registry) || !SHA.test(s.registry) || !text(s.composition) || !SHA.test(s.composition) || !digests(s.files)) return refused("Route source bootstrap shape differs");
  const identity = s.identity, styling = s.styling;
  if (!record(identity) || !keys(identity, ["kind", "head", "tree"]) || identity.kind !== "git" || typeof identity.head !== "string" || !GIT.test(identity.head) || typeof identity.tree !== "string" || !GIT.test(identity.tree)) return refused("Route source bootstrap identity differs");
  if ("planDigest" in s && !text(s.planDigest) || "materialization" in s && !text(s.materialization)) return refused("Route source bootstrap shape differs");
  if (styling !== undefined && (!record(styling) || !keys(styling, ["profile", "manifest", "css"]) || !text(styling.profile) || !text(styling.manifest) || !digests(styling.css))) return refused("Route source bootstrap styling differs");
  // Source match: the exact registry, route identity and composition this client renders.
  if (s.routeId !== route.routeId || s.registry !== routeRegistryDigest(registry) || s.composition !== routeCompositionDigest(route)) return refused("Route source bootstrap differs from the registered route");
  // Library: the payload was checked against this exact engine library and profile.
  if (bootstrap.library !== libraryHash(engine.library) || styling && styling.profile !== runtimeHash(resolve(engine))) return refused("Route source bootstrap library differs from the current engine");
  // Materialization id: equal to the receipt the fixed query sealed here, or absent for a static body.
  if (route.composition.binding.body?.source.kind === "derived") {
    if (!currentRouteRuntimeMaterialization(materialization, route.composition.binding, engine)) return refused("Current sealed route materialization required");
    if (s.materialization !== materialization.digest) return { status: "pending", findings: ["Route source bootstrap materialization differs from the current fixed query materialization"] };
  } else if (materialization || "materialization" in s) return refused("Static route source bootstrap cannot carry a materialization");
  const source: RegisteredRouteSourceEvidence = deepFreeze({
    routeId: s.routeId, registry: s.registry as `sha256:${string}`, composition: s.composition as `sha256:${string}`,
    identity: { kind: "git" as const, head: identity.head, tree: identity.tree }, files: { ...s.files },
    ...(text(s.planDigest) ? { planDigest: s.planDigest } : {}),
    ...(styling ? { styling: { profile: styling.profile as string, manifest: styling.manifest as string, css: { ...(styling.css as Record<string, `sha256:${string}`>) } } } : {}),
    ...(text(s.materialization) ? { materialization: s.materialization } : {}),
  });
  rematerialized.add(source);
  return { status: "materialized", source };
}
