/**
 * The slot model (SLOT-MODEL §1): one on-disk layout for all four agents.
 *
 *   <consumer>/agents/<agent>/ia.json                   IA tree as data, every slot in IA order
 *   <consumer>/agents/<agent>/<slot>/slot.json          generated from the IA
 *   <consumer>/agents/<agent>/<slot>/candidates/<name>-v<n>.<ext>
 *   <consumer>/agents/<agent>/<slot>/pin.json           absent = no pin
 *   <consumer>/agents/<agent>/_<name>/                  `_`-prefixed: never a slot (e.g. `_evidence`)
 *
 * Slot folders are flat: grouping (L1/L2) lives only in ia.json and slot.json
 * `ia`, so the IA can be regrouped without moving a file.
 * Nothing about pinning lives in a candidate. Provenance is one `source` key.
 */
export const SLOT_AGENTS = ["director", "designer", "writer", "publisher"] as const;
export type SlotAgent = typeof SLOT_AGENTS[number];

export const SLOT_KINDS = ["brief", "element", "strings", "page", "publication"] as const;
export type SlotKind = typeof SLOT_KINDS[number];

export const IA_SCHEMA = "clossys.ia/1" as const;
export const SLOT_SCHEMA = "clossys.slot/1" as const;
export const PAGE_SCHEMA = "clossys.page/1" as const;
export const PUBLICATION_SCHEMA = "clossys.publication/1" as const;

export const IA_FILE = "ia.json";
export const SLOT_FILE = "slot.json";
export const PIN_FILE = "pin.json";
export const CANDIDATES_DIR = "candidates";

/** Pin provenance for migrated pins (D6) and for the owner-cleared Director brief. */
export const MIGRATION_PINNED_BY = "migration:SLOT-MODEL";
export const DIRECTOR_PINNED_BY = "owner:2026-10-31 all-approved";

export interface IaLeafGroup { readonly id: string; readonly label: string; readonly slots: readonly string[] }
export interface IaNode { readonly id: string; readonly label: string; readonly children: readonly IaLeafGroup[] }
export interface IaDoc {
  readonly schema: typeof IA_SCHEMA;
  /** `<foundry pkg>#<leaf-freeze ref>`, or `consumer#<store>` for the Publisher. */
  readonly source: string;
  /** Consumer-only slots the owner signed. */
  readonly extensions: readonly string[];
  /** L1 nodes (Designer and Writer ids carry their L0 prefix: `themes.colors`). */
  readonly nodes: readonly IaNode[];
  /**
   * Optional display grouping (Studio tabs). Each layer lists L1 refs: `<l1>`
   * shows that L1 with its L2 groups; `<l1>/<l2>` shows one L2 group as its
   * own L1. Display only: folders and slot.json positions never change.
   */
  readonly layers?: readonly IaLayer[];
}
export interface IaLayer { readonly id: string; readonly label: string; readonly nodes: readonly string[] }

export interface SlotPosition { readonly l0?: string; readonly l1: string; readonly l2: string; readonly order: number }
export interface SlotDoc {
  readonly schema: typeof SLOT_SCHEMA;
  readonly id: string;
  readonly agent: SlotAgent;
  readonly ia: SlotPosition;
  readonly kind: SlotKind;
  /** Copied from Foundry: Designer slot contract, Director question/mustContain, Writer leaf rule, Publisher format. */
  readonly contract: Readonly<Record<string, unknown>>;
  /** Upstream slots this slot derives from (F10). Empty = not declared; readiness reports it. */
  readonly inputs: readonly string[];
  /** Slots it composes or binds (F10). `usedBy` is never stored. */
  readonly uses: readonly string[];
}

export interface PinDoc {
  readonly candidate: string;
  /** Hex sha256 of the candidate bytes. */
  readonly sha256: string;
  readonly pinnedBy: string;
  readonly at: string;
}

export const SOURCE_KINDS = ["registry", "derived", "original"] as const;
export interface SourceDoc {
  readonly kind: typeof SOURCE_KINDS[number];
  readonly ref: readonly string[];
  readonly hash?: string;
  readonly license?: string;
}

/** Keys that the single `source` key replaces, and pin state that never lives in a candidate. */
export const LEGACY_PROVENANCE_KEYS = ["lineage", "cites", "links", "sources", "originKinds", "origin", "original"] as const;
export const CANDIDATE_STATUS_KEYS = ["status", "active", "confirmed", "pinned"] as const;

export const AGENT_KIND: Readonly<Record<SlotAgent, readonly SlotKind[]>> = {
  director: ["brief"],
  designer: ["element"],
  writer: ["strings"],
  publisher: ["page", "publication"],
};
export const KIND_EXT: Readonly<Record<SlotKind, "md" | "json">> = {
  brief: "md", element: "json", strings: "md", page: "json", publication: "json",
};

export const SLOT_ID = /^[a-z][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*){1,3}$/;
/** A page candidate's copy binding target: `<writer slot>#<key>`. Page `copy` maps copy slot to this ref, never the reverse. */
export const WRITER_KEY_REF = /^[a-z][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*){1,3}#[^\s#]+$/;
/** A section instance key on a page: the slot id, `#<n>` for its nth listing (see Publisher `sectionInstances`). */
export const INSTANCE_KEY = /^[a-z][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*){1,3}(#[1-9][0-9]*)?$/;
export const NODE_ID = /^[a-z0-9][a-z0-9.-]*$/;
export const CANDIDATE_NAME = /^([a-z0-9][a-z0-9.-]*)-v([1-9][0-9]*)\.(md|json)$/;
