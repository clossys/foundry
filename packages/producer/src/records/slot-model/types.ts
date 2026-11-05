/**
 * The slot model (SLOT-MODEL §1): one on-disk layout for all four agents.
 *
 *   <consumer>/agents/<agent>/ia.json                   IA tree as data, every slot in IA order
 *   <consumer>/agents/<agent>/<slot>/slot.json          generated from the IA
 *   <consumer>/agents/<agent>/<slot>/candidates/<name>-v<n>.<ext>
 *   <consumer>/agents/<agent>/<slot>/pin.json           absent = no pin
 *   <consumer>/agents/<agent>/_<name>/                  `_`-prefixed: never read as a slot, but check:git-cms
 *                                                       (R-GIT-CMS) fails on it: evidence lives in <consumer>/evidence/
 *
 * Slot folders are flat: grouping (L1/L2) lives only in ia.json and slot.json
 * `ia`, so the IA can be regrouped without moving a file.
 * Nothing about pinning lives in a candidate. Provenance is one `source` key.
 */
export const SLOT_AGENTS = ["director", "designer", "writer", "publisher"] as const;
export type SlotAgent = typeof SLOT_AGENTS[number];

/**
 * The seat kind: the Producer tree holds seats, not slots. A seat folder is one pipeline decide
 * step that has a seat (`pin.<agent>`, `pick.<agent>`, ...), holds only seat.json, and is placed by
 * the Producer ia.json exactly as a slot folder is placed by its agent's ia.json:
 *
 *   <consumer>/agents/producer/ia.json                  seat ids in IA order (grouped by round and stage)
 *   <consumer>/agents/producer/<step>/seat.json         who decides that step (pipeline/schemas/seat.schema.json)
 *
 * Seats have no candidates and no pin; the pipeline (src/pipeline/seats.ts) reads them through
 * records/slots.ts and check:git-cms (R-GIT-CMS) holds the tree to this layout.
 */
export const SEAT_AGENT = "producer" as const;
export type SeatAgent = typeof SEAT_AGENT;
/** Every agent tree under `<consumer>/agents`: the four slot trees and the seat tree. */
export const MODEL_AGENTS = [...SLOT_AGENTS, SEAT_AGENT] as const;
export type ModelAgent = typeof MODEL_AGENTS[number];
/** What a folder in an agent tree is: a slot (slot.json, candidates/, pin.json) or a seat (seat.json). */
export const FOLDER_KINDS = ["slot", "seat"] as const;
export type FolderKind = typeof FOLDER_KINDS[number];
export const FOLDER_KIND: Readonly<Record<ModelAgent, FolderKind>> = {
  director: "slot", designer: "slot", writer: "slot", publisher: "slot", producer: "seat",
};

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
export const SEAT_FILE = "seat.json";

/** Decision provenance for migrated pins (D6, and the decidedBy rewrite) and for the owner-cleared Director brief. */
export const MIGRATION_DECIDED_BY = "migrated";
export const DIRECTOR_DECIDED_BY = "owner:2026-10-31 all-approved";
/** Who decided: owner, planner or migration (each optionally `:<ref>`), `agent:<seat>` (a judge seat, `clossys pick`), or `migrated`. Written by `clossys pin` and `clossys pick`. */
export const DECIDED_BY = /^(?:(?:owner|planner|migration)(?::\S.*)?|agent:\S+|migrated)$/;
/**
 * How a pin was decided, so Studio can show what the owner still has to confirm:
 * `picked` the owner chose this candidate; `bulk` a blanket owner approval; `planner` the planner chose it;
 * `agent` a judge seat picked one of the slot's options (`clossys pick`).
 * Written by `clossys pin` (`--by planner:*` is `planner`; any other decider needs an explicit `--basis`)
 * and `clossys pick` (always `agent`, with `--by agent:<seat>`). Required on every pin.
 */
export const PIN_BASES = ["picked", "bulk", "planner", "agent"] as const;
export type PinBasis = typeof PIN_BASES[number];
/** A pin's review status: `pinned` only for an owner pick (basis picked); bulk, planner and agent pins are `confirm`. */
export type PinStatus = "pinned" | "confirm";
export const pinStatus = (basis: PinBasis): PinStatus => basis === "picked" ? "pinned" : "confirm";

/** How many candidates a slot offers for choice (CANDIDATE-OPTIONS). */
export const OPTION_COUNTS = [1, 2, 3] as const;
/** A named variation axis (`varyOn`) or one of its values: lower-case words joined by hyphens. */
export const VARY_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

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
  /** The owner's decision that this slot is not needed. Present only for the `not-needed` state. */
  readonly notNeeded?: NotNeeded;
  /** How many distinct candidates the slot must offer (1 to 3); written from the option-class mapping by `clossys options --classes`. */
  readonly options?: typeof OPTION_COUNTS[number];
  /** The axis candidates differ on (e.g. `tone`); required when options > 1. Each candidate tags its value as `vary: {"<axis>": "<value>"}`. */
  readonly varyOn?: string;
}

/** Why a slot is not needed, since when (ISO date) and who decided. Written by `clossys pin --not-needed`, never by an agent fill. */
export interface NotNeeded { readonly reason: string; readonly since: string; readonly decidedBy: string }

/**
 * Slot state is a closed union: a slot is `pinned` (pin.json exists) or `not-needed`
 * (slot.json carries `notNeeded`). Every other state fails validation; the one loader
 * (`readSlotState` in records/slots.ts) decides it.
 */
export const SLOT_STATES = ["pinned", "not-needed"] as const;
export type SlotStateName = typeof SLOT_STATES[number];
export type SlotState =
  | { readonly state: "pinned"; readonly pin: PinDoc }
  | { readonly state: "not-needed"; readonly notNeeded: NotNeeded };
/** Why the loader rejects a slot's state. */
export type SlotStateRejection = "no-pin" | "invalid-pin" | "pinned-and-not-needed" | "invalid-slot";
export type SlotStateResult = SlotState | { readonly state: "rejected"; readonly reason: SlotStateRejection; readonly message: string };

export interface PinDoc {
  readonly candidate: string;
  /** Hex sha256 of the candidate bytes. */
  readonly sha256: string;
  /** Who decided (DECIDED_BY). */
  readonly decidedBy: string;
  /** How it was decided (PIN_BASES). */
  readonly basis: PinBasis;
  readonly at: string;
}

export const SOURCE_KINDS = ["registry", "derived", "original", "composition", "npm"] as const;
/** The one ref of an `npm` source: `npm/<package>@<exact version>` (ref-verbatim proves it against package-lock.json). */
export const NPM_SOURCE_REF = /^npm\/((?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*)@(\d+\.\d+\.\d+)$/;
/** One stock part of a `composition` source: a pinned slot and the exact vendored reference paths its pin maps. */
export interface CompositionPart {
  readonly slot: string;
  readonly files: readonly string[];
}
export interface SourceDoc {
  readonly kind: typeof SOURCE_KINDS[number];
  readonly ref: readonly string[];
  /** Only for kind `composition` (and required there): the pinned registry slots the code places. */
  readonly parts?: readonly CompositionPart[];
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
