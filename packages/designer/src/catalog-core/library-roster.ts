import type { CatalogData, DtcgToken, LayerId, Placement, Source, FillMeta } from "./types.js";
import type { ComponentCandidate, ComponentCandidateDocument } from "./resolve-components.js";
import { flatten } from "./model.js";
import { tokenContent } from "./library.js";
import { stableStringify } from "./stable.js";

/** Display policy only. An entry is never proof of a fill, licence clearance or executable implementation. */
export interface LibraryRosterEntry {
  readonly id: string;
  readonly label: string;
  readonly role: "candidate-source" | "reference" | "consumer";
  readonly license: string;
  readonly restriction?: string;
}
const custom: LibraryRosterEntry = { id: "custom", label: "Custom", role: "consumer", license: "consumer-owned" };
const foundry: LibraryRosterEntry = { id: "foundry", label: "Foundry", role: "candidate-source", license: "MIT" };
const reference = (id: string, label: string, license: string, restriction?: string): LibraryRosterEntry => ({ id, label, role: "reference", license, ...(restriction ? { restriction } : {}) });
const blocks = reference("shadcn-blocks", "shadcn blocks", "MIT", "Official free blocks only; dashboard/sidebar frame references. No third-party or commercial block kits.");
const components: readonly LibraryRosterEntry[] = [
  { id: "shadcn@aria", label: "shadcn/ui (React Aria)", role: "candidate-source", license: "MIT", restriction: "Existing item-specific drafts only; preserve MIT notices. Selection requires normal engine qualification." },
  reference("shadcn-ui", "shadcn/ui", "MIT", "Reference anatomy metadata only; distinct from official shadcn@aria implementation candidates."),
  foundry,
  reference("heroui-v3", "HeroUI v3", "Apache-2.0", "Preserve licence, NOTICE and modification notices; Pro excluded."),
  reference("untitled-ui-react", "Untitled UI React", "MIT", "Verified MIT-marked subset only; paid assets excluded."),
  reference("radix-themes", "Radix Themes", "MIT"),
  reference("mantine", "Mantine", "MIT"),
  reference("park-ui", "Park UI", "MIT"),
  reference("base-ui", "Base UI", "MIT"),
  custom,
];

/** Allowed column roster per slot, before hiding empty columns. Never rewrites catalog sources or provenance. */
export function libraryRoster(layer: LayerId, slot: string): readonly LibraryRosterEntry[] {
  if (!slot.startsWith(`${layer}.`)) return [];
  if (layer === "tokens") return [{ ...custom }];
  if (layer === "components") return components.map(entry => ({ ...entry }));
  if (layer === "sections") return [custom, foundry, blocks].map(entry => ({ ...entry }));
  if (layer === "frames") return [foundry, blocks, custom].map(entry => ({ ...entry }));
  if (slot.startsWith("assets.icon-")) return [
    { id: "lucide", label: "Lucide", role: "candidate-source", license: "ISC AND MIT" },
    { id: "phosphor", label: "Phosphor", role: "candidate-source", license: "MIT" },
    { ...custom },
  ];
  if (slot === "assets.typeface") return [
    { id: "google-fonts", label: "Google Fonts", role: "candidate-source", license: "per-family", restriction: "Verify and preserve each selected family's licence." },
    { id: "fontshare-ofl", label: "Fontshare (OFL)", role: "candidate-source", license: "OFL-1.1", restriction: "Verified OFL subset only; ITF FFL fonts excluded without separate rights." },
    { ...custom },
  ];
  if (slot === "assets.pattern") return [
    { id: "hero-patterns", label: "Hero Patterns", role: "candidate-source", license: "CC-BY-4.0", restriction: "Retain attribution, source, licence and modification notices." },
    { ...custom },
  ];
  return [{ ...custom }];
}

export interface LibraryColumn extends LibraryRosterEntry {
  readonly source: string;
  /** References describe variants; the normal engine must qualify every actual implementation. */
  readonly referenceOnly: boolean;
}
/** Sources must come from actual candidates for the board. Empty columns stay hidden. */
export function libraryColumns(layer: LayerId, slots: readonly string[], availableSources: readonly string[], consumerSource: string): readonly LibraryColumn[] {
  const available = new Set(availableSources);
  const seen = new Set<string>();
  return slots.flatMap(slot => libraryRoster(layer, slot)).flatMap(entry => {
    const source = entry.id === "custom" ? consumerSource : entry.id;
    if (seen.has(entry.id) || !available.has(source)) return [];
    seen.add(entry.id);
    return [{ ...entry, source, referenceOnly: entry.role === "reference" }];
  });
}

/** Item provenance never inherits a source-level token-theme pin. */
export interface LibraryItemProvenance {
  readonly source: string;
  readonly layer: string;
  readonly fill: FillMeta;
  readonly sourceLicense?: string;
  /** Context for the source record, not evidence for this item's implementation. */
  readonly sourceRecordPin?: Source["pin"];
}
export function libraryItemProvenance(sources: readonly Source[], meta: FillMeta): LibraryItemProvenance {
  const source = sources.find(source => source.id === meta.source);
  return structuredClone({ source: meta.source, layer: meta.slot.split(".")[0]!, fill: meta,
    ...(source ? { sourceLicense: source.license, sourceRecordPin: source.pin } : {}),
  });
}

export interface ComponentLibraryCandidate extends LibraryItemProvenance {
  /** Original descriptor evidence: per-file pins, dependencies, notice and transform. */
  readonly implementation: ComponentCandidate;
  /** A projection does not execute qualification or make an adoption decision. */
  readonly qualification: "unassessed";
}
export interface ComponentLibraryColumn extends LibraryColumn {
  readonly candidates: readonly ComponentLibraryCandidate[];
}
/** Pure Studio data projection. Only actual documents on this board create columns. */
export function componentLibraryColumns(
  sources: readonly Source[], documents: readonly ComponentCandidateDocument[],
  slots: readonly string[], consumerSource: string,
): readonly ComponentLibraryColumn[] {
  const board = new Set(slots);
  const candidates = documents.filter(doc => board.has(doc.$extensions["com.clossys.fill"].slot)).flatMap(doc => {
    const meta = doc.$extensions["com.clossys.fill"];
    return Object.values(doc.components).filter(item => item.slot === meta.slot && item.source === meta.source).map(implementation => ({
      ...libraryItemProvenance(sources, meta), implementation: structuredClone(implementation), qualification: "unassessed" as const,
    }));
  });
  return libraryColumns("components", slots, candidates.map(candidate => candidate.source), consumerSource).map(column => ({
    ...column, candidates: candidates.filter(candidate => candidate.source === column.source),
  }));
}

export interface AssetSlotDetails {
  readonly classification: "asset" | "legacy-setting";
  readonly guidelines: readonly string[];
  readonly settings: readonly string[];
  readonly tokenInputs: readonly string[];
}
/** Guidelines validate bytes; settings parameterize their use. Neither creates candidate columns. */
export function assetSlotDetails(slot: string): AssetSlotDetails {
  if (slot === "assets.image-ratio") return { classification: "legacy-setting", guidelines: [], settings: ["aspect-ratio", "crop", "focal-point"], tokenInputs: ["aspect-ratio"] };
  if (slot === "assets.video") return { classification: "asset", guidelines: ["media-accessibility", "supported-codecs"], settings: ["poster", "loop", "muted", "autoplay", "reduced-motion-still", "max-bytes", "codec", "aspect-ratio", "crop", "focal-point", "overlay"], tokenInputs: ["duration"] };
  if (slot === "assets.pattern") return { classification: "asset", guidelines: ["attribution"], settings: [], tokenInputs: ["color", "scale", "opacity"] };
  const guidelines = slot === "assets.favicon" ? ["favicon-sizes", "formats", "safe-area"]
    : slot === "assets.app-icon" ? ["platform-icon-sizes", "formats", "safe-area"]
    : slot === "assets.share-image" ? ["og-1200x630", "formats", "safe-area"]
    : slot === "assets.lockup" || slot === "assets.mark" ? ["formats", "safe-area"] : ["formats"];
  return { classification: "asset", guidelines, settings: ["aspect-ratio", "crop", "focal-point"], tokenInputs: [] };
}

/** Proposed new IDs remain outside the signed registry until the owner amends its freeze. */
export interface PendingAssetLeaf { readonly id: string; readonly label: string; readonly group: string; readonly family: string }
export interface AssetPresentation {
  readonly status: "build-pending-owner-freeze";
  readonly activation: "requires-amended-owner-leaf-freeze-and-contracts";
  readonly placement: Placement;
  readonly pendingLeaves: readonly PendingAssetLeaf[];
  readonly legacySettings: readonly string[];
}
export function assetPresentation(placement: Placement): AssetPresentation {
  const proposed = structuredClone(placement);
  const media = proposed.nodes.find(node => node.id === "imagery");
  if (media) media.label = "Media";
  return {
    status: "build-pending-owner-freeze" as const,
    activation: "requires-amended-owner-leaf-freeze-and-contracts",
    placement: proposed,
    pendingLeaves: [
      { id: "assets.photography", label: "Photography", group: "imagery", family: "media-photography" },
      { id: "assets.illustration", label: "Illustration", group: "imagery", family: "media-illustration" },
      { id: "assets.video", label: "Video and motion", group: "imagery", family: "media-motion" },
      { id: "assets.pattern", label: "Patterns and textures", group: "imagery", family: "media-patterns" },
      { id: "assets.typeface", label: "Typefaces", group: "typefaces", family: "typefaces-files" },
      { id: "assets.share-image", label: "OG and share image", group: "app-identity", family: "app-identity-share" },
    ],
    legacySettings: ["assets.image-ratio"],
  };
}

export interface TokenBaseline {
  readonly source: "tailwind-default";
  readonly readOnly: true;
  readonly token: DtcgToken;
  readonly pin?: Source["pin"];
  /** Undefined means no consumer value was provided. */
  readonly differs?: boolean;
}
/** Uses the actual pinned catalog fill; absence stays absent, including Foundry-only tokens. */
export function tokenBaseline(catalog: CatalogData, slot: string, member: string, current?: DtcgToken): TokenBaseline | undefined {
  if (!slot.startsWith("tokens.")) return undefined;
  const fill = catalog.fills.find(fill => {
    const meta = fill.$extensions["com.clossys.fill"];
    return meta.slot === slot && meta.source === "tailwind-default" && meta.mode !== "reference";
  });
  if (!fill) return undefined;
  const id = member.startsWith(`${slot}.`) ? member : `${slot}.${member}`;
  const token = flatten(fill)[id];
  if (!token) return undefined;
  const content = tokenContent(token);
  return { source: "tailwind-default", readOnly: true, token: structuredClone(content),
    ...(fill.$extensions["com.clossys.fill"].pin ? { pin: structuredClone(fill.$extensions["com.clossys.fill"].pin) } : {}),
    ...(current ? { differs: stableStringify(tokenContent(current)) !== stableStringify(content) } : {}),
  };
}

/** Feed this through the consumer's existing changeset engine; adoption retains the upstream provenance. */
export function tokenBaselineReset(catalog: CatalogData, slot: string, member: string) {
  if (!tokenBaseline(catalog, slot, member)) return undefined;
  return { op: "adopt" as const, slot, source: "tailwind-default", members: [member.startsWith(`${slot}.`) ? member : `${slot}.${member}`] };
}
