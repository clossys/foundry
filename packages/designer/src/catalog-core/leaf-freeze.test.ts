import { describe, expect, it, vi } from "vitest";
import tokenIA from "../catalog/ia/themes.json" with { type: "json" };
import assetIA from "../catalog/ia/assets.json" with { type: "json" };
import componentIA from "../catalog/ia/components.json" with { type: "json" };
import tokenSlots from "../catalog/slots/themes.json" with { type: "json" };
import assetSlots from "../catalog/slots/assets.json" with { type: "json" };
import componentSlots from "../catalog/slots/components.json" with { type: "json" };
import tokenFreeze from "../catalog/ia/themes.leaf-freeze.json" with { type: "json" };
import assetFreeze from "../catalog/ia/assets.leaf-freeze.json" with { type: "json" };
import componentAmendments from "../catalog/ia/components.leaf-amendments.json" with { type: "json" };
import draftAssetAmendments from "../catalog/ia/assets.draft-leaf-amendments.json" with { type: "json" };
import assetAmendments from "../catalog/ia/assets.leaf-amendments.json" with { type: "json" };
import componentFreeze from "../catalog/ia/components.leaf-freeze.json" with { type: "json" };
import themesMigration from "../catalog/ia/themes.id-migration.json" with { type: "json" };
import { sha256 } from "./digest.js";
import { checkFrozenLeafSets, assertFrozenLeafSets, type FrozenLeafLayer } from "./leaf-freeze.js";
import { loadBuildCatalog, loadCatalog, loadComponentRegistry, type Placement } from "./index.js";

const fixtures = [
  { layer: "themes", ia: tokenIA, slots: tokenSlots, freeze: tokenFreeze, count: 42, digest: "cdea2088f1a37a10eb1754051174dde81bbe6ecea73235035ad30148ca6d86f1" },
  { layer: "assets", ia: assetIA, slots: assetSlots, freeze: assetFreeze, count: 45, digest: "dc3c75b4dee91fb500da9548a147fa0bf530215764b58df7a9ec12b2a966ae54" },
  { layer: "components", ia: componentIA, slots: componentSlots, freeze: componentFreeze, count: 57, digest: "ec9ed90570c757ff9891e5d04bded6339c26e87165a43fbdc4024607410c1185" },
] as const;

describe("owner-signed leaf membership", () => {
  for (const fixture of fixtures) {
    const { layer } = fixture;
    const placement = fixture.ia as Placement;
    const input = () => ({ ia: structuredClone(placement), slots: structuredClone(fixture.slots) });
    it(`${layer}: records the independently measured signed IDs and signoff`, () => {
      expect(fixture.freeze).toMatchObject({ schemaVersion: 1, layer, scope: "leaf-membership-only" });
      if (layer === "themes") expect(tokenFreeze.approval).toMatch(/tokens-to-themes migration/);
      else expect(fixture.freeze).toMatchObject({ signedHead: "581e4fd70589fe072d9ce38fa159306d473c1754", placementProofHead: "2dfa7722ff726aef0f10ff2391054c9554e4bc86", ownerSignoffComment: "6380345814" });
      expect(fixture.freeze.leafIds).toHaveLength(fixture.count);
      expect(sha256([...fixture.freeze.leafIds].sort().join("\n"))).toBe(fixture.digest);
      expect(checkFrozenLeafSets([placement], fixture.slots, [layer])).toEqual([]);
    });
    for (const source of ["slots", "ia"] as const) for (const mutation of ["add", "remove", "rename"] as const) {
      it(`${layer}: rejects ${source} ${mutation}, including same-count renames`, () => {
        const value = input();
        if (source === "slots") {
          if (mutation === "add") value.slots.push({ ...value.slots[0]!, id: `${layer}.unsigned` } as never);
          else if (mutation === "remove") value.slots.splice(0, 1);
          else value.slots[0]!.id = `${layer}.renamed`;
        } else {
          const family = value.ia.nodes.flatMap(node => "children" in node ? node.children : []).find(node => "leaves" in node && node.leaves.length > 1)!;
          if (!("leaves" in family)) throw new Error("expected family");
          family.leaves = mutation === "add" ? [...family.leaves, `${layer}.unsigned`] : mutation === "remove" ? family.leaves.slice(1) : [`${layer}.renamed`, ...family.leaves.slice(1)];
        }
        const findings = checkFrozenLeafSets([value.ia], value.slots, [layer]);
        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatchObject({ code: "LEAF_FREEZE", source, layer });
        expect(findings[0]!.missing.length + findings[0]!.unexpected.length).toBe(mutation === "rename" ? 2 : 1);
        expect(() => assertFrozenLeafSets([value.ia], value.slots, [layer])).toThrow("LEAF_FREEZE");
      });
    }
    it(`${layer}: still rejects coordinated source edits that preserve slot/IA agreement`, () => {
      const value = input();
      value.slots[0]!.id = `${layer}.renamed`;
      const original = fixture.slots[0]!.id;
      for (const group of value.ia.nodes) if ("children" in group) for (const family of group.children) if ("leaves" in family) family.leaves = family.leaves.map(id => id === original ? `${layer}.renamed` : id);
      expect(checkFrozenLeafSets([value.ia], value.slots, [layer]).map(finding => finding.source)).toEqual(["slots", "ia"]);
    });
    it(`${layer}: allows regrouping, reordering, labels and metadata changes`, () => {
      const value = input();
      const ids = fixture.layer === "components" ? [...fixture.freeze.leafIds, ...componentAmendments.addedLeafIds] : fixture.layer === "assets" ? [...fixture.freeze.leafIds, ...assetAmendments.addedLeafIds, ...draftAssetAmendments.addedLeafIds] : [...fixture.freeze.leafIds];
      value.ia.nodes = [{ id: "new-domain", label: "New domain", children: [{ id: "new-family", label: "New family", leaves: [...ids].reverse() }] }];
      value.slots.reverse();
      Object.assign(value.slots[0]!, { description: "Metadata remains separate" });
      expect(checkFrozenLeafSets([value.ia], value.slots, [layer])).toEqual([]);
    });
    for (const mutation of ["add", "remove", "rename"] as const) it(`${layer}: loaders refuse coordinated source ${mutation} and restore exactly`, () => {
      const beforeSlots = structuredClone(fixture.slots);
      const beforeIA = structuredClone(fixture.ia);
      try {
        const family = fixture.ia.nodes.flatMap(group => group.children).find(node => node.leaves.length > 1)!;
        const original = family.leaves[0]!;
        const slotIndex = fixture.slots.findIndex(slot => slot.id === original);
        if (mutation === "add") {
          fixture.slots.push({ ...fixture.slots[slotIndex]!, id: `${layer}.unsigned` } as never);
          family.leaves.push(`${layer}.unsigned`);
        } else if (mutation === "remove") {
          fixture.slots.splice(slotIndex, 1);
          family.leaves.splice(0, 1);
        } else {
          fixture.slots[slotIndex]!.id = `${layer}.renamed`;
          family.leaves[0] = `${layer}.renamed`;
        }
        expect(() => loadBuildCatalog()).toThrow("LEAF_FREEZE");
        if (layer === "components") expect(() => loadComponentRegistry()).toThrow("LEAF_FREEZE");
        else expect(() => loadCatalog()).toThrow("LEAF_FREEZE");
      } finally {
        fixture.slots.splice(0, fixture.slots.length, ...beforeSlots as never[]);
        Object.assign(fixture.ia, beforeIA);
      }
      expect(fixture.slots).toEqual(beforeSlots);
      expect(fixture.ia).toEqual(beforeIA);
      expect(loadBuildCatalog().slots).toHaveLength(233);
    });
  }

  it("requires explicitly offered layers even when both inputs omit one entirely", () => {
    expect(checkFrozenLeafSets([], [], ["components"])).toEqual([
      expect.objectContaining({ layer: "components", source: "slots", missing: [...componentFreeze.leafIds, ...componentAmendments.addedLeafIds].sort() }),
      expect.objectContaining({ layer: "components", source: "ia", missing: [...componentFreeze.leafIds, ...componentAmendments.addedLeafIds].sort() }),
    ]);
  });
  it("keeps Sections/Frames unsigned and build readiness unchanged", () => {
    const build = loadBuildCatalog();
    const layers: FrozenLeafLayer[] = ["themes", "assets", "components"];
    expect(build.registryStatus).toBe("build-unfrozen");
    expect(checkFrozenLeafSets(build.placements, build.slots, layers)).toEqual([]);
    const altered = build.slots.map(slot => slot.layer === "sections" || slot.layer === "frames" ? { ...slot, id: `${slot.layer}.still-unsigned` } : slot);
    expect(checkFrozenLeafSets(build.placements, altered, layers)).toEqual([]);
  });
});


describe("owner-signed Media leaf amendment", () => {
  const added = ["assets.image", "assets.pattern", "assets.video"];
  it("adds exactly image, video and pattern to the unchanged 45 signed IDs: 48 leaves, 0 removals", () => {
    const { pending, ...signedAmendment } = assetAmendments;
    expect(signedAmendment).toEqual({ schemaVersion: 1, layer: "assets", baseSignedHead: assetFreeze.signedHead, status: "owner-signed", ownerSignoffComment: "6408363557", receiptComment: "6404876885", addedLeafIds: added });
    expect(pending).toEqual({ status: "pending-owner-ratification", source: "workspace#45 A131/A132 AUTO-DECIDED 2026-10-28", memberChanges: [{ id: "assets.pattern", addedMembers: ["grain", "noise", "topo"] }] });
    expect(assetFreeze.leafIds).toHaveLength(45);
    expect(sha256([...assetFreeze.leafIds].sort().join("\n"))).toBe("dc3c75b4dee91fb500da9548a147fa0bf530215764b58df7a9ec12b2a966ae54");
    const ids = assetSlots.map(slot => slot.id).filter(id => !draftAssetAmendments.addedLeafIds.includes(id)).sort();
    expect(ids).toHaveLength(48);
    expect(sha256(ids.join("\n"))).toBe("413698a4fe2af41b64f02e23353ba29760397c06ed54c94f790a3ce93cf9fdda");
    expect(assetFreeze.leafIds.filter(id => !ids.includes(id))).toEqual([]);
    expect(ids.filter(id => !assetFreeze.leafIds.includes(id))).toEqual(added);
    expect(checkFrozenLeafSets([assetIA as Placement], assetSlots, ["assets"])).toEqual([]);
  });
  it("refuses a fourth unsigned Media leaf and a missing signed addition", () => {
    const slots = structuredClone(assetSlots);
    slots.push({ ...slots[0]!, id: "assets.audio" });
    expect(checkFrozenLeafSets([assetIA as Placement], slots, ["assets"])).toEqual([expect.objectContaining({ source: "slots", unexpected: ["assets.audio"], missing: [] })]);
    const without = structuredClone(assetSlots).filter(slot => slot.id !== "assets.pattern");
    expect(checkFrozenLeafSets([assetIA as Placement], without, ["assets"])).toEqual([expect.objectContaining({ source: "slots", missing: ["assets.pattern"], unexpected: [] })]);
  });
});

describe("themes leaf set", () => {
  it("holds exactly the 42 shadcn-universe theme leaves and no retired tokens leaf", () => {
    const ids = tokenSlots.map(slot => slot.id).sort();
    expect(ids).toHaveLength(42);
    expect(ids).toEqual([...tokenFreeze.leafIds].sort());
    expect(ids.filter(id => !id.startsWith("themes."))).toEqual([]);
    expect(JSON.stringify(tokenIA)).not.toMatch(/"tokens\./);
    expect(checkFrozenLeafSets([tokenIA as Placement], tokenSlots, ["themes"])).toEqual([]);
  });
  it("refuses every retired tokens leaf and a missing theme leaf", () => {
    const retired = [...themesMigration.deleted, ...themesMigration.renamed.map(row => row.old)];
    expect(retired).toHaveLength(56);
    expect(tokenSlots.map(slot => slot.id).filter(id => retired.includes(id))).toEqual([]);
    for (const id of retired) {
      const slots = structuredClone(tokenSlots);
      slots.push({ ...slots[0]!, id });
      expect(checkFrozenLeafSets([tokenIA as Placement], slots, ["themes"])).toEqual([expect.objectContaining({ source: "slots", unexpected: [id], missing: [] })]);
    }
    const without = structuredClone(tokenSlots).filter(slot => slot.id !== "themes.radius");
    expect(checkFrozenLeafSets([tokenIA as Placement], without, ["themes"])).toEqual([expect.objectContaining({ source: "slots", missing: ["themes.radius"], unexpected: [] })]);
  });
});

describe("explicit local component amendment", () => {
  const amendedId = "components.semantic-content";
  it("records an explicit versioned proposal against the unchanged signed baseline", () => {
    expect(componentAmendments).toEqual({ schemaVersion: 1, layer: "components", baseSignedHead: componentFreeze.signedHead, status: "pending-owner-ratification", addedLeafIds: ["components.native-action", amendedId, "components.sidebar", "components.command", "components.sheet", "components.empty", "components.item", "components.scroll-area", "components.dropdown-menu"] });
  });
  const inputs = () => ({ ia: structuredClone(componentIA) as Placement, slots: structuredClone(componentSlots) });
  it("accepts only the exact amended leaf alongside the unchanged signed IDs", () => {
    const value = inputs();
    if (!value.slots.some(slot => slot.id === amendedId)) value.slots.push({ ...value.slots[0]!, id: amendedId });
    const families = value.ia.nodes.flatMap(node => "children" in node ? node.children : []);
    if (!JSON.stringify(value.ia).includes(amendedId)) {
      const family = families.find(node => "leaves" in node)!;
      if ("leaves" in family) family.leaves = [...family.leaves, amendedId];
    }
    expect(checkFrozenLeafSets([value.ia], value.slots, ["components"])).toEqual([]);
    expect(componentFreeze.leafIds).toHaveLength(57);
    expect(componentFreeze.leafIds).not.toContain(amendedId);
  });
  for (const source of ["slots", "ia"] as const) for (const mutation of ["missing-amendment", "renamed-amendment", "unknown-addition", "coordinated-unknown-addition"] as const) it(`rejects ${source} ${mutation}`, () => {
    const value = inputs();
    const changeSlots = source === "slots" || mutation === "coordinated-unknown-addition";
    const changeIA = source === "ia" || mutation === "coordinated-unknown-addition";
    if (changeSlots) {
      if (mutation.endsWith("addition")) value.slots.push({ ...value.slots[0]!, id: "components.unspecified" });
      else {
        const index = value.slots.findIndex(slot => slot.id === amendedId);
        if (mutation === "missing-amendment") value.slots.splice(index, 1);
        else value.slots[index]!.id = "components.renamed-amendment";
      }
    }
    if (changeIA) for (const node of value.ia.nodes) if ("children" in node) for (const family of node.children) if ("leaves" in family) {
      if (mutation.endsWith("addition")) { if (family.id === "display-content") family.leaves = [...family.leaves, "components.unspecified"]; }
      else family.leaves = mutation === "missing-amendment" ? family.leaves.filter(id => id !== amendedId) : family.leaves.map(id => id === amendedId ? "components.renamed-amendment" : id);
    }
    const findings = checkFrozenLeafSets([value.ia], value.slots, ["components"]);
    expect(findings.map(finding => finding.source)).toEqual(mutation === "coordinated-unknown-addition" ? ["slots", "ia"] : [source]);
    expect(() => assertFrozenLeafSets([value.ia], value.slots, ["components"])).toThrow("LEAF_FREEZE");
  });
});

it("keeps the NativeAction amendment explicit and refuses missing or coordinated foreign native capabilities", () => {
  expect(componentAmendments.status).toBe("pending-owner-ratification");
  expect(componentFreeze.leafIds).toHaveLength(57);
  expect(componentFreeze.leafIds).not.toContain("components.native-action");
  for (const replacement of [undefined, "components.unknown-action"]) {
    const slots = structuredClone(componentSlots).filter(slot => slot.id !== "components.native-action");
    const ia = structuredClone(componentIA) as Placement;
    for (const group of ia.nodes) if ("children" in group) for (const family of group.children) if ("leaves" in family) family.leaves = family.leaves.filter(id => id !== "components.native-action");
    if (replacement) {
      slots.push({ ...slots[0]!, id: replacement });
      const family = ia.nodes.flatMap(group => "children" in group ? group.children : []).find(row => "leaves" in row)!;
      if ("leaves" in family) family.leaves = [...family.leaves, replacement];
    }
    expect(checkFrozenLeafSets([ia], slots, ["components"]).map(finding => finding.source)).toEqual(["slots", "ia"]);
  }
});


it("Studio may report a freeze mismatch while strict callers still reject the same inputs", () => {
  const findings: unknown[] = [];
  expect(() => assertFrozenLeafSets([], [], ["components"], finding => findings.push(finding))).not.toThrow();
  expect(findings.length).toBeGreaterThan(0);
  expect(findings[0]).toMatchObject({ code: "LEAF_FREEZE", severity: "error" });
  expect(() => assertFrozenLeafSets([], [], ["components"])).toThrow("LEAF_FREEZE");
});
