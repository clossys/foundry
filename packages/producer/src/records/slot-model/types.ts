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
import { PIN_BASES } from "@clossys/director";
export const SLOT_AGENTS = ["director", "designer", "writer", "publisher"] as const;
/**
 * The agents whose IA is Foundry data (`clossys ia <agent> --adopt`), each with the agents whose IA it is adopted
 * after (its slots read theirs); the Publisher IA is the workspace's own (`clossys ia publisher --start`).
 */
export const FOUNDRY_IA_AFTER: Readonly<Record<"director" | "designer" | "writer", readonly ("director" | "designer" | "writer" | "publisher")[]>> = { director: [], designer: ["director"], writer: ["director"] };
export const FOUNDRY_IA_AGENTS = Object.keys(FOUNDRY_IA_AFTER) as (keyof typeof FOUNDRY_IA_AFTER)[];
export type SlotAgent = typeof SLOT_AGENTS[number];

/**
 * The seat kind (D5, W2-A): the Producer tree holds seats, read as slots. A seat is one pipeline
 * decide step that has a seat (`pin.<agent>`, `pick.<agent>`, ...); its slot id is `seat.<step-id>`
 * (`seat.pin.director`), placed by the Producer ia.json exactly as a slot is placed by its agent's
 * ia.json, with a slot.json of kind `seat` (agent `producer`, contract valid against
 * pipeline/schemas/contract-seat.schema.json) and its seat as a candidate file plus a pin under the
 * slot pin contract (pin.json: candidate, sha256, decidedBy, basis, at):
 *
 *   <consumer>/agents/producer/ia.json                                    seat slot ids in IA order (grouped by round and stage)
 *   <consumer>/agents/producer/seat.<step>/slot.json                      kind seat; contract {step, fixture: {step}}
 *   <consumer>/agents/producer/seat.<step>/candidates/<step>-v<n>.json    who decides that step (pipeline/schemas/seat.schema.json)
 *   <consumer>/agents/producer/seat.<step>/pin.json                       the pinned seat candidate
 *
 * The pipeline (src/pipeline/seats.ts) reads the pinned seat through records/slots.ts by step id;
 * check:git-cms (R-GIT-CMS) holds the tree to this layout, check:slot-pins (R-SLOT-PINS) fails a
 * placed seat without exactly one valid pin and the constitution's R01 holds every seat to its
 * slot.json and contract. The retired seat.json file is refused wherever it is found.
 */
export const SEAT_AGENT = "producer" as const;
export type SeatAgent = typeof SEAT_AGENT;
/** Every agent tree under `<consumer>/agents`: the four slot trees and the seat tree. */
export const MODEL_AGENTS = [...SLOT_AGENTS, SEAT_AGENT] as const;
export type ModelAgent = typeof MODEL_AGENTS[number];
/**
 * What a folder in an agent tree is: a slot, or a seat (a slot of kind `seat`, in the Producer tree).
 * Kept for the readers that count content slots apart from seats (pipeline/status.ts, chain.ts) and for
 * check:git-cms; retired with them in E1, now that a seat carries a slot.json like any slot.
 */
export const FOLDER_KINDS = ["slot", "seat"] as const;
export type FolderKind = typeof FOLDER_KINDS[number];
export const FOLDER_KIND: Readonly<Record<ModelAgent, FolderKind>> = {
  director: "slot", designer: "slot", writer: "slot", publisher: "slot", producer: "seat",
};

export const SLOT_KINDS = ["brief", "element", "strings", "page", "publication", "seat"] as const;
export type SlotKind = typeof SLOT_KINDS[number];
/** The kinds of the four content agents' slots (every kind but the Producer's `seat`). */
export type ContentKind = Exclude<SlotKind, "seat">;

/** A seat's slot id is its decide step's id under `seat.` (D5): `seat.pin.director` seats `pin.director`. */
export const SEAT_PREFIX = "seat." as const;
export const seatSlotId = (step: string): string => `${SEAT_PREFIX}${step}`;
/** The decide step a seat slot id seats, or undefined when the id is not a seat id. */
export const seatStepOf = (id: string): string | undefined => (id.startsWith(SEAT_PREFIX) && id.length > SEAT_PREFIX.length ? id.slice(SEAT_PREFIX.length) : undefined);

export const IA_SCHEMA = "clossys.ia/1" as const;
export const SLOT_SCHEMA = "clossys.slot/1" as const;
export const PAGE_SCHEMA = "clossys.page/1" as const;
export const PUBLICATION_SCHEMA = "clossys.publication/1" as const;

export const IA_FILE = "ia.json";
export const SLOT_FILE = "slot.json";
export const PIN_FILE = "pin.json";
export const CANDIDATES_DIR = "candidates";
/** The retired seat file: a seat is a pinned candidate now, and a seat.json left in a seat folder is refused. */
export const RETIRED_SEAT_FILE = "seat.json";

/** Decision provenance for migrated pins (D6, and the decidedBy rewrite) and for the owner-cleared Director brief. */
export const MIGRATION_DECIDED_BY = "migrated";
export const DIRECTOR_DECIDED_BY = "owner:2026-10-31 all-approved";
/** Who decided: owner, planner or migration (each optionally `:<ref>`), `agent:<seat>` (a judge seat, `clossys pick`), or `migrated`. Written by `clossys pin` and `clossys pick`. */
export { DECIDED_BY } from "@clossys/director";
/**
 * How a pin was decided, so Studio can show what the owner still has to confirm:
 * `picked` the owner chose this candidate; `bulk` a blanket owner approval; `planner` the planner chose it;
 * `agent` a judge seat picked one of the slot's options (`clossys pick`).
 * Written by `clossys pin` (`--by planner:*` is `planner`; any other decider needs an explicit `--basis`)
 * and `clossys pick` (always `agent`, with `--by agent:<seat>`). Required on every pin.
 */
export { PIN_BASES } from "@clossys/director";
export type PinBasis = typeof PIN_BASES[number];
/** A pin's review status: `pinned` only for an owner pick (basis picked); bulk, planner and agent pins are `confirm`. */
export type PinStatus = "pinned" | "confirm";
export const pinStatus = (basis: PinBasis): PinStatus => basis === "picked" ? "pinned" : "confirm";
/**
 * Whether a pin is the owner's approval (owner Producer round 2, "Pin = approval"): an owner pick
 * (`picked`) or a blanket owner approval (`bulk`). A planner or agent pin is decided but not approved:
 * it stays a confirm item until the owner pins. Writer copy reads its editorial approval from this.
 */
export const pinApproved = (basis: PinBasis): boolean => basis === "picked" || basis === "bulk";

/** How many candidates a slot offers for choice (CANDIDATE-OPTIONS). */
export const OPTION_COUNTS = [1, 2, 3] as const;
/** A named variation axis (`varyOn`) or one of its values: lower-case words joined by hyphens. */
export const VARY_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export interface IaLeafGroup { readonly id: string; readonly label: string; readonly slots: readonly string[] }
export interface IaNode { readonly id: string; readonly label: string; readonly children: readonly IaLeafGroup[] }
export interface IaDoc {
  readonly schema: typeof IA_SCHEMA;
  /** `@clossys/<package>#<path>` (the package IA file or folder), or `workspace#owner` for a workspace-owned IA (records/slot-model/ia-source.ts). */
  readonly source: string;
  /** Consumer-only slots the owner signed. */
  readonly extensions: readonly string[];
  /** L1 nodes (Designer and Writer ids carry their L0 prefix: `themes.colors`). */
  readonly nodes: readonly IaNode[];
  /**
   * Optional display grouping (Studio tabs). Each layer lists L1 refs: `<l1>`
   * shows that L1 with its L2 groups; `<l1>/<l2>` shows one L2 group as its
   * own L1. Display only until the IA declares its `axes`: then each layer is an L0 and slot.json
   * `ia.l0` carries it (foundry-ia.ts nodeLayers). Folders never change.
   */
  readonly layers?: readonly IaLayer[];
  /** The closed L0 and L1 vocabularies (R01.7); `L1` is keyed by layer id. */
  readonly axes?: IaAxes;
  /** The owner-authorized IA changes (`clossys ia` regroup operations, IA-V), oldest first: each names the owner decision that allowed it. */
  readonly changes?: readonly IaChange[];
}
export interface IaLayer { readonly id: string; readonly label: string; readonly nodes: readonly string[] }
/** One IA level's axis: a name plus a closed label list, or `instance` for data-driven tabs (L1 only); `mirrors` names `<agent>/<L0>` (R01.11). */
export interface IaAxis { readonly name: string; readonly values?: readonly string[]; readonly instance?: true; readonly mirrors?: string }
export interface IaAxes { readonly L0: IaAxis; readonly L1: Readonly<Record<string, IaAxis>>; readonly shared?: readonly string[] }
/**
 * One owner-authorized change to an ia.json (`clossys ia ... --owner-ref <ref>`): the operation, the
 * resolved owner-words ref (OWNER_WORDS_REF, from clossys/owner-decisions.json), when, what changed
 * and how many slot.json files the same guarded write rewrote. It stands in for the slot ledger's IA
 * events until the ledger lands (W2-B).
 */
export interface IaChange { readonly op: string; readonly ownerRef: string; readonly at: string; readonly detail: string; readonly slotFiles: number }

export interface SlotPosition { readonly l0?: string; readonly l1: string; readonly l2: string; readonly order: number }
export interface SlotDoc {
  readonly schema: typeof SLOT_SCHEMA;
  readonly id: string;
  readonly agent: ModelAgent;
  readonly ia: SlotPosition;
  readonly kind: SlotKind;
  /** The standard the slot is judged by (R15; optional until W2-I makes it required). */
  readonly standard?: string;
  /**
   * Copied from Foundry: Designer slot contract, Director question/mustContain, Writer leaf rule, Publisher format;
   * a seat's `{step, fixture}`. `fixture` (D1, R01.3) is the sample every candidate is certified with.
   */
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
  /** The option family as slot data (a slot/2 `family`): readers take it before the option table. */
  readonly family?: { readonly options: typeof OPTION_COUNTS[number]; readonly varyOn: string | null; readonly values: readonly string[]; readonly class?: string };
  /** A consumer extension leaf (R01.14): listed in ia.json `extensions`, under a Foundry L1. */
  readonly extension?: boolean;
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

/** pin.json: the one pin schema (planner R9), checked by @clossys/director pinIssues (validate.ts validatePin). */
export interface PinDoc {
  readonly candidate: string;
  /** Hex sha256 of the candidate bytes. */
  readonly sha256: string;
  /** Who decided (DECIDED_BY). */
  readonly decidedBy: string;
  /** How it was decided (PIN_BASES). */
  readonly basis: PinBasis;
  readonly at: string;
  /**
   * The owner's confirmation of an agent pick (`clossys pin <agent>/<slot> <candidate> --confirm --ref <ref>`,
   * owner Foundry Director round 8): the pick keeps basis `agent` and `decidedBy: agent:<seat>`; this records
   * who confirmed it, when, and the ledger reference holding their words. Only on a basis `agent` pin.
   */
  readonly confirmed?: PinConfirmation;
}
export interface PinConfirmation {
  /** owner or owner:<ref> (CONFIRMED_BY). */
  readonly by: string;
  /** Where the owner's words are recorded (a ledger comment). */
  readonly ref: string;
  /** ISO timestamp of the confirmation. */
  readonly at: string;
}
/** Who may confirm an agent pick: the owner only. */
export { CONFIRMED_BY } from "@clossys/director";
/**
 * Where a confirmation's owner words are: one ledger comment, `<org>/<repo>#<issue> issuecomment-<id>`
 * or its GitHub URL, optionally followed by a note in parentheses. A ref that cites no comment (a launch
 * instruction, a "standing instruction", a date) records no owner words and is refused.
 */
export { OWNER_WORDS_REF, OWNER_WORDS_REF_FORM } from "@clossys/director";

/** `interactive-backdrop`: a Designer element that is a descriptor over a Foundry interactive backdrop component (foundry-build-0048 A4), no code. */
export const SOURCE_KINDS = ["registry", "derived", "original", "composition", "npm", "interactive-backdrop"] as const;
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

export const AGENT_KIND: Readonly<Record<ModelAgent, readonly SlotKind[]>> = {
  director: ["brief"],
  designer: ["element"],
  writer: ["strings"],
  publisher: ["page", "publication"],
  producer: ["seat"],
};
export const KIND_EXT: Readonly<Record<SlotKind, "md" | "json">> = {
  brief: "md", element: "json", strings: "md", page: "json", publication: "json", seat: "json",
};
/** A standard id (slot.json `standard`, R15): lower-case words joined by dots and hyphens. */
export const STANDARD_ID = /^[a-z][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)*$/;

export const SLOT_ID = /^[a-z][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*){1,3}$/;
/** A page candidate's copy binding target: `<writer slot>#<key>`. Page `copy` maps copy slot to this ref, never the reverse. */
export const WRITER_KEY_REF = /^[a-z][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*){1,3}#[^\s#]+$/;
/** A section instance key on a page: the slot id, `#<n>` for its nth listing (see Publisher `sectionInstances`). */
export const INSTANCE_KEY = /^[a-z][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*){1,3}(#[1-9][0-9]*)?$/;
export const NODE_ID = /^[a-z0-9][a-z0-9.-]*$/;
export const CANDIDATE_NAME = /^([a-z0-9][a-z0-9.-]*)-v([1-9][0-9]*)\.(md|json)$/;
