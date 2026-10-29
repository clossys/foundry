import type { CompleteRouteMetadata } from "../../content-map/complete-route-metadata.js";
export function completeRoutes(): { readonly version: 1; readonly consumer: string; readonly routes: readonly CompleteRouteMetadata[] } {
  return { version: 1, consumer: "example", routes: ["designer", "writer", "publisher"].map(kind => ({
    routeId: `example.${kind}`, planItemId: `app.example.${kind}`, path: `/agents/${kind}`, title: kind[0]!.toUpperCase() + kind.slice(1), channel: "admin",
    brand: { homeRouteId: "example.designer", label: "Example" }, entry: { file: `src/app/agents/${kind}/page.tsx`, export: "default" },
    composition: { complete: { kind: kind as "designer" | "writer" | "publisher" }, loader: { file: `src/data/${kind}.ts`, export: "loadRoute" } },
  })) };
}
