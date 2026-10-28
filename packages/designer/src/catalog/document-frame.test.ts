import { describe, expect, it } from "vitest";
import { loadBuildCatalog } from "../catalog-core/index.js";
import frames from "./slots/frames.json" with { type: "json" };
import placement from "./ia/frames.json" with { type: "json" };

const id = "frames.document";

describe("document frame catalog registration", () => {
  it("registers one permanent document leaf", () => {
    const matches = frames.filter(frame => frame.id === id);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ id, layer: "frames", requires: [], status: "draft" });
    expect(loadBuildCatalog().retiredByLayer.frames?.some(frame => frame.id === id)).toBe(false);
  });

  it("places the document beside site-shell under Page shells > Documents exactly once", () => {
    const homes = placement.nodes.flatMap(group => group.children.flatMap(family =>
      family.leaves.includes(id) ? [{ group: group.id, label: group.label, family: family.id, familyLabel: family.label }] : []));
    expect(homes).toEqual([{ group: "page-shells", label: "Page shells", family: "page-shells-documents", familyLabel: "Documents" }]);
    const documents = placement.nodes.find(group => group.id === "page-shells")?.children.find(family => family.id === "page-shells-documents");
    expect(documents?.leaves).toEqual(["frames.site-shell", id]);
    expect(placement.nodes.flatMap(group => group.children.flatMap(family => family.leaves)).filter(leaf => leaf === id)).toHaveLength(1);
  });

  it("declares the html envelope with three host slots and closed page/status variants", () => {
    expect(frames.find(frame => frame.id === id)?.contract).toEqual({
      kind: "frame",
      root: "html",
      landmarks: [],
      slots: [
        { id: "head", required: true, accepts: "host-node" },
        { id: "critical-css", required: false, accepts: "host-node" },
        { id: "body", required: true, accepts: "host-node" },
      ],
      members: { mode: "closed", names: ["variant.page", "variant.status"] },
      statePorts: [],
      rendering: "server",
      breakpoints: [],
      layers: [],
      allowedReads: { tokens: [], assets: [] },
      composes: ["frames.site-shell", "frames.app-shell", "frames.auth-shell"],
    });
  });

  it("loads the current frame catalog and IA without changing their registration data", () => {
    const catalog = loadBuildCatalog();
    expect(catalog.slots.filter(slot => slot.layer === "frames")).toEqual(frames);
    expect(catalog.placements.find(tree => tree.layer === "frames")).toEqual(placement);
    expect(catalog.slots.filter(slot => slot.id === id)).toHaveLength(1);
  });
});
