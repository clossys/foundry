import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { agentGallery, agentLeaf, isLibraryAgent } from "./agent-library.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__/agents-workspace");

describe("agent library templates", () => {
  it("keeps Designer out of the record library", () => {
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
  });

  it("returns undefined (404) for an unknown slug", async () => {
    for (const agent of ["director", "writer", "publisher"] as const) expect(await agentLeaf(root, agent, "missing.leaf")).toBeUndefined();
  });
});
