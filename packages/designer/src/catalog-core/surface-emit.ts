import { isSurfacePackageEntry, resolveSurfacePackageDescriptor, surfaceEntryOf, surfaceFault, surfaceOutputs, surfacePackageDescriptorHash, surfacePrimary } from "./surface-library.js";
import { stableStringify } from "./stable.js";
import type { CompositeCatalogData, CompositeEmitFile } from "./types.js";
import type { SurfacePackageEvidence, SurfaceResolved, SurfaceSlot } from "./surface-types.js";

/** Emit an authentic registered package candidate without adopting it into a consumer library. */
export function emitSurfacePackageCandidate(input: { catalog: CompositeCatalogData; slot: SurfaceSlot; source: string; packages: readonly SurfacePackageEvidence[] }) {
    const candidates = input.catalog.surfaces?.fills.filter(doc => { const meta = doc.$extensions["com.clossys.fill"]; return meta.slot === input.slot && meta.source === input.source && meta.mode === "implementation"; }) ?? [];
    if (candidates.length !== 1) surfaceFault("S2 unique registered package candidate required");
    const document = candidates[0]!, fill = surfaceEntryOf(document), meta = document.$extensions["com.clossys.fill"];
    if (!isSurfacePackageEntry(fill) || fill.origin) surfaceFault("S2 unadopted package candidate required");
    const descriptorHash = surfacePackageDescriptorHash(fill);
    const registration = resolveSurfacePackageDescriptor(input.catalog, input.slot, { source: meta.source, fill: meta.id, pin: meta.pin as import("./surface-types.js").SurfacePackagePin, license: meta.license, descriptorHash });
    const matches = input.packages.filter(row => row.module === fill.impl.module && row.version === meta.pin?.version && /^[a-f0-9]{64}$/.test(row.artifactSha256) && row.values.includes(fill.impl.export));
    if (matches.length !== 1) surfaceFault("S2 exact installed package export evidence required");
    const siteShell = input.slot === "frames.site-shell" && fill.impl.module === "@clossys/designer/frames" && fill.impl.export === "SiteFrame";
    if (siteShell && !matches[0]!.values.includes("siteShellProps")) surfaceFault("S2 native siteShellProps export evidence required");
    const name = surfacePrimary(fill.slot), path = `${fill.slot.replace(".", "/")}/index.${siteShell ? "tsx" : "ts"}`;
    const contents = siteShell ? [
        'import { Children, createElement, type ReactNode } from "react";',
        'import { SiteFrame, siteShellProps } from "@clossys/designer/frames";',
        'export type CatalogSurfaceProps = Omit<Parameters<typeof siteShellProps>[0], "slots"> & { slots?: Parameters<typeof siteShellProps>[0]["slots"]; children?: ReactNode };',
        `export function ${name}({ children, slots, ...input }: CatalogSurfaceProps) {`,
        '  if (children !== undefined && slots?.main !== undefined) throw new TypeError("Frame main supplied twice");',
        '  return createElement(SiteFrame, siteShellProps({ ...input, slots: { ...slots, main: slots?.main ?? Children.toArray(children) } }));',
        '}', '',
    ].join("\n") : `export { ${fill.impl.export}${fill.impl.export === name ? "" : ` as ${name}`} } from ${JSON.stringify(fill.impl.module)};\n`;
    return { ...registration, descriptor: structuredClone(fill), descriptorHash, package: structuredClone(matches[0]!), file: { path, contents }, export: name, rendering: registration.contract.contract.kind === "frame" ? registration.contract.contract.rendering : "server" as const, adapter: siteShell ? "siteShellProps" as const : "package" as const };
}
export function emitSurfaces(profile: SurfaceResolved, targets: readonly string[]): CompositeEmitFile[] {
    const files: CompositeEmitFile[] = [];
    const rows = Object.values(profile.fills).sort((a, b) => surfaceEntryOf(a.document).slot < surfaceEntryOf(b.document).slot ? -1 : 1);
    if (targets.includes("surfaces-consumption"))
        files.push({ path: "surfaces-consumption.json", contents: stableStringify({ version: 1, consumer: profile.consumer, selectionHash: profile.selectionHash, strength: "source-only", fills: rows.map(row => ({ slot: surfaceEntryOf(row.document).slot, fill: row.document.$extensions["com.clossys.fill"].id, descriptorHash: row.descriptorHash, outputHash: row.outputHash, apiHash: row.apiHash, inputsHash: row.inputsHash })), findings: profile.check.findings }) });
    if (targets.includes("notices"))
        files.push({ path: "notices/surfaces.json", contents: stableStringify({ version: 1, consumer: profile.consumer, selectionHash: profile.selectionHash, fills: rows.map(row => { const fill = surfaceEntryOf(row.document); return { slot: fill.slot, license: isSurfacePackageEntry(fill) ? fill.origin!.license : fill.license, origin: fill.origin, notices: surfaceOutputs(fill).filter(row => row.path.startsWith("notices/")) }; }) }) });
    if (targets.includes("surface-index")) {
        if (!profile.check.ok || profile.check.findings.some(row => row.severity === "error"))
            surfaceFault("S8 source emission requires current complete evidence");
        const names = new Set<string>(), root: string[] = [];
        for (const row of rows) {
            const fill = surfaceEntryOf(row.document), name = surfacePrimary(fill.slot);
            if (names.has(name))
                surfaceFault("S1 cross-kind primary collision");
            names.add(name);
            const directory = fill.slot.replace(".", "/");
            if (isSurfacePackageEntry(fill)) {
                // Package pointer: re-export the pinned package export; its CSS ships with the pinned package stylesheet.
                files.push({ path: `${directory}/index.ts`, contents: `export { ${fill.impl.export}${fill.impl.export === name ? "" : ` as ${name}`} } from ${JSON.stringify(fill.impl.module)};\n` });
                root.push(`export { ${name} } from "./${directory}/index.js";\n`);
                continue;
            }
            const request = "./" + fill.impl.entry.slice(directory.length + 1).replace(/\.tsx?$/, ".js");
            files.push({ path: `${directory}/index.ts`, contents: fill.api.exports.map(api => `export { ${api.export}${api.name === api.export ? "" : ` as ${api.name}`} } from ${JSON.stringify(request)};\n`).join("") });
            root.push(`export { ${name} } from "./${directory}/index.js";\n`);
        }
        files.push({ path: "surface-index.ts", contents: root.join("") }, ...profile.files.map(file => ({ path: file.path, contents: file.content })));
    }
    return files;
}
