/** Explicit authenticated capability boundary; pure resolve/apply never invokes it. */
import { resolve } from "./api.js";
import { runtimeSnapshot } from "./runtime-ports.js";
import { sha256 } from "./digest.js";
import { stableStringify } from "./stable.js";
import { assertRegistryIdentity, surfaceDerivationHash, surfaceDescriptorHash, surfaceDocument, surfaceFault, surfaceInputs, surfaceManifest, surfaceOf, surfacePath, verifySurfaceFiles, verifySurfaceProvenance } from "./surface-library.js";
import type { SurfaceMaterializationInput, SurfaceSourceBundle, SurfaceCandidate, SurfaceBase, SurfaceOrigin, SurfaceFile, SurfaceInputIdentity } from "./surface-types.js";
export async function materializeSurfaceSourceFill(input: SurfaceMaterializationInput): Promise<SurfaceSourceBundle> {
    const registry = input.catalog.surfaces;
    if (!registry)
        surfaceFault("S2 surface registry missing");
    const candidates = registry.fills.filter(doc => { const fill = surfaceOf(doc); return fill.slot === input.slot && fill.source === input.source; });
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
        const current = input.library.surfaces?.fills.find(doc => surfaceOf(doc).slot === input.slot);
        const old = current ? surfaceOf(current) : undefined;
        if (!old?.origin || old.origin.kind === "authored" || stableStringify(old.origin.base) !== stableStringify(base) || stableStringify(rule.base) !== stableStringify(base))
            surfaceFault("S6 retained derivation base differs");
        const resolved = resolve({ catalog: input.catalog, library: input.library, componentOptions: input.componentOptions, surfaceOptions: input.surfaceOptions });
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
