/** SYNTHETIC source-only fixture. It qualifies no real Foundry component. */
import { applyLibraryChange, libraryHash, resolve } from "../../api.js";
import { componentIntegration } from "../component-integration.js";
import { surfaceDigest, surfaceDescriptorHash, surfaceDerivationHash, surfaceDocument, surfaceManifest, surfaceOf, surfaceInputs } from "../../surface-library.js";
import { sha256 } from "../../digest.js";
import { stableStringify } from "../../stable.js";
import type { CompositeEngineInput, FrameSlot } from "../../types.js";
import type { SectionSlot } from "../../sections-contract.js";
import type { SurfaceCandidate, SurfaceSourceBundle, SurfaceTransform, SurfaceBase, SurfaceMaterializationReceipt } from "../../surface-types.js";
export function syntheticSurface(options: {
    layer?: "sections" | "frames";
    leaf?: string;
    shared?: boolean;
    sharedContent?: string;
    secondary?: boolean;
} = {}) {
    const layer = options.layer ?? "sections", leaf = options.leaf ?? "synthetic", primary = leaf.split("-").map(part => part[0]!.toUpperCase() + part.slice(1)).join("");
    const slotId = `${layer}.${leaf}` as import("../../surface-types.js").SurfaceSlot;
    const input: CompositeEngineInput = componentIntegration();
    const slot: SectionSlot | FrameSlot = layer === "frames" ? { id: slotId, layer: "frames", requires: [], status: "draft", contract: { kind: "frame", root: "div", landmarks: [], slots: [{ id: "main", required: true, accepts: "view" }], members: { mode: "closed", names: [] }, statePorts: [], rendering: "server", breakpoints: [], layers: [], allowedReads: { tokens: [], assets: [] } } } : { id: slotId, layer: "sections", requires: [], status: "draft", contract: { kind: "section", passageSchema: `passages.${slotId.slice("sections.".length)}`, copy: { sourceLocale: "en", fields: [] }, root: "section", anatomy: { band: null, header: null }, slots: [], members: { mode: "closed", names: [] }, allowedComposes: [], parts: [], allowedReads: { tokens: [], assets: [] }, data: "host-injected", surface: "both" } };
    const shared = { path: "surfaces/_parts/synthetic/shared.ts", content: options.sharedContent ?? 'export function helper() { return "SYNTHETIC"; }\n' };
    const text = (options.shared ? 'import { helper } from "../../surfaces/_parts/synthetic/shared.js";\n' : '') + `export function ${primary}() { return ${options.shared ? 'helper()' : '"SYNTHETIC"'}; }\n` + (options.secondary ? 'export function Caption() { return "CAPTION"; }\n' : '');
    const upstream = [{ path: "upstream/Synthetic.ts", content: text }, { path: "LICENSE", content: "SYNTHETIC fixture MIT license\n" }];
    const pin = { kind: "local-tree" as const, tree: "a".repeat(40), files: surfaceManifest(upstream) };
    const source = { path: `${layer}/${leaf}/${primary}.ts`, content: upstream[0]!.content };
    const notice = { path: `notices/surfaces/n-${sha256(upstream[1]!.content)}.txt`, content: upstream[1]!.content };
    const common: Omit<import("../../surface-types.js").SurfaceSectionEntry, "kind" | "slot" | "slotMap" | "configs"> = { source: "synthetic", impl: { kind: "source" as const, entry: source.path, export: primary }, rendering: "server" as const, members: [], states: ["default"], reads: { tokens: [], assets: [] }, composes: [], parts: [], api: { version: 1, exports: [{ name: primary, export: primary }, ...(options.secondary ? [{ name: primary + "Caption", export: "Caption" }] : [])] }, bindings: [], dependencies: [], license: "MIT", pin, notice: notice.path, outputSha256: surfaceManifest([source, notice]), blockers: [], propMap: {} };
    const candidate: SurfaceCandidate = layer === "sections" ? { ...common, kind: "section", slot: slotId as `sections.${string}`, slotMap: {}, configs: {} } : { ...common, kind: "frame", slot: slotId as `frames.${string}`, slots: { main: { export: primary, path: ["children"] } }, statePorts: {} };
    const meta = { id: `synthetic/${slotId}`, slot: candidate.slot, source: candidate.source, mode: "implementation" as const, sourceAddress: "upstream/Synthetic.ts", relation: "same-contract" as const, builtOn: [], conforms: [], evidence: [], author: "third-party" as const, trust: "pinned-upstream" as const, license: "MIT", status: "draft" as const };
    const recipe = [{ path: "recipe/synthetic.ts", content: `SYNTHETIC registered relocation ${slotId} v1\n` }];
    const transform: SurfaceTransform = { identity: { id: `synthetic-relocate-${layer}-${leaf}`, version: "1", sha256: surfaceDigest(surfaceManifest(recipe)).slice(7) }, source: recipe, run: ({ candidate }) => ({ fill: candidate, files: [source, notice, ...(options.shared ? [shared] : [])], blockers: [] }) };
    const base: SurfaceBase = { source: candidate.source, fill: meta.id, license: "MIT", pin, descriptorHash: surfaceDescriptorHash(candidate), upstreamSha256: surfaceManifest(upstream), notices: [{ path: "LICENSE", sha256: sha256(upstream[1]!.content) }] };
    input.catalog.surfaces = { slots: [slot], fills: [layer === "sections" ? { $extensions: { "com.clossys.fill": meta }, sections: { [leaf]: candidate as import("../../surface-types.js").SurfaceSectionEntry } } : { $extensions: { "com.clossys.fill": meta }, frames: { [leaf]: candidate as import("../../surface-types.js").SurfaceFrameEntry } }], transforms: [transform], rules: [], materializations: [] };
    const receiptText = stableStringify({ version: 1, base, transform: transform.identity, rule: null, inputs: [] });
    const receipt = { path: `surfaces/receipts/r-${sha256(receiptText)}.json`, content: receiptText };
    const files = [source, notice, receipt, ...(options.shared ? [shared] : [])];
    const fill = { ...candidate, source: input.library.source.id, outputSha256: surfaceManifest(files) };
    const descriptorHash = surfaceDescriptorHash(fill), inputsHash = surfaceDerivationHash(base, transform.identity, null, input.catalog, candidate.slot, []);
    const document = surfaceDocument(input.library, { ...fill, origin: { kind: "adopted", base, transform: transform.identity, descriptorHash, adoptedAt: input.library.adoptedAt! } });
    const expected: SurfaceMaterializationReceipt = { operation: "adopt", slot: candidate.slot, baseDescriptorHash: base.descriptorHash, transform: transform.identity, rule: null, inputsHash, descriptorHash, outputSha256: fill.outputSha256 };
    input.catalog.surfaces.materializations = [expected];
    input.surfaceOptions = { packages: [], measurements: [] };
    const bundle: SurfaceSourceBundle = { version: 1, operation: "adopt", slot: candidate.slot, document, base, upstream: [...upstream].sort((a, b) => a.path < b.path ? -1 : 1), files, transform: transform.identity, rule: null, inputs: [], inputsHash };
    const fetch = async ({ path }: {
        path: string;
    }) => upstream.find(file => file.path === path)!.content;
    return { input, bundle, candidate, transform, upstream, source, notice, fetch };
}
export function adoptedSurface() { const fixture = syntheticSurface(); const { input, bundle } = fixture; input.library = applyLibraryChange(input.catalog, input.library, { baseHash: libraryHash(input.library), changes: [{ portion: "surfaces", change: { op: "adopt", slot: "sections.synthetic", source: "synthetic" } }], surfaceBundles: [bundle] }, { componentOptions: input.componentOptions, surfaceOptions: input.surfaceOptions! }); return fixture; }
export function syntheticDerivation(fixture: ReturnType<typeof adoptedSurface>, inputs: readonly import("../../surface-types.js").SurfaceInputRef[] = [{ kind: "value", id: "tokens.text-color.primary" }]) {
    const { input, bundle } = fixture;
    const source = [{ path: "rules/synthetic-derive.ts", content: "SYNTHETIC derive v1\n" }];
    const identity = { id: `synthetic-derive-${bundle.slot}`, version: "1", sha256: surfaceDigest(surfaceManifest(source)).slice(7) };
    const rule: import("../../surface-types.js").SurfaceRule = { identity, source, slot: bundle.slot, base: bundle.base, inputs, run: ({ base }) => ({ fill: base, files: [fixture.source, fixture.notice], blockers: [] }) };
    input.catalog.surfaces!.rules = [...input.catalog.surfaces!.rules.filter(existing => existing.identity.id !== rule.identity.id), rule];
    const actual = surfaceInputs(input.catalog, input.library, resolve(input), inputs, input.surfaceOptions!);
    const inputsHash = surfaceDerivationHash(bundle.base, bundle.transform, identity, input.catalog, bundle.slot, actual);
    const text = stableStringify({ version: 1, base: bundle.base, transform: bundle.transform, rule: identity, inputs: actual });
    const files = [fixture.source, fixture.notice, { path: `surfaces/receipts/r-${sha256(text)}.json`, content: text }];
    const old = surfaceOf(bundle.document);
    const { origin: _origin, ...candidate } = old;
    const fill = { ...candidate, outputSha256: surfaceManifest(files) };
    const descriptorHash = surfaceDescriptorHash(fill);
    const document = surfaceDocument(input.library, { ...fill, origin: { kind: "derived", base: bundle.base, transform: bundle.transform, rule: identity, inputs: actual, inputsHash, descriptorHash } });
    const derived: SurfaceSourceBundle = { ...bundle, operation: "derive", document, files, rule: identity, inputs: actual, inputsHash };
    input.catalog.surfaces!.materializations = [...input.catalog.surfaces!.materializations, { operation: "derive", slot: bundle.slot, baseDescriptorHash: bundle.base.descriptorHash, transform: bundle.transform, rule: identity, inputsHash, descriptorHash, outputSha256: fill.outputSha256 }];
    return { rule, bundle: derived };
}
