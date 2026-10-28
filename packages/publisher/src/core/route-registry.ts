import { instanceBodyFindings } from "./instance-body.js";
import { registeredRouteLifecycleStatus } from "./route-lifecycle.js";
import type { RegisteredRouteLifecycleEvidence, RegisteredRouteNodeCurrentContext } from "./route-lifecycle.js";
import type { FramePageHeader } from "@clossys/designer/shell";
import type { InstanceBinding, InstanceRegistries } from "./instance-binding.js";
import type { PublisherPlanDraft, PublisherPlanItem } from "../planning/plan.js";
import type { PublisherPlanVersion } from "../planning/change-set.js";
import type { PublisherChannelId } from "../planning/channel-ids.js";
import { PUBLISHER_CHANNELS } from "../planning/channel-ids.js";
import { createPublisherPlanDraft } from "../planning/plan.js";
import { canonicalPlanJson, sha256 } from "../planning/digest.js";
import { completeRouteKind, isLegacyRouteRegistration, registeredRouteBrandLink, routeSourcePath } from "./route-identities.js";
import type { CompleteRouteKind } from "./route-identities.js";
export { COMPLETE_ROUTE_KINDS, completeRouteKind, isCompleteRouteKind, isLegacyRouteRegistration, registeredRouteBrandLink, routeInstanceBinding, routeSourcePath } from "./route-identities.js";
export type { CompleteRouteKind } from "./route-identities.js";

/** Public source identity. Relative to the adopting consumer, never an executable callback. */
export interface RouteSourceExport { readonly file: string; readonly export: string }
export interface LegacyRouteRegistration {
  readonly routeId: string;
  readonly path: string;
  readonly title: string;
  readonly channel: PublisherChannelId;
  /** Home identity references this one registry; href is derived from that row. */
  readonly brand: { readonly homeRouteId: string; readonly label: string };
  readonly entry: RouteSourceExport;
  readonly planItemId: PublisherPlanItem["id"];
  readonly composition: {
    /** The existing Publisher assembly is the only Frame/Section authority. */
    readonly binding: InstanceBinding;
    readonly source: RouteSourceExport;
    /** Narrow host state/library hook; its result contains no page body. */
    readonly runtime: RouteSourceExport;
    readonly header: {
      readonly id: string;
      readonly data: Omit<FramePageHeader, "actions">;
      /** A typed client action implementation; never a page body. */
      readonly actions?: RouteSourceExport;
    };
    /** Optional registered nonvisual provider mounted around the emitted page.
     * Only an identity in ROUTE_PROVIDER_MOUNTS for its exact derived body is valid. */
    readonly provider?: RouteProviderMount;
    /** Optional consumer-registered server data loader. The emitted server page (the
     * route entry) imports exactly this export, awaits it with no arguments and passes
     * its serializable result to the emitted client page. Data only, never a callback. */
    readonly loader?: RouteSourceExport;
  };
}
/** Complete native pages have no fabricated instance binding or runtime hook. */
export interface CompleteRouteRegistration extends Omit<LegacyRouteRegistration, "composition"> {
  readonly composition: {
    readonly complete: { readonly kind: CompleteRouteKind };
    /** Required only when emitting its executable server page. */
    readonly loader?: RouteSourceExport;
  };
}
export type RouteRegistration = LegacyRouteRegistration | CompleteRouteRegistration;
/** Closed set of original providers a registered route may mount. Data only:
 * the checker admits a provider module only as this exact nonvisual mount. */
export const ROUTE_PROVIDER_MOUNTS = {
  "designer.whole-studio": {
    module: "@clossys/designer/studio/state",
    component: "WholeStudioProvider",
    props: ["adapter", "labels", "initialSlotId", "livePreview", "sessionRef", "initialSession"],
    body: { id: "designer.layer-boards", version: 1 },
  },
} as const satisfies Readonly<Record<string, { readonly module: string; readonly component: string; readonly props: readonly string[]; readonly body: { readonly id: string; readonly version: number } }>>;
export type RouteProviderId = keyof typeof ROUTE_PROVIDER_MOUNTS;
export interface RouteProviderMount { readonly id: RouteProviderId; readonly source: RouteSourceExport }
export interface RouteRegistry<R extends RouteRegistration = RouteRegistration> { readonly version: 1; readonly consumer: string; readonly routes: readonly R[] }
export type LegacyRouteRegistry = RouteRegistry<LegacyRouteRegistration>;
export interface RouteRegistryFinding { readonly routeId: string; readonly path: string; readonly message: string }
export interface RegisteredRouteRow {
  readonly registration: RouteRegistration;
  readonly item?: PublisherPlanItem;
  readonly owner?: { readonly packId: string; readonly milestone: string; readonly answerIds: readonly string[] };
  readonly frame?: InstanceBinding["frame"];
  readonly substrate?: NonNullable<InstanceBinding["body"]>["kind"];
  readonly body?: InstanceBinding["body"];
  readonly sections: readonly { readonly path: string; readonly fill: InstanceBinding["fills"][string][number] }[];
  readonly status: "planned" | "built" | "reviewed";
  readonly pending: readonly string[];
  readonly findings: readonly RouteRegistryFinding[];
}
export interface RouteRegistryProjection { readonly rows: readonly RegisteredRouteRow[]; readonly findings: readonly RouteRegistryFinding[] }
const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const only = (v: object, keys: readonly string[]) => Object.keys(v).every(k => keys.includes(k));
function source(v: RouteSourceExport): boolean { return !!v && only(v, ["file", "export"]) && routeSourcePath(v.file) && /^[A-Za-z_$][\w$]*$/.test(v.export); }
/** The registered provider mount, or undefined when absent or invalid for this route. */
export function routeProviderMount(route: LegacyRouteRegistration): (typeof ROUTE_PROVIDER_MOUNTS)[RouteProviderId] | undefined {
  const c = route?.composition, p: unknown = c?.provider;
  if (!p || typeof p !== "object" || Array.isArray(p) || !only(p, ["id", "source"])) return undefined;
  const { id, source: ref } = p as RouteProviderMount;
  if (typeof id !== "string" || !Object.hasOwn(ROUTE_PROVIDER_MOUNTS, id) || !source(ref)) return undefined;
  const mount = ROUTE_PROVIDER_MOUNTS[id], body = c.binding?.body?.source;
  if (body?.kind !== "derived" || body.query?.id !== mount.body.id || body.query.version !== mount.body.version) return undefined;
  // Never the page, adapter, runtime or action module: the provider is its own closed module.
  if ([route.entry?.file, c.source?.file, c.runtime?.file, c.header?.actions?.file].includes(ref.file)) return undefined;
  return mount;
}
/** Next special files are routing/endpoint surfaces, never a registered data loader. */
const NEXT_SPECIAL_FILE = /(?:^|\/)(?:page|layout|template|route|default|loading|error|global-error|not-found|middleware|instrumentation)\.[cm]?[jt]sx?$/;
/** The registered server data loader, or undefined when absent or invalid for this route.
 * It needs a separate default-export entry (the emitted server page) and its own module:
 * never the entry, page, runtime, action or provider module, nor a Next special file. */
export function routeServerLoader(route: LegacyRouteRegistration): RouteSourceExport | undefined {
  const c = route?.composition, loader: unknown = c?.loader;
  if (!loader || typeof loader !== "object" || Array.isArray(loader) || !source(loader as RouteSourceExport)) return undefined;
  const ref = loader as RouteSourceExport;
  // Both fields are required strings here; a missing export is never read as a name.
  if (typeof ref.file !== "string" || typeof ref.export !== "string") return undefined;
  if (!/[^/]\.[cm]?[jt]sx?$/.test(ref.file) || ref.file.endsWith(".d.ts") || NEXT_SPECIAL_FILE.test(ref.file)) return undefined;
  // The entry becomes the emitted JSX server page, so it must be a JSX module.
  if (route.entry?.export !== "default" || typeof route.entry.file !== "string" || !/\.[jt]sx$/.test(route.entry.file) || route.entry.file === c.source?.file) return undefined;
  if ([route.entry.file, c.source?.file, c.runtime?.file, c.header?.actions?.file, c.provider?.source?.file].includes(ref.file)) return undefined;
  return ref;
}
export function routeCompositionDigest(registration: RouteRegistration): `sha256:${string}` {
  return `sha256:${sha256(canonicalPlanJson(registration))}`;
}
/** Every displayed identity is joined from the plan, never copied into a route-owned status record.
 * Static registration establishes no runtime, generated-artifact or review clearance. */
export function projectRouteRegistry(registry: RouteRegistry, plan: PublisherPlanDraft | PublisherPlanVersion | undefined, registries: InstanceRegistries, evidence: Readonly<Record<string, RegisteredRouteLifecycleEvidence>> = {}, currentByRoute: Readonly<Record<string, RegisteredRouteNodeCurrentContext>> = {}): RouteRegistryProjection {
  const findings: RouteRegistryFinding[] = [];
  const add = (routeId: string, path: string, message: string) => findings.push({ routeId, path, message });
  if (!registry || !only(registry, ["version", "consumer", "routes"]) || registry.version !== 1 || !text(registry.consumer) || !Array.isArray(registry.routes)) return { rows: [], findings: [{ routeId: "", path: "registry", message: "A versioned consumer route registry is required" }] };
  let validPlan = false, aligned = false;
  if (plan) {
    try {
      const { digest: _digest, ...draft } = plan as PublisherPlanVersion;
      const normalized = createPublisherPlanDraft({ ...draft, status: "draft" }, registries);
      validPlan = true;
      aligned = plan.status === "aligned" && plan.digest === `sha256:${sha256(canonicalPlanJson(normalized))}`;
      if (plan.status === "aligned" && !aligned) add("", "plan", "Aligned plan digest is stale");
    } catch { add("", "plan", "Publisher plan is invalid"); }
  }
  const owners = validPlan ? plan!.milestones.flatMap(m => m.packs.flatMap(p => p.items.map(item => ({ item, milestone: m.id, packId: p.id })))) : [];
  const ids = new Set<string>(), paths = new Set<string>(), entries = new Set<string>(), bindings = new Set<string>(), headers = new Set<string>();
  const rows = registry.routes.map((route: RouteRegistration) => {
    const at = findings.length;
    try {
      if (!only(route, ["routeId", "path", "title", "channel", "brand", "entry", "planItemId", "composition"]) || !text(route.routeId) || !text(route.title) || !text(route.planItemId) || !PUBLISHER_CHANNELS.some(c => c.id === route.channel)) add(route.routeId, "route", "Unknown route fields or identity/channel");
      if (!registeredRouteBrandLink(registry, route)) add(route.routeId, "brand", "Brand requires one exact registered home route and accessible label");
      if (ids.has(route.routeId)) add(route.routeId, "routeId", "Duplicate route identity"); ids.add(route.routeId);
      if (!/^\/(?:[^/?#\\]+\/?)*$/.test(route.path) || route.path.includes("//") || route.path.split("/").some(p => p === "." || p === "..")) add(route.routeId, "path", "Canonical absolute route path required");
      const normalized = route.path.replace(/\/$/, "") || "/";
      if (route.path !== normalized || route.path.includes("%")) add(route.routeId, "path", "Route path must use its canonical unencoded form");
      if (paths.has(normalized)) add(route.routeId, "path", "Duplicate route path"); paths.add(normalized);
      if (!source(route.entry)) add(route.routeId, "entry", "Consumer-relative entry export required");
      const entry = canonicalPlanJson(route.entry); if (entries.has(entry)) add(route.routeId, "entry", "Duplicate executable entry"); entries.add(entry);
      const matches = owners.filter(row => row.item.id === route.planItemId);
      if (matches.length !== 1 || matches[0]!.item.appRouteId !== route.routeId || owners.filter(row => row.item.appRouteId === route.routeId).length !== 1) add(route.routeId, "planItemId", "Route must join exactly one unchanged plan item/appRouteId");
      const owner = matches.length === 1 ? matches[0] : undefined;
      if (!isLegacyRouteRegistration(route)) {
        const c = route.composition;
        if (!only(c, ["complete", "loader"]) || !completeRouteKind(route)) add(route.routeId, "composition.complete", "Known complete route kind required");
        if (c.loader !== undefined && (!source(c.loader) || c.loader.file === route.entry.file || NEXT_SPECIAL_FILE.test(c.loader.file) || !/\.[jt]sx?$/.test(c.loader.file) || c.loader.file.endsWith(".d.ts"))) add(route.routeId, "composition.loader", "Separate typed complete route data loader required");
        if (owner?.item.completeRoute && (owner.item.completeRoute.kind !== completeRouteKind(route) || owner.item.completeRoute.path !== route.path || owner.item.completeRoute.title !== route.title || canonicalPlanJson(owner.item.completeRoute.entry) !== canonicalPlanJson(route.entry) || canonicalPlanJson(owner.item.completeRoute.brand) !== canonicalPlanJson(route.brand) || canonicalPlanJson(owner.item.completeRoute.loader) !== canonicalPlanJson(c.loader))) add(route.routeId, "composition.complete", "Complete route differs from its plan item");
        return { registration: route, item: owner?.item, owner: owner ? { packId: owner.packId, milestone: owner.milestone, answerIds: owner.item.answerIds } : undefined, sections: [], status: "planned" as const,
          pending: [...(!validPlan ? ["Valid Publisher plan unavailable"] : []), ...(!aligned ? ["Exact plan alignment pending"] : []), ...(owner?.item.openNeeds.map(n => `${n.slot}: ${n.question}`) ?? []), "Complete native page runtime and exact artifact review evidence pending"], findings: findings.slice(at) };
      }
      const c = route.composition, b = c.binding;
      for (const message of instanceBodyFindings(b, registries)) add(route.routeId, "composition.binding.body", message);
      if (!only(c, ["binding", "source", "runtime", "header", "provider", "loader"]) || !source(c.source) || !source(c.runtime)) add(route.routeId, "composition", "Canonical composition source required");
      if ("provider" in c && !routeProviderMount(route)) add(route.routeId, "composition.provider", "Provider must be one registered nonvisual mount for its derived body");
      if ("loader" in c && !routeServerLoader(route)) add(route.routeId, "composition.loader", "Loader must be one consumer server module export, separate from the entry, page, runtime, action and provider modules");
      if (bindings.has(b.instanceId)) add(route.routeId, "composition.binding", "Composition belongs to more than one route"); bindings.add(b.instanceId);
      if (b.path !== route.path || b.context.consumer !== registry.consumer) add(route.routeId, "composition.binding", "Path or consumer differs from the bound instance");
      if (!only(c.header, ["id", "data", "actions"]) || !text(c.header.id) || c.header.data.title !== route.title || !only(c.header.data, ["title", "nav"]) || c.header.actions && !source(c.header.actions)) add(route.routeId, "composition.header", "Header lease identity/title or action source differs");
      const nav = c.header.data.nav;
      if (nav && (!only(nav, ["label", "items", "activeId"]) || !text(nav.label) || !Array.isArray(nav.items) || !nav.items.length || nav.items.some((item: { id: string; label: string; href: string }) => !only(item, ["id", "label", "href"]) || !text(item.id) || !text(item.label) || !text(item.href)) || new Set(nav.items.map((item: { id: string }) => item.id)).size !== nav.items.length || !nav.items.some((item: { id: string; label: string; href: string }) => item.id === nav.activeId))) add(route.routeId, "composition.header.data.nav", "Header navigation must identify one active unique destination");
      if (headers.has(c.header.id)) add(route.routeId, "composition.header.id", "Duplicate header lease identity"); headers.add(c.header.id);
      if (owner && (!b.packIds.includes(owner.packId) || owner.item.frame && (owner.item.frame.leaf !== b.frame.leaf || owner.item.frame.config !== b.frame.config) || owner.item.layout && (owner.item.layout.leaf !== b.layout?.leaf || owner.item.layout.config !== b.layout?.config))) add(route.routeId, "composition.binding", "Binding disagrees with plan owner/frame/layout");
      const sections = [...Object.entries(b.fills).flatMap(([slot, fills]) => fills.map((fill, index) => ({ path: `fills.${slot}.${index}`, fill }))), ...Object.entries(b.frame.slotFills ?? {}).map(([slot, fill]) => ({ path: `frame.slotFills.${slot}`, fill }))];
      const pending = [...(!validPlan ? ["Valid Publisher plan unavailable"] : []), ...(!aligned ? ["Exact plan alignment pending"] : []), ...(owner?.item.openNeeds.map(n => `${n.slot}: ${n.question}`) ?? []), "Exact selected consumer runtime assembly pending", "Deterministic generated entry/source closure pending", "Real Frame/provider and whole-instance runtime evidence pending", "Exact artifact review evidence pending"];
      const artifact = evidence[route.routeId];
      const status = validPlan && aligned && owner && !owner.item.openNeeds.length && findings.length === at && artifact?.source.planDigest === (plan as PublisherPlanVersion)?.digest ? registeredRouteLifecycleStatus(registry, route, artifact, currentByRoute[route.routeId]) : "planned";
      const stillPending = status === "planned" ? pending : status === "built" ? ["Exact artifact review evidence pending"] : [];
      return { registration: route, item: owner?.item, owner: owner ? { packId: owner.packId, milestone: owner.milestone, answerIds: owner.item.answerIds } : undefined, frame: b.frame, substrate: b.body?.kind, body: b.body, sections, status, pending: stillPending, findings: findings.slice(at) };
    } catch { add(route?.routeId ?? "", "composition", "Malformed route composition"); return { registration: route, frame: route && isLegacyRouteRegistration(route) ? route.composition.binding?.frame : undefined, sections: [], status: "planned" as const, pending: ["Valid route composition required"], findings: findings.slice(at) }; }
  });
  return { rows, findings };
}
/** The Admin tab consumes this projection directly; no built-in route identities exist here. */
export function registeredRoutesForChannel(projection: RouteRegistryProjection, channel: PublisherChannelId): readonly RegisteredRouteRow[] { return projection.rows.filter(row => row.registration.channel === channel); }
/** Audience never implies a different Frame leaf. Compare to the exact registered binding. */
export function registeredRouteFrameFinding(projection: RouteRegistryProjection | undefined, routeId: string | undefined, binding: InstanceBinding | undefined): string | undefined {
  const rows = projection?.rows.filter(row => row.registration.routeId === routeId) ?? [];
  if (rows.length !== 1) return "Exact registered route composition is unavailable";
  if (!binding) return "Adopted route binding is unavailable";
  const registered = rows[0]!.registration;
  if (!isLegacyRouteRegistration(registered)) return "Complete native route has no legacy instance binding";
  const expected = registered.composition.binding;
  if (binding.instanceId !== expected.instanceId || binding.path !== expected.path || binding.frame.leaf !== expected.frame.leaf || binding.frame.config !== expected.frame.config) return "Supplied route binding differs from its registered Frame composition";
  if (rows[0]!.findings.length) return "Registered route composition has unresolved findings";
  return undefined;
}

export function routeRegistryDigest(registry: RouteRegistry): `sha256:${string}` { return `sha256:${sha256(canonicalPlanJson(registry))}`; }
