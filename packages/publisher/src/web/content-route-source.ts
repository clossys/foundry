import { appLocalSpecifier, type AppLocalRouteSourceOptions } from "../app-local/route-options.js";
import { assertContentRouteRegistration } from "./content-route-registration.js";
import type { ContentRouteRegistration } from "./content-route-types.js";

export { resolveContentRouteRequest } from "./content-route-request.js";
export type { ContentRouteRequestInput, ContentRouteRequestResult } from "./content-route-request.js";

export { createContentRouteManifest } from "./content-route-manifest.js";
export type { CreateContentRouteManifestInput } from "./content-route-manifest.js";

function modulePath(from: string, to: string): string {
  const parents = from.split("/"); parents.pop();
  const destination = to.split("/");
  while (parents.length && parents[0] === destination[0]) { parents.shift(); destination.shift(); }
  const relative = [...parents.map(() => ".."), ...destination].join("/");
  return relative.startsWith(".") ? relative : `./${relative}`;
}

/** JSON remains an inert module literal even when Writer text contains script delimiters. */
function moduleJson(value: unknown): string {
  return JSON.stringify(value, null, 2).replace(/</g, "\\u003c").replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

/** Emit the server entry only; the active candidate remains the sole page-body authority. */
export function emitContentRoutePage(route: ContentRouteRegistration, options?: AppLocalRouteSourceOptions): string {
  assertContentRouteRegistration(route);
  return [
    `import { ContentRoutePage, bindContentRoute, requireContentRoutePublishing } from ${JSON.stringify(appLocalSpecifier("@clossys/publisher/web/content-route", options))};`,
    `import type { ContentRouteInput, ContentRouteRegistration } from ${JSON.stringify(appLocalSpecifier("@clossys/publisher/web/content-route", options))};`,
    `import { ${route.loader.export} as loadContentRoute } from ${moduleJson(modulePath(route.source.file, route.loader.file))};`,
    `const route: ContentRouteRegistration = ${moduleJson(route)};`,
    "export default async function ContentPage() {",
    "  const input: ContentRouteInput = await loadContentRoute();",
    "  return <ContentRoutePage input={requireContentRoutePublishing(bindContentRoute(input, route))} />;",
    "}", "",
  ].join("\n");
}
