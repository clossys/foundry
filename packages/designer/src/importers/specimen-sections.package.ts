/** Registered package implementations of the intrinsic specimen sections. */
import { SPECIMEN_SECTION_EXPORTS } from "./specimen-sections.js";
import { canonicalSurfaceConsumption } from "./foundry-surface-consumption.js";
import { stableStringify } from "../catalog-core/stable.js";
import type { SurfacePackageDocument, SurfacePackageSectionEntry } from "../catalog-core/surface-types.js";

/** These functions are real public SDK exports, not generated source proxies. */
export function specimenSectionPackageCatalog(): readonly SurfacePackageDocument[] {
  return SPECIMEN_SECTION_EXPORTS.map(registration => {
    const pin = { package: "@clossys/designer", version: "0.12.0", export: `./studio#${registration.name}` };
    const impl = { kind: "package" as const, module: "@clossys/designer/studio", export: registration.name };
    const consumption = canonicalSurfaceConsumption(registration.id, impl, pin);
    const descriptor: SurfacePackageSectionEntry = {
      slot: registration.id, source: "foundry", impl, pin, license: "MIT",
      slotMap: Object.fromEntries(["items", "axes", "context", "labels"].map(name => [name, `./studio#${registration.name}.${name}`])),
      propMap: {}, configs: {}, parts: [],
      reads: { tokens: [...new Set(["tokens.spacing", "tokens.breakpoint", ...consumption?.scannedReads.tokens ?? []])].sort(), assets: [...consumption?.scannedReads.assets ?? []] },
      composes: [...new Set([...registration.components, "components.grid-list", "components.disclosure", ...consumption?.scannedComposes ?? [], ...consumption?.scannedReads.components ?? []])].sort(),
      ...(consumption ? { consumption } : {}),
      notes: [
        "The public SDK function owns the intrinsic specimen layout and consumes the descriptor-matched emitted selection context.",
        "Selected components and surfaces come from the caller's emitted native context; package defaults are not rendering ports.",
        "Source-consumption observations are lower bounds and retain unresolved observations. Package build and consumer runtime proof are separate.",
      ],
    };
    return { $extensions: { "com.clossys.fill": {
      id: `foundry/${registration.id}`, slot: registration.id, source: "foundry", mode: "implementation", sourceAddress: pin.export,
      relation: "same-contract", builtOn: [], conforms: [], evidence: [], author: "foundry", trust: "foundry", license: "MIT", pin,
      status: "draft", originKinds: ["adopted"],
    } }, sections: { [registration.id.slice("sections.".length)]: descriptor } };
  });
}

/** The unchanged native measurement generator reads these real export pointers. */
export function generatedSpecimenSectionPackageFiles(): Readonly<Record<string, string>> {
  return Object.fromEntries(specimenSectionPackageCatalog().map(document => [document.$extensions["com.clossys.fill"].slot + ".json", stableStringify(document)]));
}
