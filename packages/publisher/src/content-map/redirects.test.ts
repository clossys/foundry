import { describe, expect, it } from "vitest";
import { checkContentMap } from "./check.js";
import type { ContentMap } from "./contract.js";
import { projectRedirects } from "./projections.js";
import { checkContentMapRedirects } from "./redirects.js";

function fixture(): ContentMap {
  return {
    version: 1, publicationId: "public-guide", format: "web.page.responsive",
    entries: [
      { id: "home", title: "Home", order: 0, kind: "page", path: "/", source: { planItemId: "home" } },
      { id: "docs", title: "Documentation", order: 1, kind: "external", path: "/docs", href: "https://docs.example.com/start" },
    ],
    redirects: [
      { from: "/old", to: "/", permanent: true },
      { from: "/preview", to: "/?mode=preview#top", permanent: false },
    ],
  };
}

function refused(map: unknown, path: string): void {
  expect(checkContentMap(map)).toEqual(expect.arrayContaining([
    expect.objectContaining({ severity: "P0", code: "redirect", path }),
  ]));
  expect(() => projectRedirects(map as ContentMap)).toThrow(/Content map refused/);
}

describe("content-map redirects", () => {
  it("projects declared redirects and an external entry's permanent local redirect", () => {
    const map = fixture();
    expect(checkContentMap(map)).toEqual([]);
    expect(projectRedirects(map)).toEqual([
      { source: "/docs", destination: "https://docs.example.com/start", permanent: true },
      { source: "/old", destination: "/", permanent: true },
      { source: "/preview", destination: "/?mode=preview#top", permanent: false },
    ]);
  });

  it("accepts safe HTTP(S) destinations without changing their query or fragment", () => {
    const map = { ...fixture(), redirects: [
      { from: "/help", to: "https://example.com/guide?search=hello%20world#start", permanent: false },
      { from: "/status", to: "http://example.com/status", permanent: true },
    ] };
    expect(checkContentMap(map)).toEqual([]);
    expect(projectRedirects(map).find(row => row.source === "/help")?.destination).toBe(map.redirects[0]!.to);
  });

  it("requires an external entry's own explicit canonical local path", () => {
    const map = fixture();
    const external = map.entries[1]!;
    const { path: _path, ...rest } = external;
    const invalid = { ...map, entries: [map.entries[0]!, { ...rest, slug: "docs" }] };
    expect(checkContentMap(invalid)).toEqual(expect.arrayContaining([expect.objectContaining({ severity: "P0", code: "contract" })]));
    expect(() => projectRedirects(invalid as ContentMap)).toThrow(/Content map refused/);
    refused({ ...map, entries: [map.entries[0]!, { ...external, path: "/:docs" }] }, "entries.1.path");
  });

  it("rejects every off-origin redirect source at P0", () => {
    for (const from of ["https://example.com/old", "http://example.com/old", "//example.com/old"]) {
      refused({ ...fixture(), redirects: [{ from, to: "/", permanent: true }] }, "redirects.0.from");
    }
  });

  it("requires canonical literal Next source paths", () => {
    for (const from of ["old", "/old/", "/a//b", "/a/../b", "/a/./b", "/a%2fb", "/a?x=1", "/a#top", "/a\\b", "/a\nb", "/:slug", "/a*", "/a(b)", "/a[slug]", "/a{b}", "/a+b"]) {
      refused({ ...fixture(), redirects: [{ from, to: "/", permanent: true }] }, "redirects.0.from");
    }
  });

  it("refuses unsafe, ambiguous, and header-injecting destinations", () => {
    for (const to of ["javascript:alert(1)", "data:text/html,hello", "mailto:help@example.com", "#top", "//example.com/path", "https:example.com/path", "https://user:pass@example.com/path", "https://example.com/a/../b", "/a//b", "/a/../b", "/a/", "/a%2fb", "/a\\b", "/a\r\nLocation: /bad", "/a?x=%0d%0aLocation:bad", "https://example.com/%0A", "https://example.com/%5cpath", "https://example.com/%zz"]) {
      refused({ ...fixture(), redirects: [{ from: "/old", to, permanent: true }] }, "redirects.0.to");
    }
  });

  it("requires a closed redirect declaration with an explicit boolean permanent", () => {
    for (const redirect of [null, {}, { from: "/old", to: "/" }, { from: "/old", to: "/", permanent: "true" }, { from: "/old", to: "/", permanent: null }, { from: "/old", to: "/", permanent: true, statusCode: 308 }]) {
      refused({ ...fixture(), redirects: [redirect] }, "redirects.0");
    }
    refused({ ...fixture(), redirects: {} }, "redirects");
  });

  it("refuses duplicate sources even when both declarations agree", () => {
    refused({ ...fixture(), redirects: [
      { from: "/old", to: "/", permanent: true },
      { from: "/old", to: "/", permanent: true },
    ] }, "redirects.1.from");
  });

  it("refuses conflicting duplicate sources and external-entry collisions", () => {
    refused({ ...fixture(), redirects: [
      { from: "/old", to: "/", permanent: true },
      { from: "/old", to: "/docs", permanent: false },
    ] }, "redirects.1.from");
    refused({ ...fixture(), redirects: [{ from: "/docs", to: "/", permanent: false }] }, "redirects.0.from");
  });

  it("refuses case-varied duplicate declared sources", () => {
    refused({ ...fixture(), redirects: [
      { from: "/Old", to: "/", permanent: true },
      { from: "/oLD", to: "/docs", permanent: false },
    ] }, "redirects.1.from");
  });

  it("reserves automatic external redirect sources without regard to case", () => {
    refused({ ...fixture(), redirects: [{ from: "/DOCS", to: "/", permanent: false }] }, "redirects.0.from");
    const map = fixture();
    refused({ ...map, entries: [...map.entries,
      { id: "other-docs", title: "Other docs", order: 2, kind: "external", path: "/DOCS", href: "https://example.com/other" },
    ] }, "entries.2.path");
  });

  it("refuses a redirect that shadows an existing page or section", () => {
    refused({ ...fixture(), redirects: [{ from: "/", to: "/docs", permanent: true }] }, "redirects.0.from");
    const map = fixture();
    refused({ ...map, entries: [...map.entries,
      { id: "guide", title: "Guide", order: 2, kind: "page", path: "/guide", source: { planItemId: "guide" } },
      { id: "detail", title: "Detail", order: 0, kind: "section", parentId: "guide", path: "/guide/detail", source: { planItemId: "detail" } },
    ], redirects: [{ from: "/guide/detail", to: "/", permanent: true }] }, "redirects.0.from");
  });

  it("refuses case-varied sources that shadow existing page or section paths", () => {
    const map = fixture();
    const entries: ContentMap["entries"] = [...map.entries,
      { id: "guide", title: "Guide", order: 2, kind: "page", path: "/Guide", source: { planItemId: "guide" } },
      { id: "detail", title: "Detail", order: 0, kind: "section", parentId: "guide", path: "/Guide/Detail", source: { planItemId: "detail" } },
    ];
    for (const from of ["/gUIDE", "/guide/detail"]) {
      refused({ ...map, entries, redirects: [{ from, to: "/", permanent: true }] }, "redirects.0.from");
    }
    refused({ ...map, entries: [...entries,
      { id: "guide-link", title: "Guide link", order: 3, kind: "external", path: "/GUIDE", href: "https://example.com/guide" },
    ] }, "entries.4.path");
    refused({ ...map, entries: [...map.entries,
      { id: "legacy", title: "Legacy", order: 2, kind: "page", slug: "Legacy", source: { planItemId: "legacy" } },
    ], redirects: [{ from: "/LEGACY", to: "/", permanent: true }] }, "redirects.0.from");
  });

  it("refuses direct and indirect cycles, including query and fragment destinations", () => {
    refused({ ...fixture(), redirects: [{ from: "/old", to: "/old", permanent: true }] }, "redirects.0.to");
    refused({ ...fixture(), redirects: [
      { from: "/a", to: "/b?source=old#next", permanent: true },
      { from: "/b", to: "/c", permanent: false },
      { from: "/c", to: "/a#top", permanent: true },
    ] }, "redirects.0.to");
  });

  it("refuses a self-cycle whose destination differs only in case", () => {
    refused({ ...fixture(), redirects: [{ from: "/old", to: "/OLD", permanent: true }] }, "redirects.0.to");
  });

  it("refuses case-varied multistep cycles after removing queries and fragments", () => {
    const map = { ...fixture(), redirects: [
      { from: "/Alpha", to: "/bETA?source=old#next", permanent: true },
      { from: "/Beta", to: "/gAMMA", permanent: false },
      { from: "/Gamma", to: "/aLPHA#top", permanent: true },
    ] };
    for (const index of [0, 1, 2]) refused(map, `redirects.${index}.to`);
  });

  it("accepts acyclic chains through an external entry's local redirect", () => {
    const map = { ...fixture(), redirects: [
      { from: "/older", to: "/old", permanent: true },
      { from: "/old", to: "/docs#start", permanent: true },
    ] };
    expect(checkContentMap(map)).toEqual([]);
    expect(projectRedirects(map)).toHaveLength(3);
  });

  it("preserves original casing while checking acyclic chains through automatic redirects", () => {
    const map: ContentMap = { ...fixture(), entries: [fixture().entries[0]!,
      { id: "docs", title: "Documentation", order: 1, kind: "external", path: "/Docs", href: "https://docs.example.com/Start?mode=Preview#Top" },
    ], redirects: [
      { from: "/Older", to: "/oLD?Source=Archive#Next", permanent: true },
      { from: "/Old", to: "/dOCS#Start", permanent: false },
    ] };
    expect(checkContentMap(map)).toEqual([]);
    expect(projectRedirects(map)).toEqual([
      { source: "/Docs", destination: "https://docs.example.com/Start?mode=Preview#Top", permanent: true },
      { source: "/Old", destination: "/dOCS#Start", permanent: false },
      { source: "/Older", destination: "/oLD?Source=Archive#Next", permanent: true },
    ]);
  });

  it("preserves whole-map refusal checks before projecting redirect output", () => {
    const map = fixture();
    expect(() => projectRedirects({ ...map, entries: [{ ...map.entries[0]!, source: { planItemId: "" } }] })).toThrow(/Content map refused/);
    expect(() => projectRedirects({ ...map, entries: [map.entries[0]!], format: "deck.16x9" })).toThrow(/Web projection/);
  });

  it("is deterministic and does not mutate frozen input or share output objects", () => {
    const map = fixture();
    for (const row of map.entries) Object.freeze(row);
    for (const row of map.redirects ?? []) Object.freeze(row);
    Object.freeze(map.entries); Object.freeze(map.redirects); Object.freeze(map);
    const before = JSON.stringify(map);
    const projected = projectRedirects(map);
    expect(projectRedirects({ ...map, entries: [...map.entries].reverse(), redirects: [...map.redirects!].reverse() })).toEqual(projected);
    expect(projectRedirects(map)).toEqual(projected);
    expect(projectRedirects(map)[0]).not.toBe(projected[0]);
    expect(JSON.stringify(map)).toBe(before);
    expect(checkContentMapRedirects(map)).toEqual([]);
  });

  it("returns no redirects for an omitted or empty declaration", () => {
    const map = fixture();
    expect(projectRedirects({ ...map, entries: [map.entries[0]!], redirects: [] })).toEqual([]);
    const { redirects: _redirects, ...withoutRedirects } = map;
    expect(projectRedirects({ ...withoutRedirects, entries: [map.entries[0]!] })).toEqual([]);
  });
});
