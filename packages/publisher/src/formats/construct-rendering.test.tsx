/** @vitest-environment node */
import { beforeAll, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createCopyResolver } from "@clossys/writer";
import { loadBuildCatalog, planSurfaceRuntime, resolve, runtimeHash } from "@clossys/designer/catalog";
import type { RuntimeAssemblyInput, RuntimeContentRef } from "@clossys/designer/catalog";
import { readSurfacePackageEvidence } from "@clossys/designer/catalog/server";
import { packageSurfaceLibrary } from "../../../designer/dist/library-cli/__fixtures__/package-surface-library.js";
import type { ContentMapConstructs } from "../content-map/contract.js";
import { prepareConstructRendering, CONSTRUCT_FORMAT_RENDERERS } from "./construct-rendering.js";

let fixture: Awaited<ReturnType<typeof packageSurfaceLibrary>>;
let packages: Awaited<ReturnType<typeof readSurfacePackageEvidence>>;
beforeAll(async () => {
  fixture = await packageSurfaceLibrary();
  packages = await readSurfacePackageEvidence(["@clossys/designer/frames", "@clossys/designer/shell"].map(module => ({ frames: { pointer: { impl: { kind: "package", module } } } })) as never);
}, 120_000);
function setup() {
  const engine = { catalog: fixture.catalog, library: fixture.library, surfaceOptions: { ...fixture.options, packages: [...fixture.packages.filter(row => !packages.some(p => p.module === row.module)), ...packages] } };
  const profile = resolve(engine), leaves = ["frames.app-shell", "sections.section-header"];
  const plan = planSurfaceRuntime({ engine, packages: engine.surfaceOptions.packages, leaves, renderers: Object.fromEntries(leaves.map(leaf => [leaf, { module: "@clossys/designer/frames", export: "surfaceRuntimeRenderers" }])) });
  expect(plan.gaps).toEqual([]);
  const frame = plan.manifest.fills.find(row => row.kind === "frame")!;
  const section = plan.manifest.fills.find(row => row.kind === "section")!;
  const constructs: ContentMapConstructs = { body: [{ section: "sections.section-header", members: { align: "center", density: "display" }, content: { heading: { kind: "copy", ref: "pitch.heading" }, description: { kind: "copy", ref: "pitch.description" } } }] };
  const writer = createCopyResolver({ id: "pitch", revision: "1", locale: "en", source: { kind: "consumer", reference: "format-proof" }, entries: [
    { id: "pitch.heading", text: "One shared construct", context: "Test heading", status: "draft" },
    { id: "pitch.description", text: "Web and deck retain the same Writer references.", context: "Test body", status: "draft" },
    { id: "pitch.skip", text: "Skip to content", context: "Test skip", status: "draft" },
  ] }, { target: "preview" });
  const resolveContent = vi.fn((reference: RuntimeContentRef) => {
    const label = writer({ id: "pitch.heading" })!.text;
    const chrome = reference.ref === "chrome.sidebar" ? { brand: { markSrc: "/mark.svg", name: label }, tree: [], account: { signedOutLabel: label, sections: [] } }
      : reference.ref === "chrome.command" ? { triggerLabel: label, heading: label, searchLabel: label, closeLabel: label, emptyMessage: label, groups: [] } : undefined;
    if (chrome) return { reference, value: chrome, hash: runtimeHash(chrome) };
    const current = writer({ id: reference.ref, locale: "en" });
    return current && { reference, value: current.text, hash: runtimeHash(current.text) };
  });
  const input: RuntimeAssemblyInput<import("react").ReactNode> = {
    identity: { kind: "git", head: "a".repeat(40), tree: "b".repeat(40) }, engine,
    contracts: { ...loadBuildCatalog(), slots: fixture.catalog.surfaces!.slots },
    ports: { manifest: plan.manifest, renderers: {}, resolveContent, frameHost: { navigate: () => {} } },
    binding: { id: "pitch", frame: { leaf: frame.leaf, fill: frame.fill, config: null, members: [], content: { "skip-link": { kind: "copy", ref: "pitch.skip" }, sidebar: { kind: "region", ref: "chrome.sidebar" }, command: { kind: "region", ref: "chrome.command" } } }, frameSlots: {}, sections: { body: [{ leaf: section.leaf, fill: section.fill, config: null, members: ["align.center", "density.display"], content: constructs.body![0]!.content }] } },
    layout: { descriptor: { library: profile.consumer, fill: "pitch/layout", leaf: "layouts.stack", config: "single", members: {}, slots: [{ id: "body", min: 1, max: 2, accepts: ["sections.section-header"] }], breakpoints: [], states: ["default"], renderer: frame.renderer }, render: ({ slots }) => createElement("main", null, ...slots.body!), expectedOrder: (_cell, paths) => paths.body! },
    themes: ["light"], states: ["default"], css: [{ id: "proof", contents: "/* explicit source styles */" }], assets: [],
    breakpointPixels: Object.fromEntries(Object.entries(profile.values.members).filter(([id]) => id.startsWith("tokens.breakpoint.")).flatMap(([id, member]) => { const value = member.value.light as { unit: string; value: number }; return value.unit === "px" ? [] : [[id, value.value * 16]]; })),
    breakpointBasis: { renderer: frame.renderer, environment: { rootFontSize: 16 } },
  };
  return { input, constructs, resolveContent };
}

it("renders one canonical SectionFill as native web and a real 16:9 SVG slide with shared Writer refs and styles", () => {
  const f = setup(), before = JSON.stringify(f.constructs);
  const prepared = prepareConstructRendering(f.constructs, f.input);
  const cell = prepared.cells.find(cell => cell.width >= 1024)!;
  const web = prepared.render("web.page.responsive", cell), deck = prepared.render("deck.16x9", cell);
  const html = renderToStaticMarkup(createElement("div", null, ...web.sections.map(section => section.node)));
  expect(html).toContain("One shared construct"); expect(html).toContain("Web and deck retain");
  expect(html).toContain("text-display-m"); expect(html).toContain("text-center"); expect(html).toContain("data-ds-leaf=\"sections.section-header\"");
  expect(deck.deck.aspect).toBe("16:9"); expect(deck.deck.width).toBe(1920); expect(deck.deck.slides).toHaveLength(1);
  expect(deck.deck.slides[0]!.svg).toContain("One shared construct"); expect(deck.deck.slides[0]!.svg).toContain('text-anchor="middle"');
  expect(deck.deck.slides[0]!.svg).toContain('font-size="'); expect(deck.deck.warnings).toEqual([]);
  expect(deck.sections.map(section => section.key)).toEqual(web.sections.map(section => section.key));
  expect(deck.sections[0]!.construct.content.heading).toEqual({ kind: "copy", ref: "pitch.heading" });
  expect(JSON.stringify(f.constructs)).toBe(before); expect(Object.isFrozen(deck.sections[0]!.construct)).toBe(true);
  expect(prepared.render("deck.16x9", cell)).toEqual(deck);
  expect(f.resolveContent.mock.calls.some(([reference]) => reference.ref === "pitch.heading")).toBe(true);
});
it("pins package renderers and canonical format metadata, rejecting caller callbacks and unbuilt formats", () => {
  const f = setup(), fake = vi.fn(() => "fake");
  const input = { ...f.input, ports: { ...f.input.ports, renderers: { "package:sections.section-header": fake } } };
  const prepared = prepareConstructRendering(f.constructs, input);
  expect(prepared.render("web.page.responsive", prepared.cells[0]!).sections).toHaveLength(1); expect(fake).not.toHaveBeenCalled();
  expect(CONSTRUCT_FORMAT_RENDERERS.map(row => row.format)).toEqual(["web.page.responsive", "deck.16x9"]);
  expect(() => prepared.render("email.html" as never, prepared.cells[0]!)).toThrow(/format/);
  const fills = f.input.ports.manifest.fills.map(fill => fill.kind === "section" ? { ...fill, renderer: { ...fill.renderer, id: "fake" } } : fill);
  expect(() => prepareConstructRendering(f.constructs, { ...f.input, ports: { ...f.input.ports, manifest: { ...f.input.ports.manifest, fills } } })).toThrow(/renderer/);
});
it("fails closed on unsupported refs/configs/members and mismatched canonical selection", () => {
  for (const change of [{ config: "unknown" }, { members: { align: "end" } }, { content: { heading: { kind: "records", ref: "pitch.heading" } } }, { repeat: { over: { kind: "records", ref: "rows" }, key: "id" } }, { section: "sections.data-table" }]) {
    const f = setup(), constructs = { body: [{ ...f.constructs.body![0]!, ...change }] } as ContentMapConstructs;
    expect(() => prepareConstructRendering(constructs, f.input)).toThrow();
  }
  const f = setup();
  expect(() => prepareConstructRendering(f.constructs, { ...f.input, ports: { ...f.input.ports, resolveContent: () => undefined } })).toThrow(/runtime|content/);
  expect(() => prepareConstructRendering(f.constructs, { ...f.input, css: [] })).toThrow(/runtime|CSS/);
});
it("uses native configured heading rank and format density from the same construct, retaining order and keys", () => {
  const f = setup(), first = f.constructs.body![0]!;
  const constructs = { body: [{ ...first, config: "level-3" }, { ...first, config: "level-3", members: { align: "start", density: "compact" } }] } satisfies ContentMapConstructs;
  const selected = f.input.binding.sections.body![0]!;
  const manifest = { ...f.input.ports.manifest, fills: f.input.ports.manifest.fills.map(fill => fill.kind === "section" ? { ...fill, config: "level-3" } : fill) };
  const input = { ...f.input, ports: { ...f.input.ports, manifest }, binding: { ...f.input.binding, sections: { body: [{ ...selected, config: "level-3" }, { ...selected, config: "level-3", members: ["align.start", "density.compact"] }] } } };
  const prepared = prepareConstructRendering(constructs, input), cell = prepared.cells.find(cell => cell.width >= 1024)!;
  const web = prepared.render("web.page.responsive", cell), deck = prepared.render("deck.16x9", cell);
  expect(renderToStaticMarkup(web.sections[0]!.node)).toContain("<h3");
  expect(renderToStaticMarkup(web.sections[1]!.node)).toContain("text-h3");
  expect(deck.sections.map(section => section.key)).toEqual(['["body",0]', '["body",1]']);
  expect(deck.deck.slides.map(slide => slide.id)).toEqual(web.sections.map(section => section.key));
  expect(deck.deck.slides[0]!.svg).not.toBe(deck.deck.slides[1]!.svg);
  expect(deck.deck.slides[1]!.svg).toContain('text-anchor="start"');
  expect(deck.deck.slides[0]!.svg).toContain('font-size="56"'); expect(deck.deck.slides[1]!.svg).toContain('font-size="14"');
});
it("snapshots caller data and refuses stale content or foreign cells through native gates", () => {
  const f = setup(), prepared = prepareConstructRendering(f.constructs, f.input), cell = prepared.cells[0]!;
  const before = prepared.render("deck.16x9", cell);
  (f.constructs.body![0]!.content.heading as { ref: string }).ref = "changed.after.prepare";
  expect(prepared.render("deck.16x9", cell)).toEqual(before);
  expect(() => prepared.render("deck.16x9", { ...cell, width: 3 })).toThrow(/cell/);
  const g = setup(), original = g.input.ports.resolveContent;
  expect(() => prepareConstructRendering(g.constructs, { ...g.input, ports: { ...g.input.ports, resolveContent: reference => { const current = original(reference); return current && { ...current, hash: runtimeHash("stale") }; } } })).toThrow(/stale/);
});
