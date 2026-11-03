/** Test-only consumer stand-in for emitted content routes; never a Publisher production default. */
import { marketingComponentSelection } from "../../../../designer/dist/studio/marketing-component-selection.js";
import type { ContentRouteInput } from "../content-route-types.js";

/** The public Designer entry a stand-in consumer loader imports live. */
export const CONTENT_ROUTE_COMPONENT_MODULE = "@clossys/designer/components";

/**
 * The selection Studio renders frames and sections with, narrowed to leaves implemented by the
 * public components entry: JSON a route loader pairs with that live module namespace.
 */
export function contentRouteComponentSelectionData() {
  const studio = marketingComponentSelection();
  const components = Object.fromEntries(Object.entries(studio.profile.components.components)
    .filter(([, chosen]) => chosen.impl.kind === "package" && chosen.impl.module === CONTENT_ROUTE_COMPONENT_MODULE));
  return {
    profile: { components: { ...studio.profile.components, components, files: [] } },
    selectionHash: studio.selectionHash,
    descriptors: Object.fromEntries(Object.keys(components).map(leaf => [leaf, studio.descriptors[leaf]!])),
  };
}

/** A consumer loader module: raw route data plus the consumer's live component selection. */
export function contentRouteLoaderSource(input: ContentRouteInput, exportName = "loadContentRoute"): string {
  return [
    `import * as selectedComponents from ${JSON.stringify(CONTENT_ROUTE_COMPONENT_MODULE)};`,
    `const selection = ${JSON.stringify(contentRouteComponentSelectionData())};`,
    `export async function ${exportName}() { return { ...${JSON.stringify(input)}, components: { ...selection, modules: { ${JSON.stringify(CONTENT_ROUTE_COMPONENT_MODULE)}: selectedComponents } } }; }`,
    "",
  ].join("\n");
}
