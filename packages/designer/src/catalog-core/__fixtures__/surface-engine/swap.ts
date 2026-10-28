/**
 * SYNTHETIC swap-through fixture. A source-kind `sections.form` whose relocated upstream imports the
 * package `Button` directly, over the bounded component integration corpus. It qualifies no real
 * Foundry section or component.
 */
import { adoptedComponentIntegration } from "../component-integration.js";
import { readSurfacePackageEvidence } from "../../../library-cli/surface-package-evidence.js";
import { applyLibraryChange, libraryHash } from "../../api.js";
import { materializeSurfaceSourceFill, bindSelectedComponentsRule, surfaceDerivationProfile, COMPONENTS_PACKAGE_MODULE } from "../../surface-materialize.js";
import { surfaceDerivationHash, surfaceDescriptorHash, surfaceDigest, surfaceInputs, surfaceManifest } from "../../surface-library.js";
import { stableStringify } from "../../stable.js";
import { sha256 } from "../../digest.js";
import type { CompositeEngineInput, CompositeLibraryData } from "../../types.js";
import type { SectionSlot } from "../../sections-contract.js";
import type { SurfaceBase, SurfaceCandidate, SurfaceCandidateDocument, SurfaceFile, SurfaceInputIdentity, SurfaceMaterializationReceipt, SurfacePackageDocument, SurfaceRule, SurfaceSectionEntry, SurfaceSourceBundle, SurfaceTransform } from "../../surface-types.js";

const SLOT = "sections.form" as const;
const UPSTREAM = 'import { Button } from "@clossys/designer/components";\nexport function Form() { return <Button>Send</Button>; }\n';

/** Evidence for the components barrel, read through the host reader rather than redone here. */
export async function componentsPackageEvidence() {
  const pointer: SurfacePackageDocument = { $extensions: { "com.clossys.fill": { id: "synthetic/sections.pointer", slot: SLOT, source: "synthetic", mode: "implementation", sourceAddress: "./components#Button", relation: "same-contract", builtOn: [], conforms: [], evidence: [], author: "third-party", trust: "pinned-upstream", license: "MIT", status: "draft" } }, sections: { pointer: { slot: SLOT, source: "synthetic", slotMap: {}, propMap: {}, configs: {}, parts: [], impl: { kind: "package", module: COMPONENTS_PACKAGE_MODULE, export: "Button" }, license: "MIT", pin: { package: "@clossys/designer", version: "0.12.0", export: "./components#Button" }, notes: [] } } };
  return readSurfacePackageEvidence([pointer]);
}

/**
 * The registry's immutable receipt for one materialization, computed the way the materializer computes it
 * (the materializer then re-verifies it). `rule` null is a plain adoption.
 */
function receipt(input: CompositeEngineInput, slot: typeof SLOT, base: SurfaceBase, transform: SurfaceTransform, candidate: SurfaceCandidate, upstream: readonly SurfaceFile[], rule: SurfaceRule | null, library: CompositeLibraryData): SurfaceMaterializationReceipt {
  let output = transform.run({ candidate, upstream });
  let inputs: SurfaceInputIdentity[] = [];
  if (rule) {
    const resolved = surfaceDerivationProfile({ catalog: input.catalog, library, componentOptions: input.componentOptions, surfaceOptions: input.surfaceOptions });
    inputs = surfaceInputs(input.catalog, library, resolved, rule.inputs, input.surfaceOptions!);
    output = rule.run({ base: output.fill, upstream, library, resolved });
  }
  const text = stableStringify({ version: 1, base, transform: transform.identity, rule: rule?.identity ?? null, inputs });
  const files = [...output.files, { path: `surfaces/receipts/r-${sha256(text)}.json`, content: text }];
  const fill = { ...output.fill, source: library.source.id, outputSha256: surfaceManifest(files), blockers: output.blockers };
  return { operation: rule ? "derive" : "adopt", slot, baseDescriptorHash: base.descriptorHash, transform: transform.identity, rule: rule?.identity ?? null, inputsHash: surfaceDerivationHash(base, transform.identity, rule?.identity ?? null, input.catalog, slot, inputs), descriptorHash: surfaceDescriptorHash(fill), outputSha256: fill.outputSha256 };
}

export async function swapSurface() {
  const input = adoptedComponentIntegration();
  const packages = await componentsPackageEvidence();
  const evidence = packages.find(row => row.module === COMPONENTS_PACKAGE_MODULE)!;
  const slot: SectionSlot = { id: SLOT, layer: "sections", requires: [], status: "draft", contract: { kind: "section", passageSchema: `passages.${SLOT.slice("sections.".length)}`, copy: { sourceLocale: "en", fields: [] }, root: "section", anatomy: { band: null, header: null }, slots: [], members: { mode: "closed", names: [] }, allowedComposes: ["components.button"], parts: [], allowedReads: { tokens: [], assets: [] }, data: "host-injected", surface: "both" } };
  const upstream = [{ path: "upstream/Form.ts", content: UPSTREAM }, { path: "LICENSE", content: "SYNTHETIC fixture MIT license\n" }];
  const pin = { kind: "local-tree" as const, tree: "b".repeat(40), files: surfaceManifest(upstream) };
  const source = { path: "sections/form/Form.ts", content: UPSTREAM };
  const notice = { path: `notices/surfaces/n-${sha256(upstream[1]!.content)}.txt`, content: upstream[1]!.content };
  const candidate: SurfaceSectionEntry = { kind: "section", slot: SLOT, source: "synthetic", impl: { kind: "source", entry: source.path, export: "Form" }, rendering: "server", members: [], states: ["default"], reads: { tokens: [], assets: [] }, composes: ["components.button"], parts: [], api: { version: 1, exports: [{ name: "Form", export: "Form" }] }, bindings: [], dependencies: [{ module: COMPONENTS_PACKAGE_MODULE, version: evidence.version, license: "MIT" }], license: "MIT", pin, notice: notice.path, outputSha256: surfaceManifest([source, notice]), blockers: [], propMap: {}, slotMap: {}, configs: {} };
  const doc: SurfaceCandidateDocument = { $extensions: { "com.clossys.fill": { id: `synthetic/${SLOT}`, slot: SLOT, source: "synthetic", mode: "implementation", sourceAddress: "upstream/Form.ts", relation: "same-contract", builtOn: [], conforms: [], evidence: [], author: "third-party", trust: "pinned-upstream", license: "MIT", status: "draft" } }, sections: { form: candidate } };
  const recipe = [{ path: "recipe/synthetic-form.ts", content: `SYNTHETIC registered relocation ${SLOT} v1\n` }];
  const transform: SurfaceTransform = { identity: { id: "synthetic-relocate-sections-form", version: "1", sha256: surfaceDigest(surfaceManifest(recipe)).slice(7) }, source: recipe, run: ({ candidate }) => ({ fill: candidate, files: [source, notice], blockers: [] }) };
  input.catalog.surfaces = { slots: [slot], fills: [doc], transforms: [transform], rules: [], materializations: [] };
  input.surfaceOptions = { packages, measurements: [] };
  const base: SurfaceBase = { source: "synthetic", fill: `synthetic/${SLOT}`, license: "MIT", pin, descriptorHash: surfaceDescriptorHash(candidate), upstreamSha256: surfaceManifest(upstream), notices: [{ path: "LICENSE", sha256: sha256(upstream[1]!.content) }] };
  const record = (rule: SurfaceRule | null, library: CompositeLibraryData) => { input.catalog.surfaces!.materializations = [...input.catalog.surfaces!.materializations, receipt(input, SLOT, base, transform, candidate, upstream, rule, library)]; };
  const fetch = async ({ path }: { path: string }) => upstream.find(file => file.path === path)!.content;
  const options = () => ({ componentOptions: input.componentOptions, surfaceOptions: input.surfaceOptions! });
  /** Plain adoption: the relocated source keeps its package import (the bypass state). */
  const adopt = async () => {
    record(null, input.library);
    const bundle = await materializeSurfaceSourceFill({ catalog: input.catalog, library: input.library, slot: SLOT, source: "synthetic", transform: transform.identity.id, rule: null, fetch, componentOptions: input.componentOptions, surfaceOptions: input.surfaceOptions! });
    input.library = applyLibraryChange(input.catalog, input.library, { baseHash: libraryHash(input.library), changes: [{ portion: "surfaces", change: { op: "adopt", slot: SLOT, source: "synthetic" } }], surfaceBundles: [bundle] }, options());
    return bundle;
  };
  /** Registers `bind-selected-components@1` over the retained adopted base. */
  const register = (base: SurfaceSourceBundle["base"], components: readonly `components.${string}`[] = ["components.button"]) => {
    const rule = bindSelectedComponentsRule({ slot: SLOT, base, transform, candidate: candidate as SurfaceCandidate, components, packages });
    input.catalog.surfaces!.rules = [...input.catalog.surfaces!.rules.filter(row => !(row.slot === SLOT && row.identity.id === rule.identity.id)), rule];
    return rule;
  };
  /** Materializes the derivation against the given library (defaults to the current one). */
  const derive = async (library = input.library) => {
    const rule = input.catalog.surfaces!.rules.find(row => row.slot === SLOT)!;
    record(rule, library);
    const bundle = await materializeSurfaceSourceFill({ catalog: input.catalog, library, slot: SLOT, source: "synthetic", transform: transform.identity.id, rule: rule.identity.id, fetch, componentOptions: input.componentOptions, surfaceOptions: input.surfaceOptions! });
    return { rule, bundle, change: { portion: "surfaces" as const, change: { op: "derive" as const, slot: SLOT, rule: rule.identity.id, inputs: rule.inputs } } };
  };
  /**
   * A Custom (consumer-authored) `components.button` fill. It keeps the checked package implementation because
   * this bounded corpus observes only that one; its identity, and so its provenance stamp, is the consumer's.
   */
  const custom = () => {
    const fill = structuredClone(input.catalog.components.fills.find(doc => doc.components.button)!.components.button!);
    return { portion: "components" as const, change: { op: "author" as const, slot: "components.button", fill, files: [] } };
  };
  return { input, packages, transform, candidate, source, upstream, fetch, options, adopt, register, derive, custom };
}
