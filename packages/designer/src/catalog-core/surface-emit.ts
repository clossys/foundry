import { surfaceFault, surfaceOf, surfacePrimary } from "./surface-library.js";
import { stableStringify } from "./stable.js";
import type { CompositeEmitFile } from "./types.js";
import type { SurfaceResolved } from "./surface-types.js";
export function emitSurfaces(profile: SurfaceResolved, targets: readonly string[]): CompositeEmitFile[] {
    const files: CompositeEmitFile[] = [];
    const rows = Object.values(profile.fills).sort((a, b) => surfaceOf(a.document).slot < surfaceOf(b.document).slot ? -1 : 1);
    if (targets.includes("surfaces-consumption"))
        files.push({ path: "surfaces-consumption.json", contents: stableStringify({ version: 1, consumer: profile.consumer, selectionHash: profile.selectionHash, strength: "source-only", fills: rows.map(row => ({ slot: surfaceOf(row.document).slot, fill: row.document.$extensions["com.clossys.fill"].id, descriptorHash: row.descriptorHash, outputHash: row.outputHash, apiHash: row.apiHash, inputsHash: row.inputsHash })), findings: profile.check.findings }) });
    if (targets.includes("notices"))
        files.push({ path: "notices/surfaces.json", contents: stableStringify({ version: 1, consumer: profile.consumer, selectionHash: profile.selectionHash, fills: rows.map(row => { const fill = surfaceOf(row.document); return { slot: fill.slot, license: fill.license, origin: fill.origin, notices: fill.outputSha256.filter(row => row.path.startsWith("notices/")) }; }) }) });
    if (targets.includes("surface-index")) {
        if (!profile.check.ok || profile.check.findings.some(row => row.severity === "error"))
            surfaceFault("S8 source emission requires current complete evidence");
        const names = new Set<string>(), root: string[] = [];
        for (const row of rows) {
            const fill = surfaceOf(row.document), name = surfacePrimary(fill.slot);
            if (names.has(name))
                surfaceFault("S1 cross-kind primary collision");
            names.add(name);
            const directory = fill.slot.replace(".", "/");
            const request = "./" + fill.impl.entry.slice(directory.length + 1).replace(/\.tsx?$/, ".js");
            files.push({ path: `${directory}/index.ts`, contents: fill.api.exports.map(api => `export { ${api.export}${api.name === api.export ? "" : ` as ${api.name}`} } from ${JSON.stringify(request)};\n`).join("") });
            root.push(`export { ${name} } from "./${directory}/index.js";\n`);
        }
        files.push({ path: "surface-index.ts", contents: root.join("") }, ...profile.files.map(file => ({ path: file.path, contents: file.content })));
    }
    return files;
}
