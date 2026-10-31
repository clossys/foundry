import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { agentGallery, agentLeaf, isLibraryAgent } from "./agent-library.js";
import { proofRouteForSegments } from "../../studio/lib/proof-routes";
import { agentDetailData, agentGalleryLayers, agentLeafHref } from "../../studio/lib/agent-library";

const root = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__/agents-workspace");

describe("agent library templates", () => {
  it("routes every library agent to the shared gallery and detail templates, and 404s the rest", () => {
    for (const agent of ["director", "writer", "publisher"] as const) {
      expect(proofRouteForSegments([agent])).toEqual({ view: "agent-gallery", agent });
      expect(proofRouteForSegments([agent, "site.about"])).toEqual({ view: "agent-leaf", agent, slug: "site.about" });
    }
    expect(proofRouteForSegments(["designer"])).toEqual({ view: "designer-gallery" });
    expect(proofRouteForSegments(["strategist"])).toBeUndefined();
    expect(proofRouteForSegments(["writer", "Bad Slug"])).toBeUndefined();
    expect(proofRouteForSegments(["writer", "a", "b"])).toBeUndefined();
    expect(isLibraryAgent("designer")).toBe(false);
  });

  it("resolves a gallery per agent from its IA, and one leaf each", async () => {
    const writer = (await agentGallery(root, "writer"))!;
    expect(writer.grouping).toBe("ia");
    expect(writer.sections.map(section => section.label)).toEqual(["Site drafts", "Pages"]);
    expect(writer.count).toBe(1);
    const director = (await agentGallery(root, "director"))!;
    expect(director.count).toBe(1);
    expect(director.sections.flatMap(section => section.cards).map(card => card.id)).toEqual(["identity.brand.essence"]);
    const publisher = (await agentGallery(root, "publisher"))!;
    expect(publisher.sections.flatMap(section => section.cards).map(card => card.id)).toEqual(["page.about"]);
    expect(agentGalleryLayers({ state: "ready", ...writer } as never)[0]!.groups[0]!.cards[0]!.href).toBe("/writer/site.about");

    const copy = (await agentLeaf(root, "writer", "site.about"))!;
    expect(copy.card.version).toBe(1);
    expect(copy.specimen.rows.length).toBe(2);
    expect(copy.history.map(row => row.version)).toEqual([2, 1]);
    expect(copy.usedBy.map(ref => ref.slug)).toContain("page.about");
    const page = (await agentLeaf(root, "publisher", "page.about"))!;
    expect(page.specimen.rows.map(row => row.ref)).toEqual([{ label: "sections.hero", agent: "designer", slug: "hero" }].map(ref => expect.objectContaining({ agent: ref.agent })));
    expect(page.specimen.summary).toMatch(/2/);
    const brief = (await agentLeaf(root, "director", "identity.brand.essence"))!;
    expect(brief.usedBy.map(ref => ref.slug)).toContain("site.about");
    expect(agentDetailData(brief).header.galleryHref).toBe("/director");
    expect(agentLeafHref("designer", "hero")).toBe("/designer/hero");
  });

  it("returns undefined (404) for an unknown slug", async () => {
    for (const agent of ["director", "writer", "publisher"] as const) expect(await agentLeaf(root, agent, "missing.leaf")).toBeUndefined();
  });
});
