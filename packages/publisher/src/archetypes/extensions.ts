/**
 * Publisher-owned registry of package extension slots: Designer section and
 * frame slots that a Foundry package declares in its consumer records
 * (`contract.package` names the package) instead of the Designer catalog.
 * The Producer Studio is the first such package. Each entry gives the slot
 * the same compatibility data a catalog slot gets (a section class, the
 * formats a frame may shell), so the conformance check treats every slot
 * alike and never names a package. The key sets must equal the consumer's
 * package extension slots (pinned by a parity test against the records).
 */
import type { SectionClass } from "./section-formats.js";

export const EXTENSION_PACKAGES = ["producer"] as const;
export type ExtensionPackage = (typeof EXTENSION_PACKAGES)[number];

export interface ExtensionSection {
  readonly package: ExtensionPackage;
  readonly class: SectionClass;
}

function freeze<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

const producer = (kind: SectionClass): ExtensionSection => ({ package: "producer", class: kind });

/** Package extension frame slot id → the package that declares it. Formats list the frame like a catalog frame. */
export const EXTENSION_FRAMES: Readonly<Record<`frames.${string}`, ExtensionPackage>> = freeze({
  "frames.studio-shell": "producer",
});

/** Package extension section slot id → its package and Publisher section class. */
export const EXTENSION_SECTION_CLASSES: Readonly<Record<`sections.${string}`, ExtensionSection>> = freeze({
  "sections.module.checks": producer("utility"),
  "sections.module.outline": producer("utility"),
  "sections.producer.pipeline-flow": producer("data"),
  "sections.producer.pipeline-header": producer("utility"),
  "sections.producer.pipeline-legend": producer("utility"),
  "sections.producer.step-sheet": producer("data"),
  "sections.producer.system-empty": producer("utility"),
  "sections.producer.team-strip": producer("data"),
  "sections.studio.checks": producer("data"),
  "sections.studio.contract": producer("data"),
  "sections.studio.history": producer("data"),
  "sections.studio.home": producer("data"),
  "sections.studio.leaf-header": producer("utility"),
  "sections.studio.options": producer("specimen"),
  "sections.studio.page-header": producer("utility"),
  "sections.studio.page-tabs": producer("utility"),
  "sections.studio.publications": producer("data"),
  "sections.studio.references": producer("data"),
  "sections.studio.slot-groups": producer("data"),
  "sections.studio.specimen": producer("specimen"),
});

export function isExtensionPackage(value: unknown): value is ExtensionPackage {
  return typeof value === "string" && (EXTENSION_PACKAGES as readonly string[]).includes(value);
}
