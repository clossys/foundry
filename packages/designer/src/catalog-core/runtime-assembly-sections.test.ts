/** @vitest-environment node */
/** Section content channels in runtime assembly: anatomy header copy, band children and per-leaf Section hosts. */
import { beforeAll, describe, expect, it } from "vitest";
import { packageSurfaceLibrary, type PackageSurfaceLibrary } from "../library-cli/__fixtures__/package-surface-library.js";
import { libraryHash, resolve } from "./api.js";
import { loadBuildCatalog } from "./index.js";
import { prepareRuntimeAssembly, type RuntimeAssemblyInput, type RuntimeFillSelection } from "./runtime-assembly.js";
import { checkConsumerRuntimePorts, runtimeHash, SECTION_HEADER_CONTENT_KEY, type RuntimeContentRef, type RuntimeFillDescriptor, type RuntimeJson, type RuntimeRenderInput, type RuntimeRendererDescriptor } from "./runtime-ports.js";
import { surfaceRuntimeIdentity } from "./surface-check.js";
import { surfaceEntryOf } from "./surface-library.js";
import type { CompositeEngineInput } from "./types.js";

let fixture: PackageSurfaceLibrary, engine: CompositeEngineInput;
beforeAll(async () => { fixture = await packageSurfaceLibrary(); engine = { catalog: fixture.catalog, library: fixture.library, surfaceOptions: fixture.options }; }, 120_000);

const FRAME = "frames.site-shell";
function packageRenderer(leaf: string, module: string): RuntimeRendererDescriptor {
  const row = fixture.packages.find(evidence => evidence.module === module)!;
  const name = module.split("/").slice(0, 2).join("/"), entry = `${leaf.replace(".", "/")}/index.ts`;
  const source = { entry, files: { [entry]: `export * from "${module}";\n` }, dependencies: { [name]: { version: row.version, artifact: `sha256:${row.artifactSha256}` as const } } };
  return { id: `package:${leaf}`, source, sourceHash: runtimeHash(source) };
}

interface Options {
  /** The body slot's Sections, built from `select`. */
  readonly body: (select: (leaf: string, extra?: Partial<RuntimeFillSelection>) => RuntimeFillSelection) => readonly RuntimeFillSelection[];
  /** Resolved content values by reference ref; any other ref resolves to its own text. */
  readonly values?: Readonly<Record<string, RuntimeJson>>;
  readonly sectionHosts?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly seen?: RuntimeRenderInput<string>[];
}
/** One frame plus one layout slot, with every Section leaf the body names (nested children included) in the manifest. */
function assembly({ body, values = {}, sectionHosts, seen = [] }: Options): RuntimeAssemblyInput<string> {
  const profile = resolve(engine);
  const contracts = { ...loadBuildCatalog(), slots: [...engine.catalog.surfaces!.slots] };
  const required = (leaf: string): Record<string, RuntimeContentRef> => {
    const contract = contracts.slots.find(slot => slot.id === leaf)!.contract as { kind: string; slots: { id?: string; name?: string; type?: string; required?: boolean; accepts?: string }[] };
    const rows = contract.kind === "section" ? contract.slots.filter(slot => slot.required) : contract.slots.filter(slot => slot.required && slot.accepts === "host-node");
    return Object.fromEntries(rows.map(slot => [contract.kind === "section" ? slot.name! : slot.id!, { kind: (contract.kind === "section" ? slot.type : "region") as RuntimeContentRef["kind"], ref: `content:${leaf}:${slot.name ?? slot.id}` }]));
  };
  const fillId = (leaf: string) => profile.surfaces!.fills[leaf]!.document.$extensions["com.clossys.fill"].id;
  const select = (leaf: string, extra: Partial<RuntimeFillSelection> = {}): RuntimeFillSelection => ({ leaf: leaf as `sections.${string}`, fill: fillId(leaf), config: null, members: [], ...extra, content: { ...required(leaf), ...extra.content } });
  const sections = body(select);
  const leaves = new Set<string>([FRAME]);
  const visit = (rows: readonly RuntimeFillSelection[]) => { for (const row of rows) { leaves.add(row.leaf); visit(row.children ?? []); } };
  visit(sections);
  const fills: RuntimeFillDescriptor[] = [...leaves].map(leaf => {
    const row = profile.surfaces!.fills[leaf]!, entry = surfaceEntryOf(row.document) as unknown as { slotMap?: object; slots?: object; members?: string[]; propMap: object; impl: { module: string } };
    return { kind: leaf.startsWith("frames.") ? "frame" : "section", leaf: leaf as `sections.${string}`, fill: fillId(leaf), library: engine.library.source.id, config: null, slots: Object.keys(entry.slotMap ?? entry.slots!), members: entry.members ?? Object.keys(entry.propMap), states: ["default"], surface: surfaceRuntimeIdentity(row), renderer: packageRenderer(leaf, entry.impl.module) };
  });
  const frame = fills.find(fill => fill.leaf === FRAME)!;
  // Each renderer records its input and prints its leaf with any nested slot nodes, so composition is visible.
  const render = (input: RuntimeRenderInput<string>) => { seen.push(input); const nested = Object.entries(input.slots).map(([slot, nodes]) => `${slot}:${nodes.join(",")}`).join(";"); return nested ? `${input.fill.leaf}[${nested}]` : input.fill.leaf; };
  return {
    identity: { kind: "artifact", name: "section channels", sha256: runtimeHash(fixture.packages) }, engine, contracts,
    ports: {
      manifest: { version: 1, consumer: engine.library.source.id, libraryHash: libraryHash(engine.library) as `sha256:${string}`, selectionHash: profile.selectionHash as `sha256:${string}`, fills, assetClosure: { complete: true, ids: [] } },
      renderers: Object.fromEntries(fills.map(fill => [fill.renderer.id, render])),
      resolveContent: (reference: RuntimeContentRef) => { const value = Object.hasOwn(values, reference.ref) ? values[reference.ref]! : reference.ref; return { reference, value, hash: runtimeHash(value) }; },
      ...(sectionHosts ? { sectionHosts } : {}),
    },
    binding: { id: "section-channels", frame: { leaf: FRAME, fill: fillId(FRAME), config: null, members: [], content: required(FRAME) }, frameSlots: {}, sections: { body: sections } },
    layout: { descriptor: { library: engine.library.source.id, fill: "section-channels/layout", leaf: "layouts.stack", config: "single", members: {}, slots: [{ id: "body", min: 1, max: sections.length, accepts: sections.map(row => row.leaf as `sections.${string}`) }], breakpoints: [], states: ["default"], renderer: frame.renderer }, render: ({ slots }) => slots.body!.join("|"), expectedOrder: (_cell, paths) => paths.body! },
    themes: ["light"], states: ["default"], css: [{ id: "explicit", contents: "/* explicit */" }], assets: [],
    breakpointPixels: Object.fromEntries(Object.entries(profile.values.members).filter(([id]) => id.startsWith("tokens.breakpoint.")).flatMap(([id, member]) => { const value = member.value.light as { unit?: string; value?: number }; return value?.unit === "px" ? [] : [[id, Math.round(value.value! * 16)]]; })),
    breakpointBasis: { renderer: frame.renderer, environment: { rootFontSize: 16 } },
  } as unknown as RuntimeAssemblyInput<string>;
}
const header = (ref = "header:empty"): Record<string, RuntimeContentRef> => ({ [SECTION_HEADER_CONTENT_KEY]: { kind: "copy", ref } });
function drawn(input: RuntimeAssemblyInput<string>): string {
  const result = prepareRuntimeAssembly(input);
  if (result.status !== "ready") throw new Error(JSON.stringify(result));
  return result.assembly.render(result.assembly.snapshot.cells[0]!);
}

describe("Section content channels", () => {
  it("admits anatomy header copy checked against the section-header contract", () => {
    const seen: RuntimeRenderInput<string>[] = [];
    drawn(assembly({ seen, body: select => [select("sections.empty-state", { content: header() })], values: { "header:empty": { heading: "No orders yet", description: "Orders appear here." } } }));
    expect(seen.find(input => input.fill.leaf === "sections.empty-state")!.content[SECTION_HEADER_CONTENT_KEY]!.value).toEqual({ heading: "No orders yet", description: "Orders appear here." });
    const refused = (value: RuntimeJson, ref: RuntimeContentRef["kind"] = "copy") => prepareRuntimeAssembly(assembly({ body: select => [select("sections.empty-state", { content: { [SECTION_HEADER_CONTENT_KEY]: { kind: ref, ref: "header:bad" } } })], values: { "header:bad": value } }));
    expect(refused({ description: "No heading" })).toMatchObject({ status: "refused", findings: [expect.stringContaining("header anatomy heading is required")] });
    expect(refused({ heading: "Notices", label: "Live notices" })).toMatchObject({ status: "refused", findings: [expect.stringContaining("header anatomy has no label slot")] });
    expect(refused({ heading: "Too many", actions: [{ label: "a" }, { label: "b" }, { label: "c" }] })).toMatchObject({ status: "refused", findings: [expect.stringContaining("must list 1-2 action records")] });
    expect(refused({ heading: "Region" }, "region")).toMatchObject({ status: "refused", findings: [expect.stringContaining("wrong content kind")] });
    // A leaf without header anatomy (the band itself) has no such channel.
    expect(prepareRuntimeAssembly(assembly({ body: select => [select("sections.band", { content: header() })], values: { "header:empty": { heading: "Band" } } }))).toMatchObject({ status: "refused", findings: [expect.stringContaining("unknown content slot")] });
  });

  it("nests Sections inside the band their contracts name, in reading order", () => {
    const seen: RuntimeRenderInput<string>[] = [];
    const html = drawn(assembly({ seen, body: select => [select("sections.band", { members: [], children: [select("sections.faq"), select("sections.empty-state")] })] }));
    expect(html).toContain("sections.band[children:sections.faq,sections.empty-state]");
    expect(seen.map(input => input.path)).toEqual(expect.arrayContaining(["sections.body.0", "sections.body.0.children.0", "sections.body.0.children.1"]));
    const nest = (parent: string, child: string) => prepareRuntimeAssembly(assembly({ body: select => [select(parent, { children: [select(child)] })] }));
    expect(nest("sections.faq", "sections.empty-state")).toMatchObject({ status: "refused", findings: [expect.stringContaining("does not take sections.faq as its band")] });
    expect(nest("sections.band", "sections.band")).toMatchObject({ status: "refused", findings: [expect.stringContaining("does not take sections.band as its band")] });
    expect(prepareRuntimeAssembly(assembly({ body: select => [select("sections.band", { children: [] })] }))).toMatchObject({ status: "refused", findings: [expect.stringContaining("children must be a non-empty Section list")] });
  });

  it("admits the native band header followed by its data-table without weakening the child gate", () => {
    const html = drawn(assembly({ body: select => [select("sections.band", { children: [select("sections.section-header"), select("sections.data-table")] })] }));
    expect(html).toContain("sections.band[children:sections.section-header,sections.data-table]");
    const invalid = prepareRuntimeAssembly(assembly({ body: select => [select("sections.data-table", { children: [select("sections.section-header")] })] }));
    expect(invalid).toMatchObject({ status: "refused", findings: [expect.stringContaining("does not take sections.data-table as its band")] });
  });

  it("delivers a Section host only to Sections of its leaf, never the Frame", () => {
    const seen: RuntimeRenderInput<string>[] = [], host = { previews: { marker: "board" } };
    drawn(assembly({ seen, sectionHosts: { "sections.faq": host }, body: select => [select("sections.faq"), select("sections.empty-state")] }));
    expect(seen.find(input => input.fill.leaf === "sections.faq")!.sectionHost).toBe(host);
    expect(seen.find(input => input.fill.leaf === "sections.empty-state")!.sectionHost).toBeUndefined();
    expect(seen.find(input => input.path === "frame")!.sectionHost).toBeUndefined();
    const input = assembly({ sectionHosts: { [FRAME]: {}, "sections.faq": [] as unknown as Record<string, unknown> }, body: select => [select("sections.faq")] });
    const check = checkConsumerRuntimePorts(input.ports, input.contracts, { consumer: input.ports.manifest.consumer, libraryHash: input.ports.manifest.libraryHash, selectionHash: input.ports.manifest.selectionHash });
    expect(check.findings.filter(finding => finding.path === "sectionHosts").map(finding => finding.message)).toEqual([`section host key ${FRAME} is not a Section leaf`, "section host sections.faq must be a record"]);
  });
});
