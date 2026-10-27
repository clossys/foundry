import type { InstanceBinding, InstanceRegistries } from "../core/instance-binding.js";
import { projectRouteRegistry } from "../core/route-registry.js";
import type { RouteRegistration, RouteRegistry } from "../core/route-registry.js";
import { createPublisherPlanDraft } from "../planning/plan.js";
import type { PublisherPlanDraft } from "../planning/plan.js";
import { PublisherPlanStore } from "../planning/change-set.js";
import type { PublisherPlanChangeSet } from "../planning/change-set.js";
import { emitRegisteredRouteAdapter, emitRegisteredRoutePage, emitRegisteredRouteRegistryModule } from "./registered-route-source.js";
import type { RegisteredRouteCheckInput } from "./registered-route-check.js";
import type { RegisteredRouteRuntime } from "./registered-route-binding.js";

/** Publisher owns the route and output shape. Consumer identities, accepted plan
 * history and live provider data belong to its overlay, never package fixtures. */
export const DESIGNER_ADMIN_ROUTE = Object.freeze({
  path: "/agents/designer", title: "Designer", channel: "admin",
  // Admin chrome: the standard docked shell, a full-bleed Stage and the viewer's system theme.
  frame: { leaf: "frames.app-shell", members: { layout: "standard", stage: "full", theme: "system" } },
  body: { kind: "canvas", source: { kind: "derived", query: { id: "designer.layer-boards", version: 1 } }, arrangement: "lanes" },
  // The JSON control input stays outside the source tree; generated pages import the
  // typed registry module, and every module they import lives under src.
  registryFile: "publisher/routes.json",
  registryModule: "src/publisher/routes.ts",
  entry: { file: "src/app/(console)/agents/designer/page.tsx", export: "default" },
  source: { file: "src/publisher/generated/designer.tsx", export: "default" },
  runtime: { file: "src/publisher/runtime/designer.tsx", export: "useDesignerRegisteredRouteRuntime" },
  header: { id: "admin-designer", data: { title: "Designer" } },
} as const);

/** Deliberately not RouteRegistration: an absent body/runtime cannot be represented
 * by an empty board list, invented fills or a substitute adapter export. */
export interface PlannedDesignerRoute {
  readonly routeId: string;
  readonly planItemId: string;
  readonly path: typeof DESIGNER_ADMIN_ROUTE.path;
  readonly title: typeof DESIGNER_ADMIN_ROUTE.title;
  readonly channel: "admin";
  readonly owner: { readonly packId: string; readonly milestone: string; readonly answerIds: readonly string[] };
  readonly frame: typeof DESIGNER_ADMIN_ROUTE.frame;
  readonly body: typeof DESIGNER_ADMIN_ROUTE.body;
  readonly status: "planned";
}
export interface DesignerRouteRegistrationInput {
  readonly consumer: string;
  readonly routeId: string;
  readonly plan: PublisherPlanDraft;
  readonly registries: InstanceRegistries;
  readonly brand: RouteRegistration["brand"];
  /** Complete canonical query output only. Never infer it from library counts. */
  readonly binding?: InstanceBinding;
  /** Current original navigation/actions are not replaced by a title-only lease. */
  readonly header?: RouteRegistration["composition"]["header"];
  /** Optional consumer-supplied server data loader binding (module and export), as
   * registry data only. Publisher never names or invents a consumer loader. */
  readonly loader?: RouteRegistration["composition"]["loader"];
  /** A genuine existing Node input; no callback mints runtime or acceptance. */
  readonly node?: Omit<RegisteredRouteCheckInput, "plan" | "registries"> & { readonly runtime: RegisteredRouteRuntime };
}
export interface DesignerRouteRegistrationPreparation {
  readonly status: "planned";
  readonly route: PlannedDesignerRoute;
  readonly plan: PublisherPlanDraft;
  readonly proposal: PublisherPlanChangeSet;
  readonly registry?: RouteRegistry;
  readonly nodeInput?: RegisteredRouteCheckInput & { readonly routeId: string; readonly runtime: RegisteredRouteRuntime };
  /** Intended output bytes, not evidence that any consumer file was changed. */
  readonly outputs: readonly { readonly file: string; readonly contents: string }[];
  readonly needs: readonly { readonly field: string; readonly reason: string }[];
}

/** Prepare this real route through the existing plan and registry seams. This
 * function does not apply a plan, capture a provider, write files or promote state.
 * Its incomplete record is useful before executable consumer ports are available. */
export function prepareDesignerRouteRegistration(input: DesignerRouteRegistrationInput): DesignerRouteRegistrationPreparation {
  if (!input.consumer.trim() || !input.routeId.trim()) throw new Error("Actual consumer and unchanged route identity required");
  const plan = createPublisherPlanDraft(input.plan, input.registries);
  const owners = plan.milestones.flatMap(m => m.packs.flatMap(p => p.items.filter(item => item.appRouteId === input.routeId).map(item => ({ item, milestone: m.id, packId: p.id }))));
  if (owners.length !== 1 || owners[0]!.packId !== "pack.app" || owners[0]!.item.lane !== "Studio") throw new Error("Designer must join exactly one existing App Studio plan item");
  const owner = owners[0]!;
  // propose validates the exact immutable draft. Alignment still requires the
  // existing host's explicit durable PublisherPlanStore.apply operation.
  const proposal = new PublisherPlanStore(input.registries).propose(plan);
  const route: PlannedDesignerRoute = {
    routeId: input.routeId, planItemId: owner.item.id,
    path: DESIGNER_ADMIN_ROUTE.path, title: DESIGNER_ADMIN_ROUTE.title, channel: "admin",
    owner: { packId: owner.packId, milestone: owner.milestone, answerIds: owner.item.answerIds },
    frame: DESIGNER_ADMIN_ROUTE.frame, body: DESIGNER_ADMIN_ROUTE.body, status: "planned",
  };
  const needs = [
    { field: "plan.acceptance", reason: "Exact proposal awaits the existing host's durable apply; a draft is not an accepted plan" },
    ...owner.item.openNeeds.map(need => ({ field: need.slot, reason: need.question })),
    { field: "composition.source", reason: `Intended generated export ${DESIGNER_ADMIN_ROUTE.source.file}#default requires actual source closure` },
    { field: "composition.runtime", reason: `Intended export ${DESIGNER_ADMIN_ROUTE.runtime.file}#${DESIGNER_ADMIN_ROUTE.runtime.export} requires the real selected Frame, Section, content, header and Stage ports` },
  ];
  if (owner.item.configuration?.kind === "web") needs.push({ field: "plan.configuration", reason: `Existing Studio proposal still recommends flow Layout ${owner.item.configuration.layout.leaf}/${owner.item.configuration.layout.config}; this does not establish the required Canvas body` });
  let registry: RouteRegistry | undefined;
  let outputs: DesignerRouteRegistrationPreparation["outputs"] = [];
  if (!input.binding) needs.push({ field: "composition.binding", reason: "Original provider projection, checked board records and selected-token-resolved lanes arrangement must produce the canonical body/fills" });
  if (!input.header) needs.push({ field: "composition.header", reason: "Original PageHeaderModule navigation/action lease from the current Studio session is unavailable" });
  if (input.binding) {
    const b = input.binding, members: Readonly<Record<string, string>> = DESIGNER_ADMIN_ROUTE.frame.members;
    // An absent selection keeps the binding's existing projection; a present one must be the admin choice.
    if (b.frame.members !== undefined && (Object.keys(b.frame.members).length !== Object.keys(members).length ||
      Object.entries(members).some(([axis, member]) => !Object.hasOwn(b.frame.members!, axis) || b.frame.members![axis] !== member))) throw new Error("Designer frame member selection must be the admin standard/full/system choice");
    if (b.frame.leaf !== DESIGNER_ADMIN_ROUTE.frame.leaf || b.layout !== undefined || b.body?.kind !== "canvas" || b.body.source.kind !== "derived" || b.body.source.query.id !== "designer.layer-boards" || b.body.source.query.version !== 1 || b.body.arrangement.kind !== "lanes" || b.body.arrangement.groupKey !== "domain") throw new Error("Designer requires its original Canvas/lanes/domain derived query binding without a flow Layout");
  }
  if (input.binding && input.header) {
    if (input.header.id !== DESIGNER_ADMIN_ROUTE.header.id || input.header.data.title !== DESIGNER_ADMIN_ROUTE.title) throw new Error("Original Designer header lease identity/title differs");
    const registration: RouteRegistration = {
      routeId: route.routeId, path: route.path, title: route.title, channel: route.channel,
      brand: input.brand, entry: DESIGNER_ADMIN_ROUTE.entry, planItemId: route.planItemId,
      composition: { binding: input.binding, source: DESIGNER_ADMIN_ROUTE.source, runtime: DESIGNER_ADMIN_ROUTE.runtime, header: input.header, ...(input.loader !== undefined ? { loader: input.loader } : {}) },
    };
    registry = { version: 1, consumer: input.consumer, routes: [registration] };
    const findings = projectRouteRegistry(registry, plan, input.registries).findings;
    if (findings.length) throw new Error(`Designer registration refused: ${findings.map(f => `${f.path}: ${f.message}`).join("; ")}`);
    outputs = [
      { file: DESIGNER_ADMIN_ROUTE.registryFile, contents: `${JSON.stringify(registry, null, 2)}\n` },
      { file: DESIGNER_ADMIN_ROUTE.registryModule, contents: emitRegisteredRouteRegistryModule(registry) },
      { file: DESIGNER_ADMIN_ROUTE.source.file, contents: emitRegisteredRoutePage(DESIGNER_ADMIN_ROUTE.registryModule, registration) },
      { file: DESIGNER_ADMIN_ROUTE.entry.file, contents: emitRegisteredRouteAdapter(registration) },
    ];
  }
  const designer = input.node?.styling?.designer?.[input.routeId];
  if (!designer) needs.push({ field: "styling.designer", reason: "Current original WholeStudioProvider projection/session/Edit/history, checked records, query/provider sources and lanes parameters are unavailable" });
  if (!input.node) needs.push({ field: "node", reason: "Actual engine, selected runtime manifest, complete reached CSS and Node runtime assembly are unavailable" });
  if (input.node && (input.node.contract.registry.file !== DESIGNER_ADMIN_ROUTE.registryFile || input.node.contract.registry.module !== DESIGNER_ADMIN_ROUTE.registryModule || input.node.contract.registry.export !== "default")) throw new Error("Node contract must load the Publisher-owned registry output");
  const nodeInput = registry && input.node ? { ...input.node, plan, registries: input.registries, routeId: input.routeId } : undefined;
  return { status: "planned", route, plan, proposal, ...(registry ? { registry } : {}), ...(nodeInput ? { nodeInput } : {}), outputs, needs };
}
