import type { LAYERS } from "./ids.js";

export type LayerId = (typeof LAYERS)[number];
export type DtcgType = "color" | "dimension" | "fontFamily" | "fontWeight" | "duration" | "cubicBezier" | "number" | "shadow";
export type Mode = "light" | "dark";
export type Status = "draft" | "stable";
export type Signoff = { by: "owner"; date: string; ref: string };
export type CheckCode = "C1" | "C2" | "C3" | "C4" | "C5" | "C6" | "C7" | "C8" | "C9";
export interface Finding { code: CheckCode | "R"; rule: string; severity: "error" | "notice"; subject: string; message: string }

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
export interface Slot {
  id: string; layer: LayerId; contract: TokenContract;
  requires: readonly string[];
  status: Status; signoff?: Signoff;
}
export interface Source {
  id: string;
  kind: "base" | "external" | "consumer";
  author: "foundry" | "consumer" | "third-party";
  license: string;
  pin?: { package?: string; version?: string; file?: string; url?: string; commit?: string; sha256?: string };
  extends?: "foundry";
  homepage?: string;
}
export type Evidence = { clause: string; path: string } | { clause: string; check: CheckCode };
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
}
export interface Standard { id: string; title: string; version: string; url: string; clauses: readonly { id: string; title: string }[] }
export type Pick = { scope: "member" | "slot"; target: string; source: string };
export interface Selection { version: 1; consumer: string; defaultChain: readonly string[]; picks: readonly Pick[] }
export type ResolvedValue = DtcgValue;
export type FontPayload =
  | { kind: "system" }
  | { kind: "fontsource"; package: string; version: string; weights: readonly number[]; styles: readonly ("normal" | "italic")[]; license: string };
export interface ResolvedMember {
  slot: string; source: string; fill: string;
  via: "member" | "slot" | "default";
  $type: DtcgType;
  value: Readonly<Partial<Record<Mode, ResolvedValue>>> & { light: ResolvedValue };
  css: Readonly<Partial<Record<Mode, string>>> & { light: string };
  alias: Readonly<Partial<Record<Mode, string>>>;
  emit?: `--${string}`;
  font?: FontPayload;
}
export interface Resolved {
  version: 1; consumer: string; selectionHash: string;
  members: Readonly<Record<string, ResolvedMember>>;
  notices: readonly Finding[];
}

/** One token inside a fill document. `$value` is a typed DTCG value, an alias string `"{member.id}"`, or raw CSS text. */
export interface DtcgToken {
  $type: DtcgType;
  $value: DtcgValue;
  $extensions?: {
    "com.clossys.css"?: { raw?: string; reads?: readonly string[] };
    "com.clossys.unit"?: "em";
    "com.clossys.modes"?: { dark?: DtcgValue };
    "com.clossys.font"?: FontPayload;
    "com.clossys.source"?: { line: number };
  };
}
export type DtcgNode = DtcgToken | { readonly [key: string]: DtcgNode };
export type DtcgGroup = { readonly [key: string]: DtcgNode };
export interface FillDoc { $extensions: { "com.clossys.fill": FillMeta }; tokens: DtcgGroup }
export interface LibraryData { source: Source; fills: readonly FillDoc[] }
export type PlacementNode = { id: string; label: string; children: readonly PlacementNode[] } | { id: string; label: string; leaves: readonly string[] };
export interface Placement { layer: LayerId; nodes: readonly PlacementNode[] }
export interface Retired { id: string; retiredAt: string; replacedBy?: string }
export interface CatalogData {
  slots: readonly Slot[]; standards: readonly Standard[]; sources: readonly Source[]; fills: readonly FillDoc[];
  placements: readonly Placement[]; retired: readonly Retired[];
}
