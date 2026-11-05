/** @vitest-environment node */
/** Manifest producer and frame host port: a library's adopted package surfaces become an exact runtime manifest. */
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { packageSurfaceLibrary, type PackageSurfaceLibrary } from "../library-cli/__fixtures__/package-surface-library.js";
import { packageBarrelExports } from "../library-cli/surface-package-evidence.js";
import { resolve } from "./api.js";
import { sha256 } from "./digest.js";
import { loadBuildCatalog } from "./index.js";
import { prepareRuntimeAssembly, type RuntimeAssemblyInput } from "./runtime-assembly.js";
import { checkConsumerRuntimeManifest, checkConsumerRuntimePorts, runtimeHash, type RuntimeContentRef, type RuntimeFrameHost, type RuntimeRenderInput } from "./runtime-ports.js";
import { planSurfaceRuntime, type SurfaceRuntimePointer } from "./surface-runtime-manifest.js";
import type { SurfacePackageEvidence } from "./surface-types.js";
import type { CompositeEngineInput } from "./types.js";

let fixture: PackageSurfaceLibrary, engine: CompositeEngineInput, packages: SurfacePackageEvidence[];
/** Evidence read from this checkout's source barrel, the artifact the next release builds from. */
const sourceEvidence = (module: string, file: string): SurfacePackageEvidence => {
  const text = readFileSync(new URL(file, import.meta.url), "utf8"), inventory = packageBarrelExports(text);
  return { module, version: "0.12.0", artifactSha256: sha256(text), values: inventory.values, types: inventory.types };
};
beforeAll(async () => {
  fixture = await packageSurfaceLibrary();
  engine = { catalog: fixture.catalog, library: fixture.library, surfaceOptions: fixture.options };
  packages = [...fixture.packages.filter(row => !["@clossys/designer/frames", "@clossys/designer/shell"].includes(row.module)), sourceEvidence("@clossys/designer/frames", "../frames/index.ts"), sourceEvidence("@clossys/designer/shell", "../shell/index.ts")];
}, 120_000);
const REGISTRY: SurfaceRuntimePointer = { module: "@clossys/designer/frames", export: "surfaceRuntimeRenderers" };
const plan = (leaves: string[], renderers: Record<string, SurfaceRuntimePointer> = Object.fromEntries(leaves.map(leaf => [leaf, REGISTRY]))) => planSurfaceRuntime({ engine, packages, renderers, leaves });

function assembly(host: unknown, calls: { path: string; host: boolean }[]): RuntimeAssemblyInput<string> {
  const profile = resolve(engine), { manifest } = plan(["frames.app-shell", "sections.faq"]);
  const contracts = { ...loadBuildCatalog(), slots: [...engine.catalog.surfaces!.slots] };
  const content = (leaf: string) => {
    const contract = contracts.slots.find(slot => slot.id === leaf)!.contract as { kind: string; slots: { id?: string; name?: string; type?: string; required?: boolean; accepts?: string }[] };
    const required = contract.kind === "section" ? contract.slots.filter(slot => slot.required) : contract.slots.filter(slot => slot.required && slot.accepts === "host-node");
    return Object.fromEntries(required.map(slot => [contract.kind === "section" ? slot.name! : slot.id!, { kind: (contract.kind === "section" ? slot.type : "region") as RuntimeContentRef["kind"], ref: `content:${leaf}:${slot.name ?? slot.id}` }]));
  };
  const [frame, section] = manifest.fills;
  const select = (fill: typeof frame) => ({ leaf: fill!.leaf, fill: fill!.fill, config: null, members: [], content: content(fill!.leaf) });
  const record = (input: RuntimeRenderInput<string>) => { calls.push({ path: input.path, host: input.host !== undefined }); return input.fill.leaf + (input.slots.main ? `[${input.slots.main.join("")}]` : ""); };
  return {
    identity: { kind: "artifact", name: "l9 manifest assembly", sha256: runtimeHash(packages) }, engine, contracts,
    ports: { manifest, renderers: Object.fromEntries(manifest.fills.map(fill => [fill.renderer.id, record])), resolveContent: (reference: RuntimeContentRef) => ({ reference, value: reference.ref, hash: runtimeHash(reference.ref) }), ...(host === undefined ? {} : { frameHost: host }) },
    binding: { id: "l9-host", frame: select(frame), frameSlots: {}, sections: { body: [select(section)] } },
    layout: { descriptor: { library: engine.library.source.id, fill: "l9/layout", leaf: "layouts.stack", config: "single", members: {}, slots: [{ id: "body", min: 1, max: 1, accepts: [section!.leaf as `sections.${string}`] }], breakpoints: [], states: ["default"], renderer: frame!.renderer }, render: ({ slots }) => slots.body!.join(""), expectedOrder: (_cell, paths) => paths.body! },
    themes: ["light"], states: ["default"], css: [{ id: "explicit", contents: "/* explicit */" }], assets: [],
  } as unknown as RuntimeAssemblyInput<string>;
}

describe("planSurfaceRuntime", () => {
  it("derives a manifest the runtime checker accepts, bound to the library and the registry artifact", () => {
    const { manifest, gaps, origins } = plan(["frames.app-shell", "sections.faq"]);
    expect(gaps).toEqual([]);
    // WL7: each adopted consumer pointer maps to the package fill its renderer stamps.
    expect(origins[manifest.fills[0]!.fill]).toBe("foundry/frames.app-shell");
    expect(origins[manifest.fills[1]!.fill]).toBe("foundry/sections.faq");
    const profile = resolve(engine);
    expect(checkConsumerRuntimeManifest(manifest, { slots: [...engine.catalog.surfaces!.slots] }, { consumer: profile.consumer, libraryHash: manifest.libraryHash, selectionHash: profile.selectionHash })).toEqual({ status: "valid", findings: [] });
    const [frame, section] = manifest.fills;
    expect(frame).toMatchObject({ kind: "frame", leaf: "frames.app-shell", fill: `${profile.consumer}/frames.app-shell`, renderer: { id: "package:frames.app-shell" }, headerModule: { package: "@clossys/designer/shell", export: "PageHeaderModule" }, stageModule: { package: "@clossys/designer/frames", export: "FrameStage" } });
    expect(section).toMatchObject({ kind: "section", leaf: "sections.faq", renderer: { id: "package:sections.faq" } });
    expect(section!.headerModule).toBeUndefined();
    expect(Object.values(frame!.renderer.source.files)[0]).toContain(`surfaceRuntimeRenderers["frames.app-shell"]`);
    expect(frame!.renderer.source.dependencies["@clossys/designer"]!.artifact).toBe(`sha256:${packages.find(row => row.module === "@clossys/designer/frames")!.artifactSha256}`);
  });
  it("reports every leaf it cannot bind instead of inventing a renderer", () => {
    const { manifest, gaps } = plan(["frames.app-shell", "sections.faq", "sections.not-adopted"], { "frames.app-shell": { module: "@clossys/designer/frames", export: "NotExported" } });
    expect(manifest.fills).toEqual([]);
    expect(gaps).toEqual([
      { leaf: "frames.app-shell", reason: "renderer module evidence missing: @clossys/designer/frames#NotExported" },
      { leaf: "sections.faq", reason: "no package-owned renderer" },
      { leaf: "sections.not-adopted", reason: "no adopted surface fill" },
    ]);
  });
});

describe("frame host interaction port", () => {
  const host: RuntimeFrameHost<string> = { navigate: () => {}, beforeNavigate: () => true, onCommand: () => {}, icons: { home: "<home/>" }, panels: { inspector: "<panel/>" } };
  it("reaches the selected Frame renderer only, never a Section", () => {
    const calls: { path: string; host: boolean }[] = [];
    const prepared = prepareRuntimeAssembly(assembly(host, calls));
    expect(prepared.status, JSON.stringify(prepared)).toBe("ready");
    if (prepared.status !== "ready") return;
    expect(prepared.assembly.render(prepared.assembly.snapshot.cells[0]!)).toBe("frames.app-shell[sections.faq]");
    expect(calls).toEqual([{ path: "sections.body.0", host: false }, { path: "frame", host: true }]);
  });
  it("is optional, and refused when malformed", () => {
    expect(prepareRuntimeAssembly(assembly(undefined, [])).status).toBe("ready");
    const refused = prepareRuntimeAssembly(assembly({ onCommand: () => {} }, []));
    expect(refused).toMatchObject({ status: "refused", findings: [expect.stringContaining("frameHost: frame host navigate is required")] });
    const unknown = assembly({ navigate: () => {}, page: "<main/>" }, []);
    expect(checkConsumerRuntimePorts(unknown.ports, unknown.contracts, { consumer: resolve(engine).consumer, libraryHash: unknown.ports.manifest.libraryHash, selectionHash: unknown.ports.manifest.selectionHash }).findings).toContainEqual({ path: "frameHost", message: "frame host port carries an unknown key" });
  });
});
