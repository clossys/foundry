import { createPublisherPlanDraft } from "./plan.js";
import type { PublisherPlanDraft } from "./plan.js";
import type { PublisherPlanVersion } from "./change-set.js";
import type { InstanceRegistries } from "../core/instance-binding.js";
import { projectRouteRegistry } from "../core/route-registry.js";
import type { CompleteRouteRegistration, RouteRegistry } from "../core/route-registry.js";

/** Projects the same completeRoute field accepted by PublisherPlanStore.propose/apply.
 * No inferred host paths, bindings or runtime hooks; no lifecycle promotion. */
export function projectPlanCompleteRoutes(plan: PublisherPlanDraft | PublisherPlanVersion, registries: InstanceRegistries, consumer: string): RouteRegistry<CompleteRouteRegistration> {
  if (!consumer.trim()) throw new TypeError("Actual consumer identity required");
  const { digest: _digest, ...draft } = plan as PublisherPlanVersion;
  const checked = createPublisherPlanDraft({ ...draft, status: "draft" }, registries);
  const routes: CompleteRouteRegistration[] = checked.milestones.flatMap(m => m.packs.flatMap(p => p.items.flatMap(item => {
    const c = item.completeRoute;
    return c ? [{ routeId: item.appRouteId!, planItemId: item.id, channel: "admin" as const, path: c.path, title: c.title, brand: c.brand, entry: c.entry,
      composition: { complete: { kind: c.kind }, loader: c.loader } }] : [];
  })));
  const registry = { version: 1 as const, consumer, routes };
  if (projectRouteRegistry(registry, checked, registries).findings.length) throw new TypeError("Complete route registry refused");
  return registry;
}
