import type { FrameContract } from "./frames-contract.js";
import type { SectionContract } from "./sections-contract.js";
import type { LAYERS } from "./ids.js";

export type LayerId = (typeof LAYERS)[number];
export type DtcgType = "color" | "dimension" | "fontFamily" | "fontWeight" | "duration" | "cubicBezier" | "number" | "shadow" | "gradient";
export type Mode = "light" | "dark";
export type Status = "draft" | "stable";
export type Signoff = { by: "owner"; date: string; ref: string };
export type CheckCode = "C1" | "C2" | "C3" | "C4" | "C5" | "C6" | "C7" | "C8" | "C9" | "C10";
/** Optional presentation metadata. Check decisions and diagnostic text stay unchanged. */
export interface FindingCopyRef { readonly id: string; readonly values?: Readonly<Record<string, string | number | boolean>> }
export interface Finding { code: CheckCode | `A${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12}` | "R"; rule: string; severity: "error" | "notice" | "warning"; subject: string; message: string; readonly copy?: FindingCopyRef }

/** JSON value as it appears in a DTCG `$value` (typed object, array, number, string). */
export type DtcgValue = string | number | boolean | null | readonly DtcgValue[] | { readonly [key: string]: DtcgValue };
export type DtcgDocType = DtcgType;

export type Tier = "scale" | "role";
export interface TokenContract {
  kind: "token";
  tier: Tier;
  $type: DtcgType;
  memberTypes?: Readonly<Record<string, DtcgType>>;
  members: { mode: "closed"; names: readonly string[] } | { mode: "open"; pattern: string; required?: readonly string[] };
  modes: readonly Mode[];
  emit?: Readonly<Record<string, `--${string}`>>;
}
export type AssetValueKind = "svg" | "raster" | "glyph" | "rules";
export type CellType = DtcgType | AssetValueKind;
export interface AssetContract {
  kind: "asset";
  valueKind: AssetValueKind;
  memberKinds?: Readonly<Record<string, AssetValueKind>>;
  members: TokenContract["members"];
  optional?: readonly string[];
  modes: readonly ["light"];
  grid?: 24;
}
export interface LeafReads { tokens: readonly string[]; assets: readonly string[] }
/** The component registry describes contracts; it does not supply executable fills. */
export interface ComponentContract {
  kind: "component";
  root: `rac:${string}` | "presentational" | "engine:none";
  apg?: string;
  /** Exact RAC roots for independently observed members sharing one source. */
  memberRoots?: Readonly<Record<string, ComponentContract["root"]>>;
  members: TokenContract["members"];
  props: readonly string[];
  allowedReads: LeafReads;
  composes?: readonly string[];
}
export type SlotContract = TokenContract | AssetContract | ComponentContract | SectionContract | FrameContract;
/** The existing value engine accepts token and asset slots until component resolution ships. */
export interface Slot<Contract extends SlotContract = TokenContract | AssetContract> {
  id: string; layer: LayerId; contract: Contract;
  requires: readonly string[];
  status: Status; signoff?: Signoff;
}
export interface Source {
  id: string;
  kind: "base" | "external" | "consumer";
  author: "foundry" | "consumer" | "third-party";
  license: string;
  pin?: { package?: string; version?: string; export?: string; file?: string; url?: string; commit?: string; sha256?: string };
  extends?: "foundry";
  homepage?: string;
  baseline?: boolean;
}
export type Evidence = { clause: string; path: string } | { clause: string; check: CheckCode };
export type Origin =
  | { kind: "adopted"; source: string; fill: string; member: string; pin?: Source["pin"]; license: string; sha256: string; adoptedAt: string; aliasOf?: string }
  | { kind: "authored"; license: string; note?: string }
  | { kind: "derived"; rule: string; inputs: readonly string[]; inputsHash: string }
  | { kind: "composed"; reads: readonly string[]; rule?: string };
/** Component compositions require a registered rule; older asset provenance remains readable. */
export type ComponentComposedOrigin = Extract<Origin, { kind: "composed" }> & { rule: string };
/** Reserved for the component change engine; the value engine does not execute this operation. */
export interface ComposeOperation { op: "compose"; slot: string; rule: string }
/** Declared inputs, when present, are the exact required set of consumer library members. */
export interface CatalogRule { id: string; slot: string; values: Readonly<Record<string, DtcgToken>>; inputs?: readonly string[] }
export interface FillMeta {
  id: string;
  slot: string; source: string;
  mode: "implementation" | "reference" | "derived";
  sourceAddress: string;
  relation: "same-contract" | "subset" | "superset" | "derived";
  builtOn: readonly string[];
  conforms: readonly string[];
  evidence: readonly Evidence[];
  author: Source["author"]; trust: "foundry" | "pinned-upstream" | "consumer" | "unpinned";
  license: string; pin?: Source["pin"];
  status: Status; signoff?: Signoff;
  derivation?: { from: string; rule: string };
  unmapped?: readonly string[];
  /** Asset fills declare every consumed leaf, including empty arrays. */
  reads?: LeafReads;
  originKinds?: readonly Origin["kind"][];
  baseline?: boolean;
}
export interface Standard { id: string; title: string; version: string; url: string; clauses: readonly { id: string; title: string }[] }
export type Pick = { scope: "member" | "slot"; target: string; source: string };
export interface LegacySelection { version: 1; consumer: string; defaultChain: readonly string[]; picks: readonly Pick[] }
export interface Selection {
  version: 2; consumer: string; rubricVersion: string; strategy: import("./selection-strategy.js").SelectionStrategy | null;
  slots: readonly { slot: string; originKinds: readonly Origin["kind"][]; sources: readonly string[]; rationale: DtcgValue }[];
}
export type ResolvedValue = DtcgValue;
export type FontPayload =
  | { kind: "system" }
  | { kind: "fontsource"; package: string; version: string; weights: readonly number[]; styles: readonly ("normal" | "italic")[]; license: string };
export interface ResolvedMember {
  slot: string; source: string; fill: string;
  via: "member" | "slot" | "default" | Origin["kind"];
  $type: CellType;
  value: Readonly<Partial<Record<Mode, ResolvedValue>>> & { light: ResolvedValue };
  css: Readonly<Partial<Record<Mode, string>>> & { light: string };
  alias: Readonly<Partial<Record<Mode, string>>>;
  emit?: `--${string}`;
  font?: FontPayload;
  reads?: readonly string[];
  origin?: Origin;
}
export interface Resolved {
  version: 1; consumer: string; selectionHash: string;
  members: Readonly<Record<string, ResolvedMember>>;
  notices: readonly Finding[];
  baseline?: Readonly<Record<string, { light: string; dark?: string }>>;
}

/** One token inside a fill document. `$value` is a typed DTCG value, an alias string `"{member.id}"`, or raw CSS text. */
export interface DtcgToken {
  $type: CellType;
  $value: DtcgValue;
  $extensions?: {
    "com.clossys.css"?: { raw?: string; reads?: readonly string[] };
    "com.clossys.unit"?: "em";
    "com.clossys.modes"?: { dark?: DtcgValue };
    "com.clossys.font"?: FontPayload;
    "com.clossys.source"?: { line: number };
    /** Value-source attribution retained when a candidate is adopted by a consumer. */
    "com.clossys.provenance"?: {
      sourceLabel: string;
      sourceAddress: string;
      sourceVariable?: string;
      mappingLabel?: "Foundry-authored";
      pin?: Source["pin"];
      note?: string;
    };
    "com.clossys.origin"?: Origin;
    "com.clossys.materializedSha256"?: string;
    /** Explicit member-only A5 contrast exemption; all other asset rules still apply. */
    "com.clossys.contrast-exemption"?: { kind: "logotype"; reason: string };
  };
}
export type DtcgNode = DtcgToken | { readonly [key: string]: DtcgNode };
export type DtcgGroup = { readonly [key: string]: DtcgNode };
export type FillDoc = { $extensions: { "com.clossys.fill": FillMeta } } & ({ tokens: DtcgGroup; assets?: never } | { assets: DtcgGroup; tokens?: never });
export interface LibraryData {
  source: Source; fills: readonly FillDoc[]; complete?: boolean;
  baseline?: Readonly<Record<string, { light: string; dark?: string }>>;
  adoptedAt?: string;
  rubricVersion?: string; strategy?: import("./selection-strategy.js").SelectionStrategy | null;
  rationale?: Readonly<Record<string, DtcgValue>>;
  selection?: Selection;
}
export type PlacementNode = { id: string; label: string; children: readonly PlacementNode[] } | { id: string; label: string; leaves: readonly string[] };
export interface Placement { layer: LayerId; nodes: readonly PlacementNode[] }
export interface Retired { id: string; retiredAt: string; replacedBy?: string }
export interface CatalogData {
  slots: readonly Slot[]; standards: readonly Standard[]; sources: readonly Source[]; fills: readonly FillDoc[];
  rules?: readonly CatalogRule[];
  placements: readonly Placement[]; retired: readonly Retired[];
}

/** Draft IA data, deliberately distinct from the executable value-engine catalog. */
export type ComponentSlot = Slot<ComponentContract> & { layer: "components" };
export type FrameSlot = Slot<FrameContract> & { layer: "frames" };
export type CatalogSlot = Slot<SlotContract>;
export interface SlotAlias { id: string; target: string; memberMap?: Readonly<Record<string, string>> }
export interface BuildCatalogData extends Omit<CatalogData, "slots"> {
  slots: readonly CatalogSlot[];
  aliases: readonly SlotAlias[];
  /** Layer-specific migration evidence; does not change the global retirement registry. */
  retiredByLayer: Readonly<Partial<Record<LayerId, readonly Retired[]>>>;
  /** This is build state, never evidence of an owner-signed leaf freeze. */
  registryStatus: "build-unfrozen";
}

/** One consumer owns explicit value and executable-component portions. */
export interface CompositeCatalogData {
  values: CatalogData;
  components: import("./resolve-components.js").ComponentCatalog;
  surfaces?: import("./surface-types.js").SurfaceCatalog;
}
export interface CompositeLibraryData {
  source: Source;
  adoptedAt?: string;
  values: Omit<LibraryData, "source" | "adoptedAt">;
  components: Omit<import("./resolve-components.js").ComponentLibrary, "source" | "adoptedAt">;
  surfaces?: import("./surface-types.js").SurfaceLibraryPortion;
}
export type CompositeFinding = Finding | import("./check-components.js").ComponentFinding | import("./surface-types.js").SurfaceFinding;
export interface CompositeCheckResult { ok: boolean; findings: readonly CompositeFinding[] }
export interface CompositeEngineInput {
  catalog: CompositeCatalogData;
  library: CompositeLibraryData;
  componentOptions?: Omit<import("./resolve-components.js").ComponentResolutionInput, "catalog" | "library" | "values">;
  surfaceOptions?: import("./surface-types.js").SurfaceResolutionOptions;
  fileExists?: (path: string) => boolean;
  strategy?: import("./selection-strategy.js").SelectionStrategyReader;
}
export interface CompositeResolved {
  consumer: string;
  selectionHash: string;
  values: Resolved;
  components: import("./resolve-components.js").ResolvedComponents;
  surfaces?: import("./surface-types.js").SurfaceResolved;
  check: CompositeCheckResult;
}
export type CompositeLibraryOperation =
  | { portion: "values"; change: import("./api.js").LibraryOperation }
  | { portion: "components"; change: import("./changeset-components.js").ComponentOperation }
  | { portion: "surfaces"; change: import("./surface-types.js").SurfaceOperation };
export interface CompositeChangeSet {
  baseHash: string;
  changes: readonly CompositeLibraryOperation[];
  bundles?: readonly import("./changeset-components.js").SourceBundle[];
  surfaceBundles?: readonly import("./surface-types.js").SurfaceSourceBundle[];
}
export type CompositeEmitTarget = import("./api.js").EmitTarget | import("./emit-components.js").ComponentEmitTarget | import("./surface-types.js").SurfaceEmitTarget;
export interface CompositeEmitFile { path: string; contents: string }
