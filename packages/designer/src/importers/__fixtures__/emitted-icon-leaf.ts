import { resolve } from "node:path";
import { loadCatalogBundles } from "../../catalog-bundles.js";
import { emitComponents } from "../../catalog-core/emit-components.js";
import { componentDescriptorHash } from "../../catalog-core/resolve-components.js";
import type { ComponentCandidateDocument, ResolvedComponent, ResolvedComponents } from "../../catalog-core/resolve-components.js";

/** Compiler `paths` that resolve the emitted Icon leaf's package import to the real designer Icon. */
export const emittedIconLeafPaths: Readonly<Record<string, string[]>> = Object.freeze({
  "@clossys/designer/components": [resolve(import.meta.dirname, "../../components/Icon.tsx")],
});

/** The asset Icon leaf and glyph module exactly as a product persist emits them. */
export function emittedIconLeaf(assets: readonly string[]): { path: string; content: string }[] {
  const fillId = (doc: ComponentCandidateDocument) => doc.$extensions["com.clossys.fill"].id;
  const doc = loadCatalogBundles().componentFills.find(candidate => fillId(candidate) === "foundry/components.icon")!;
  const descriptor = Object.values(doc.components)[0]!;
  const component: ResolvedComponent = {
    slot: descriptor.slot, originKind: "adopted",
    origin: { kind: "adopted", source: descriptor.source, fill: fillId(doc), pin: descriptor.pin, license: descriptor.license ?? "MIT", sha256: componentDescriptorHash(descriptor), adoptedAt: "2026-01-01T00:00:00.000Z" },
    impl: descriptor.impl as ResolvedComponent["impl"], propMap: structuredClone(descriptor.propMap),
    reads: { tokens: {}, assets: [], components: [] }, descriptor,
  };
  const profile: ResolvedComponents = {
    consumer: "icon-typecheck", selectionHash: `sha256:${"0".repeat(64)}`,
    components: { [descriptor.slot]: component }, files: [],
    check: { ok: true, findings: [] } as unknown as ResolvedComponents["check"],
    packageExports: { "@clossys/designer/components": ["Icon"] },
  };
  // Glyph geometry is not what these checks measure: each asset gets one valid stand-in path.
  const glyphs = Object.fromEntries(assets.map(asset => [asset, [["path", { d: "M4 12h16" }]]]));
  return emitComponents(profile, ["component-index"], { glyphModule: { path: "assets/glyphs.ts", glyphs } })
    .filter(file => file.path === "components/icon/index.ts" || file.path === "assets/glyphs.ts");
}
