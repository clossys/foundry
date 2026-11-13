import type { ContentMap, ContentMapRouteOptions } from "../contract.js";

/** Generic English-only publication data; no application content or defaults. */
export function publicSiteContentMap(): ContentMap<"web.page.responsive"> {
  return {
    version: 1, publicationId: "example.publication", format: "web.page.responsive",
    entries: [
      { id: "navigation", kind: "group", path: "/navigation", order: 0, title: "Navigation", pin: { nav: true }, source: { planItemId: "navigation" } },
      { id: "home", kind: "page", parentId: "navigation", path: "/", order: 0, title: "Home", pin: { nav: true }, source: { planItemId: "home" } },
      { id: "guide", kind: "page", parentId: "navigation", path: "/guide", order: 1, title: "Guide", pin: { nav: true }, source: { planItemId: "guide" }, lastModified: "2026-10-01T12:30:00+02:00" },
      { id: "preview", kind: "page", parentId: "navigation", path: "/preview", order: 2, title: "Preview", source: { planItemId: "preview" }, indexing: { mode: "noindex", reason: "Preview publication" } },
      { id: "reference", kind: "external", parentId: "navigation", path: "/reference", order: 3, title: "Reference", href: "https://reference.example/guide", pin: { nav: true } },
    ],
    redirects: [{ from: "/previous-guide", to: "/guide", permanent: true }],
  };
}

export function publicSiteRouteOptions(): ContentMapRouteOptions {
  return {
    consumer: "example.publication", channel: "site", brand: { homeRouteId: "home", label: "Example" },
    completeRoutes: Object.fromEntries(["home", "guide", "preview"].map(id => [id, {
      kind: "publisher" as const, entry: { file: `src/pages/${id}.tsx`, export: "default" },
      loader: { file: `src/loaders/${id}.ts`, export: "loadPage" },
    }])),
  };
}
