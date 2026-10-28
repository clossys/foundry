/** @vitest-environment node */
/** Renderer contract: one merged registry, shipped by name through the frames barrel. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { packageBarrelExports } from "../library-cli/surface-package-evidence.js";
import { mergeRendererGroups, runtimeMember, runtimeRecord, runtimeText, surfaceRendererId, SURFACE_RUNTIME_POINTER, type SurfaceRendererEntry } from "./contract.js";
import { surfaceRuntimeCallbacks, surfaceRuntimePointers, surfaceRuntimeRenderers } from "./index.js";
import { sectionRenderers } from "./sections/index.js";
import { frameRenderers } from "./frames/index.js";
import sectionSlots from "../catalog/slots/sections.json" with { type: "json" };
import frameSlots from "../catalog/slots/frames.json" with { type: "json" };

const entry = (leaf: SurfaceRendererEntry["leaf"]): SurfaceRendererEntry => ({ leaf, render: () => leaf, sample: () => ({}) });

describe("surface runtime registry", () => {
  it("merges groups and refuses a leaf claimed twice or filed under another key", () => {
    expect(Object.keys(mergeRendererGroups({ "sections.faq": entry("sections.faq") }, { "sections.hero": entry("sections.hero") })).sort()).toEqual(["sections.faq", "sections.hero"]);
    expect(() => mergeRendererGroups({ "sections.faq": entry("sections.faq") }, { "sections.faq": entry("sections.faq") })).toThrow(/two renderers/);
    expect(() => mergeRendererGroups({ "sections.faq": entry("sections.hero") })).toThrow(/wrong key/);
  });
  it("is the union of the frame registry and the three section groups", () => {
    expect(Object.keys(surfaceRuntimeRenderers).sort()).toEqual([...Object.keys(frameRenderers), ...Object.keys(sectionRenderers)].sort());
    for (const [leaf, row] of Object.entries(surfaceRuntimeRenderers)) {
      expect(row.leaf).toBe(leaf);
      expect(surfaceRuntimePointers()[leaf]).toEqual(SURFACE_RUNTIME_POINTER);
      expect(surfaceRuntimeCallbacks([leaf])[surfaceRendererId(leaf)]).toBe(row.render);
    }
    expect(() => surfaceRuntimeCallbacks(["sections.not-a-leaf"])).toThrow(/no package renderer/);
  });
  it("covers every Sections leaf and every Frames leaf except the publisher-owned site shell", () => {
    const ids = (rows: readonly { id: string }[]) => rows.map(row => row.id).sort();
    expect(Object.keys(sectionRenderers).sort()).toEqual(ids(sectionSlots as readonly { id: string }[]));
    expect(Object.keys(sectionRenderers)).toHaveLength(46);
    expect(Object.keys(frameRenderers).sort()).toEqual(ids(frameSlots as readonly { id: string }[]).filter(id => id !== "frames.site-shell"));
    expect(Object.keys(frameRenderers)).toHaveLength(8);
  });
  it("ships the registry by name from the frames barrel the pointer names", () => {
    expect(SURFACE_RUNTIME_POINTER).toEqual({ module: "@clossys/designer/frames", export: "surfaceRuntimeRenderers" });
    const barrel = packageBarrelExports(readFileSync(new URL("../frames/index.ts", import.meta.url), "utf8"));
    expect(barrel.values).toEqual(expect.arrayContaining(["surfaceRuntimeRenderers", "surfaceRuntimeCallbacks", "surfaceRuntimePointers", "SURFACE_RUNTIME_POINTER", "surfaceRendererId"]));
  });
  it("reads JSON content and selected members without inventing values", () => {
    const input = { content: { label: { reference: { kind: "copy" as const, ref: "a" }, value: "Skip", hash: "sha256:x" as const }, blank: { reference: { kind: "copy" as const, ref: "b" }, value: " ", hash: "sha256:y" as const }, nav: { reference: { kind: "records" as const, ref: "c" }, value: { activeId: "home" }, hash: "sha256:z" as const } }, selection: { leaf: "frames.app-shell" as const, fill: "f", config: null, members: ["layout.immersive", "theme.dark"], content: {} } };
    expect(runtimeText(input, "label")).toBe("Skip");
    expect(runtimeText(input, "blank")).toBeUndefined();
    expect(runtimeText(input, "missing")).toBeUndefined();
    expect(runtimeRecord(input, "nav")).toEqual({ activeId: "home" });
    expect(runtimeMember(input, "layout", "standard")).toBe("immersive");
    expect(runtimeMember(input, "stage", "contained")).toBe("contained");
  });
});
