/** Surface diagnostics retain failed provenance, source, contract and evidence boundaries. */
import { surfaceOf, surfacePrimary, canonicalSurfacePortion, surfaceDescriptorHash, surfaceDigest, sortedManifest, verifySurfaceFiles, verifySurfaceProvenance, surfaceInputs, surfaceDerivationHash, surfaceFault, assertSurfaceResolutionOptions } from "./surface-library.js";
import { bindSurfaceSource } from "./surface-bindings.js";
import { runtimeHash, runtimeSourceFindings, runtimeSnapshot } from "./runtime-ports.js";
import { buildSurfaceConsumption } from "./surface-consumption.js";
import { emit as emitValues } from "./emit.js";
import { stableStringify } from "./stable.js";
import type { CompositeEngineInput, CompositeResolved } from "./types.js";
import type { SurfaceFinding, SurfaceResolved, SurfaceResolvedFill, SurfaceRuntimeIdentity, SurfaceCandidate, SurfaceResolutionOptions } from "./surface-types.js";
export function surfaceRuntimeIdentity(row: SurfaceResolvedFill): SurfaceRuntimeIdentity { return { version: 1, descriptorHash: row.descriptorHash, outputHash: row.outputHash, apiHash: row.apiHash, inputsHash: row.inputsHash }; }
export function surfaceMeasurementFindings(fill: SurfaceCandidate, row: SurfaceResolvedFill, bound: ReturnType<typeof bindSurfaceSource>, options: SurfaceResolutionOptions): string[] {
    const matches = options.measurements.filter(measurement => measurement.slot === fill.slot && stableStringify(measurement.identity) === stableStringify(surfaceRuntimeIdentity(row)));
    if (matches.length !== 1)
        return ["independent current type/closure measurement missing"];
    const m = runtimeSnapshot(matches[0]!);
    const errors: string[] = [];
    if (m.version !== 1 || !["synthetic", "real"].includes(m.scope) || m.command.exitCode !== 0 || !m.command.argv.length || m.checks.types !== "pass" || m.checks.closure !== "pass" || runtimeSourceFindings(m.compiler).length || m.compiler.sourceHash !== runtimeHash(m.compiler.source))
        errors.push("compiler identity/command/type/closure evidence differs");
    const command = (command: typeof m.command) => command.argv.every(arg => typeof arg === "string") && /^[a-f0-9]{64}$/.test(command.stdoutSha256) && /^[a-f0-9]{64}$/.test(command.stderrSha256);
    if (!command(m.command))
        errors.push("invalid command log identity");
    if (m.source.entry !== fill.impl.entry || !Object.hasOwn(m.source.files, fill.impl.entry) || !Object.hasOwn(m.compiled.files, m.compiled.entry) || runtimeSourceFindings({ id: "surface-source", source: m.source, sourceHash: runtimeHash(m.source) }).length || runtimeSourceFindings({ id: "surface-compiled", source: m.compiled, sourceHash: runtimeHash(m.compiled) }).length)
        errors.push("invalid measured source/compiled closure");
    const dependencyTable = Object.fromEntries(bound.packages.map(pkg => [pkg.module, { version: pkg.version, artifact: `sha256:${pkg.artifactSha256}` }]));
    if (stableStringify(m.source.dependencies) !== stableStringify(dependencyTable) || stableStringify(m.compiled.dependencies) !== stableStringify(dependencyTable))
        errors.push("dependency artifact inventory differs");
    if (m.runtime && (m.runtime.command.exitCode !== 0 || !command(m.runtime.command) || m.runtime.checks.module !== "pass" || runtimeSourceFindings(m.runtime.renderer).length || stableStringify(m.runtime.renderer.source) !== stableStringify(m.compiled)))
        errors.push("runtime module identity differs");
    return errors;
}
export function resolveSurfaces(input: CompositeEngineInput, profile: CompositeResolved, validateDerivations = true): SurfaceResolved | undefined {
    if (input.library.surfaces === undefined)
        return undefined;
    const primaryNames = new Set<string>();
    const findings: SurfaceFinding[] = [];
    const add = (code: SurfaceFinding["code"], subject: string, message: string, severity: SurfaceFinding["severity"] = "error") => findings.push({ code, rule: "surfaces", severity, subject, message });
    const portion = canonicalSurfacePortion(input.library.surfaces);
    const fills = {} as Record<SurfaceCandidate["slot"], SurfaceResolvedFill>;
    const options = input.surfaceOptions ?? { packages: [], measurements: [] };
    const seen = new Set<string>();
    assertSurfaceResolutionOptions(options);
    for (const doc of portion.fills) {
        const fill = surfaceOf(doc);
        if (!fill.origin)
            surfaceFault("S1 consumer origin missing");
        const meta = doc.$extensions["com.clossys.fill"];
        const primary = surfacePrimary(fill.slot);
        if (primaryNames.has(primary))
            add("S1", fill.slot, "cross-kind primary collision");
        primaryNames.add(primary);
        if (meta.id !== `${input.library.source.id}/${fill.slot}` || fill.source !== input.library.source.id || meta.sourceAddress !== `fills/${fill.slot}.json` || meta.author !== "consumer" || meta.trust !== "consumer" || meta.status !== "draft" || meta.conforms.length || meta.evidence.length || stableStringify(meta.originKinds) !== stableStringify([fill.origin.kind]))
            surfaceFault("S1 consumer metadata differs");
        verifySurfaceFiles(fill, portion.files);
        verifySurfaceProvenance(input.catalog, { ...input.library, surfaces: portion }, fill);
        for (const path of fill.outputSha256.map(row => row.path))
            seen.add(path);
        if (input.library.components.files.some(file => seen.has(file.path)))
            surfaceFault("S1 component/surface ownership overlaps");
        const owned = portion.files.filter(file => fill.outputSha256.some(row => row.path === file.path));
        const bound = bindSurfaceSource(fill, owned, profile, options.packages);
        findings.push(...bound.proof.findings);
        const origin = fill.origin;
        const descriptorHash = surfaceDescriptorHash(fill), outputHash = surfaceDigest(sortedManifest(fill.outputSha256));
        const row: SurfaceResolvedFill = { document: doc, descriptorHash, outputHash, apiHash: bound.apiHash, inputsHash: origin.kind === "derived" ? origin.inputsHash : origin.kind === "adopted" ? surfaceDigest({ base: origin.base, transform: origin.transform }) : surfaceDigest({ descriptorHash, outputHash, apiHash: bound.apiHash }) };
        fills[fill.slot] = row;
        const slot = input.catalog.surfaces?.slots.find(row => row.id === fill.slot);
        if (!slot) {
            add("S1", fill.slot, "authored contract missing");
            continue;
        }
        const contract = slot.contract;
        for (const [label, actual, allowed] of [["members", fill.members, contract.members.names], ["states", fill.states.filter(state => state !== "default"), contract.kind === "section" ? contract.states ?? [] : contract.statePorts.map(port => port.id)], ["tokens", fill.reads.tokens, contract.allowedReads.tokens], ["assets", fill.reads.assets, contract.allowedReads.assets], ["composes", fill.composes, contract.kind === "section" ? contract.allowedComposes : contract.composes ?? []], ["parts", fill.parts, contract.kind === "section" ? contract.parts : []]] as const)
            if (actual.some(value => !allowed.some(option => option === value)))
                add("S5", fill.slot, `unsupported ${label}`);
        const required = contract.kind === "section" ? contract.slots.filter(slot => slot.required).map(slot => slot.name) : contract.slots.filter(slot => slot.required).map(slot => slot.id);
        const mapped = Object.keys(fill.kind === "section" ? fill.slotMap : fill.slots);
        const allowedSlots = contract.kind === "section" ? contract.slots.map(slot => slot.name) : contract.slots.map(slot => slot.id);
        if (required.some(name => !mapped.includes(name)) || mapped.some(name => !allowedSlots.includes(name)) || Object.keys(fill.propMap).some(member => !contract.members.names.includes(member)))
            add("S5", fill.slot, "content/member mapping differs");
        if (fill.kind === "section") {
            if (Object.values(fill.configs).some(config => config.members.some(member => !fill.members.includes(member))))
                add("S5", fill.slot, "config member unavailable");
        }
        if (fill.kind === "frame" && contract.kind === "frame") {
            if (fill.rendering !== contract.rendering || Object.keys(fill.statePorts).some(key => !contract.statePorts.some(port => port.id === key)) || contract.statePorts.some(port => !fill.statePorts[port.id]))
                add("S5", fill.slot, "frame rendering/state ownership differs");
            for (const id of [...contract.breakpoints, ...contract.layers])
                if (!profile.values.members[id] || !fill.reads.tokens.some(leaf => id === leaf || id.startsWith(leaf + ".")))
                    add("S5", fill.slot, `frame value unavailable ${id}`);
        }
        for (const id of fill.composes)
            if (id.startsWith("components.") && !profile.components.components[id])
                add("S4", fill.slot, `selected component missing ${id}`);
        for (const id of [...fill.reads.tokens, ...fill.reads.assets])
            if (!Object.keys(profile.values.members).some(member => member === id || member.startsWith(id + ".")))
                add("S5", fill.slot, `consumer read missing ${id}`);
        for (const blocker of fill.blockers)
            add("S5", fill.slot, `${blocker.code}: ${blocker.message}`);
        for (const error of surfaceMeasurementFindings(fill, row, bound, options))
            add("S8", fill.slot, error);
        const measurement = options.measurements.find(m => m.slot === fill.slot && stableStringify(m.identity) === stableStringify(surfaceRuntimeIdentity(row)));
        if (measurement) {
            const expected = Object.fromEntries([...owned.filter(file => /\.tsx?$/.test(file.path)), ...bound.componentFiles.filter(file => fill.bindings.length && file.path !== "component-index.ts")].map(file => [file.path, file.content]));
            if (stableStringify(measurement.source.files) !== stableStringify(expected))
                add("S8", fill.slot, "measured source bytes/selected component closure differ");
            if (measurement.scope === "synthetic")
                add("S8", fill.slot, "SYNTHETIC evidence qualifies only this synthetic fixture", "notice");
        }
        if (!bound.proof.findings.length) {
            const themeCss = emitValues(profile.values, ["css-brand", "css-scales"], { header: false }).map(file => file.contents).join("\n");
            const report = buildSurfaceConsumption({ tokens: input.catalog.values.slots.filter(slot => slot.layer === "tokens").map(slot => ({ id: slot.id, contract: { emit: "emit" in slot.contract ? slot.contract.emit : undefined } })), assets: input.catalog.values.slots.filter(slot => slot.layer === "assets"), components: input.catalog.components.slots, sections: slot.layer === "sections" ? [slot] : [], frames: slot.layer === "frames" ? [slot] : [], fills: [{ id: meta.id, slot: fill.slot, source: fill.source }], sourceScans: [{ fill: meta.id, files: owned.filter(file => /\.tsx?$/.test(file.path)), resolvedImports: Object.fromEntries(bound.proof.imports.filter(edge => fill.bindings.some(row => row.file === edge.file && row.local === edge.local)).map(edge => [edge.local, fill.bindings.find(row => row.file === edge.file && row.local === edge.local)!.slot])) }], themeCss });
            for (const finding of report.findings)
                add("S5", fill.slot, stableStringify(finding).trim());
        }
    }
    for (const file of portion.files)
        if (!seen.has(file.path))
            surfaceFault("S1 orphan surface file");
    // Dependency verification is a whole-graph pass: removal cannot leave a stale downstream derivation.
    const joined = { ...profile, surfaces: { version: 1 as const, consumer: profile.consumer, selectionHash: profile.selectionHash, fills, files: portion.files, check: { ok: false, findings: [] } } };
    if (validateDerivations) {
        const topology = (id: string, chain: readonly string[]) => { if (chain.includes(id))
            surfaceFault("S6 surface input cycle"); const row = fills[id as SurfaceCandidate["slot"]]; if (!row)
            return; const origin = surfaceOf(row.document).origin; if (origin?.kind !== "derived")
            return; for (const ref of origin.inputs)
            if (ref.input.kind === "surface")
                topology(ref.input.id, [...chain, id]); };
        Object.keys(fills).forEach(id => topology(id, []));
    }
    const visit = (id: string, chain: readonly string[]) => { if (chain.includes(id))
        surfaceFault("S6 surface input cycle"); const entry = fills[id as SurfaceCandidate["slot"]]; if (!entry)
        return; const fill = surfaceOf(entry.document); if (fill.origin?.kind !== "derived")
        return; const origin = fill.origin; const rules = input.catalog.surfaces?.rules.filter(rule => rule.slot === id && stableStringify(rule.identity) === stableStringify(origin.rule)) ?? []; if (rules.length !== 1)
        surfaceFault("S6 registered derivation missing"); const actual = surfaceInputs(input.catalog, input.library, joined, rules[0]!.inputs, options); if (stableStringify(actual) !== stableStringify(origin.inputs) || origin.inputsHash !== surfaceDerivationHash(origin.base, origin.transform, origin.rule, input.catalog, id, actual))
        surfaceFault("S6 stale derivation input identity"); for (const ref of actual)
        if (ref.input.kind === "surface")
            visit(ref.input.id, [...chain, id]); };
    if (validateDerivations)
        Object.keys(fills).forEach(id => visit(id, []));
    return { version: 1, consumer: profile.consumer, selectionHash: profile.selectionHash, fills, files: portion.files, check: { ok: !findings.some(row => row.severity === "error"), findings } };
}
