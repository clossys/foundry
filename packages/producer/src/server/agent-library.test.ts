import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { agentGallery, agentLeaf, isLibraryAgent } from "./agent-library.js";
import { agentGalleryLayers, agentLeafInputs, type StudioLinks } from "../../studio/lib/agent-library";
import { resolveStudioRoute, studioHref, studioLeafHref, studioRuntimeMap } from "../../studio/lib/studio-route-map";

const root = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__/agents-workspace");

describe("agent library templates", () => {
  it("routes every agent gallery and its mapped leaves through the Studio map, and 404s the rest", () => {
    const rows = [{ slug: "site.about", title: "About" }, { slug: "Bad Slug", title: "Bad" }];
    const leaves = { director: rows, designer: rows, writer: rows, publisher: rows };
    const map = studioRuntimeMap(leaves);
    for (const agent of ["director", "designer", "writer", "publisher"] as const) {
      expect(resolveStudioRoute(map, leaves, [agent])).toMatchObject({ state: "page", page: { id: agent } });
      expect(resolveStudioRoute(map, leaves, [agent, "site.about"])).toMatchObject({ state: "leaf", slug: "site.about", page: { id: agent } });
      expect(resolveStudioRoute(map, leaves, [agent, "Bad Slug"])).toEqual({ state: "missing" });
    }
    expect(resolveStudioRoute(map, leaves, ["strategist"])).toEqual({ state: "missing" });
    expect(resolveStudioRoute(map, leaves, ["writer", "a", "b"])).toEqual({ state: "missing" });
    expect(resolveStudioRoute(studioRuntimeMap({}), {}, ["writer", "site.about"])).toMatchObject({ state: "pending" });
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
    const map = studioRuntimeMap({ writer: [{ slug: "site.about", title: "About" }], director: [{ slug: "identity.brand.essence", title: "Essence" }] });
    const links: StudioLinks = { gallery: agent => studioHref(map, agent), leaf: (agent, slug) => studioLeafHref(map, agent, slug) };
    expect(agentGalleryLayers({ state: "ready", ...writer } as never, links)[0]!.groups[0]!.sections[0]!.cards[0]!.href).toBe("/writer/site.about");

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
    expect((agentLeafInputs(brief, links).header as { galleryHref: string }).galleryHref).toBe("/director");
    expect(links.leaf("designer", "hero")).toBeUndefined();
  });

  it("returns undefined (404) for an unknown slug", async () => {
    for (const agent of ["director", "writer", "publisher"] as const) expect(await agentLeaf(root, agent, "missing.leaf")).toBeUndefined();
  });
});
