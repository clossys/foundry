import { DEFAULT_COMPONENT_PICKS, loadCatalog, loadComponentCompositionRules, loadComponentRegistry, type BuildCatalogData } from "../catalog-core/index.js";
import { loadCatalogBundles } from "../catalog-bundles.js";
import { sourceRoster } from "../catalog-core/token-contract.js";
import { foundrySurfaceCatalog } from "./surface-catalog.js";

/** Explicit source decisions take precedence over roster availability. */
const sourceDecisions: Readonly<Record<string, string | undefined>> = {
  "components.rich-text": "shadcn@aria",
  "components.semantic-content": "foundry",
  // H3-A01..A12: asset policy is independent of candidate availability.
  "assets.backdrop-graphic": "foundry",
  "assets.icon-check": "lucide",
  "assets.icon-chevron-down": "lucide",
  "assets.icon-chevron-left": "lucide",
  "assets.icon-chevron-right": "lucide",
  "assets.icon-chevron-up": "lucide",
  "assets.icon-close": "lucide",
  "assets.icon-date": "lucide",
  "assets.icon-search": "lucide",
  // Constructor engines, not permission to adopt identity rule templates as seeds.
  "assets.lockup": "foundry",
  "assets.mark": "foundry",
  // Required policy does not waive Video A1's native construction evidence.
  "assets.video": "foundry",
};

/** The native candidate inventory shared by the CLI, cell compiler and catalog checks. */
export function loadNativeCompositeCatalog(values = loadCatalog()) {
  return {
    values,
    components: {
      slots: loadComponentRegistry().slots,
      fills: loadCatalogBundles().componentFills,
      rules: loadComponentCompositionRules(),
    },
    surfaces: foundrySurfaceCatalog(),
  };
}

/**
 * Tokens use the explicitly requested default source. Other layers retain only
 * unambiguous existing native policy. Availability never chooses a source;
 * multiple offers and unregistered slots remain undefined.
 */
export function loadNativeDefaultSources(build: Pick<BuildCatalogData, "slots">): Readonly<Record<string, string | undefined>> {
  const result: Record<string, string | undefined> = {};
  for (const slot of build.slots) {
    if (Object.hasOwn(sourceDecisions, slot.id)) { result[slot.id] = sourceDecisions[slot.id]; continue; }
    if (slot.layer === "tokens") {
      result[slot.id] = "shadcn@aria";
      continue;
    }
    const explicit = DEFAULT_COMPONENT_PICKS[slot.id];
    if (slot.layer === "components" && explicit) { result[slot.id] = explicit; continue; }
    const rows = sourceRoster[slot.layer];
    const sources = [...new Set(rows.filter(row => row.leaves.includes(slot.id)).flatMap(row => row.offers.filter(offer => offer.leaves.includes(slot.id)).map(offer => offer.source)))];
    result[slot.id] = sources.length === 1 ? sources[0] : undefined;
  }
  return result;
}
