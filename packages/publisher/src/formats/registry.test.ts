import { describe, expect, it } from "vitest";
import { checkFormatRegistry, FORMAT_IA, FORMAT_IDS, FORMAT_LEAVES, getFormatLeaf } from "./index.js";
import type { FormatIA, FormatLeaf } from "./index.js";

type Mutable<T> = T extends readonly (infer U)[] ? Mutable<U>[] : T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;
const leaves = () => structuredClone(FORMAT_LEAVES) as Mutable<FormatLeaf>[];
const tree = () => structuredClone(FORMAT_IA) as Mutable<FormatIA>;

describe("generation format registry", () => {
  it("registers one built web page and five concepts without renderers or instances", () => {
    expect(checkFormatRegistry()).toEqual([]);
    expect(FORMAT_LEAVES.map(leaf => leaf.id)).toEqual(FORMAT_IDS);
    expect(FORMAT_LEAVES.filter(leaf => leaf.status === "built").map(leaf => leaf.id)).toEqual(["web.page.responsive"]);
    expect(FORMAT_LEAVES.filter(leaf => leaf.status === "concept")).toHaveLength(5);
    for (const leaf of FORMAT_LEAVES) {
      expect(Object.keys(leaf)).not.toContain("renderer");
      expect(Object.keys(leaf)).not.toContain("instances");
      if (leaf.status === "concept") expect([leaf.allowedCompositions, leaf.frames, leaf.usedByPacks]).toEqual([[], [], []]);
    }
    expect(Object.isFrozen(FORMAT_LEAVES[0]?.size)).toBe(true);
    expect(Object.isFrozen(FORMAT_IA.nodes[0]?.children)).toBe(true);
    expect(getFormatLeaf("unknown")).toBeUndefined();
    expect(getFormatLeaf("web.page.responsive", [])).toBeUndefined();
  });
  it("pins web output, token breakpoints, active compositions, held staggered-grid and page shells", () => {
    expect(getFormatLeaf("web.page.responsive")).toMatchObject({
      status: "built", outputType: "html", arrangement: "page",
      size: { kind: "responsive", breakpoints: ["tokens.breakpoint.mobile", "tokens.breakpoint.mobile-lg", "tokens.breakpoint.tablet", "tokens.breakpoint.tablet-lg", "tokens.breakpoint.desktop", "tokens.breakpoint.wide"] },
      allowedCompositions: ["layouts.stack", "layouts.split", "layouts.sidebar-content", "layouts.bento"], heldCompositions: ["layouts.staggered-grid"],
      frames: ["frames.site-shell", "frames.app-shell"], usedByPacks: [],
    });
  });
  it("pins concept sizes and distinguishes pixels, paper units, aspect ratio and fps", () => {
    expect(getFormatLeaf("email.html")).toMatchObject({ outputType: "html", size: { kind: "fixed", unit: "px", width: 600 } });
    expect(getFormatLeaf("image.og")).toMatchObject({ arrangement: "canvas", size: { kind: "fixed", unit: "px", width: 1200, height: 630 } });
    expect(getFormatLeaf("document.pdf-a4")).toMatchObject({ arrangement: "paged", size: { kind: "paper", unit: "mm", width: 210, height: 297 } });
    expect(getFormatLeaf("video.16x9")).toMatchObject({ arrangement: "canvas", size: { kind: "fixed", unit: "px", width: 1920, height: 1080 }, fps: 30 });
    expect(getFormatLeaf("deck.16x9")).toMatchObject({ arrangement: "paged", size: { kind: "aspect-ratio", width: 16, height: 9 } });
  });
  it("places each format once at medium > family > leaf", () => {
    const placements = FORMAT_IA.nodes.flatMap(medium => medium.children.flatMap(family => family.leaves.map(id => ({ id, medium: medium.id, family: family.id }))));
    expect(placements).toHaveLength(6);
    expect(new Set(placements.map(leaf => leaf.id)).size).toBe(6);
    for (const placement of placements) expect(getFormatLeaf(placement.id)).toMatchObject(placement);
    expect(FORMAT_IA.nodes[0]).toMatchObject({ label: "Screen", children: [{ label: "Web page", leaves: ["web.page.responsive"] }] });
  });
  it("rejects skipped levels, fourth levels, duplicates, missing leaves and foreign placements", () => {
    const mutants = [
      (ia: Mutable<FormatIA>) => { Object.assign(ia.nodes[0]!, { leaves: ["web.page.responsive"] }); },
      (ia: Mutable<FormatIA>) => { Object.assign(ia.nodes[0]!.children[0]!, { children: [] }); },
      (ia: Mutable<FormatIA>) => { ia.nodes[0]!.children = [{ id: "extra", label: "Extra", children: [{ leaves: ["web.page.responsive"] }] }] as never; },
      (ia: Mutable<FormatIA>) => { ia.nodes[0]!.children[0]!.leaves.push("web.page.responsive"); },
      (ia: Mutable<FormatIA>) => { ia.nodes[0]!.children[0]!.leaves = []; },
      (ia: Mutable<FormatIA>) => { ia.nodes[0]!.children[0]!.leaves = ["email.html"]; },
      (ia: Mutable<FormatIA>) => { ia.nodes[0]!.children.push(ia.nodes[0]!.children[0]!); },
    ];
    for (const mutate of mutants) { const ia = tree(); mutate(ia); expect(checkFormatRegistry(FORMAT_LEAVES, ia).some(finding => finding.code === "ia")).toBe(true); }
  });
  it("refuses duplicate/unknown ids and inactive or mismatched allowed compositions", () => {
    const mutations = [
      (rows: Mutable<FormatLeaf>[]) => { rows.push(rows[0]!); },
      (rows: Mutable<FormatLeaf>[]) => { rows[0]!.id = "other" as never; },
      (rows: Mutable<FormatLeaf>[]) => { rows[0]!.allowedCompositions.push("layouts.staggered-grid"); },
      (rows: Mutable<FormatLeaf>[]) => { rows[2]!.allowedCompositions = ["layouts.stack"]; },
      (rows: Mutable<FormatLeaf>[]) => { rows[0]!.heldCompositions = ["layouts.stack"]; },
      (rows: Mutable<FormatLeaf>[]) => { rows[0]!.frames = ["frames.overlay"]; },
    ];
    for (const mutate of mutations) { const rows = leaves(); mutate(rows); expect(checkFormatRegistry(rows).length).toBeGreaterThan(0); }
  });
  it("refuses raw breakpoints, invalid numeric values and mismatched units", () => {
    const mutations = [
      (rows: Mutable<FormatLeaf>[]) => { rows[0]!.size = { kind: "responsive", breakpoints: ["768px"] } as never; },
      (rows: Mutable<FormatLeaf>[]) => { rows[0]!.size = { kind: "responsive", breakpoints: [] }; },
      ...[0, -1, NaN, Infinity, 1.5].map(width => (rows: Mutable<FormatLeaf>[]) => { rows[1]!.size = { kind: "fixed", unit: "px", width }; }),
      (rows: Mutable<FormatLeaf>[]) => { rows[1]!.size = { kind: "fixed", unit: "mm", width: 600 } as never; },
      (rows: Mutable<FormatLeaf>[]) => { rows[3]!.size = { kind: "paper", unit: "px", width: 210, height: 297 } as never; },
      (rows: Mutable<FormatLeaf>[]) => { rows[4]!.fps = Infinity; },
      (rows: Mutable<FormatLeaf>[]) => { rows[1]!.fps = 30; },
    ];
    for (const mutate of mutations) { const rows = leaves(); mutate(rows); expect(checkFormatRegistry(rows).some(finding => finding.code === "contract")).toBe(true); }
  });
  it("keeps concept rendering, instance data and content outside the registry", () => {
    for (const extra of [{ renderer: "email.js" }, { instances: ["example.email"] }, { content: "Audience copy" }, { usedByPacks: ["pack.example"] }]) {
      const rows = leaves(); Object.assign(rows[1]!, extra);
      expect(checkFormatRegistry(rows).some(finding => finding.code === "contract")).toBe(true);
    }
    const rows = leaves(); rows[1]!.status = "built";
    expect(checkFormatRegistry(rows).some(finding => finding.code === "contract")).toBe(true);
  });
  it("returns findings for malformed arrays and null data without invoking accessors", () => {
    for (const bad of [null, {}, [null], [{ ...FORMAT_LEAVES[0], allowedCompositions: null }], [{ ...FORMAT_LEAVES[0], size: null }]]) {
      expect(checkFormatRegistry(bad as never).length).toBeGreaterThan(0);
    }
    for (const bad of [null, { nodes: null }, { nodes: [null] }, { nodes: [{ id: "screen", label: "Screen", children: [null] }] }]) {
      expect(checkFormatRegistry(FORMAT_LEAVES, bad as never).length).toBeGreaterThan(0);
    }
    let read = false;
    const rows = leaves(); Object.defineProperty(rows[0], "renderer", { enumerable: true, get() { read = true; return "renderer.js"; } });
    expect(checkFormatRegistry(rows).length).toBeGreaterThan(0); expect(read).toBe(false);
  });
});

it("registers exact final deliveries without claiming an exporter and requires slide fidelity choices", async () => {
  const { FORMAT_DELIVERY_IDS } = await import("./contract.js");
  for (const format of FORMAT_LEAVES) {
    expect(format.deliveries.map(delivery => delivery.id)).toEqual(FORMAT_DELIVERY_IDS[format.id]);
    expect(format.deliveries.every(delivery => delivery.status === "concept-only")).toBe(true);
    for (const delivery of format.deliveries) expect(delivery.fidelityChoices).toEqual(["pptx", "google-slides"].includes(delivery.id) ? ["editable", "flat"] : undefined);
  }
  for (const mutation of [
    (rows: Mutable<FormatLeaf>[]) => { rows[0]!.deliveries[0]!.status = "built"; },
    (rows: Mutable<FormatLeaf>[]) => { rows[0]!.deliveries.push({ id: "pdf", label: "PDF", status: "concept-only" }); },
    (rows: Mutable<FormatLeaf>[]) => { rows[5]!.deliveries.find(delivery => delivery.id === "pptx")!.fidelityChoices = ["flat"]; },
    (rows: Mutable<FormatLeaf>[]) => { rows[1]!.deliveries = []; },
    (rows: Mutable<FormatLeaf>[]) => { Object.assign(rows[0]!.deliveries[0]!, { exporter: "invented" }); },
  ]) {
    const rows = leaves(); mutation(rows);
    expect(checkFormatRegistry(rows).length).toBeGreaterThan(0);
  }
});
