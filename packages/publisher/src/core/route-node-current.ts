import { prepareRuntimeAssembly, resolve, runtimeHash } from "@clossys/designer/catalog";
import type { RuntimeAssemblyBase, RuntimeAssemblyInput, RuntimeRendererDescriptor } from "@clossys/designer/catalog";
import type { PublisherPlanVersion } from "../planning/change-set.js";
import { routeCompositionDigest, routeRegistryDigest } from "./route-registry.js";
import type { RouteRegistration, RouteRegistry } from "./route-registry.js";
import { currentRouteRuntimeMaterialization } from "./route-runtime.js";
import type { RouteRuntimeMaterialization } from "./route-runtime.js";
import { isCurrentRegisteredRouteSourceEvidence } from "./route-source-evidence.js";
import type { RegisteredRouteSourceEvidence } from "./route-source-evidence.js";

const nodeCurrentBrand = Symbol("Node current route transaction");
/** Only the existing Node source operation issues this process-local proof.
 * Serialization carries no authority; it never belongs in a browser projection. */
export interface RegisteredRouteNodeCurrentContext {
  readonly kind: "publisher.node-current-route";
  readonly routeId: string;
  readonly [nodeCurrentBrand]: true;
}
interface RegisteredRouteNodeTransaction { readonly key: string; readonly routeId: string }
const transactions = new WeakSet<RegisteredRouteNodeTransaction>();
const latest = new Map<string, WeakRef<RegisteredRouteNodeTransaction>>();
/** Internal Node preparation begins a new transaction before observing sources.
 * It revokes old context authority even if the new preparation cannot become ready. */
export function beginRegisteredRouteNodeTransaction(scope: string, routeId: string): RegisteredRouteNodeTransaction {
  const key = runtimeHash({ scope, routeId });
  const transaction = Object.freeze({ key, routeId });
  transactions.add(transaction); latest.set(key, new WeakRef(transaction));
  return transaction;
}
const currentTransaction = (transaction: RegisteredRouteNodeTransaction) => transactions.has(transaction) && latest.get(transaction.key)?.deref() === transaction;
interface NodeCurrentInput<Node> {
  readonly transaction: RegisteredRouteNodeTransaction;
  readonly registry: RouteRegistry;
  readonly route: RouteRegistration;
  readonly plan: PublisherPlanVersion;
  readonly source: RegisteredRouteSourceEvidence;
  readonly assembly: RuntimeAssemblyInput<Node>;
  readonly original: Omit<RuntimeAssemblyBase<Node>, "binding" | "pageHeader">;
  readonly materialization?: RouteRuntimeMaterialization;
  readonly query?: { readonly input: object; readonly implementation: RuntimeRendererDescriptor; readonly provider: RuntimeRendererDescriptor };
}
interface Seal {
  readonly digest: string;
  readonly snapshot: string;
  readonly inspect: () => { readonly digest: string; readonly snapshot: string } | undefined;
}
const issued = new WeakMap<RegisteredRouteNodeCurrentContext, Seal>();

function inspect<Node>(input: NodeCurrentInput<Node>) {
  const { registry, route, source, assembly, plan, materialization, query, original } = input;
  if (!currentTransaction(input.transaction) || input.transaction.routeId !== route.routeId) return;
  if (plan.status !== "aligned" || source.planDigest !== plan.digest || !isCurrentRegisteredRouteSourceEvidence(source, registry, route, materialization?.digest)) return;
  if (runtimeHash(source.identity) !== runtimeHash(assembly.identity)) return;
  if (runtimeHash(resolve(original.engine)) !== runtimeHash(resolve(assembly.engine))) return;
  if (registry.routes.filter(row => row.routeId === route.routeId && routeCompositionDigest(row) === routeCompositionDigest(route)).length !== 1) return;
  if (route.composition.binding.body?.source.kind === "derived") {
    if (!query || !currentRouteRuntimeMaterialization(materialization, route.composition.binding, assembly.engine)) return;
    const facts = materialization.facts;
    if (!facts || typeof facts !== "object" || Array.isArray(facts) || !("input" in facts) || !("implementation" in facts) || !("provider" in facts) || runtimeHash(query) !== runtimeHash({ input: facts.input, implementation: facts.implementation, provider: facts.provider })) return;
  } else if (query || materialization) return;
  const prepared = prepareRuntimeAssembly(assembly);
  if (prepared.status !== "ready") return;
  const digest = runtimeHash({ registry: routeRegistryDigest(registry), route: routeCompositionDigest(route), plan, source,
    materialization: materialization?.digest ?? null, query: query ?? null, snapshot: prepared.assembly.snapshot,
    original: { profile: resolve(original.engine), manifest: original.ports.manifest, identity: original.identity, stage: original.stage ?? null,
      stageMeasurements: original.stageMeasurements ?? null, query: original.query ?? null, css: original.css, assets: original.assets,
      themes: original.themes, states: original.states, runner: original.runner ?? null,
      breakpointPixels: original.breakpointPixels ?? null, breakpointBasis: original.breakpointBasis ?? null } });
  return { digest, snapshot: prepared.assembly.snapshot.hash };
}

/** Internal Node orchestration seam, deliberately absent from every public barrel.
 * The caller has already completed the unchanged filesystem/source checker and
 * closed binder. This does not mint source, materialization or runtime evidence. */
export function issueRegisteredRouteNodeCurrent<Node>(input: NodeCurrentInput<Node>): RegisteredRouteNodeCurrentContext {
  const initial = inspect(input);
  if (!initial) throw new Error("Exact Node source/plan/materialization/assembly context unavailable");
  const renderers = Object.entries(input.assembly.ports.renderers), originals = Object.entries(input.original.ports.renderers);
  const resolveContent = input.assembly.ports.resolveContent, originalContent = input.original.ports.resolveContent;
  const frameOrder = input.assembly.ports.frameOrder, stageActions = input.assembly.ports.stageActions;
  const originalFrameOrder = input.original.ports.frameOrder, originalStageActions = input.original.ports.stageActions;
  const originalViewportChange = originalStageActions?.onViewportChange, originalBoardChange = originalStageActions?.onCurrentBoardChange;
  const headerActions = input.assembly.pageHeader?.actions?.render;
  const onViewportChange = stageActions?.onViewportChange, onCurrentBoardChange = stageActions?.onCurrentBoardChange;
  const context: RegisteredRouteNodeCurrentContext = Object.freeze({ kind: "publisher.node-current-route", routeId: input.route.routeId, [nodeCurrentBrand]: true as const });
  nodeReadings.set(context, runtimeHash({ registry: routeRegistryDigest(input.registry), route: routeCompositionDigest(input.route), source: input.source, materialization: input.materialization?.digest ?? null }));
  issued.set(context, { ...initial, inspect: () => {
    try {
      if (input.assembly.ports.resolveContent !== resolveContent || input.original.ports.resolveContent !== originalContent || input.assembly.ports.frameOrder !== frameOrder || input.assembly.ports.stageActions?.onViewportChange !== onViewportChange || input.assembly.ports.stageActions?.onCurrentBoardChange !== onCurrentBoardChange || input.original.ports.frameOrder !== originalFrameOrder || input.original.ports.stageActions?.onViewportChange !== originalViewportChange || input.original.ports.stageActions?.onCurrentBoardChange !== originalBoardChange || input.assembly.pageHeader?.actions?.render !== headerActions) return;
      for (const [id, renderer] of renderers) if (input.assembly.ports.renderers[id] !== renderer) return;
      for (const [id, renderer] of originals) if (input.original.ports.renderers[id] !== renderer) return;
      return inspect(input);
    } catch { return; }
  } });
  return context;
}

/** Repeated reads are deterministic within this Node transaction. Live input
 * mutations invalidate the seal; no shape or retained JSON can recreate it. */
export function registeredRouteNodeCurrentSnapshot(current: RegisteredRouteNodeCurrentContext | undefined, registry: RouteRegistry, route: RouteRegistration, source: RegisteredRouteSourceEvidence, materialization?: RouteRuntimeMaterialization): string | undefined {
  try {
    if (!current || current.routeId !== route.routeId) return;
    const seal = issued.get(current), now = seal?.inspect();
    if (!seal || !now || now.digest !== seal.digest || now.snapshot !== seal.snapshot) return;
    if (!isCurrentRegisteredRouteSourceEvidence(source, registry, route, materialization?.digest ?? source.materialization)) return;
    // Bind the exact registry/route/source/materialization supplied to this read,
    // rather than accepting another authentic transaction's receipt by shape.
    const reading = runtimeHash({ registry: routeRegistryDigest(registry), route: routeCompositionDigest(route), source, materialization: materialization?.digest ?? source.materialization ?? null });
    return reading === nodeReadings.get(current) ? now.snapshot : undefined;
  } catch { return; }
}
const nodeReadings = new WeakMap<RegisteredRouteNodeCurrentContext, string>();
