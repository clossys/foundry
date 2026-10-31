/** Authenticated AccessMatrix source recipe, for diagnostics until its selected API/asset prerequisites exist. */
import { sha256 } from "../catalog-core/digest.js";
import { stableStringify } from "../catalog-core/stable.js";
import { surfaceDigest, surfaceManifest, surfaceFault } from "../catalog-core/surface-library.js";
import type { SurfaceCandidate, SurfaceFile, SurfacePackageEvidence, SurfaceTransform } from "../catalog-core/surface-types.js";
export interface AccessMatrixRecipeInput {
    tree: string;
    upstream: readonly {
        path: string;
        sha256: string;
    }[];
    /** Exact emitted property/member evidence of the current consumer; never package TOKENS. */
    scales: readonly {
        member: string;
        property: string;
        valueHash: string;
    }[];
    tailwindMerge: SurfacePackageEvidence;
}
export const ACCESS_MATRIX_PATHS = ["src/blocks/AccessMatrix.tsx", "src/blocks/access-matrix/validate.ts", "src/blocks/access-matrix/summary.ts", "src/components/internal/cx.ts", "src/tokens/tokens.ts", "LICENSE"] as const;
export function foundryAccessMatrixTransform(input: AccessMatrixRecipeInput): SurfaceTransform {
    if (!/^[a-f0-9]{40}$/.test(input.tree) || stableStringify([...input.upstream].map(row => row.path).sort()) !== stableStringify([...ACCESS_MATRIX_PATHS].sort()) || input.upstream.some(row => !/^[a-f0-9]{64}$/.test(row.sha256)))
        surfaceFault("S2 exact AccessMatrix upstream closure required");
    if (input.tailwindMerge.module !== "tailwind-merge" || !input.tailwindMerge.values.includes("extendTailwindMerge") || !/^[a-f0-9]{64}$/.test(input.tailwindMerge.artifactSha256) || !/^\d+\.\d+\.\d+$/.test(input.tailwindMerge.version))
        surfaceFault("S4 inspected installed tailwind-merge artifact required");
    if (!input.scales.length || new Set(input.scales.map(row => row.member)).size !== input.scales.length || new Set(input.scales.map(row => row.property)).size !== input.scales.length || input.scales.some(row => !/^themes\.[a-z0-9.-]+$/.test(row.member) || !/^--[a-z0-9-]+$/.test(row.property) || !/^sha256:[a-f0-9]{64}$/.test(row.valueHash)))
        surfaceFault("S6 authenticated consumer scale table required");
    const ordered = { ...input, upstream: [...input.upstream].sort((a, b) => a.path < b.path ? -1 : 1), scales: [...input.scales].sort((a, b) => a.member < b.member ? -1 : 1) };
    // This registered rule source records every semantic normalization input.
    const source = [{ path: "rules/access-matrix-normalize-v1.json", content: stableStringify({ version: 1, operation: "authenticated-relocation-and-required-installed-peer-normalization", ...ordered }) }];
    return { identity: { id: "foundry-access-matrix-consumer-source", version: "1", sha256: surfaceDigest(surfaceManifest(source)).slice(7) }, source, run: ({ candidate, upstream }) => {
            if (candidate.slot !== "sections.access-matrix" || candidate.pin.kind !== "local-tree" || candidate.pin.tree !== input.tree || stableStringify(surfaceManifest(upstream)) !== stableStringify(ordered.upstream))
                surfaceFault("S2 AccessMatrix immutable input bytes differ");
            const get = (path: string) => upstream.find(file => file.path === path)?.content ?? surfaceFault("S2 missing AccessMatrix helper input");
            const raw = get("src/components/internal/cx.ts");
            get("src/tokens/tokens.ts");
            const tokenImport = 'import { TOKENS } from "../../tokens/tokens.js";';
            const dynamic = /const twMerge = await \(async \(\) => \{[\s\S]*?\n\}\)\(\);/;
            if (!raw.includes(tokenImport) || !dynamic.test(raw))
                surfaceFault("S3 unsupported upstream helper version");
            const table = Object.fromEntries(ordered.scales.map(row => [row.property, 0]));
            const helper = raw.replace(tokenImport, `import { extendTailwindMerge } from "tailwind-merge";\nconst TOKENS = ${stableStringify(table).trim()};`).replace(dynamic, 'const twMerge = extendTailwindMerge({ extend: { classGroups: { py: ["py-frame-display"] }, theme: { spacing: tokenSuffixes("--spacing-"), radius: tokenSuffixes("--radius-"), text: tokenSuffixes("--text-"), tracking: tokenSuffixes("--tracking-") } } });');
            let main = get("src/blocks/AccessMatrix.tsx");
            for (const leaf of ["Button", "Checkbox", "Icon", "Tooltip"])
                main = main.replace(`"../components/${leaf}.js"`, `"../../components/${leaf.toLowerCase()}/index.js"`);
            main = main.replace('"../components/internal/cx.js"', '"../../surfaces/_parts/access-matrix/cx.js"').replace('"./access-matrix/validate.js"', '"./validate.js"').replace('"./access-matrix/summary.js"', '"./summary.js"');
            const files: SurfaceFile[] = [{ path: "sections/access-matrix/AccessMatrix.tsx", content: main }, { path: "sections/access-matrix/validate.ts", content: get("src/blocks/access-matrix/validate.ts").replace('"../AccessMatrix.js"', '"./AccessMatrix.js"') }, { path: "sections/access-matrix/summary.ts", content: get("src/blocks/access-matrix/summary.ts").replace('"../AccessMatrix.js"', '"./AccessMatrix.js"') }, { path: "surfaces/_parts/access-matrix/cx.ts", content: helper }];
            const blockers = [...candidate.blockers, { code: "S4", message: "Selected Checkbox/Tooltip/TooltipTrigger/Button/Icon executable APIs remain independently required." }, { code: "S5", message: "Lock glyph remains unresolved: assets.icon-locked has no granted AccessMatrix read permission; no glyph was copied." }, { code: "S8", message: "Source authentication/normalization is not actual selected runtime qualification." }];
            const fill: SurfaceCandidate = { ...candidate, impl: { kind: "source", entry: files[0]!.path, export: "AccessMatrix" }, bindings: ["Button", "Checkbox", "Icon", "Tooltip"].map(name => ({ file: files[0]!.path, module: `../../components/${name.toLowerCase()}/index.js`, name, local: name, slot: `components.${name.toLowerCase()}` })), dependencies: [{ module: "react", version: candidate.dependencies.find(row => row.module === "react")?.version ?? surfaceFault("S4 exact React dependency required"), license: "MIT" }, { module: "tailwind-merge", version: input.tailwindMerge.version, license: "MIT" }], blockers };
            return { fill, files, blockers };
        } };
}
