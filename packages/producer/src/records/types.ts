/** TypeScript views of the record schemas in ./schemas.ts. Validate before trusting a cast. */

export type Hash = `sha256:${string}`;

export type LineageMode = "verbatim" | "customized" | "original";

export type ReferenceRef = {
  readonly registry: string;
  readonly item: string;
  readonly version: string;
  readonly hash?: Hash;
  readonly url?: string;
  /** Payload file -> file path inside the vendored reference item it was copied from. */
  readonly files?: Readonly<Record<string, string>>;
};

/** Byte offsets are UTF-8 bytes, endExclusive excluded. Reference 0 is source; n>0 is parts[n-1]. */
export type ExactPartSource = {
  readonly reference: number; readonly path: string; readonly upstream: string;
  readonly fileSha256: string; readonly start: number; readonly endExclusive: number; readonly sha256: string;
  readonly license: { readonly path: string; readonly sha256: string; readonly payloadPath: string };
};
export type ExactPartEdit = {
  readonly kind: "import" | "token" | "data";
  readonly start: number; readonly endExclusive: number; readonly from: string; readonly to: string;
};
export type ExactPartProof = {
  readonly schema: "ref-exact-parts/1";
  readonly payload: Readonly<Record<string, string>>;
  readonly files: Readonly<Record<string, {
    readonly sha256: string;
    readonly segments: readonly { readonly start: number; readonly endExclusive: number; readonly source: ExactPartSource; readonly edits: readonly ExactPartEdit[] }[];
  }>>;
  readonly closure: {
    readonly roots: readonly string[];
    readonly imports: readonly { readonly file: string; readonly specifier: string; readonly target:
      | { readonly kind: "payload"; readonly path: string }
      | { readonly kind: "npm"; readonly package: string; readonly version: string; readonly entry: string; readonly hash: Hash }
      | { readonly kind: "element"; readonly slot: string; readonly element: string; readonly version: number; readonly hash: Hash; readonly entry: string }
    }[];
  };
};

export type CheckResult = {
  readonly id: string;
  readonly suite?: string;
  readonly type: "fixed" | "measured" | "judged";
  readonly status: "pass" | "fail" | "warn" | "skip";
  readonly detail?: string;
  readonly value?: number | string | boolean;
  readonly at?: string;
};

export type ElementDependency = {
  readonly slot: string;
  readonly element: string;
  readonly version: number;
  readonly hash: Hash;
};

/** The five source-bound replays currently implemented by the reference guard. */
export type FiniteDataFitReplay = {
  readonly kind: "data-fit";
  readonly sourceHash: Hash;
} & (
  | { readonly operation: "sidebar15-frame-split"; readonly bindings: { readonly region: "app" | "page" } }
  | { readonly operation: "sidebar15-right-offcanvas"; readonly bindings: { readonly side: "right"; readonly collapsible: "offcanvas" } }
  | { readonly operation: "sidebar07-single-option"; readonly bindings: { readonly input: "teams" | "user"; readonly values: readonly Readonly<Record<string, unknown>>[] } }
  | { readonly operation: "sidebar-mirrored-edge"; readonly bindings: { readonly side: "left" | "right" } }
  | { readonly operation: "sidebar-resizable-panels"; readonly bindings: { readonly orientation: "horizontal" } }
);

export type ElementAdaptation = {
  readonly kind: "import-paths" | "token-mapping" | "data-binding" | "data-fit" | "slot-bound-copy" | "slot-bound-identity";
  readonly file: string;
  readonly reason: string;
  readonly hash?: Hash;
  readonly optionCount?: 1;
  readonly menu?: string;
} & ({ readonly operation?: "single-option-static-row" } | FiniteDataFitReplay);

export type ElementRecord = {
  readonly schema: "clossys.element/1";
  readonly id: string;
  readonly package: string;
  readonly layer: string;
  readonly slot: string;
  readonly kind: string;
  readonly version: number;
  readonly hash: Hash;
  readonly lineage: {
    readonly mode: LineageMode;
    readonly path?: "pick" | "adopt" | "create";
    readonly ownerRequest?: string;
    readonly adaptations?: readonly ElementAdaptation[];
    readonly exactParts?: ExactPartProof;
    readonly source?: ReferenceRef;
    /** Further trusted references the payload takes verbatim parts from, beside the source block. */
    readonly parts?: readonly ReferenceRef[];
    readonly parent?: { readonly version: number; readonly hash: Hash };
  };
  readonly license: { readonly spdx: string; readonly attribution?: string; readonly file?: string };
  readonly creator: { readonly agent: string; readonly model: string; readonly by?: string };
  readonly reason: string;
  readonly createdAt: string;
  readonly checks: readonly CheckResult[];
  readonly deps: { readonly npm: Readonly<Record<string, string>>; readonly elements: readonly ElementDependency[] };
  readonly reads: { readonly copyKeys: readonly ElementCopyKey[]; readonly themeVars: readonly string[] };
  readonly payload?: readonly string[];
};

/**
 * What an element reads from Writer: a copy slot `{ slot, prop, previewKey }` (a page binds `slot`,
 * the text renders at `prop`, the specimen previews it with `previewKey`), or a bare Writer key it
 * reads through host data.
 */
export type ElementCopyKey = string | { readonly slot: string; readonly prop: string; readonly previewKey: string };

export type PreviewRecord = {
  readonly schema: "clossys.element-preview/1";
  readonly fixtures: Readonly<Record<string, unknown>>;
  readonly copy: Readonly<Record<string, string>>;
  readonly container: "canvas" | "section-in-frame" | "page";
  readonly theme: "light" | "dark";
  readonly width: number;
};

export type PinState = {
  readonly element: string;
  readonly version: number;
  readonly hash: Hash;
  /** Id of the history event that produced this pin. */
  readonly event: string;
};

export type PinEvent = {
  readonly id: string;
  readonly at: string;
  readonly by: string;
  readonly action: "pin" | "restore" | "unpin";
  readonly slot: string;
  readonly element?: string;
  readonly version?: number;
  readonly hash?: Hash;
  readonly from?: "option" | "saved" | "version" | "reference";
  readonly restores?: string;
  readonly approval?: string;
  readonly reason?: string;
};

export type SpecimenKind = "visual" | "text" | "data" | "media" | "flow";

/** Region input names are bound once by the frame that owns the region. */
export type FrameOwnership =
  | { readonly kind: "app"; readonly regions: { readonly navigation: readonly string[] } }
  | { readonly kind: "page"; readonly regions: { readonly header: readonly string[]; readonly chat: readonly string[]; readonly body: readonly string[] } };

export type SlotContract = {
  readonly schema: "clossys.slot-contract/1";
  /** The slot's sub-kind: a standard serves `<slot kind>/<kind>` (records/standards.ts slotKinds). */
  readonly kind?: string;
  readonly slot: string;
  readonly package: string;
  readonly layer: string;
  readonly purpose: string;
  readonly ownership?: FrameOwnership;
  readonly inputs: readonly {
    readonly name: string;
    readonly kind: "copy" | "prop" | "asset" | "theme" | "data" | "cell";
    readonly required: boolean;
    readonly description?: string;
    /** Owning identity, Writer or composed slot; never a literal frame value. */
    readonly slot?: string;
  }[];
  readonly limits: Readonly<Record<string, number | string | boolean>>;
  readonly references: readonly ReferenceRef[];
  readonly checkSuite: string;
  readonly specimenKind: SpecimenKind;
  /** Requirement checks merged over the standard's by check id (records/standards.ts resolveRequirements). */
  readonly requirements?: readonly { readonly check: string; readonly params?: Readonly<Record<string, unknown>> }[];
  /** The certifier's sample (R05.1): an element-preview/1 fixture for a mounted element. */
  readonly fixture?: Readonly<Record<string, unknown>>;
};

export type ReferenceFile = { readonly path: string; readonly sha256: string; readonly bytes: number; readonly origin: string };

export type ReferenceItem = {
  readonly registry: string;
  readonly name: string;
  readonly version: string;
  readonly dir: string;
  readonly type: string;
  readonly sourceUrl: string;
  readonly license: string;
  readonly direct: boolean;
  readonly slots: readonly string[];
  /** Vendored because the registry index lists it, not because a slot maps it. */
  readonly indexed?: boolean;
  readonly requiredBy?: readonly string[];
  readonly registryDependencies?: readonly string[];
  readonly dependencies?: readonly string[];
  readonly hash: Hash;
  readonly files: readonly ReferenceFile[];
  /** Owner-approved source sanitization, retaining the complete upstream digest record. */
  readonly adaptations?: readonly {
    readonly kind: "identity";
    readonly reason: string;
    readonly approvedBy: "owner";
    readonly approvedAt: string;
    readonly upstream: { readonly hash: Hash; readonly files: readonly ReferenceFile[] };
  }[];
};

export type ReferencesManifest = {
  readonly schema: "clossys.references-manifest/1";
  readonly package: string;
  readonly fetchedAt: string;
  readonly fetchedWith?: string;
  readonly hashAlgorithm: "sha256-tree/1";
  readonly registries: Readonly<
    Record<
      string,
      {
        readonly namespace: string;
        readonly source: string;
        readonly version: string;
        readonly versionBasis?: string;
        readonly upstream?: string;
        readonly style?: string;
        readonly fetchedAt?: string;
        /** The style's registry.json the generator vendored every listed item from. */
        readonly index?: { readonly url: string; readonly sha256: string; readonly items: number };
        readonly license: string;
        readonly licenseFiles: readonly string[];
      }
    >
  >;
  readonly licenses: readonly { readonly path: string; readonly sha256: string; readonly bytes: number; readonly sourceUrl: string }[];
  readonly items: readonly ReferenceItem[];
  /** npm packages consumed as a class contract, proved by the vendored item at the same version. */
  readonly packages?: readonly ReferencePackage[];
  readonly skipped: readonly { readonly ref: string; readonly slots?: readonly string[]; readonly reason: string }[];
};

export type ReferencePackage = {
  readonly id: string;
  readonly kind: "npm";
  readonly package: string;
  readonly version: string;
  readonly integrity: string;
  readonly license: string;
  /** Directory of the vendored item (same package, same version) the contract is derived from. */
  readonly source: string;
  readonly classes: { readonly base: string; readonly baseFrom: string; readonly modifiers: readonly string[]; readonly modifiersFrom: string };
  readonly slots: readonly string[];
};

// ---------------------------------------------------------------------------
// Target record formats (release2 ia-target: system.md 4, 6.5, 12; designer.md 9.8).
// The JSON Schemas in packages/producer/schemas/ are the wire contract; these
// hand-written types mirror them key for key (RECORD_KEYS, checked by schema.test.ts).
// The int2 types above are unchanged; where a target name collides with an int2
// name the target type takes a suffix (CheckResultDoc).
// ---------------------------------------------------------------------------

export type AgentId = "director" | "designer" | "writer" | "publisher" | "producer";
export type SlotId = string;          // /^[a-z][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*){1,3}$/
export type CandidateName = string;   // /^[a-z0-9][a-z0-9.-]*-v[1-9][0-9]*\.(md|json|svg)$/
export type Iso = string;             // 2026-11-18T09:12:00Z
export type Sha256 = string;          // 64 lowercase hex
export type Tier = "low" | "mid" | "high";

export type Actor =
  | { actor: "package"; package: `@clossys/${AgentId}`; version: string }
  | { actor: "agent"; agent: AgentId; skill: string; skillSha256: Sha256; model: string; tier: Tier }
  | { actor: "owner"; ref: string }        // where the owner said it (issue comment, chat log id)
  | { actor: "planner"; ref: string }
  | { actor: "code"; cli: string; version: string };

export type RefRel = "input" | "uses" | "consumedBy" | "places" | "cites" | "raisedBy" | "answers";

/** A pointer to another record. `key` names a Director must-contain key; `record` names a Writer record or an entry id. */
export interface Ref {
  /** A slot, a candidate (`package:` for the package default) or the owner facts file. */
  to: `${AgentId}/${SlotId}` | `${AgentId}/${SlotId}/${CandidateName}` | `${AgentId}/${SlotId}/package:${CandidateName}` | "facts";
  key?: string;
  record?: string;
  sha256?: Sha256;
  rel: RefRel;
}

export type TargetSlotKind =
  | "brief"                                                   // Director
  | "element/token" | "element/asset" | "element/component" | "element/section" | "element/frame"   // Designer
  | "voice" | "prose" | "copy"                                // Writer
  | "layout" | "chrome" | "page" | "publication" | "release" // Publisher
  | "loop" | "queue" | "ledger";                              // Producer

export interface Common {
  schema: string;
  id: string;
  agent: AgentId;
  kind: TargetSlotKind | "candidate" | "pin" | "pin-map" | "check-result" | "queue-entry" | "ledger-entry";
  status: string;
  createdBy: Actor;
  createdAt: Iso;
  updatedAt?: Iso;
  refs: Ref[];
}

export interface Brief {
  purpose: string;
  mustDo: string[];
  inputs: Ref[];
  acceptance: { check: string; params?: Record<string, unknown>; decider?: "code" | "agent" | "owner" }[];
}

export type TightenOp = "max" | "min" | "require" | "add" | "remove" | "narrow";
export interface Tighten {
  path: string;
  op: TightenOp;
  value: unknown;
  why: string;
  by: Actor;
  at: Iso;
}

export type SlotState = "starter" | "live" | "parked" | "retired" | "needs-refresh";

export interface Slot<C = Record<string, unknown>> extends Common {
  schema: "clossys.slot/2";
  kind: TargetSlotKind;
  status: SlotState;
  ia: { l0: string; l1: string; l2: string; order: number };
  base: { package: string; version: string; path: string; sha256: Sha256 } | null;  // null = consumer-added L3
  standard: string;
  brief: Brief;
  contract: C;
  tighten: Tighten[];
  options?: 1 | 2 | 3;
  varyOn?: string;
  /** The option family as slot data (schemas/slot.json family): readers take it before the option table. */
  family?: SlotFamily;
}

/** A slot's option family: distinct candidates offered, the axis they differ on, its allowed values, the seeding class. */
export interface SlotFamily { options: 1 | 2 | 3; varyOn: string | null; values: string[]; class?: string }

export interface CandidateHeader extends Common {
  schema: "clossys.candidate/1";
  kind: "candidate";
  status: "draft" | "submitted" | "retired";
  slot: `${AgentId}/${SlotId}`;
  record?: string;
  /** The resolved brief it was made against. Absent only on package defaults (publisher.md 9.4 header-v1.json). */
  briefSha256?: Sha256;
  source: { kind: "registry" | "composition" | "npm" | "derived" | "original" | "package-default"; ref: string[]; parts?: { slot: string; files: string[] }[]; hash?: string; license?: string };
  rationale: { purpose: string; field?: string; why: string; sources: Ref[] }[];
}

export interface PinRecord {
  candidate: CandidateName;
  sha256: Sha256;
  decidedBy: string;                      // owner[:ref] | planner[:ref] | agent:<id> | migrated
  basis: "picked" | "bulk" | "planner" | "agent";
  at: Iso;
  confirmed?: { by: "owner"; ref: string; at: Iso };
}

export interface Pin extends Common, PinRecord {
  schema: "clossys.pin/2";
  kind: "pin";
  status: "pinned" | "confirm";
}

export interface PinMap extends Common {
  schema: "clossys.pin-map/1";
  kind: "pin-map";
  status: "pinned" | "confirm";
  records: Record<string, PinRecord>;
}

/** system.md 4 `CheckResult` (named CheckResultDoc here: int2 `CheckResult` above is a different shape). */
export interface CheckResultDoc {
  schema: "clossys.check-result/1";
  subject: string;                        // "<agent>/<slot-id>/<candidate>"
  subjectSha256: Sha256;
  briefSha256: Sha256;
  standard: string;
  ranAt: Iso;
  by: Extract<Actor, { actor: "code" }>;
  status: "pass" | "fail" | "error";
  results: { check: string; status: "pass" | "fail" | "skip"; field?: string; locale?: string; detail?: string }[];
}

export type DeciderVerb = "refine-brief" | "create-candidates" | "check" | "pin" | "pick" | "decide";
export type HumanRaise = "queue.pick" | "queue.approve" | "queue.clarify";

export type Decider =
  | { by: "code" }
  | { by: "agent"; agent: AgentId; verb: DeciderVerb; tier: Tier; model: string; skill?: string }
  | { by: "human"; who: "owner"; raise: HumanRaise };

/** A loop step's decider: the agent may be the placeholder "<owner of slot>"; package versions carry tier only (14.6). */
export type LoopDecider =
  | { by: "code" }
  | { by: "agent"; agent: AgentId | "<owner of slot>"; verb: DeciderVerb; tier: Tier; model?: string; skill?: string }
  | { by: "human"; who: "owner"; raise: HumanRaise };

export interface LoopStep {
  id: string;
  does: string;
  decider: LoopDecider;
  cli: string;
  reads: string[];
  writes: string[];
  checks: string[];
  /** `owner`: a request run (loop.slot) runs the step only for a request whose target agent is listed. */
  when?: { ia?: string[]; slots?: string[]; owner?: string[]; decision?: ("reuse" | "create")[] };
  onFail?: { raise: "queue.fix" | "queue.clarify"; then: "retry" | `loop.${string}` };
}

/** Content of producer/loop.<name>/candidates/<name>-v<n>.json, under `content`. */
export interface LoopVersion {
  trigger: string[];
  steps: LoopStep[];
  exit: string;
  repeat: string;
  maxRounds: number;
}

export type QueueName = "queue.pick" | "queue.approve" | "queue.clarify" | "queue.fix";

export interface QueueEntry extends Common {
  schema: "clossys.queue-entry/1";
  kind: "queue-entry";
  status: "open" | "answered" | "withdrawn";
  queue: QueueName;
  ask: string;
  subject: Ref;
  decider: "owner" | `agent:${AgentId}`;
  default: string | null;
  options?: { id: string; candidate?: CandidateName; summary: string }[];
  events: {
    at: Iso; op: "raised" | "answered" | "withdrawn"; by: string;
    via?: "cli" | "chat" | "app";
    answer?: string; note?: string;
    quote?: string;                       // required when by = owner and via = chat (checked by code, not the schema)
  }[];
}

export interface LedgerEntry extends Common {
  schema: "clossys.ledger-entry/1";
  kind: "ledger-entry";
  status: "done" | "stopped" | "pinned-ready";
  loop: `loop.${string}`;
  loopVersion: CandidateName;
  trigger: { kind: string; ref?: Ref };
  steps: { id: string; decider: Decider; cli: string; exit: 0 | 1 | 2; wrote: { file: string; sha256: Sha256 | null }[] }[];
  checks: Record<string, "pass" | "fail">;
  decisions: { entry: string; answer: string }[];
  outcome: string;
}

/** Front matter `clossys` key of a view prompt (system.md 6.6). */
export interface ViewHeader {
  schema: "clossys.view/1";
  id: `${AgentId}/views/${string}`;
  agent: AgentId;
  kind: "view";
  status: "live";
  createdBy: Actor;
  createdAt: Iso;
  updatedAt?: Iso;
  refs?: Ref[];
  appliesTo: string[];
  inputs: string[];                       // each starts with clossys status|slot|render|preview
  answers: QueueName[];
}

export interface IaPublication {
  node: string;
  starter: string;
  root: string;
  pages: SlotId[];
  chrome: SlotId[];
  release: SlotId;
  redirects: { from: string; to: string }[];
}

/** clossys/agents/<agent>/ia.json. */
export interface IaRecord extends Omit<Common, "kind"> {
  schema: "clossys.ia/1";
  kind: "ia";
  status: "live";
  publications?: Record<string, IaPublication>;
}

/** clossys/facts.json: owner facts bound in prose as {fact:<id>}. */
export interface FactsRecord {
  schema: "clossys.facts/1";
  id: "facts";
  status: "live";
  createdBy: Actor;
  createdAt: Iso;
  updatedAt?: Iso;
  facts: Record<string, string | number | boolean | string[]>;
}

// Read models (system.md 12.2-12.5): CLI stdout, never committed.

export interface AgentCensus {
  slots: number;
  byState: { pinned: number; confirm: number; sample: number; unresolved: number; failing: number; needsRefresh: number };
  records?: number;
}

export interface StatusView {
  schema: "clossys.status/1";
  at: Iso;
  workspace: string;
  stateSha256?: Sha256;                   // system.md 14.9
  agents: Record<AgentId, AgentCensus>;
  queue: { id: string; queue: QueueName | "queue.slot"; decider: QueueEntry["decider"]; subject: string; ask: string; default: string | null; raisedAt: Iso }[];
  ledger: { id: string; loop: string; status: LedgerEntry["status"]; outcome: string; at: Iso }[];
  releases: { publication: string; pinned: CandidateName | null; stale: boolean; reason?: string }[];
}

export interface SlotView {
  schema: "clossys.slot-view/1";
  ref: string;
  slot: { id: SlotId; agent: AgentId; kind: string; status: SlotState; ia: { l0: string; l1: string; l2: string };
          brief: Brief; briefSha256: Sha256; tightenCount: number; contract: unknown };
  candidates: {
    name: CandidateName; record?: string; sha256: Sha256; createdBy: Actor; createdAt: Iso;
    briefCurrent: boolean;
    check: { status: "pass" | "fail" | "error" | "none"; failed: string[] };
    rationale: { purpose: string; field?: string; why: string }[];
    renders: string[];
  }[];
  pin: { record?: string; candidate: CandidateName; sha256: Sha256; decidedBy: string; basis: string; at: Iso;
         state: "pinned" | "confirm" | "sample" }[];
  consumedBy: string[];
  queue: string[];
  ledger: string[];
}

export interface RenderIndex {
  schema: "clossys.render/1";
  ref: string;
  compare?: string;
  inputsSha256: Sha256;
  renderedAt: Iso;
  by: Extract<Actor, { actor: "code" }>;
  specimens: { candidate: CandidateName; specimen: string; locale?: string; width?: number; png?: string; html?: string }[];
}

/** system.md 12.5: the output of `clossys preview <publication>`. The int2 element preview is PreviewRecord (`clossys.element-preview/1`). */
export interface PreviewView {
  schema: "clossys.preview/1";
  publication: string;
  buildId: string;                        // "preview-<12 hex>"
  url: string;
  routes: { path: string; page: string; locales: string[] }[];
  overrides: { ref: string; sha256: Sha256 }[];
  sample: string[];
}

export type ThemeMode = "light" | "dark";
export type ShadcnVar =
  | "--background" | "--foreground" | "--primary" | "--primary-foreground" | "--secondary" | "--secondary-foreground"
  | "--muted" | "--muted-foreground" | "--accent" | "--accent-foreground" | "--destructive" | "--border" | "--input"
  | "--ring" | "--radius" | "--font-sans" | "--font-heading";

export interface ThemeSource { slot: string; candidate: CandidateName; sha256: Sha256; sample: boolean }

/** designer.md 9.8: .clossys/generated/designer/theme.json. */
export interface ThemeProjection {
  schema: "clossys.theme/1";
  vars: Record<ThemeMode, Partial<Record<ShadcnVar | `--${string}`, string>>>;
  sources: Record<string, ThemeSource>;
  inputsSha256: Sha256;
}

/** A kind slot entry (clossys.queue-entry/2, foundry-build-0048 U5): records/request.ts reads and writes it. */
export type RequestOp = "raised" | "checked" | "decided" | "placed" | "closed";
export interface RequestEvent {
  readonly id: string; readonly at: string; readonly op: RequestOp; readonly by?: string; readonly detail?: string;
  /** As clossys.queue-entry/1 events: where the words came from (cli, chat, app) and the owner's words when quoted. */
  readonly via?: "cli" | "chat" | "app"; readonly quote?: string;
}
export interface Overlap { readonly slot: string; readonly why: string }
export interface Proposal {
  readonly slot: string; readonly under: string; readonly kind?: string; readonly contract: Record<string, unknown>;
  /** The new leaf's inputs (slot refs): the placement overlap check compares them with the assignee's placed slots. */
  readonly inputs?: readonly string[];
}
export interface SlotRequest {
  readonly schema: "clossys.queue-entry/2";
  readonly id: string;
  readonly kind: "slot";
  /** The requester slot ref, or `owner`. */
  readonly from: string;
  /** Who executes: for kind slot, the agent whose tree would hold the slot (the target's agent). */
  readonly assignee: "director" | "designer" | "writer" | "publisher";
  /** `<agent>/<slot id>`: the slot the requester names. */
  readonly target: string;
  readonly status: "open" | "closed";
  readonly opened: string;
  readonly closed?: string;
  readonly link?: string;
  readonly rel: "input" | "uses";
  readonly why: string;
  readonly source: "cli" | "ia" | "interview" | "feedback" | "scope";
  /** Who raised it, as clossys.queue-entry/1 `createdBy`. */
  readonly createdBy: Actor;
  readonly createdAt: string;
  /** As clossys.queue-entry/1 `refs`: the requester slot (`raisedBy`) when one raised it. */
  readonly refs: readonly Ref[];
  readonly overlaps?: readonly Overlap[];
  /** A create decided over a listed overlap: why it is a new leaf (the owner signs it). */
  readonly overlapReason?: string;
  readonly decision?: "reuse" | "create";
  readonly reuse?: string;
  readonly proposal?: Proposal;
  readonly notified?: { readonly to: string; readonly at: string };
  readonly closedAt?: string;
  readonly events: readonly RequestEvent[];
}

/** Exactly the keys of T: a missing or extra key fails the build. */
const keysOf = <T>() => (keys: { [K in keyof Required<T>]: true }): readonly string[] => Object.keys(keys);

/** Top-level keys of each target type, by schema id; schema.test.ts compares them to the schema `properties`. */
export const RECORD_KEYS: Readonly<Record<string, readonly string[]>> = {
  "clossys.slot/2": keysOf<Slot>()({
    schema: true, id: true, agent: true, kind: true, status: true, createdBy: true, createdAt: true, updatedAt: true, refs: true,
    ia: true, base: true, standard: true, brief: true, contract: true, tighten: true, options: true, varyOn: true, family: true,
  }),
  "clossys.candidate/1": keysOf<CandidateHeader>()({
    schema: true, id: true, agent: true, kind: true, status: true, createdBy: true, createdAt: true, updatedAt: true, refs: true,
    slot: true, record: true, briefSha256: true, source: true, rationale: true,
  }),
  "clossys.pin/2": keysOf<Pin>()({
    schema: true, id: true, agent: true, kind: true, status: true, createdBy: true, createdAt: true, updatedAt: true, refs: true,
    candidate: true, sha256: true, decidedBy: true, basis: true, at: true, confirmed: true,
  }),
  "clossys.pin-map/1": keysOf<PinMap>()({
    schema: true, id: true, agent: true, kind: true, status: true, createdBy: true, createdAt: true, updatedAt: true, refs: true,
    records: true,
  }),
  "clossys.check-result/1": keysOf<CheckResultDoc>()({
    schema: true, subject: true, subjectSha256: true, briefSha256: true, standard: true, ranAt: true, by: true, status: true, results: true,
  }),
  "clossys.queue-entry/1": keysOf<QueueEntry>()({
    schema: true, id: true, agent: true, kind: true, status: true, createdBy: true, createdAt: true, updatedAt: true, refs: true,
    queue: true, ask: true, subject: true, decider: true, default: true, options: true, events: true,
  }),
  "clossys.queue-entry/2": keysOf<SlotRequest>()({
    schema: true, id: true, kind: true, from: true, assignee: true, target: true, status: true, opened: true, closed: true, link: true,
    rel: true, why: true, source: true, createdBy: true, createdAt: true, refs: true, overlaps: true, overlapReason: true, decision: true,
    reuse: true, proposal: true, notified: true, closedAt: true, events: true,
  }),
  "clossys.ledger-entry/1": keysOf<LedgerEntry>()({
    schema: true, id: true, agent: true, kind: true, status: true, createdBy: true, createdAt: true, updatedAt: true, refs: true,
    loop: true, loopVersion: true, trigger: true, steps: true, checks: true, decisions: true, outcome: true,
  }),
  "clossys.loop-version/1": keysOf<LoopVersion>()({ trigger: true, steps: true, exit: true, repeat: true, maxRounds: true }),
  "clossys.view/1": keysOf<ViewHeader>()({
    schema: true, id: true, agent: true, kind: true, status: true, createdBy: true, createdAt: true, updatedAt: true, refs: true,
    appliesTo: true, inputs: true, answers: true,
  }),
  "clossys.ia/1": keysOf<IaRecord>()({
    schema: true, id: true, agent: true, kind: true, status: true, createdBy: true, createdAt: true, updatedAt: true, refs: true,
    publications: true,
  }),
  "clossys.facts/1": keysOf<FactsRecord>()({
    schema: true, id: true, status: true, createdBy: true, createdAt: true, updatedAt: true, facts: true,
  }),
  "clossys.status/1": keysOf<StatusView>()({
    schema: true, at: true, workspace: true, stateSha256: true, agents: true, queue: true, ledger: true, releases: true,
  }),
  "clossys.slot-view/1": keysOf<SlotView>()({
    schema: true, ref: true, slot: true, candidates: true, pin: true, consumedBy: true, queue: true, ledger: true,
  }),
  "clossys.render/1": keysOf<RenderIndex>()({
    schema: true, ref: true, compare: true, inputsSha256: true, renderedAt: true, by: true, specimens: true,
  }),
  "clossys.preview/1": keysOf<PreviewView>()({
    schema: true, publication: true, buildId: true, url: true, routes: true, overrides: true, sample: true,
  }),
  "clossys.theme/1": keysOf<ThemeProjection>()({ schema: true, vars: true, sources: true, inputsSha256: true }),
};
