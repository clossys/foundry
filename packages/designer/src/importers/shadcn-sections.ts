import data from "./shadcn-sections.data.json" with { type: "json" };
import upstreamEmpty from "../catalog/fills/shadcn@aria/components.empty.json" with { type: "json" };
import railSource from "./vendor/shadcn-aria-rail.data.json" with { type: "json" };
import { sha256 } from "../catalog-core/digest.js";
import { stableStringify } from "../catalog-core/stable.js";
import { surfaceDescriptorHash, surfaceDerivationHash, surfaceManifest, surfaceDigest } from "../catalog-core/surface-library.js";
import type { CompositeCatalogData } from "../catalog-core/types.js";
import type { SurfaceBase, SurfaceCandidateDocument, SurfaceFile, SurfaceMaterializationReceipt, SurfaceSectionEntry, SurfaceTransform } from "../catalog-core/surface-types.js";

/** Exact upstream Card and Empty anatomy. The three sections are declared ports, not upstream section blocks. */
export const SHADCN_SECTIONS_PIN = {
  url: upstreamEmpty.$extensions["com.clossys.fill"].pin.url,
  commit: "96da9cc7f1aa10580a3741664e2a77c721206c00",
  card: "0d525c03e086b0047f7c0700850281023359cfc020eb233fdb0d74ec870ebea0",
  empty: "05c419160ac0226973f6f00d7d8865dc46645a75ea0697138992cdbc736efec4",
  notice: "1564074e13439397221ffd522e2e504d56561994a23d371aa5e3ad43e4f5423f",
} as const;

type Leaf = keyof typeof data.ports;
const PRIMARY: Record<Leaf, string> = { "section-header": "SectionHeader", content: "Content", "empty-state": "EmptyState" };
const READS: Record<Leaf, string[]> = {
  "section-header": ["tokens.body-size", "tokens.caption-size", "tokens.display-face", "tokens.display-size", "tokens.heading-size", "tokens.letter-spacing", "tokens.line-height", "tokens.spacing", "tokens.text-color", "tokens.typeface"],
  content: ["tokens.body-size", "tokens.breakpoint", "tokens.caption-size", "tokens.spacing", "tokens.text-color"],
  "empty-state": ["tokens.spacing", "tokens.text-color"],
};
const SLOTS: Record<Leaf, Record<string, string>> = {
  "section-header": { eyebrow: "eyebrow", heading: "title", description: "description", actions: "actions", stats: "stats" },
  content: { header: "header", body: "children", media: "media", footnote: "footnote" },
  "empty-state": { illustration: "icon", actions: "action" },
};
const MEMBERS: Record<Leaf, Record<string, string>> = {
  "section-header": { "align.start": "align", "align.center": "align", "density.display": "density", "density.standard": "density", "density.compact": "density" },
  content: { "layout.stacked": "layout", "layout.split-start": "layout", "layout.split-end": "layout" },
  "empty-state": {},
};

/** A source candidate needs source materialization, not a forged package-consumption measurement. */
export function importShadcnSections() {
  const fills: SurfaceCandidateDocument[] = [];
  const transforms: SurfaceTransform[] = [];
  // Reuse the already-vendored Empty/notice bytes; Card bytes arrive through the authenticated fetch port.
  const upstream: Partial<Record<`sections.${Leaf}`, readonly SurfaceFile[]>> = {};
  const files: Record<string, readonly SurfaceFile[]> = {};
  for (const leaf of Object.keys(PRIMARY) as Leaf[]) {
    const slot = `sections.${leaf}` as const;
    const primary = PRIMARY[leaf];
    const item = leaf === "empty-state" ? "empty" : "card";
    const sourcePath = `apps/v4/registry/bases/aria/ui/${item}.tsx`;
    const license = railSource.files.find(row => row.item === "license")!;
    if (sha256(license.content) !== SHADCN_SECTIONS_PIN.notice) throw new Error("shadcn sections: upstream notice differs");
    const pinFiles = [{ path: "LICENSE.md", sha256: SHADCN_SECTIONS_PIN.notice }, { path: sourcePath, sha256: SHADCN_SECTIONS_PIN[item] }];
    const notice = { path: `notices/surfaces/n-${SHADCN_SECTIONS_PIN.notice}.txt`, content: license.content };
    const output = [data.ports[leaf], notice];
    const binding = (prop: string) => ({ export: primary, path: [prop] });
    const candidate: SurfaceSectionEntry = {
      kind: "section", slot, source: "shadcn@aria", impl: { kind: "source", entry: data.ports[leaf].path, export: primary },
      rendering: "server", members: Object.keys(MEMBERS[leaf]), states: ["default"],
      reads: { tokens: READS[leaf], assets: [] }, composes: ["components.semantic-content"], parts: leaf === "section-header" ? [] : ["sections.section-header"],
      api: { version: 1, exports: [{ name: primary, export: primary }] },
      bindings: [{ file: data.ports[leaf].path, module: "../../components/semantic-content/index.js", name: "SemanticContent", local: "SemanticContent", slot: "components.semantic-content" }],
      dependencies: [{ module: "react", version: "19.3.0", license: "MIT" }, { module: "@clossys/designer", version: "0.12.0", license: "MIT" }],
      license: "MIT", pin: { kind: "git", url: SHADCN_SECTIONS_PIN.url, commit: SHADCN_SECTIONS_PIN.commit, files: pinFiles },
      notice: notice.path, outputSha256: surfaceManifest(output), blockers: [],
      propMap: Object.fromEntries(Object.entries(MEMBERS[leaf]).map(([name, prop]) => [name, binding(prop)])),
      slotMap: Object.fromEntries(Object.entries(SLOTS[leaf]).map(([name, prop]) => [name, binding(prop)])),
      configs: leaf === "section-header" ? Object.fromEntries([1, 2, 3, 4, 5, 6].map(level => [`level-${level}`, { members: [], props: [{ ...binding("level"), value: level }] }])) : {},
    };
    const meta = { id: `shadcn@aria/${slot}`, slot, source: candidate.source, mode: "implementation" as const, sourceAddress: sourcePath, relation: leaf === "empty-state" ? "subset" as const : "same-contract" as const, builtOn: [leaf === "empty-state" ? "shadcn@aria/components.empty" : "shadcn@aria/components.card"], conforms: [], evidence: [], author: "third-party" as const, trust: "pinned-upstream" as const, license: "MIT", status: "draft" as const, ...(leaf === "empty-state" ? { unmapped: ["kind.empty", "kind.no-results", "kind.first-use", "scope.region", "scope.page"] } : {}) };
    // The recipe includes every emitted source byte, so a port change invalidates its registered identity.
    const recipe = [{ path: `ports/shadcn-sections/${leaf}.tsx`, content: data.ports[leaf].content }];
    const transform: SurfaceTransform = {
      identity: { id: `shadcn-aria-section-${leaf}`, version: "1", sha256: surfaceDigest(surfaceManifest(recipe)).slice(7) }, source: recipe,
      run: ({ candidate: supplied, upstream: suppliedFiles }) => {
        if (surfaceDescriptorHash(supplied) !== surfaceDescriptorHash(candidate) || stableStringify(surfaceManifest(suppliedFiles)) !== stableStringify(candidate.pin.files)) throw new Error(`shadcn sections: registered ${leaf} input differs`);
        return { fill: candidate, files: output, blockers: [] };
      },
    };
    fills.push({ $extensions: { "com.clossys.fill": meta }, sections: { [leaf]: candidate } });
    transforms.push(transform);
    if (leaf === "empty-state") {
      const original = railSource.files.find(row => row.item === "empty")!;
      if (sha256(original.content) !== SHADCN_SECTIONS_PIN.empty) throw new Error("shadcn sections: upstream Empty differs");
      upstream[slot] = [{ path: original.path, content: original.content }, { path: "LICENSE.md", content: license.content }];
    }
    files[slot] = output;
  }
  return { fills, transforms, upstream, files };
}

/** Exact port receipts for a known consumer identity; callers still use the existing authenticated materializer. */
export function shadcnSectionMaterializations(catalog: CompositeCatalogData, consumerSource: string): SurfaceMaterializationReceipt[] {
  const imported = importShadcnSections();
  return imported.fills.map((doc, index) => {
    const candidate = Object.values(doc.sections!)[0]!;
    const transform = imported.transforms[index]!;
    const base: SurfaceBase = { source: candidate.source, fill: doc.$extensions["com.clossys.fill"].id, license: candidate.license, pin: candidate.pin, descriptorHash: surfaceDescriptorHash(candidate), upstreamSha256: candidate.pin.files, notices: candidate.pin.files.filter(row => row.path === "LICENSE.md") };
    const receipt = { path: "", content: stableStringify({ version: 1, base, transform: transform.identity, rule: null, inputs: [] }) };
    receipt.path = `surfaces/receipts/r-${sha256(receipt.content)}.json`;
    const output = [...imported.files[candidate.slot]!, receipt];
    const fill = { ...candidate, source: consumerSource, outputSha256: surfaceManifest(output) };
    return { operation: "adopt", slot: candidate.slot, baseDescriptorHash: base.descriptorHash, transform: transform.identity, rule: null, inputsHash: surfaceDerivationHash(base, transform.identity, null, catalog, candidate.slot, []), descriptorHash: surfaceDescriptorHash(fill), outputSha256: fill.outputSha256 };
  });
}
