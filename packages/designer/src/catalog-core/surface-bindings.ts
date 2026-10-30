/** Selected consumer APIs are proven by the existing emitter, never by candidates. */
import { emitComponents } from "./emit-components.js";
import { inspectGlyph } from "../catalog-assets/svg.js";
import { analyzeSurfaceSource, relativeSurfacePath } from "./surface-source-analysis.js";
import { isSurfacePackageEntry, surfaceDigest, surfaceEntryOf, surfaceOf } from "./surface-library.js";
import type { CompositeEngineInput, CompositeResolved } from "./types.js";
import type { WiringFinding } from "./wiring.js";
import type { SurfaceCandidate, SurfaceFile, SurfacePackageEvidence } from "./surface-types.js";
export function bindSurfaceSource(fill: SurfaceCandidate, files: readonly SurfaceFile[], profile: CompositeResolved, packages: readonly SurfacePackageEvidence[]) {
    const glyphs: Record<string, unknown> = {};
    for (const member of Object.values(profile.values.members).filter(row => row.$type === "glyph" && row.slot.startsWith("assets.icon-"))) {
        inspectGlyph(member.value.light);
        glyphs[member.slot] = member.value.light;
    }
    let componentFiles: ReturnType<typeof emitComponents> = [], emissionError = "";
    try {
        componentFiles = emitComponents(profile.components, ["component-index"], { glyphModule: { path: "adapters/glyphs.ts", glyphs } });
    }
    catch (error) {
        emissionError = error instanceof Error ? error.message : "component emission refused";
    }
    let proof = analyzeSurfaceSource({ fill, files, components: profile.components, componentFiles, packages });
    if (fill.bindings.length && emissionError)
        proof = { ...proof, findings: [...proof.findings, { code: "S4", rule: "surfaces", severity: "error", subject: fill.slot, message: emissionError }] };
    const bindings = fill.bindings.map(row => { const selected = profile.components.components[row.slot]; return { binding: row, descriptor: selected?.descriptor ?? null, origin: selected?.origin ?? null, outputs: selected?.descriptor.outputSha256 ?? null, generated: componentFiles.find(file => file.path === `components/${row.slot.slice(11)}/index.ts`)?.content ?? null, approved: selected ? [{ name: row.slot.slice(11).split("-").map(word => word[0]!.toUpperCase() + word.slice(1)).join(""), export: selected.impl.export }, ...(selected.descriptor.secondaryExports ?? [])] : [] }; });
    const usedModules = new Set(proof.imports.filter(row => !row.module.startsWith(".")).map(row => row.module));
    const reachable = new Set<string>();
    const graphFindings: typeof proof.findings[number][] = [];
    const add = (message: string) => graphFindings.push({ code: "S4", rule: "surfaces", severity: "error", subject: fill.slot, message });
    // These texts have already passed the existing component emitter's complete named-import closure guard.
    // This pass selects its reachable subset and authenticates external artifacts; it grants no component API.
    const visit = (path: string): void => {
        if (reachable.has(path))
            return;
        reachable.add(path);
        const file = componentFiles.find(file => file.path === path);
        if (!file) {
            add("selected generated source missing");
            return;
        }
        const code = file.content.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
        for (const edge of code.matchAll(/\b(?:import|export)\s+(type\s+)?\{([^}]+)\}\s*from\s*["']([^"']+)["']/g)) {
            const module = edge[3]!;
            if (module.startsWith(".")) {
                const target = relativeSurfacePath(path, module, componentFiles.map(file => file.path));
                if (!target)
                    add("selected generated relative closure missing");
                else
                    visit(target);
                continue;
            }
            usedModules.add(module);
            const declared = fill.dependencies.find(row => row.module === module), evidence = packages.filter(row => row.module === module);
            if (!declared || evidence.length !== 1 || evidence[0]!.version !== declared.version) {
                add(`unproven selected dependency ${module}`);
                continue;
            }
            for (const value of edge[2]!.replace(/,\s*$/, "").split(",")) {
                const binding = value.trim(), erased = !!edge[1] || binding.startsWith("type "), name = binding.replace(/^type\s+/, "").split(/\s+as\s+/)[0]!;
                if (!(erased ? evidence[0]!.types : evidence[0]!.values).includes(name))
                    add(`unproven selected dependency export ${module}#${name}`);
            }
        }
    };
    for (const edge of proof.imports.filter(row => fill.bindings.some(binding => binding.file === row.file && binding.local === row.local)))
        if (edge.target.startsWith("components/"))
            visit(edge.target);
    for (const dep of fill.dependencies)
        if (!usedModules.has(dep.module))
            add("unused dependency declaration");
    const reachableFiles = componentFiles.filter(file => reachable.has(file.path));
    proof = { ...proof, findings: [...proof.findings, ...graphFindings] };
    const usedPackages = packages.filter(row => usedModules.has(row.module)).sort((a, b) => a.module < b.module ? -1 : 1);
    const entry = files.find(file => file.path === fill.impl.entry);
    const resolvedBindings = bindings.map(binding => ({ ...binding, closure: reachableFiles }));
    return { proof, componentFiles: reachableFiles, packages: usedPackages, apiHash: surfaceDigest({ api: fill.api, entry: fill.impl.entry, entryHash: entry ? surfaceDigest(entry.content) : null, bindings: resolvedBindings, packages: usedPackages }) };
}

const publicName = (slot: string): string => slot.slice("components.".length).split("-").map(word => word[0]!.toUpperCase() + word.slice(1)).join("");
/** True when the selected fill for `slot` is exactly the package export a surface would render. */
const rendersSelected = (profile: CompositeResolved, slot: string, module: string, name: string): boolean => {
    const selected = profile.components.components[slot];
    return !selected || (selected.impl.kind === "package" && selected.impl.module === module && selected.impl.export === name);
};
/**
 * Static WL7 over surface descriptors (G3): a Section or Frame whose bound component differs from the selected
 * fill. A package-pointer surface renders its own package's components for every component its contract may
 * compose, so it is listed whenever a selection differs (package pointers stay previews only). A source-kind
 * surface is listed for each external value import of a selected component's public name: only the consumer
 * component-index carries the selected fill and its provenance stamp, so a direct import never reaches a
 * re-selection. That is the import the `bind-selected-components@1` rule re-binds. An unselected component is
 * S4's finding, not WL7's. The rendered `data-ds-fill` half of WL7 is a DOM check (provenance-scan).
 */
export function surfaceSwapFindings(input: CompositeEngineInput, profile: CompositeResolved): WiringFinding[] {
    const findings: WiringFinding[] = [];
    const selected = Object.keys(profile.components.components).filter(id => id.startsWith("components."));
    for (const doc of input.library.surfaces?.fills ?? []) {
        const entry = surfaceEntryOf(doc);
        if (isSurfacePackageEntry(entry)) {
            const contract = input.catalog.surfaces?.slots.find(row => row.id === entry.slot)?.contract;
            const composes = contract && "allowedComposes" in contract ? contract.allowedComposes : [];
            const pkg = entry.origin?.pin.package ?? ("pin" in entry ? entry.pin.package : "");
            for (const slot of composes.filter(id => selected.includes(id)))
                if (!rendersSelected(profile, slot, `${pkg}/components`, publicName(slot)))
                    findings.push({ code: "WL7", severity: "error", file: `fills/${entry.slot}.json`, line: 0, subject: entry.slot, evidence: `package-pointer surface renders ${pkg}/components#${publicName(slot)}, not the selected ${slot} fill` });
            continue;
        }
        const fill = surfaceOf(doc);
        const owned = input.library.surfaces!.files.filter(file => fill.outputSha256.some(row => row.path === file.path));
        const { proof } = bindSurfaceSource(fill, owned, profile, input.surfaceOptions?.packages ?? []);
        for (const edge of proof.imports.filter(row => !row.module.startsWith(".") && row.kind === "value")) {
            const slot = selected.find(id => publicName(id) === edge.name);
            if (slot)
                findings.push({ code: "WL7", severity: "error", file: edge.file, line: 0, subject: fill.slot, evidence: `imports ${edge.module}#${edge.name} directly, so the selected ${slot} fill never reaches it; derive it through bind-selected-components@1` });
        }
    }
    return findings.sort((a, b) => a.subject < b.subject ? -1 : a.subject > b.subject ? 1 : a.evidence < b.evidence ? -1 : 1);
}
