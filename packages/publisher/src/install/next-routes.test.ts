import { describe, expect, it } from "vitest";
import type { ContentMap } from "../content-map/contract.js";
import { NEXT_ROUTE_MARKER, planNextRoutes } from "./next-routes.js";

const source = { frameId: "frames.shell", sectionIds: ["sections.body"] };
const map = {
  version: 1, publicationId: "app", format: "web.page.responsive",
  entries: [
    { id: "home", kind: "page", title: "Home", order: 0, path: "/", source },
    { id: "agents", kind: "group", title: "Agents", order: 1, path: "/agents", source: { planItemId: "app.agents" } },
    { id: "designer", kind: "page", title: "Designer", order: 0, parentId: "agents", path: "/designer", source },
  ],
} as unknown as ContentMap;

describe("planNextRoutes", () => {
  it("installs one marked route per page and a dynamic leaf route fed by the content map's static params", () => {
    const plan = planNextRoutes({
      map, assembly: "../components/Assembly.tsx", live: true,
      leafTemplates: [{ pageId: "designer", param: "slug", leaves: [{ slug: "sections.hero", title: "Hero" }, { slug: "sections.hero", title: "Again" }, { slug: "../x", title: "Bad" }] }],
    });
    expect(plan.files.map(row => [row.file, row.kind, row.route])).toEqual([
      ["page.tsx", "page", "/"],
      ["designer/page.tsx", "page", "/designer"],
      ["designer/[slug]/page.tsx", "leaf", "/designer/[slug]"],
    ]);
    expect(plan.findings.map(row => row.code)).toEqual(["site-contract"]);
    for (const row of plan.files) expect(row.content.split("\n")[0]).toBe(NEXT_ROUTE_MARKER);
    expect(plan.files[0]!.content).toContain('from "../components/Assembly"');
    expect(plan.files[1]!.content).toContain('createElement(PublishedPage, { page: "designer" })');
    const leaf = plan.files[2]!.content;
    expect(leaf).toContain('from "../../../components/Assembly"');
    expect(leaf).toContain('const leaves: { slug: string }[] = [\n  { slug: "sections.hero" },\n];');
    expect(leaf).toContain("export const dynamicParams = true;");
    expect(leaf).toContain('if (!(await publishedLeaf("designer", slug))) notFound();');
  });

  it("a static install serves only its installed leaves", () => {
    const plan = planNextRoutes({ map, assembly: "../a.tsx", leafTemplates: [{ pageId: "designer", param: "slug", leaves: [{ slug: "one", title: "One" }] }] });
    const leaf = plan.files.find(row => row.kind === "leaf")!.content;
    expect(leaf).toContain("export const dynamicParams = false;");
    expect(leaf).toContain("leaves.some(leaf => leaf.slug === slug)");
    expect(leaf).not.toContain("publishedLeaf");
  });

  it("refuses a leaf template for a page the map does not hold", () => {
    const plan = planNextRoutes({ map, assembly: "../a.tsx", leafTemplates: [{ pageId: "writer", param: "slug", leaves: [] }] });
    expect(plan.findings).toEqual([expect.objectContaining({ code: "site-route-missing", slot: "writer" })]);
    expect(plan.files.some(row => row.kind === "leaf")).toBe(false);
  });

  it("refuses a page path that is not a static route segment", () => {
    const bad = { ...map, entries: [...map.entries, { id: "odd", kind: "page", title: "Odd", order: 2, path: "/(group)", source }] } as unknown as ContentMap;
    const plan = planNextRoutes({ map: bad, assembly: "../a.tsx" });
    expect(plan.findings).toEqual(expect.arrayContaining([expect.objectContaining({ code: "site-contract", slot: "odd" })]));
    expect(plan.files.some(row => row.pageId === "odd")).toBe(false);
  });
});
