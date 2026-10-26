/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { standardM1FixtureEngine, standardM1Runtime } from "./__fixtures__/standard-m1-runtime.js";
import { prepareRuntimeAssembly, runtimeAssemblyCells } from "./runtime-assembly.js";
import { applyLibraryChange, libraryHash, resolve } from "./api.js";
import { runtimeHash } from "./runtime-ports.js";
import { emittedTokenProperties } from "./emit.js";
import type { RuntimeCanvasAssemblyInput, RuntimeBodyQueryBinding } from "./runtime-assembly.js";
import type { RuntimeFrameStage } from "./runtime-ports.js";
import type { ReactElement } from "react";
const engine = standardM1FixtureEngine();
const fixture = () => standardM1Runtime({ engine: structuredClone(engine), identity: { kind: "git", head: "1".repeat(40), tree: "2".repeat(40) }, source: { entry: "synthetic.tsx", files: { "synthetic.tsx": "// SYNTHETIC source descriptor" }, dependencies: {} }, css: [{ id: "fixture.css", contents: "body{margin:0}" }] });
function canvasFixture() {
  const flow = fixture(), { layout: _layout, ...base } = flow;
  const refs = [{ slot: "body", index: 0 }, { slot: "body", index: 1 }];
  const body = { kind: "canvas" as const, source: { kind: "static" as const }, boards: refs.map((section, index) => ({ id: `example/group-${index}`, section })), arrangement: { kind: "grid" as const, columns: 2, gap: { x: 0, y: 0 } }, collapseBelow: "tokens.breakpoint.tablet" as const };
  const source = { entry: "frames/FrameStage.tsx", files: { "frames/FrameStage.tsx": "// SYNTHETIC Stage source; not component qualification" }, dependencies: {} };
  const renderer = { id: "SYNTHETIC Stage", source, sourceHash: runtimeHash(source) };
  const module = { package: "@clossys/designer/frames" as const, export: "FrameStage" as const, renderer };
  let captured: RuntimeFrameStage<ReactElement> | undefined;
  const labels = { "stage.label": "Library boards", "sections.body.0": "First selected Section", "sections.body.1": "Second selected Section" };
  const input: RuntimeCanvasAssemblyInput<ReactElement> = { ...base, binding: { ...base.binding, body },
    contracts: { ...base.contracts, slots: base.contracts.slots.map(slot => ({ ...slot, contract: slot.contract.kind === "frame" ? { ...slot.contract, stage: { accepts: ["flow", "canvas"], scroll: "region" } } : slot.contract.kind === "section" ? { ...slot.contract, substrates: ["flow", "canvas"], substrateTests: ["flow", "canvas"].map(substrate => ({ substrate: substrate as "flow" | "canvas", file: "SYNTHETIC.tsx", name: "SYNTHETIC source declaration" })) } : slot.contract })) },
    ports: { ...base.ports, manifest: { ...base.ports.manifest, fills: base.ports.manifest.fills.map(fill => fill.kind === "frame" ? { ...fill, stageModule: module } : fill) }, stageActions: { onViewportChange() {} },
      resolveContent: reference => Object.hasOwn(labels, reference.ref) ? { reference, value: labels[reference.ref as keyof typeof labels], hash: runtimeHash(labels[reference.ref as keyof typeof labels]) } : base.ports.resolveContent(reference),
      renderers: { ...base.ports.renderers, [base.ports.manifest.fills[0]!.renderer.id]: current => { captured = current.stage; return base.ports.renderers[base.ports.manifest.fills[0]!.renderer.id]!(current); } } },
    stage: { module, bodyDigest: runtimeHash(body), label: { kind: "copy", ref: "stage.label" }, labels: Object.fromEntries(refs.map((_, index) => [`sections.body.${index}`, { kind: "copy" as const, ref: `sections.body.${index}` }])), controller: renderer, state: { camera: { viewport: { x: 0, y: 0, zoom: 1 }, minZoom: 0.1, maxZoom: 2, fitPadding: 0 } } },
  };
  return { input, captured: () => captured };
}

describe("canonical runtime Stage/body seam (synthetic metadata only)", () => {
  it("canvas needs no dummy Layout and renders every canonical ref once", () => {
    const f = canvasFixture(), result = prepareRuntimeAssembly(f.input);
    expect(result.status, JSON.stringify(result)).toBe("ready"); if (result.status !== "ready") return;
    result.assembly.render(result.assembly.snapshot.cells[0]!);
    expect(f.captured()!.sectionNodes.map(row => row.reference)).toEqual(f.input.binding.body.boards.map(board => board.section));
    expect(f.captured()!.sectionNodes.map(row => row.label)).toEqual(["First selected Section", "Second selected Section"]);
    expect("layout" in f.captured()!).toBe(false);
    expect(prepareRuntimeAssembly({ ...f.input, layout: fixture().layout } as never).status).toBe("refused");
  });
  it("foreign or stale Stage module/body digest and host node escapes refuse", () => {
    const { input } = canvasFixture();
    for (const stage of [{ ...input.stage, bodyDigest: runtimeHash("old body") }, { ...input.stage, module: { ...input.stage.module, export: "ForeignStage" } }, { ...input.stage, renderBody: () => "old page" }, { ...input.stage, sectionNodes: [] }])
      expect(prepareRuntimeAssembly({ ...input, stage } as never).status).toBe("refused");
    const source = { ...input.stage.module.renderer.source, files: { ...input.stage.module.renderer.source.files, "new.ts": "changed implementation" } };
    const module = { ...input.stage.module, renderer: { ...input.stage.module.renderer, source, sourceHash: runtimeHash(source) } };
    expect(prepareRuntimeAssembly({ ...input, stage: { ...input.stage, module } }).status).toBe("refused");
  });
  it("canonical refs retain declared frame-module order outside the Stage body", () => {
    const f = canvasFixture(), original = f.input, moduleFill = original.binding.sections.body![1]!;
    const input = { ...original, binding: { ...original.binding, frameSlots: { consent: [moduleFill] } },
      ports: { ...original.ports, manifest: { ...original.ports.manifest, fills: original.ports.manifest.fills.map(fill => fill.kind === "frame" ? { ...fill, slots: [...fill.slots, "consent"] } : fill) }, frameOrder: ({ layout, slots }: { layout: readonly string[]; slots: Readonly<Record<string, readonly string[]>> }) => [...slots.consent!, ...layout] },
    };
    const result = prepareRuntimeAssembly(input); expect(result.status, JSON.stringify(result)).toBe("ready"); if (result.status !== "ready") return;
    const cell = result.assembly.snapshot.cells[0]!; result.assembly.render(cell);
    expect(result.assembly.snapshot.expectedOrder[JSON.stringify([cell.theme, cell.state, cell.width])]).toEqual(["frameSlots.consent.0", "sections.body.0", "sections.body.1"]);
    expect(f.captured()!.sectionNodes).toHaveLength(2);
  });
  it.each(["duplicate", "omit"])("canonical reference %s refuses", mutation => {
    const { input } = canvasFixture(), boards = input.binding.body.boards;
    const body = { ...input.binding.body, boards: mutation === "omit" ? boards.slice(0, 1) : [boards[0]!, { ...boards[1]!, section: boards[0]!.section }] };
    expect(prepareRuntimeAssembly({ ...input, binding: { ...input.binding, body }, stage: { ...input.stage, bodyDigest: runtimeHash(body) } }).status).toBe("refused");
  });
  it("query source, version and fresh input/output digests are independently bound", () => {
    const { input } = canvasFixture(), body = { ...input.binding.body, source: { kind: "derived" as const, query: { id: "example.boards", version: 1 } } }, binding = { ...input.binding, body };
    const profile = resolve(input.engine), content = Object.fromEntries(Object.entries(binding.sections).flatMap(([slot, fills]) => fills.map((fill, index) => [`sections.${slot}.${index}`, Object.fromEntries(Object.entries(fill.content).map(([key, ref]) => [key, input.ports.resolveContent(ref)!]))])));
    content.frame = Object.fromEntries(Object.entries(binding.frame.content).map(([key, ref]) => [key, input.ports.resolveContent(ref)!]));
    const state = { revision: 1 }, query: RuntimeBodyQueryBinding = { id: body.source.query.id, version: 1, renderer: input.stage.module.renderer, state,
      inputHash: runtimeHash({ libraryHash: libraryHash(input.engine.library), selectionHash: profile.selectionHash, content, state }), outputHash: runtimeHash({ body, sections: binding.sections, frameSlots: binding.frameSlots }) };
    const current = { ...input, binding, stage: { ...input.stage, bodyDigest: runtimeHash(body) }, query };
    expect(prepareRuntimeAssembly(current).status).toBe("ready");
    for (const changed of [{ ...query, version: 2 }, { ...query, inputHash: runtimeHash("old input") }, { ...query, outputHash: runtimeHash("old output") }, { ...query, renderer: { ...query.renderer, sourceHash: runtimeHash("old source") } }])
      expect(prepareRuntimeAssembly({ ...current, query: changed }).status).toBe("refused");
    const { query: _query, ...missing } = current; expect(prepareRuntimeAssembly(missing).status).toBe("pending");
  });
  it("actual Stage width differs from viewport at the same cell and independently decides expected flow order", () => {
    const flow = fixture(), profile = resolve(flow.engine), threshold = (profile.values.members["tokens.breakpoint.tablet"]!.value.light as { value: number }).value;
    const body = { kind: "flow" as const, source: { kind: "static" as const }, sections: [{ slot: "body", index: 0 }, { slot: "body", index: 1 }] };
    const cells = runtimeAssemblyCells(profile, flow.themes, flow.states);
    let renderedWidth: number | undefined;
    const input = { ...flow, binding: { ...flow.binding, body }, contracts: canvasFixture().input.contracts,
      stageMeasurements: { renderer: flow.layout.descriptor.renderer, environment: { kind: "SYNTHETIC measured container smaller than viewport" }, cells: cells.map(cell => ({ cell, width: Math.min(cell.width, threshold - 1) })) },
      layout: { ...flow.layout, expectedOrder: (_cell: unknown, paths: Readonly<Record<string, readonly string[]>>, stageWidth: number) => stageWidth < threshold ? [...paths.body!].reverse() : paths.body!, render: (current: Parameters<typeof flow.layout.render>[0]) => { renderedWidth = current.stageWidth; return flow.layout.render(current); } },
    };
    const result = prepareRuntimeAssembly(input); expect(result.status, JSON.stringify(result)).toBe("ready"); if (result.status !== "ready") return;
    const cell = cells.find(cell => cell.width > threshold)!; const key = JSON.stringify([cell.theme, cell.state, cell.width]);
    expect(result.assembly.snapshot.stageWidths![key]).toBe(threshold - 1);
    expect(result.assembly.snapshot.expectedOrder[key]).toEqual(["sections.body.1", "sections.body.0"]);
    result.assembly.render(cell); expect(renderedWidth).toBe(threshold - 1);
    expect(prepareRuntimeAssembly({ ...input, stageMeasurements: undefined }).status).toBe("pending");
  });
});
describe("SYNTHETIC runtime assembly unit corpus (not full-library proof)", () => {
  it("resolves fixture frame and sections with an immutable fixture matrix", () => {
    const input = fixture(); const result = prepareRuntimeAssembly(input);
    expect(result.status, JSON.stringify(result)).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.assembly.snapshot.cells.length).toBeGreaterThan(2);
    expect(result.assembly.snapshot.measuredPaths).toEqual(["frame", "sections.body.0", "sections.body.1"]);
    expect(Object.isFrozen(result.assembly.snapshot.data)).toBe(true);
    expect(result.assembly.render(result.assembly.snapshot.cells[0]!).type).toBe("div");
    expect(() => result.assembly.render({ theme: "foreign", state: "default", width: 320 })).toThrow(/outside/);
  });
  it("uses all consumer breakpoint ±1 widths, deduplicates and expands every theme/state once", () => {
    const profile = resolve(fixture().engine);
    const cells = runtimeAssemblyCells(profile, ["light", "dark"], ["default", "loading"]);
    const values = Object.values(profile.values.members).filter(member => member.slot === "tokens.breakpoint").map(member => (member.value.light as { value: number }).value);
    const widths = [...new Set([320, ...values.flatMap(value => [value - 1, value, value + 1])])].sort((a, b) => a - b);
    expect(cells).toHaveLength(widths.length * 4);
    expect(cells.filter(cell => cell.theme === "dark" && cell.state === "loading").map(cell => cell.width)).toEqual(widths);
    expect(() => runtimeAssemblyCells(profile, [], ["default"])).toThrow();
    expect(() => runtimeAssemblyCells(profile, ["light", "light"], ["default"])).toThrow();
  });
  it("passes exact selected config and members into runtime callbacks", () => {
    const input = fixture(); const fill = input.ports.manifest.fills[1]!;
    const selected = { ...input.binding.sections.body![0]!, members: ["layout.split"] };
    const ports = { ...input.ports, manifest: { ...input.ports.manifest, fills: input.ports.manifest.fills.map(value => value === fill ? { ...value, members: ["layout.editorial", "layout.split"] } : value) }, renderers: { ...input.ports.renderers, [fill.renderer.id]: (value: Parameters<(typeof input.ports.renderers)[string]>[0]) => { expect(value.selection.members).toEqual(["layout.split"]); expect(value.selection.config).toBe(null); return input.ports.renderers[fill.renderer.id]!(value); } } };
    const result = prepareRuntimeAssembly({ ...input, ports, binding: { ...input.binding, sections: { body: [selected, input.binding.sections.body![1]!] } } });
    expect(result.status).toBe("ready"); if (result.status === "ready") result.assembly.render(result.assembly.snapshot.cells[0]!);
  });
  it("requires frame slot order and binds every frame section path", () => {
    const input = fixture(); const frame = input.ports.manifest.fills[0]!;
    const binding = { ...input.binding, frameSlots: { consent: [input.binding.sections.body![1]!] } };
    const ports = { ...input.ports, manifest: { ...input.ports.manifest, fills: input.ports.manifest.fills.map(fill => fill === frame ? { ...fill, slots: [...fill.slots, "consent"] } : fill) } };
    expect(prepareRuntimeAssembly({ ...input, ports, binding }).status).toBe("pending");
    const ordered = prepareRuntimeAssembly({ ...input, binding, ports: { ...ports, frameOrder: order => [...order.layout, ...order.slots.consent!] } });
    expect(ordered.status).toBe("ready");
    if (ordered.status === "ready") expect(Object.values(ordered.assembly.snapshot.expectedOrder)[0]).toEqual(["sections.body.0", "sections.body.1", "frameSlots.consent.0"]);
    expect(prepareRuntimeAssembly({ ...input, binding, ports: { ...ports, frameOrder: order => order.layout } }).status).toBe("refused");
  });
  it("leaves absent content, frame fills, ports, breakpoints and CSS pending or refused", () => {
    const input = fixture();
    expect(prepareRuntimeAssembly({ ...input, ports: { ...input.ports, resolveContent: () => undefined } }).status).toBe("pending");
    expect(prepareRuntimeAssembly({ ...input, binding: { ...input.binding, frame: { ...input.binding.frame, fill: "missing" } } }).status).toBe("pending");
    expect(prepareRuntimeAssembly({ ...input, ports: { ...input.ports, renderers: {} } }).status).toBe("refused");
    expect(prepareRuntimeAssembly({ ...input, css: [] }).status).toBe("pending");
    const hero = input.binding.sections.body![0]!;
    expect(prepareRuntimeAssembly({ ...input, binding: { ...input.binding, sections: { body: [{ ...hero, config: "unsupported-config" }] } } }).status).toBe("pending");
    expect(prepareRuntimeAssembly({ ...input, binding: { ...input.binding, sections: { body: [{ ...hero, content: { header: { kind: "copy", ref: "standard-m1.hero" } } }] } } }).status).toBe("refused");
    expect(prepareRuntimeAssembly({ ...input, binding: { ...input.binding, sections: { body: [] } } }).status).toBe("pending");
    expect(prepareRuntimeAssembly({ ...input, ports: { ...input.ports, resolveContent: ref => ({ reference: ref, value: "changed", hash: runtimeHash("old") }) } }).status).toBe("refused");
  });
  it("requires complete asset closure and concrete bytes or actual resolved glyph payloads", () => {
    const input = fixture();
    const ports = { ...input.ports, manifest: { ...input.ports.manifest, assetClosure: { complete: true, ids: ["assets.logo"] } } };
    expect(prepareRuntimeAssembly({ ...input, ports }).status).toBe("pending");
    expect(prepareRuntimeAssembly({ ...input, ports, assets: [{ id: "assets.logo", mediaType: "image/svg+xml", bytes: [60, 115, 118, 103, 62] }] }).status).toBe("ready");
    expect(prepareRuntimeAssembly({ ...input, ports: { ...input.ports, manifest: { ...input.ports.manifest, assetClosure: { complete: false, ids: [] } } } }).status).toBe("pending");
  });
  it.each(["head", "tree", "library", "source", "content", "tokens", "css", "assets", "matrix", "selection"])("binds fresh %s bytes or identity", change => {
    const input = fixture(); const initial = prepareRuntimeAssembly(input); expect(initial.status).toBe("ready"); if (initial.status !== "ready") return;
    let changed = { ...input };
    if (change === "head") changed = { ...input, identity: { kind: "git", head: "3".repeat(40), tree: "2".repeat(40) } };
    if (change === "tree") changed = { ...input, identity: { kind: "git", head: "1".repeat(40), tree: "3".repeat(40) } };
    if (change === "css") changed = { ...input, css: [{ id: "fixture.css", contents: "body{margin:1px}" }] };
    if (change === "assets") changed = { ...input, assets: [{ id: "assets.fixture", mediaType: "text/plain", bytes: [1] }] };
    if (change === "matrix") changed = { ...input, themes: ["light"] };
    if (change === "content") changed = { ...input, ports: { ...input.ports, resolveContent: ref => ({ reference: ref, value: "Fresh content", hash: runtimeHash("Fresh content") }) } };
    if (change === "selection") changed = { ...input, binding: { ...input.binding, id: "other-instance" } };
    if (change === "source") { const source = { ...input.layout.descriptor.renderer.source, files: { "synthetic.tsx": "new source" } }; changed = { ...input, layout: { ...input.layout, descriptor: { ...input.layout.descriptor, renderer: { ...input.layout.descriptor.renderer, source, sourceHash: runtimeHash(source) } } } }; }
    if (change === "library" || change === "tokens") {
      let library = structuredClone(input.engine.library);
      if (change === "library") library.values.rationale = { changed: true };
      else library = applyLibraryChange(input.engine.catalog, library, { baseHash: libraryHash(library), changes: [{ portion: "values", change: { op: "author", slot: "tokens.breakpoint", tokens: { mobile: { $type: "dimension", $value: { value: 376, unit: "px" } } } } }] });
      const hash = libraryHash(library) as `sha256:${string}`;
      changed = { ...input, engine: { ...input.engine, library }, ports: { ...input.ports, manifest: { ...input.ports.manifest, libraryHash: hash, selectionHash: hash } } };
    }
    const fresh = prepareRuntimeAssembly(changed); expect(fresh.status, JSON.stringify(fresh)).toBe("ready");
    if (fresh.status === "ready") expect(fresh.assembly.snapshot.hash).not.toBe(initial.assembly.snapshot.hash);
  });
});

describe("runtime breakpoint measurement basis", () => {
  it("requires explicit rem pixels and basis, binds changed edges and refuses fabricated px overrides", () => {
    const input = fixture();
    const library = applyLibraryChange(input.engine.catalog, input.engine.library, { baseHash: libraryHash(input.engine.library), changes: [{ portion: "values", change: { op: "author", slot: "tokens.breakpoint", tokens: { mobile: { $type: "dimension", $value: { unit: "rem", value: 20 } } } } }] });
    const hash = libraryHash(library) as `sha256:${string}`;
    const rem = { ...input, engine: { ...input.engine, library }, ports: { ...input.ports, manifest: { ...input.ports.manifest, libraryHash: hash, selectionHash: hash } } };
    expect(prepareRuntimeAssembly(rem).status).toBe("pending");
    expect(prepareRuntimeAssembly({ ...rem, breakpointPixels: { "tokens.breakpoint.mobile": 320 } }).status).toBe("pending");
    const basis = { renderer: input.layout.descriptor.renderer, environment: { rootFontPx: 16, css: "html{font-size:16px}", kind: "SYNTHETIC" } };
    const a = prepareRuntimeAssembly({ ...rem, breakpointPixels: { "tokens.breakpoint.mobile": 320 }, breakpointBasis: basis });
    const b = prepareRuntimeAssembly({ ...rem, breakpointPixels: { "tokens.breakpoint.mobile": 400 }, breakpointBasis: { ...basis, environment: { rootFontPx: 20, kind: "SYNTHETIC" } } });
    expect(a.status).toBe("ready"); expect(b.status).toBe("ready");
    if (a.status === "ready" && b.status === "ready") { expect(a.assembly.snapshot.hash).not.toBe(b.assembly.snapshot.hash); expect(a.assembly.snapshot.cells.some(cell => cell.width === 319)).toBe(true); expect(b.assembly.snapshot.cells.some(cell => cell.width === 399)).toBe(true); }
    for (const pixels of [{ "tokens.breakpoint.mobile": -1 }, { "tokens.breakpoint.invented": 320 }, { "tokens.breakpoint.mobile": NaN }]) expect(prepareRuntimeAssembly({ ...rem, breakpointPixels: pixels, breakpointBasis: basis }).status).toBe("refused");
    expect(prepareRuntimeAssembly({ ...input, breakpointPixels: { "tokens.breakpoint.mobile": 999 }, breakpointBasis: basis }).status).toBe("refused");
  });
  it("binds renderer dependency artifact bytes and rejects state changes unsupported by real fills", () => {
    const input = fixture(); const before = prepareRuntimeAssembly(input); expect(before.status).toBe("ready");
    const source = { ...input.layout.descriptor.renderer.source, dependencies: { react: { version: "19.3.0", artifact: runtimeHash("changed artifact bytes") } } };
    const changed = prepareRuntimeAssembly({ ...input, layout: { ...input.layout, descriptor: { ...input.layout.descriptor, renderer: { ...input.layout.descriptor.renderer, source, sourceHash: runtimeHash(source) } } } });
    expect(changed.status).toBe("ready"); if (before.status === "ready" && changed.status === "ready") expect(changed.assembly.snapshot.hash).not.toBe(before.assembly.snapshot.hash);
    expect(prepareRuntimeAssembly({ ...input, states: ["default", "loading"] }).status).toBe("refused");
  });
});

it("binds synthetic consumer glyph payload changes and component descriptors", async () => {
  const input = fixture();
  const all = (await import("./index.js")).loadCatalog();
  const glyphSlot = all.slots.find(slot => slot.id === "assets.icon-close")!;
  const catalog = { ...input.engine.catalog, values: { ...input.engine.catalog.values, slots: [...input.engine.catalog.values.slots, glyphSlot, all.slots.find(slot => slot.id === "assets.favicon")!], fills: [...input.engine.catalog.values.fills, ...all.fills.filter(fill => fill.$extensions["com.clossys.fill"].slot === glyphSlot.id)] } };
  const adopted = applyLibraryChange(catalog, input.engine.library, { baseHash: libraryHash(input.engine.library), changes: [{ portion: "values", change: { op: "adopt", slot: glyphSlot.id, source: "lucide" } }, { portion: "values", change: { op: "author", slot: "assets.favicon", tokens: { vector: { $type: "svg", $value: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" color="#000000"><style>@media (prefers-color-scheme: dark){svg{color:#ffffff}}</style><path d="M4 4h16v16H4z" fill="currentColor"/></svg>' } } } }] });
  const bind = (library: typeof adopted) => {
    const hash = libraryHash(library) as `sha256:${string}`;
    return { ...input, engine: { catalog, library }, ports: { ...input.ports, manifest: { ...input.ports.manifest, libraryHash: hash, selectionHash: hash, assetClosure: { complete: true, ids: [glyphSlot.id] } } } };
  };
  const first = prepareRuntimeAssembly(bind(adopted)); expect(first.status, JSON.stringify(first)).toBe("ready");
  const changed = applyLibraryChange(catalog, adopted, { baseHash: libraryHash(adopted), changes: [{ portion: "values", change: { op: "author", slot: glyphSlot.id, tokens: { default: { $type: "glyph", $value: [["path", { d: "M2 2h8" }]] } } } }] });
  const second = prepareRuntimeAssembly(bind(changed)); expect(second.status, JSON.stringify(second)).toBe("ready");
  if (first.status === "ready" && second.status === "ready") expect(second.assembly.snapshot.hash).not.toBe(first.assembly.snapshot.hash);
  // A component descriptor cannot disappear behind a refreshed facade/library hash.
  const { adoptedComponentIntegration } = await import("./__fixtures__/component-integration.js");
  const { componentTokensHash } = await import("./check-components.js");
  const { cssText } = await import("./model.js");
  const component = adoptedComponentIntegration();
  const pixels = resolve(input.engine).values.members;
  const tokens = Object.fromEntries(Object.entries(pixels).filter(([, member]) => member.slot === "tokens.breakpoint").map(([id, member]) => [id.slice("tokens.breakpoint.".length), { $type: "dimension" as const, $value: member.value.light }]));
  component.library = applyLibraryChange(component.catalog, component.library, { baseHash: libraryHash(component.library), changes: [{ portion: "values", change: { op: "author", slot: "tokens.breakpoint", tokens } }] });
  const { source, adoptedAt, values } = component.library;
  const profile = resolve({ catalog: component.catalog.values, library: { ...values, source, adoptedAt } });
  // SYNTHETIC fixture evidence binds all actual emitted outputs, including open @theme members.
  const observations = Object.fromEntries([...emittedTokenProperties(profile)].map(([id, output]) => {
    const member = profile.members[id]!;
    return [id, { property: output.property, light: member.alias.light ? cssText(member.$type, member.value.light) : member.css.light, ...(member.value.dark === undefined ? {} : { dark: member.alias.dark ? cssText(member.$type, member.value.dark) : member.css.dark! }) }];
  }));
  const incomplete = Object.fromEntries(Object.entries(observations).filter(([id]) => id !== "tokens.breakpoint.sm"));
  component.componentOptions!.evidence!.observations["components.button"]!.tokensHash = componentTokensHash(incomplete);
  const stale = resolve(component).check.findings.filter(finding => finding.severity === "error");
  expect(stale).toEqual(expect.arrayContaining([expect.objectContaining({ code: "K5" }), expect.objectContaining({ code: "K6" })]));
  component.componentOptions!.evidence!.observations["components.button"]!.tokensHash = componentTokensHash(observations);
  const configure = () => {
    const runtime = standardM1Runtime({ engine: component, identity: input.identity, source: input.layout.descriptor.renderer.source, css: input.css });
    return { ...runtime, ports: { ...runtime.ports, manifest: { ...runtime.ports.manifest, assetClosure: { complete: true, ids: ["assets.icon-close"] } } } };
  };
  const before = prepareRuntimeAssembly(configure()); expect(before.status, JSON.stringify(before)).toBe("ready");
  component.library.components.fills[0]!.components.button!.license = "ISC";
  const after = prepareRuntimeAssembly(configure());
  expect(after.status).not.toBe("pending");
  if (after.status === "ready" && before.status === "ready") expect(after.assembly.snapshot.hash).not.toBe(before.assembly.snapshot.hash);
});
