import type { ContentMap, ContentMapRouteOptions } from "../index.js";
import contentMap from "./content-map.json" with { type: "json" };

/** Synthetic consumer-owned navigation data, not an adoption or route implementation. */
export function adminContentMap(): ContentMap {
  return structuredClone(contentMap) as ContentMap;
}
export function adminRouteOptions(): ContentMapRouteOptions {
  return {
    consumer: "example", channel: "admin", brand: { homeRouteId: "designer", label: "Example" },
    completeRoutes: Object.fromEntries((["designer", "writer", "publisher"] as const).map(kind => [`app.${kind}`, {
      kind, entry: { file: `src/app/agents/${kind}/page.tsx`, export: "default" }, loader: { file: `src/data/${kind}.ts`, export: "loadRoute" },
    }])),
  };
}
