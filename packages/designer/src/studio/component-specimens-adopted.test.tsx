import { expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import * as components from "../components/index.js";
import * as charts from "../charts/index.js";
import * as shell from "../shell/index.js";
import { loadBuildCatalog } from "../catalog-core/index.js";
import { loadCatalogBundles } from "../catalog-bundles.js";
import type { CompositeResolved, ResolvedComponent } from "../catalog-core/index.js";
import { componentSpecimenPreview } from "./component-specimens.js";

const hostModules = { "@clossys/designer/components": components, "@clossys/designer/charts": charts, "@clossys/designer/shell": shell };

/** The leaves a consumer reported throwing once it adopted Foundry's component library. */
const reported = ["native-action", "toolbar", "field", "number-field", "table", "grid-list", "tree", "meter", "logo", "chart-bar", "chart-line", "chart-area", "chart-status-strip", "chart-heatmap", "chart-range", "chart-sparkline", "chart-scatter", "chart-waterfall", "semantic-content", "navigation-tree", "resize-handle"].map(name => `components.${name}`);

/**
 * Every Foundry package-implemented leaf as a consumer sees it after adopting: resolve() stamps the consumer's own
 * id on `descriptor.source`, while `origin.source` keeps naming the library the component came from.
 */
function adoptedFoundryLeaves() {
  const slots = new Set(loadBuildCatalog().slots.map(slot => slot.id));
  return loadCatalogBundles().componentFills.flatMap(doc => Object.values(doc.components))
    .filter(fill => fill.source === "foundry" && fill.impl.kind === "package" && slots.has(fill.slot))
    .map(fill => {
      const component = { slot: fill.slot, originKind: "adopted", origin: { kind: "adopted", source: "foundry" }, impl: fill.impl, propMap: fill.propMap, reads: { tokens: {}, assets: [], components: [] }, descriptor: { ...fill, source: "consumer-app" } } as unknown as ResolvedComponent;
      return { leaf: fill.slot, profile: { selectionHash: `selection-${fill.slot}`, components: { components: { [fill.slot]: component } } } as unknown as CompositeResolved };
    });
}

it("server-renders every adopted Foundry leaf from designer samples, though resolve() rewrote descriptor.source", () => {
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const specimens = componentSpecimenPreview({ modules: hostModules });
  const leaves = adoptedFoundryLeaves();
  expect(leaves.map(entry => entry.leaf)).toEqual(expect.arrayContaining(reported));
  const throws: Record<string, string> = {};
  for (const { leaf, profile } of leaves) {
    try { renderToString(<>{specimens.preview(leaf, profile)}</>); }
    catch (error) { throws[leaf] = error instanceof Error ? error.message : String(error); }
  }
  expect(throws).toEqual({});
  errors.mockRestore();
});
