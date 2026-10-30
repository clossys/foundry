/** @vitest-environment node */
/** Runtime assembly of package-pointer Sections and Frames: contract support is checked, module qualification is the pinned release's. */
import { beforeAll, describe, expect, it } from "vitest";
import { packageSurfaceLibrary, type PackageSurfaceLibrary } from "../library-cli/__fixtures__/package-surface-library.js";
import { libraryHash, resolve } from "./api.js";
import { loadBuildCatalog } from "./index.js";
import { loadSectionRegistry } from "./sections-contract.js";
import { prepareRuntimeAssembly, type RuntimeAssemblyInput } from "./runtime-assembly.js";
import { runtimeHash, type RuntimeContentRef, type RuntimeFillDescriptor, type RuntimeRendererDescriptor } from "./runtime-ports.js";
import { surfaceRuntimeIdentity } from "./surface-check.js";
import { surfaceEntryOf } from "./surface-library.js";
import type { CompositeEngineInput } from "./types.js";

let fixture: PackageSurfaceLibrary, engine: CompositeEngineInput;
beforeAll(async () => { fixture = await packageSurfaceLibrary(); engine = { catalog: fixture.catalog, library: fixture.library, surfaceOptions: fixture.options }; }, 120_000);

/** A renderer bound to the emitted pointer module and the exact installed package artifact it re-exports. */
function packageRenderer(leaf: string, module: string): RuntimeRendererDescriptor {
  const row = fixture.packages.find(evidence => evidence.module === module)!;
  const name = module.split("/").slice(0, 2).join("/"), entry = `${leaf.replace(".", "/")}/index.ts`;
  const source = { entry, files: { [entry]: `export * from "${module}";\n` }, dependencies: { [name]: { version: row.version, artifact: `sha256:${row.artifactSha256}` as const } } };
  return { id: `package:${leaf}`, source, sourceHash: runtimeHash(source) };
}
function assembly(frameLeaf: string, sectionLeaf: string, edit: (fill: RuntimeFillDescriptor) => RuntimeFillDescriptor = fill => fill): RuntimeAssemblyInput<string> {
  const profile = resolve(engine);
  const fills: RuntimeFillDescriptor[] = [frameLeaf, sectionLeaf].map(leaf => {
    const row = profile.surfaces!.fills[leaf]!, entry = surfaceEntryOf(row.document) as unknown as { slotMap?: object; slots?: object; members?: string[]; propMap: object; impl: { module: string } };
    return edit({ kind: leaf.startsWith("frames.") ? "frame" : "section", leaf: leaf as `sections.${string}`, fill: row.document.$extensions["com.clossys.fill"].id, library: engine.library.source.id, config: null, slots: Object.keys(entry.slotMap ?? entry.slots!), members: entry.members ?? Object.keys(entry.propMap), states: ["default"], surface: surfaceRuntimeIdentity(row), renderer: packageRenderer(leaf, entry.impl.module) });
  });
  const contracts = { ...loadBuildCatalog(), slots: [...engine.catalog.surfaces!.slots] };
  const content = (leaf: string) => {
    const contract = contracts.slots.find(slot => slot.id === leaf)!.contract as { kind: string; slots: { id?: string; name?: string; type?: string; required?: boolean; accepts?: string }[] };
    const required = contract.kind === "section" ? contract.slots.filter(slot => slot.required) : contract.slots.filter(slot => slot.required && slot.accepts === "host-node");
    return Object.fromEntries(required.map(slot => [contract.kind === "section" ? slot.name! : slot.id!, { kind: (contract.kind === "section" ? slot.type : "region") as RuntimeContentRef["kind"], ref: `content:${leaf}:${slot.name ?? slot.id}` }]));
  };
  const [frame, section] = fills as [RuntimeFillDescriptor, RuntimeFillDescriptor];
  const select = (fill: RuntimeFillDescriptor) => ({ leaf: fill.leaf, fill: fill.fill, config: null, members: [], content: content(fill.leaf) });
  return {
    identity: { kind: "artifact", name: "package-pointer assembly", sha256: runtimeHash(fixture.packages) }, engine, contracts,
    ports: { manifest: { version: 1, consumer: engine.library.source.id, libraryHash: libraryHash(engine.library) as `sha256:${string}`, selectionHash: profile.selectionHash as `sha256:${string}`, fills, assetClosure: { complete: true, ids: [] } }, renderers: Object.fromEntries(fills.map(fill => [fill.renderer.id, () => fill.leaf])), resolveContent: (reference: RuntimeContentRef) => ({ reference, value: reference.ref, hash: runtimeHash(reference.ref) }) },
    binding: { id: "package-pointer", frame: select(frame), frameSlots: {}, sections: { body: [select(section)] } },
    layout: { descriptor: { library: engine.library.source.id, fill: "package-pointer/layout", leaf: "layouts.stack", config: "single", members: {}, slots: [{ id: "body", min: 1, max: 1, accepts: [section.leaf as `sections.${string}`] }], breakpoints: [], states: ["default"], renderer: frame.renderer }, render: ({ slots }) => slots.body!.join(""), expectedOrder: (_cell, paths) => paths.body! },
    themes: ["light"], states: ["default"], css: [{ id: "explicit", contents: "/* explicit */" }], assets: [],
    // Relative breakpoint tokens need a measured pixel basis; a 16px root is stated as the measurement environment.
    breakpointPixels: Object.fromEntries(Object.entries(profile.values.members).filter(([id]) => id.startsWith("tokens.breakpoint.")).flatMap(([id, member]) => { const value = member.value.light as { unit?: string; value?: number }; return value?.unit === "px" ? [] : [[id, Math.round(value.value! * 16)]]; })),
    breakpointBasis: { renderer: frame.renderer, environment: { rootFontSize: 16 } },
  } as unknown as RuntimeAssemblyInput<string>;
}

describe("package-pointer runtime assembly", () => {
  it("assembles an adopted package Frame and Section without module measurements", () => {
    const result = prepareRuntimeAssembly(assembly("frames.site-shell", "sections.faq"));
    expect(result.status, JSON.stringify(result.status === "ready" ? result.status : result)).toBe("ready");
  });
  it("still refuses a descriptor whose contract support differs from the adopted pointer", () => {
    const contract = loadSectionRegistry().slots.find(slot => slot.id === "sections.faq")!.contract;
    const pointer = surfaceEntryOf(resolve(engine).surfaces!.fills["sections.faq"]!.document) as unknown as { propMap: object };
    // Contract-valid support the adopted pointer does not match: the port check accepts it, the surface join must not.
    const member = contract.members.names.find(name => !Object.hasOwn(pointer.propMap, name));
    expect(member).toBeDefined();
    // A descriptor claiming fewer slots than the pointer maps is as different as one claiming more.
    const content = surfaceEntryOf(resolve(engine).surfaces!.fills["sections.content"]!.document) as unknown as { slotMap: object };
    const optional = loadSectionRegistry().slots.find(slot => slot.id === "sections.content")!.contract.slots.filter(row => !row.required).map(row => row.name).find(name => Object.hasOwn(content.slotMap, name));
    expect(optional).toBeDefined();
    const slots = prepareRuntimeAssembly(assembly("frames.site-shell", "sections.content", fill => fill.leaf === "sections.content" ? { ...fill, slots: fill.slots.filter(name => name !== optional) } : fill));
    expect(slots).toMatchObject({ status: "refused", findings: [expect.stringContaining("S7 surface contract support differs")] });
    const members = prepareRuntimeAssembly(assembly("frames.site-shell", "sections.faq", fill => fill.leaf === "sections.faq" ? { ...fill, members: [...fill.members, member!] } : fill));
    expect(members).toMatchObject({ status: "refused", findings: [expect.stringContaining("S7 surface contract support differs")] });
    const config = prepareRuntimeAssembly(assembly("frames.site-shell", "sections.faq", fill => fill.leaf === "sections.faq" ? { ...fill, config: "unknown-config" } : fill));
    expect(config).toMatchObject({ status: "refused", findings: [expect.stringContaining("S7 surface config differs")] });
  });
});
