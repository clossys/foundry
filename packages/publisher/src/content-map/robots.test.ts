import { expect, it } from "vitest";
import type { ContentMap } from "./contract.js";
import { projectRobots } from "./robots.js";

function map(): ContentMap {
  return { version: 1, publicationId: "example.site", format: "web.page.responsive", entries: [
    { id: "home", kind: "page", path: "/", order: 0, title: "Home", source: { planItemId: "home" } },
    { id: "guide", kind: "page", path: "/guide", order: 1, title: "Guide", source: { planItemId: "guide" } },
    { id: "detail", kind: "section", parentId: "guide", path: "/guide/detail", order: 0, title: "Detail", source: { planItemId: "guide" } },
  ] };
}

it("projects map page crawl targets and the canonical-origin sitemap", () => {
  expect(projectRobots(map(), { origin: "https://example.test", crawl: "allow" })).toEqual({
    rules: { userAgent: "*", allow: ["/", "/guide"], disallow: [] }, sitemap: "https://example.test/sitemap.xml",
  });
});

it("blocks all crawling only when explicitly requested", () => {
  expect(projectRobots(map(), { origin: "https://example.test", crawl: "disallow" })).toEqual({
    rules: { userAgent: "*", allow: [], disallow: ["/"] }, sitemap: "https://example.test/sitemap.xml",
  });
});

it("keeps noindex pages crawlable and excludes external destinations from local crawl rules", () => {
  const publication = map();
  const entries: ContentMap["entries"] = [
    ...publication.entries.map(entry => entry.id === "guide" ? { ...entry, indexing: { mode: "noindex" as const } } : entry),
    { id: "reference", kind: "external", path: "/reference", order: 2, title: "Reference", href: "https://reference.example.test/guide" },
  ];
  expect(projectRobots({ ...publication, entries }, { origin: "https://example.test", crawl: "allow" })).toEqual({
    rules: { userAgent: "*", allow: ["/", "/guide"], disallow: [] }, sitemap: "https://example.test/sitemap.xml",
  });
});

it("rejects unknown or omitted crawl permission", () => {
  for (const crawl of [undefined, "production", "", true]) {
    expect(() => projectRobots(map(), { origin: "https://example.test", crawl } as Parameters<typeof projectRobots>[1])).toThrow(/crawl/i);
  }
});

it.each([
  "https://example.test/path",
  "https://example.test?query", "https://example.test#fragment", "https://user:password@example.test",
  "javascript:origin", "//example.test", " https://example.test", "https://example.test\n",
])("refuses an unsafe site origin or a URL beyond its origin %j", origin => {
  expect(() => projectRobots(map(), { origin, crawl: "allow" })).toThrow();
});

it("canonicalizes accepted origin spellings using the shared sitemap origin guard", () => {
  for (const origin of ["https://example.test/", "https://EXAMPLE.test", "https://example.test:443"]) {
    expect(projectRobots(map(), { origin, crawl: "allow" }).sitemap).toBe("https://example.test/sitemap.xml");
  }
});

it("refuses malformed maps and nonweb publications in either crawl mode", () => {
  const invalid = { ...map(), entries: [...map().entries, map().entries[0]!] };
  const deck = { ...map(), format: "deck.16x9" } as ContentMap;
  for (const crawl of ["allow", "disallow"] as const) {
    expect(() => projectRobots(invalid, { origin: "https://example.test", crawl })).toThrow(/map/i);
    expect(() => projectRobots(deck, { origin: "https://example.test", crawl })).toThrow(/web/i);
  }
});

it("orders crawl paths by map hierarchy without mutating map or sharing output arrays", () => {
  const original = map(), before = JSON.stringify(original);
  const options = { origin: "https://example.test", crawl: "allow" as const };
  const first = projectRobots(original, options);
  expect(projectRobots({ ...original, entries: [...original.entries].reverse() }, options)).toEqual(first);
  first.rules.allow.push("/changed");
  expect(projectRobots(original, options).rules.allow).toEqual(["/", "/guide"]);
  expect(JSON.stringify(original)).toBe(before);
});

it("serializes literal page path metacharacters without turning them into robots patterns", () => {
  const publication = map();
  const entries = publication.entries.filter(entry => entry.kind === "page").map(entry => ({ ...entry, path: entry.id === "home" ? "/literal*" : "/literal$" }));
  expect(projectRobots({ ...publication, entries }, { origin: "https://example.test", crawl: "allow" }).rules.allow).toEqual(["/literal%2A", "/literal%24"]);
});
