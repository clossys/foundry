/** Test-only consumer stand-ins for the Publisher page host; never a Publisher production default. */
import { dirname, join } from "node:path";
import { CONTENT_ROUTE_COMPONENT_MODULE, contentRouteComponentSelectionData } from "../../web/__fixtures__/content-route-components.js";

/** A minimal consumer selection module: the fixture frames mount no selected Designer leaf. */
export const fixtureSelection = 'export const componentSelection = { profile: { components: { components: {}, selectionHash: "fixture" } }, selectionHash: "fixture", descriptors: {}, modules: {} };\n';

/** A consumer selection module over the live public Designer components entry: what Designer frames such as SiteFrame mount. */
export function designerSelectionModule(): string {
  return [
    'import type { ConsumerComponentSelection } from "@clossys/designer/frames";',
    `import * as selectedComponents from ${JSON.stringify(CONTENT_ROUTE_COMPONENT_MODULE)};`,
    "// Selection data inlined as JSON loses its literal union types; the value is Designer's own resolved selection.",
    `export const componentSelection = { ...${JSON.stringify(contentRouteComponentSelectionData())}, modules: { ${JSON.stringify(CONTENT_ROUTE_COMPONENT_MODULE)}: selectedComponents } } as unknown as ConsumerComponentSelection;`,
    "",
  ].join("\n");
}

/** Every node_modules folder above this package, so a temp substrate resolves the host's `@clossys/*` imports. */
export function workspaceNodePaths(): string[] {
  const paths: string[] = [];
  for (let dir = import.meta.dirname; dirname(dir) !== dir; dir = dirname(dir)) paths.push(join(dir, "node_modules"));
  return paths;
}
