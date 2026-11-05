import { measuredSurfaceConsumption } from "./foundry-surface-consumption.js";
import { stableStringify } from "../catalog-core/stable.js";

/**
 * Foundry section fills implemented by a Publisher package export. The package
 * mapping is authored here; reads, composes and the source measurement are the
 * generated lower-bound facts of that export, never hand-declared.
 */
const PUBLISHER_SECTIONS = {
  "sectioned-document": {
    pin: { package: "@clossys/publisher", version: "0.13.0", export: "./web#SectionedView" },
    impl: { kind: "package", module: "@clossys/publisher/web", export: "SectionedView" },
    slotMap: { document: "./web#SectionedView.document,landmark" },
    propMap: { "landmark.none": "./web#SectionedView.landmark=none" },
    notes: [
      "The required resolved document placement maps two native props: document and landmark. This is a placement mapping, not JSON type equivalence.",
      "The host resolves the whole document before materialization; document.resolutions retains Writer provenance. This section owns no additional copy.",
      "landmark must be none inside the parent SiteFrame main landmark. SectionedView preserves the authored section order and intro heading.",
      "Asset-bearing documents additionally require the host runtime resolveAssetId callback, which this JSON-only candidate cannot serialize or supply.",
    ],
  },
} as const;

/** Exact local artifacts as bytes; filesystem writes remain caller-owned. */
export function generatedPublisherSectionFiles(): Readonly<Record<string, string>> {
  return Object.fromEntries(Object.entries(PUBLISHER_SECTIONS).map(([leaf, entry]) => {
    const slot = `sections.${leaf}`;
    const fill = {
      $extensions: { "com.clossys.fill": {
        author: "foundry", builtOn: [], conforms: [], evidence: [], id: `foundry/${slot}`, license: "MIT", mode: "implementation",
        originKinds: ["adopted"], pin: entry.pin, relation: "same-contract", slot, source: "foundry", sourceAddress: entry.pin.export, status: "draft", trust: "foundry",
      } },
      sections: { [leaf]: {
        slot, source: "foundry", slotMap: entry.slotMap, propMap: entry.propMap, configs: {}, parts: [], impl: entry.impl, license: "MIT", pin: entry.pin, notes: entry.notes,
        ...measuredSurfaceConsumption(slot, entry.pin),
      } },
    };
    return [`${slot}.json`, stableStringify(fill)];
  }));
}
