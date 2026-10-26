import { alignedPlanItems } from "../../../planning/change-set.js";
import type { PublisherPlanVersion } from "../../../planning/change-set.js";
import type { AppInventory } from "./inventory.js";
/** App uses its own inventory refs; a website plan never enrolls App routes implicitly. */
export function projectPlanAppInventory(plan: PublisherPlanVersion | undefined, inventory?: AppInventory): AppInventory | undefined {
  if (!inventory) return undefined;
  const items = alignedPlanItems(plan).filter(row => row.packId === "pack.app").map(row => row.item);
  const pageIds = new Set(inventory.routes.filter(route => route.kind !== "detail-tab" && items.some(item => item.appRouteId === route.id && item.lane === route.lane)).map(route => route.id));
  // A page enrolls its content/check subrows; a subrow reference cannot enroll a page.
  const routes = inventory.routes.filter(route => pageIds.has(route.parentRecordRoute ?? route.id));
  return { ...inventory, routes, missingDecisions: inventory.missingDecisions?.filter(row => items.some(item => item.appRouteId === row.id && item.lane === row.lane)), nonAddressableTabs: inventory.nonAddressableTabs.filter(row => routes.some(route => route.id === row.hostRouteId)) };
}
