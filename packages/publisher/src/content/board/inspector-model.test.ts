import { describe, expect, it } from "vitest";
import { buildPublisherInspector } from "./inspector-model.js";
import { inspectorFixture } from "../../web/publisher-v2/inspector/__fixtures__/inspector.js";

describe("read-only inspector projection", () => {
  it("joins only the selected slot's candidates, revisions, pinned reviews, locale copy, approval and releases", () => {
    const input = inspectorFixture(), before = structuredClone(input);
    const model = buildPublisherInspector(input);
    expect(model.ready).toBe(true);
    expect(model.candidates.map(row => row.id)).toEqual(["site-main", "site-alternative"]);
    const text = JSON.stringify(model);
    for (const value of ["r1", "r2", "Finish the heading", "Bonjour", "en", "fr", "Approval differs", "example-target"]) expect(text).toContain(value);
    expect(text).not.toContain("Workspace current");
    expect(input).toEqual(before);
  });
  it("reports missing or ambiguous Writer text instead of inventing labels", () => {
    const input = inspectorFixture();
    expect(buildPublisherInspector({ ...input, copy: input.copy.filter(row => row.key !== "inspector.title") }).needs).toContainEqual(expect.objectContaining({ target: "writer", ref: "inspector.title" }));
    expect(buildPublisherInspector({ ...input, copy: [...input.copy, input.copy.find(row => row.key === "inspector.title")!] }).ready).toBe(false);
  });
  it("never treats missing release/review evidence or a stale review as an empty verified result", () => {
    const input = inspectorFixture();
    expect(buildPublisherInspector({ ...input, releases: undefined }).needs).toContainEqual(expect.objectContaining({ ref: "releases" }));
    expect(buildPublisherInspector({ ...input, reviews: input.reviews!.map(row => ({ ...row, digest: "stale" })) }).needs).toContainEqual(expect.objectContaining({ target: "publisher" }));
    expect(buildPublisherInspector({ ...input, slotId: "unknown" }).ready).toBe(false);
  });
});
