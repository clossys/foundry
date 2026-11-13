/** @vitest-environment node */
/** Renderer contract: one merged registry, shipped by name through the frames barrel. */
import { readdirSync, readFileSync } from "node:fs";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { RuntimeRenderInput } from "../catalog-core/runtime-ports.js";
import { SPECIMEN_SECTION_EXPORTS } from "../importers/specimen-sections.js";
import { packageBarrelExports } from "../library-cli/surface-package-evidence.js";
import { mergeRendererGroups, runtimeMember, runtimeRecord, runtimeText, surfaceRendererId, SURFACE_RUNTIME_POINTER, type SurfaceRendererEntry } from "./contract.js";
import { ConsumerComponentProvider, surfaceRuntimeCallbacks, surfaceRuntimePointers, surfaceRuntimeRenderers } from "./index.js";
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
    }
    expect(() => surfaceRuntimeCallbacks(["sections.not-a-leaf"])).toThrow(/no package renderer/);
  });
  it("calls each leaf's registered render, inside the consumer component provider when assembly passes an index", () => {
    const callbacks = surfaceRuntimeCallbacks();
    expect(Object.keys(callbacks).sort()).toEqual(Object.keys(surfaceRuntimeRenderers).map(surfaceRendererId).sort());
    for (const [leaf, row] of Object.entries(surfaceRuntimeRenderers)) {
      const rendered = `rendered:${leaf}`;
      const render = vi.spyOn(row, "render").mockReturnValue(rendered);
      try {
        const callback = callbacks[surfaceRendererId(leaf)]!;
        const plain = { path: leaf } as unknown as RuntimeRenderInput<ReactNode>;
        expect(callback(plain)).toBe(rendered);
        expect(render).toHaveBeenLastCalledWith(plain);
        const indexed = { path: leaf, profile: { values: {} }, componentIndex: { selections: {} } } as unknown as RuntimeRenderInput<ReactNode>;
        const wrapped = callback(indexed) as ReactElement<{ value: unknown; children: unknown }>;
        expect(isValidElement(wrapped) && wrapped.type).toBe(ConsumerComponentProvider);
        expect(wrapped.props.children).toBe(rendered);
        expect(wrapped.props.value).toEqual({ selections: {}, profile: { values: {} } });
        expect(render).toHaveBeenLastCalledWith(indexed);
        expect(render).toHaveBeenCalledTimes(2);
      } finally {
        render.mockRestore();
      }
    }
  });
  it("covers every Sections leaf and every Designer-owned Frames leaf", () => {
    const ids = (rows: readonly { id: string }[]) => rows.map(row => row.id).sort();
    // A Sections leaf has a package renderer here unless its fill is a native specimen source (rendered from its
    // imported source, not a package export) or pins another package's export (the Publisher's sectioned document).
    const fills = readdirSync(new URL("../catalog/fills/foundry/", import.meta.url)).filter(name => /^sections\..+\.json$/.test(name) && name !== "sections.coverage.json")
      .map(name => (JSON.parse(readFileSync(new URL(`../catalog/fills/foundry/${name}`, import.meta.url), "utf8")) as { $extensions: { "com.clossys.fill": { slot: string; pin?: { package: string } } } }).$extensions["com.clossys.fill"]);
    const otherPackage = fills.filter(fill => fill.pin?.package !== "@clossys/designer").map(fill => fill.slot).sort();
    const nativeSpecimens = SPECIMEN_SECTION_EXPORTS.map(row => row.id).sort();
    expect(otherPackage).toEqual(["sections.sectioned-document"]);
    expect(nativeSpecimens.length).toBeGreaterThan(0);
    const packaged = ids(sectionSlots as readonly { id: string }[]).filter(id => !otherPackage.includes(id) && !nativeSpecimens.includes(id));
    expect(Object.keys(sectionRenderers).sort()).toEqual(packaged);
    expect(packaged.length + otherPackage.length + nativeSpecimens.length).toBe(sectionSlots.length);
    for (const id of [...otherPackage, ...nativeSpecimens]) expect(ids(sectionSlots as readonly { id: string }[])).toContain(id);
    expect(Object.keys(frameRenderers).sort()).toEqual(ids(frameSlots as readonly { id: string }[]));
    expect(Object.keys(frameRenderers)).toHaveLength(frameSlots.length);
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
