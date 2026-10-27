/** Explicit authenticated capability boundary; pure resolve/apply never invokes it. */
import { resolve } from "./api.js";
import { resolveSurfaces } from "./surface-check.js";
import { runtimeSnapshot } from "./runtime-ports.js";
import { sha256 } from "./digest.js";
import { stableStringify } from "./stable.js";
import { assertRegistryIdentity, isSurfacePackageEntry, surfaceDigest, surfaceDerivationHash, surfaceDescriptorHash, surfaceDocument, surfaceEntryOf, surfaceFault, surfaceInputs, surfaceManifest, surfaceOf, surfacePath, verifySurfaceFiles, verifySurfaceProvenance } from "./surface-library.js";
import type { CompositeEngineInput, CompositeResolved } from "./types.js";
import type { SurfaceMaterializationInput, SurfaceSourceBundle, SurfaceCandidate, SurfaceBase, SurfaceOrigin, SurfaceFile, SurfaceInputIdentity, SurfaceComponentBinding, SurfacePackageEvidence, SurfaceRule, SurfaceRuleIdentity, SurfaceSlot, SurfaceTransform } from "./surface-types.js";
/**
 * The resolution a derivation reads its inputs from, staged the way applyLibraryChange stages a surface
 * operation: values and components resolve in full, while the surface portion resolves without validating
 * derivations, because re-deriving is what clears a derivation an input re-selection made stale. Nothing
 * installs from this profile alone: apply re-validates every derivation of the result.
 */
export function surfaceDerivationProfile(input: CompositeEngineInput): CompositeResolved {
    const { surfaces: _staged, ...withoutSurfaces } = input.library;
    const profile = resolve({ ...input, library: withoutSurfaces });
    profile.surfaces = resolveSurfaces(input, profile, false);
    return profile;
}
export async function materializeSurfaceSourceFill(input: SurfaceMaterializationInput): Promise<SurfaceSourceBundle> {
    const registry = input.catalog.surfaces;
    if (!registry)
        surfaceFault("S2 surface registry missing");
    // Package-pointer candidates copy no bytes and are adopted by applySurfaceOperation, never materialized.
    const candidates = registry.fills.filter(doc => { const fill = surfaceEntryOf(doc); return !isSurfacePackageEntry(fill) && fill.slot === input.slot && fill.source === input.source; });
    if (candidates.length !== 1)
        surfaceFault("S2 unique upstream candidate required");
    const candidate = surfaceOf(candidates[0]!);
    const transforms = registry.transforms.filter(transform => transform.identity.id === input.transform);
    if (transforms.length !== 1)
        surfaceFault("S2 unique transform required");
    const transform = transforms[0]!;
    assertRegistryIdentity(transform.identity, transform.source);
    const rules = input.rule === null ? [] : registry.rules.filter(rule => rule.identity.id === input.rule && rule.slot === input.slot);
    if (input.rule !== null && rules.length !== 1)
        surfaceFault("S6 unique rule required");
    const rule = rules[0];
    if (rule)
        assertRegistryIdentity(rule.identity, rule.source);
    if (!input.library.adoptedAt || !Number.isFinite(Date.parse(input.library.adoptedAt)))
        surfaceFault("S2 existing adoptedAt required");
    const noticeRows = candidate.pin.files.filter(row => /^(?:.*\/)?(?:LICENSE(?:\.txt|\.md)?|COPYING|NOTICE(?:\.txt|\.md)?)$/.test(row.path));
    if (!noticeRows.length)
        surfaceFault("S2 authenticated upstream notice required");
    const base: SurfaceBase = { source: candidate.source, fill: candidates[0]!.$extensions["com.clossys.fill"].id, license: candidate.license, pin: candidate.pin, descriptorHash: surfaceDescriptorHash(candidate), upstreamSha256: [...candidate.pin.files].sort((a, b) => a.path < b.path ? -1 : 1), notices: noticeRows.sort((a, b) => a.path < b.path ? -1 : 1) };
    const upstream: SurfaceFile[] = [];
    for (const row of base.upstreamSha256) {
        surfacePath(row.path);
        const content = await input.fetch({ pin: candidate.pin, path: row.path, sha256: row.sha256 });
        if (typeof content !== "string" || content.includes("\0") || sha256(content) !== row.sha256)
            surfaceFault("S2 upstream bytes differ");
        upstream.push({ path: row.path, content });
    }
    const upstreamFrozen = runtimeSnapshot(upstream);
    let output = transform.run({ candidate: runtimeSnapshot(candidate), upstream: upstreamFrozen });
    let inputs: SurfaceInputIdentity[] = [];
    if (rule) {
        // A package pointer at this slot retains no derivation base, so it faults S6 below like an absent fill.
        const current = input.library.surfaces?.fills.map(doc => surfaceEntryOf(doc)).find(fill => fill.slot === input.slot);
        const old = current && !isSurfacePackageEntry(current) ? current : undefined;
        if (!old?.origin || old.origin.kind === "authored" || stableStringify(old.origin.base) !== stableStringify(base) || stableStringify(rule.base) !== stableStringify(base))
            surfaceFault("S6 retained derivation base differs");
        const resolved = surfaceDerivationProfile({ catalog: input.catalog, library: input.library, componentOptions: input.componentOptions, surfaceOptions: input.surfaceOptions });
        inputs = surfaceInputs(input.catalog, input.library, resolved, rule.inputs, input.surfaceOptions);
        if (rule.inputs.some(ref => ref.kind === "surface" && ref.id === input.slot))
            surfaceFault("S6 surface input cycle");
        output = rule.run({ base: runtimeSnapshot(output.fill), upstream: upstreamFrozen, library: runtimeSnapshot(input.library), resolved: runtimeSnapshot(resolved) });
    }
    output = runtimeSnapshot(output);
    if (output.fill.slot !== candidate.slot || output.fill.kind !== candidate.kind || output.fill.license !== candidate.license || stableStringify(output.fill.pin) !== stableStringify(candidate.pin))
        surfaceFault("S2 transformed source lineage differs");
    const receipt = stableStringify({ version: 1, base, transform: transform.identity, rule: rule?.identity ?? null, inputs });
    const files = [...output.files, { path: `surfaces/receipts/r-${sha256(receipt)}.json`, content: receipt }];
    for (const notice of base.notices) {
        const text = upstream.find(file => file.path === notice.path)!.content;
        const path = `notices/surfaces/n-${sha256(text)}.txt`;
        if (!files.some(file => file.path === path))
            files.push({ path, content: text });
        else if (files.find(file => file.path === path)!.content !== text)
            surfaceFault("S2 notice text changed");
    }
    if (new Set(files.map(file => file.path)).size !== files.length)
        surfaceFault("S2 duplicate transformed output");
    const fill: SurfaceCandidate = { ...output.fill, source: input.library.source.id, notice: `notices/surfaces/n-${sha256(upstream.find(file => file.path === base.notices[0]!.path)!.content)}.txt`, outputSha256: surfaceManifest(files), blockers: output.blockers };
    const descriptorHash = surfaceDescriptorHash(fill);
    const inputsHash = surfaceDerivationHash(base, transform.identity, rule?.identity ?? null, input.catalog, input.slot, inputs);
    const origin: SurfaceOrigin = rule ? { kind: "derived", base, transform: transform.identity, rule: rule.identity, inputs, inputsHash, descriptorHash } : { kind: "adopted", base, transform: transform.identity, descriptorHash, adoptedAt: input.library.adoptedAt };
    const document = surfaceDocument(input.library, { ...fill, origin });
    const staged = { ...input.library, surfaces: { version: 1 as const, fills: [document], files } };
    verifySurfaceFiles(fill, files);
    verifySurfaceProvenance(input.catalog, staged, { ...fill, origin });
    return { version: 1, operation: rule ? "derive" : "adopt", slot: input.slot, document, base, upstream, files, transform: transform.identity, rule: rule?.identity ?? null, inputs, inputsHash };
}

/** The package barrel whose component imports a source-kind surface re-binds to the consumer's own index. */
export const COMPONENTS_PACKAGE_MODULE = "@clossys/designer/components";
const BIND_SELECTED_COMPONENTS_SOURCE: readonly SurfaceFile[] = [{ path: "rules/bind-selected-components@1.txt", content: [
    "bind-selected-components@1",
    "Re-runs the registered transform over the retained adopted base. In every relocated TypeScript file, each",
    "named value import of a declared component's public name from the components package barrel becomes an",
    "import of the consumer's generated components/<leaf>/index.js and a recorded component binding. Each declared",
    "component is a derivation input, so a re-selection makes the derivation stale until it is re-derived. The",
    "package dependency is kept while a selected component's closure still reaches it, and dropped once nothing",
    "imports it. Names the package evidence does not export, declared",
    "components that are not selected or not imported, and selected components imported but not declared refuse.",
    "",
].join("\n") }];
/** Registered identity of the swap-through rule (G3). */
export const BIND_SELECTED_COMPONENTS: SurfaceRuleIdentity = { id: "bind-selected-components", version: "1", sha256: surfaceDigest(surfaceManifest(BIND_SELECTED_COMPONENTS_SOURCE)).slice(7) };
/** `components.combo-box` → `ComboBox`: the public name the consumer component-index exports. */
export const componentPublicName = (slot: string): string => slot.slice("components.".length).split("-").map(word => word[0]!.toUpperCase() + word.slice(1)).join("");
const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/**
 * `bind-selected-components@1`: a source-kind Section or Frame derived through this rule imports each declared
 * component from the consumer's component-index, never from the package barrel, so a re-selected component
 * reaches it. `packages` is the host's `readSurfacePackageEvidence` output; it is consumed, never re-read here.
 */
export function bindSelectedComponentsRule(options: { slot: SurfaceSlot; base: SurfaceBase; transform: SurfaceTransform; candidate: SurfaceCandidate; components: readonly `components.${string}`[]; packages: readonly SurfacePackageEvidence[]; module?: string }): SurfaceRule {
    const module = options.module ?? COMPONENTS_PACKAGE_MODULE;
    const components = [...new Set(options.components)].sort();
    if (!components.length)
        surfaceFault("S6 bind-selected-components declares no component");
    const statement = new RegExp(`^import\\s*\\{([^}]*)\\}\\s*from\\s*["']${escapeRegExp(module)}["'];?[ \\t]*$`, "gm");
    const imported = new RegExp(`\\bfrom\\s*["']${escapeRegExp(module)}["']`);
    return {
        identity: BIND_SELECTED_COMPONENTS, source: BIND_SELECTED_COMPONENTS_SOURCE, slot: options.slot, base: options.base,
        inputs: components.map(id => ({ kind: "component" as const, id })),
        run: ({ base, upstream, resolved }) => {
            const output = options.transform.run({ candidate: options.candidate, upstream });
            if (stableStringify(output.fill) !== stableStringify(base))
                surfaceFault("S6 bind-selected-components base differs from the registered transform output");
            const evidence = options.packages.filter(row => row.module === module);
            if (evidence.length !== 1)
                surfaceFault(`S6 bind-selected-components requires package evidence for ${module}`);
            const selectedByName = new Map(Object.keys(resolved.components.components).filter(id => id.startsWith("components.")).map(id => [componentPublicName(id), id]));
            const bindings: SurfaceComponentBinding[] = [...base.bindings];
            const bound = new Set<string>();
            const files = output.files.map(file => {
                if (!/\.tsx?$/.test(file.path))
                    return file;
                const prefix = "../".repeat(file.path.split("/").length - 1);
                const content = file.content.replace(statement, (_whole, list: string) => {
                    const residual: string[] = [], rebound: string[] = [];
                    for (const raw of list.split(",").map(part => part.trim()).filter(Boolean)) {
                        const [name, local = name] = raw.split(/\s+as\s+/).map(part => part.trim()) as [string, string?];
                        const slot = components.find(id => componentPublicName(id) === name);
                        if (raw.startsWith("type ") || !slot) {
                            if (!raw.startsWith("type ") && selectedByName.has(name))
                                surfaceFault(`S6 selected component imported but not declared ${selectedByName.get(name)}`);
                            residual.push(raw);
                            continue;
                        }
                        if (!evidence[0]!.values.includes(name))
                            surfaceFault(`S6 unproven package export ${module}#${name}`);
                        if (!resolved.components.components[slot])
                            surfaceFault(`S6 declared component not selected ${slot}`);
                        const target = `${prefix}components/${slot.slice("components.".length)}/index.js`;
                        bindings.push({ file: file.path, module: target, name, local: local!, slot });
                        bound.add(slot);
                        rebound.push(`import { ${name === local ? name : `${name} as ${local}`} } from "${target}";`);
                    }
                    return [...rebound, ...(residual.length ? [`import { ${residual.join(", ")} } from "${module}";`] : [])].join("\n");
                });
                return content === file.content ? file : { path: file.path, content };
            });
            for (const slot of components)
                if (!bound.has(slot))
                    surfaceFault(`S6 declared component not imported ${slot}`);
            // The consumer index of a package-backed selection re-exports that package, so its closure still reaches it.
            const reached = files.some(file => imported.test(file.content)) || components.some(slot => { const impl = resolved.components.components[slot]!.impl; return impl.kind === "package" && impl.module === module; });
            const dependencies = reached ? base.dependencies : base.dependencies.filter(row => row.module !== module);
            bindings.sort((a, b) => stableStringify(a) < stableStringify(b) ? -1 : 1);
            return { fill: { ...base, bindings, dependencies }, files, blockers: output.blockers };
        },
    };
}
