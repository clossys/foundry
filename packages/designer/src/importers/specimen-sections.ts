/** Native source candidates for intrinsic Studio specimen leaves. No package component render fallback. */
import { sha256 } from "../catalog-core/digest.js";
import { stableStringify } from "../catalog-core/stable.js";
import { surfaceDigest, surfaceManifest, surfaceFault } from "../catalog-core/surface-library.js";
import type { SurfaceCandidateDocument, SurfaceFile, SurfaceSectionEntry, SurfaceTransform, SurfacePackageEvidence, SurfaceDependency } from "../catalog-core/surface-types.js";
import sourceData from "./specimen-source.data.json" with { type: "json" };
import { SPECIMEN_RENDER_PARTS } from "../studio/specimen-render-part-identities.js";

export const SPECIMEN_SECTION_EXPORTS = [
  {
    "id": "sections.specimen-swatch",
    "name": "SpecimenSwatch",
    "components": [
      "components.semantic-content"
    ]
  },
  {
    "id": "sections.specimen-color-ramp",
    "name": "SpecimenColorRamp",
    "components": [
      "components.semantic-content",
      "components.grid-list",
      "components.disclosure"
    ]
  },
  {
    "id": "sections.specimen-type-ladder",
    "name": "SpecimenTypeLadder",
    "components": [
      "components.semantic-content",
      "components.grid-list",
      "components.disclosure"
    ]
  },
  {
    "id": "sections.specimen-spacing-ladder",
    "name": "SpecimenSpacingLadder",
    "components": [
      "components.semantic-content",
      "components.grid-list",
      "components.disclosure"
    ]
  },
  {
    "id": "sections.specimen-radius-ladder",
    "name": "SpecimenRadiusLadder",
    "components": [
      "components.semantic-content",
      "components.grid-list",
      "components.disclosure"
    ]
  },
  {
    "id": "sections.specimen-motion-player",
    "name": "SpecimenMotionPlayer",
    "components": [
      "components.semantic-content",
      "components.grid-list",
      "components.disclosure",
      "components.button"
    ]
  },
  {
    "id": "sections.specimen-asset-grid",
    "name": "SpecimenAssetGrid",
    "components": [
      "components.semantic-content",
      "components.grid-list",
      "components.disclosure",
      "components.logo"
    ]
  },
  {
    "id": "sections.specimen-icon-grid",
    "name": "SpecimenIconGrid",
    "components": [
      "components.semantic-content",
      "components.grid-list",
      "components.disclosure",
      "components.icon"
    ]
  },
  {
    "id": "sections.specimen-variant-matrix",
    "name": "SpecimenVariantMatrix",
    "components": [
      "components.semantic-content",
      "components.grid-list",
      "components.table",
      "components.disclosure",
      "components.badge"
    ]
  },
  {
    "id": "sections.specimen-section-viewports",
    "name": "SpecimenSectionViewports",
    "components": [
      "components.semantic-content",
      "components.grid-list",
      "components.table",
      "components.disclosure"
    ]
  },
  {
    "id": "sections.specimen-frame-viewports",
    "name": "SpecimenFrameViewports",
    "components": [
      "components.semantic-content",
      "components.grid-list",
      "components.table",
      "components.disclosure"
    ]
  },
  {
    "id": "sections.specimen-rich-passage",
    "name": "SpecimenRichPassage",
    "components": [
      "components.semantic-content",
      "components.grid-list",
      "components.disclosure",
      "components.rich-text"
    ]
  },
  {
    "id": "sections.specimen-copy-in-context",
    "name": "SpecimenCopyInContext",
    "components": [
      "components.semantic-content",
      "components.grid-list",
      "components.table",
      "components.disclosure",
      "components.rich-text",
      "components.button",
      "components.navigation-tree"
    ]
  },
  {
    "id": "sections.specimen-page-viewports",
    "name": "SpecimenPageViewports",
    "components": [
      "components.semantic-content",
      "components.grid-list",
      "components.table",
      "components.disclosure"
    ]
  }
] as const;
const notice = "SPDX-License-Identifier: MIT\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files, to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED AS IS, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.\n";
export interface SpecimenSectionSourceCatalog {
  readonly fills: readonly SurfaceCandidateDocument[];
  readonly transforms: readonly SurfaceTransform[];
  readonly upstream: readonly SurfaceFile[];
}
/**
 * Source files are an immutable, content-addressed local tree. Hosts may supply exact installed dependency
 * evidence when deriving for their selected component closure; no dependency artifact is invented here.
 */
export function specimenSectionSourceCatalog(packages: readonly SurfacePackageEvidence[] = [], selectedDependencies: readonly SurfaceDependency[] = []): SpecimenSectionSourceCatalog {
  const upstream: SurfaceFile[] = [];
  const fills: SurfaceCandidateDocument[] = [], transforms: SurfaceTransform[] = [];
  for (const registration of SPECIMEN_SECTION_EXPORTS) {
    const entry = registration.id.replace(".", "/") + "/" + registration.name + ".tsx";
    const components = [...new Set([...registration.components, "components.grid-list", "components.disclosure"])] as `components.${string}`[];
    const parts: string[] = Object.hasOwn(SPECIMEN_RENDER_PARTS, registration.id) ? [...SPECIMEN_RENDER_PARTS[registration.id as keyof typeof SPECIMEN_RENDER_PARTS]] : [];
    if (registration.id === "sections.specimen-swatch" || registration.id === "sections.specimen-color-ramp") parts.push("studio.specimen-swatch", "studio.specimen-contrast");
    const materialized = sourceData.specimens.find(row => row.id === registration.id);
    if (!materialized || materialized.files.length !== 1 || materialized.files[0]!.path !== entry) surfaceFault("S2 canonical specimen source is unavailable");
    const files = materialized.files;
    const own = [...files, { path: "LICENSE", content: notice }];
    const pin = { kind: "local-tree" as const, tree: sha256(stableStringify(surfaceManifest(own))).slice(0,40), files: surfaceManifest(own) };
    const dependencies = [{ module: "@clossys/designer/studio", version: packages.find(pkg => pkg.module === "@clossys/designer/studio")?.version ?? "0.12.0", license: "MIT" }, ...selectedDependencies.filter(dependency => dependency.module !== "@clossys/designer/studio")];
    const candidate: SurfaceSectionEntry = {
      kind: "section", slot: registration.id, source: "foundry", impl: { kind: "source", entry, export: registration.name },
      rendering: "client", members: [], states: ["default"], reads: { tokens: ["tokens.spacing", "tokens.breakpoint"], assets: [] },
      composes: components, parts, api: { version: 1, exports: [{ name: registration.name, export: registration.name }, { name: "SpecimenLeaf", export: "SpecimenLeaf" }] },
      bindings: materialized.bindings as SurfaceSectionEntry["bindings"],
      dependencies, license: "MIT", pin, notice: `notices/surfaces/n-${sha256(notice)}.txt`,
      outputSha256: surfaceManifest([...files, { path: `notices/surfaces/n-${sha256(notice)}.txt`, content: notice }]),
      blockers: [], slotMap: Object.fromEntries(["items", "axes", "context", "labels", ...(parts.length ? ["renderParts"] : [])].map(name => [name, { export: registration.name, path: [name] }])), propMap: {}, configs: {},
    };
    const transformSource = [{ path: `rules/${registration.id.slice(9)}.json`, content: stableStringify({ version: 1, operation: "retain-native-specimen-source", files: pin.files }) }];
    const transform: SurfaceTransform = {
      identity: { id: registration.id.slice(9), version: "1", sha256: surfaceDigest(surfaceManifest(transformSource)).slice(7) }, source: transformSource,
      run: input => {
        if (input.candidate.slot !== registration.id || stableStringify(surfaceManifest(input.upstream)) !== stableStringify(pin.files)) surfaceFault("S2 specimen source input bytes differ");
        return { fill: input.candidate, files, blockers: [] };
      },
    };
    fills.push({ $extensions: { "com.clossys.fill": { id: `foundry/${registration.id}`, slot: registration.id, source: "foundry", mode: "implementation", sourceAddress: entry, relation: "same-contract", builtOn: [], conforms: [], evidence: [], author: "foundry", trust: "foundry", license: "MIT", status: "draft", originKinds: ["adopted"] } }, sections: { [registration.id.slice(9)]: candidate } });
    transforms.push(transform); upstream.push(...own.filter(file => file.path !== "LICENSE"));
  }
  upstream.push({ path: "LICENSE", content: notice });
  return { fills, transforms, upstream };
}
