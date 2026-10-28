import type { ContentMap, ContentMapRouteOptions } from "../index.js";

/** Synthetic consumer-owned navigation data, not an adoption or route implementation. */
export function adminContentMap(): ContentMap {
  return {
    version: 1, publicationId: "example.admin", format: "web.page.responsive",
    entries: [
      { id: "agents", order: 0, title: "Agents", slug: "agents", kind: "group", pin: { nav: true }, source: { planItemId: "app.agents" } },
      ...(["designer", "writer", "publisher"] as const).map((kind, order) => ({
        id: kind, parentId: "agents", order, title: kind[0]!.toUpperCase() + kind.slice(1), path: `/agents/${kind}`, kind: "page" as const,
        pin: { nav: true as const, group: "agents" }, source: { planItemId: `app.${kind}` },
      })),
    ],
    actions: [{ id: "refresh", label: "Refresh records", group: "Records", intent: "records.refresh" }],
  };
}
export function adminRouteOptions(): ContentMapRouteOptions {
  return {
    consumer: "example", channel: "admin", brand: { homeRouteId: "designer", label: "Example" },
    completeRoutes: Object.fromEntries((["designer", "writer", "publisher"] as const).map(kind => [`app.${kind}`, {
      kind, entry: { file: `src/app/agents/${kind}/page.tsx`, export: "default" }, loader: { file: `src/data/${kind}.ts`, export: "loadRoute" },
    }])),
  };
}
