import { createPublisherPlanDraft } from "./plan.js";
import type { PublisherPlanDraft } from "./plan.js";
import type { PublisherPlanVersion } from "./change-set.js";
import type { InstanceRegistries } from "../core/instance-binding.js";
import { projectRouteRegistry } from "../core/route-registry.js";
import type { CompleteRouteRegistration, RouteRegistry } from "../core/route-registry.js";
import { isLegacyRouteRegistration } from "../core/route-identities.js";
import { projectRoutes } from "../content-map/projections.js";

/** Projects the same completeRoute field accepted by PublisherPlanStore.propose/apply.
 * No inferred host paths, bindings or runtime hooks; no lifecycle promotion. */
export function projectPlanCompleteRoutes(plan: PublisherPlanDraft | PublisherPlanVersion, registries: InstanceRegistries, consumer: string): RouteRegistry<CompleteRouteRegistration> {
  if (!consumer.trim()) throw new TypeError("Actual consumer identity required");
  const { digest: _digest, ...draft } = plan as PublisherPlanVersion;
  const checked = createPublisherPlanDraft({ ...draft, status: "draft" }, registries);
  const items = checked.milestones.flatMap(m => m.packs.flatMap(p => p.items)).filter(item => item.completeRoute);
  const first = items[0]?.completeRoute;
  const projected = first ? projectRoutes({ version: 1, publicationId: checked.id, format: "web.page.responsive", entries: items.map((item, order) => ({
    id: item.appRouteId!, order, title: item.completeRoute!.title, path: item.completeRoute!.path, kind: "page", source: { planItemId: item.id },
  })) }, { consumer, channel: "admin", brand: first.brand, planItems: items }) : { version: 1 as const, consumer, routes: [] };
  const routes = projected.routes.map(route => {
    if (isLegacyRouteRegistration(route)) throw new TypeError("Complete plan cannot project a legacy assembly");
    return route;
  });
  const registry = { ...projected, routes };
  if (projectRouteRegistry(registry, checked, registries).findings.length) throw new TypeError("Complete route registry refused");
  return registry;
}
