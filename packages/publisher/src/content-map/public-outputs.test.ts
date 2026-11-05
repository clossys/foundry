import { expect, it } from "vitest";
import * as contentMap from "./index.js";
import { publicSiteContentMap, publicSiteRouteOptions } from "./__fixtures__/public-site.js";

it("accepts one public map containing source-free external destinations, indexing and redirects", () => {
  expect(contentMap.checkContentMap(publicSiteContentMap())).toEqual([]);
});

it("projects only indexable local pages with deterministic consumer modification dates", () => {
  expect(contentMap.projectSitemap(publicSiteContentMap(), { channel: "site", origin: "https://example.com" })).toEqual([
    { url: "https://example.com/" },
    { url: "https://example.com/guide", lastModified: "2026-10-01T10:30:00.000Z" },
  ]);
});

it("routes noindex pages and never registers an external destination", () => {
  expect(contentMap.projectRoutes(publicSiteContentMap(), publicSiteRouteOptions()).routes.map(row => row.routeId)).toEqual(["home", "guide", "preview"]);
});

it("uses the same local page inventory for static params, without excluding noindex pages", () => {
  expect(contentMap.projectStaticParams(publicSiteContentMap())).toEqual([{ slug: [] }, { slug: ["guide"] }, { slug: ["preview"] }]);
});

it("surfaces an external navigation href and leaves structural groups without links", () => {
  const nav = contentMap.projectNavigation(publicSiteContentMap(), "home");
  expect(nav.tree[0]).not.toHaveProperty("href");
  expect(nav.tree[0]!.children).toContainEqual({ id: "reference", label: "Reference", href: "https://reference.example/guide", external: true });
  expect(() => contentMap.projectNavigation(publicSiteContentMap(), "reference")).toThrow(/active entry/);
  expect(contentMap.projectCommands(publicSiteContentMap())[0]!.items).toContainEqual({ id: "reference", label: "Reference", href: "https://reference.example/guide" });
  expect(contentMap.projectBreadcrumbs(publicSiteContentMap(), "reference").at(-1)?.href).toBe("https://reference.example/guide");
  expect(contentMap.projectOutline(publicSiteContentMap())[0]!.children?.at(-1)?.href).toBe("https://reference.example/guide");
});

it("projects all public protocols from one map without mutating or depending on input order", () => {
  const map = publicSiteContentMap(), before = JSON.stringify(map);
  const reversed = { ...map, entries: [...map.entries].reverse(), redirects: [...map.redirects!].reverse() };
  const project = (value: typeof map) => ({
    routes: contentMap.projectRoutes(value, publicSiteRouteOptions()),
    sitemap: contentMap.projectSitemap(value, { channel: "site", origin: "https://example.com" }),
    params: contentMap.projectStaticParams(value),
    redirects: contentMap.projectRedirects(value),
    robots: contentMap.projectRobots(value, { origin: "https://example.com", crawl: "allow" }),
  });
  expect(project(map)).toEqual(project(reversed));
  expect(contentMap.projectRedirects(map)).toEqual([
    { source: "/previous-guide", destination: "/guide", permanent: true },
    { source: "/reference", destination: "https://reference.example/guide", permanent: true },
  ]);
  expect(contentMap.buildSecurityTxt({ contact: "mailto:security@example.com", expires: "2027-10-01T00:00:00Z" })).toBe("Contact: mailto:security@example.com\nExpires: 2027-10-01T00:00:00Z\n");
  expect(JSON.stringify(map)).toBe(before);
});

it.each([
  ["external source", (map: any) => { map.entries[4].source = { planItemId: "reference" }; }],
  ["external page config", (map: any) => { map.entries[4].pageConfig = "reference"; }],
  ["external executable URL", (map: any) => { map.entries[4].href = "javascript:alert(1)"; }],
  ["external credentials", (map: any) => { map.entries[4].href = "https://user:pass@example.com/"; }],
  ["external nonlocal path", (map: any) => { map.entries[4].path = "//example.com/reference"; }],
  ["indexing mode", (map: any) => { map.entries[2].indexing = { mode: "hidden" }; }],
  ["indexing reason", (map: any) => { map.entries[2].indexing = { mode: "index", reason: " " }; }],
  ["indexing extra field", (map: any) => { map.entries[2].indexing = { mode: "index", enabled: true }; }],
  ["rollover date", (map: any) => { map.entries[2].lastModified = "2026-02-30"; }],
  ["unzoned time", (map: any) => { map.entries[2].lastModified = "2026-10-01T12:00:00"; }],
  ["implicit clock", (map: any) => { map.entries[2].lastModified = "now"; }],
] as const)("refuses invalid %s before projecting any public output", (_name, mutate) => {
  const map = publicSiteContentMap(); mutate(map);
  expect(contentMap.checkContentMap(map)).toContainEqual(expect.objectContaining({ severity: "P0" }));
  expect(() => contentMap.projectSitemap(map, { channel: "site", origin: "https://example.com" })).toThrow();
  expect(() => contentMap.projectStaticParams(map)).toThrow();
  expect(() => contentMap.projectRedirects(map)).toThrow();
});

it("omits absent modification metadata and normalizes explicit calendar dates", () => {
  const map = publicSiteContentMap();
  (map.entries[2] as any).lastModified = "2024-02-29";
  expect(contentMap.projectSitemap(map, { channel: "site", origin: "https://EXAMPLE.com:443/" })).toEqual([
    { url: "https://example.com/" }, { url: "https://example.com/guide", lastModified: "2024-02-29T00:00:00.000Z" },
  ]);
});
