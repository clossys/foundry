/**
 * The constitution check suite (rules R01-R16 and R20, programs/release2-swaps/slot-constitution.md): types
 * shared by the context builder, the rule modules and the runner. Every rule is a pure function of
 * one `ConstitutionContext`, built once per run from one read of the tree. A rule module never opens
 * a file itself; the same records in give the same rows out.
 */
import type { ModelAgent, SlotModelIssue } from "../records/slot-model/index.js";
import type { MigratedEvent } from "../records/migrations.js";

/** Rule ids R01..R16 and R20 (R17-R19 are reserved by slot-constitution.md and not yet registered). */
export type RuleId = `R${"01" | "02" | "03" | "04" | "05" | "06" | "07" | "08" | "09" | "10" | "11" | "12" | "13" | "14" | "15" | "16" | "20"}`;

/**
 * One finding. `rule` is the rule id, `check` the check id inside it (`R06.5`), `agent`/`slot`
 * the record's owner, `candidate` the candidate file name when the finding is about one file,
 * `path` the record path relative to the workspace root. A `pending` row is a rule nobody has
 * implemented yet: it is never a pass.
 */
export interface Row {
  readonly rule: RuleId;
  readonly check: string;
  readonly agent: string;
  readonly slot: string;
  readonly candidate?: string;
  readonly reason: string;
  readonly path: string;
  readonly pending?: true;
  /**
   * Set by the runner, never by a check: the row came from a `building` check (reported; fails the
   * run only under --strict) or a `warn` check (reported as a warning; never fails the run).
   */
  readonly level?: "building" | "warn";
}

/**
 * One file under a slot's `candidates/` folder, read once through the one candidate reader
 * (records/slot-current.ts readCandidateText). `text` and `json` are what the kind rules read: the view of a
 * clossys.candidate/1 file under a slot/2 slot (no header, the header's `source` where the int2 rules read it),
 * else the bytes as they are. A rule that must see the bytes as written (a scan of every byte) reads `raw`.
 */
export interface CandidateRecord {
  readonly name: string;
  /** Workspace-relative path. */
  readonly path: string;
  /** The view: what every kind rule reads. */
  readonly text: string;
  /** The file's bytes as written. */
  readonly raw: string;
  /** Hex sha256 of the file bytes (`raw`): pins, the ledger, R08 and R14 name a file by it. */
  readonly sha256: string;
  /** The content identity (records/slot-current.ts contentDigest): the view and the header without its provenance. Empty when unreadable. */
  readonly contentDigest: string;
  /** The clossys.candidate/1 header the view stripped. */
  readonly header?: Readonly<Record<string, unknown>>;
  /** That header's issues where the file sits (schema, id, agent and slot naming, one source); empty without a viewed header. */
  readonly headerIssues: readonly SlotModelIssue[];
  /** Parsed JSON of the view for a `.json` candidate; undefined for `.md` or unparseable JSON. */
  readonly json?: unknown;
  readonly jsonError?: string;
  /** Why the file could not be read (an alias, not a regular file); `text` is then empty. */
  readonly readError?: string;
}

/** A JSON record file in a slot folder (slot.json, pin.json, ledger.json): its text and parse. */
export interface JsonRecord {
  readonly path: string;
  readonly text: string;
  /** Hex sha256 of the file bytes (absent when unreadable). */
  readonly sha256?: string;
  readonly value?: unknown;
  readonly error?: string;
}

/** A retire record found under a `retired/` folder (agent level or slot level). */
export interface RetiredRecord extends JsonRecord {
  readonly name: string;
  /** Hex sha256 of the file bytes (empty when unreadable). */
  readonly sha256: string;
}

/** One folder in an agent tree. */
export interface SlotRecord {
  readonly agent: ModelAgent;
  readonly id: string;
  /** Workspace-relative folder path. */
  readonly dir: string;
  /** Placed by the agent's ia.json. */
  readonly live: boolean;
  /** Names of the folder's entries, sorted. */
  readonly entries: readonly string[];
  readonly slot?: JsonRecord;
  readonly pin?: JsonRecord;
  readonly ledger?: JsonRecord;
  /** Entries of `candidates/`, sorted by name (every regular file, whatever its name). */
  readonly candidates: readonly CandidateRecord[];
  /** Records under the slot's `retired/` folder. */
  readonly retired: readonly RetiredRecord[];
}

export interface AgentRecord {
  readonly agent: ModelAgent;
  /** Workspace-relative agent folder path. */
  readonly dir: string;
  readonly ia?: JsonRecord;
  /** The agent tree's ledger.json (records/ledger.ts). */
  readonly ledger?: JsonRecord;
  /** Slot ids ia.json places, in IA order (read leniently: an invalid IA still places its ids). */
  readonly liveIds: readonly string[];
  /** Every folder in the agent tree, by name. */
  readonly slots: ReadonlyMap<string, SlotRecord>;
  /** Names of the agent folder's entries, sorted. */
  readonly entries: readonly string[];
  /** Records under the agent's `retired/` folder. */
  readonly retired: readonly RetiredRecord[];
}

/**
 * One commit's change to one path (git `--raw --no-renames`), oldest first per path. `from` and
 * `to` are the path's git blob ids before and after the change, when the log carried them.
 */
export interface PathChange { readonly commit: string; readonly status: "A" | "M" | "D" | "T"; readonly from?: string; readonly to?: string; /** The change is a merge commit's diff against its first parent. */ readonly merge?: true }

/** The migration manifest (`<consumer>/evidence/migrations.json`, records/migrations.ts), as read for R08.2. */
export interface MigrationsRecord {
  /** Workspace-relative path of the manifest. */
  readonly path: string;
  /** Its events, each `file` made workspace-relative; empty when it is absent or invalid. */
  readonly events: readonly MigratedEvent[];
  /** Why the manifest is unreadable or invalid. */
  readonly error?: string;
}

/** Git history of the agent trees: every path's changes, oldest first, and the working tree state. */
export interface CandidateHistory {
  readonly available: boolean;
  /** Why history is unavailable (no repository, git failed). */
  readonly error?: string;
  readonly changes: ReadonlyMap<string, readonly PathChange[]>;
  /** Workspace-relative paths with uncommitted changes to tracked files. */
  readonly dirty: ReadonlySet<string>;
}

export interface ConstitutionContext {
  /** Absolute workspace root (the repository holding `clossys/`). */
  readonly root: string;
  /** Absolute consumer folder (`<root>/clossys`). */
  readonly consumer: string;
  readonly agents: readonly AgentRecord[];
  /**
   * Versions of every package in the workspace's root package-lock.json (name → versions), or
   * undefined when there is no readable lockfile (R06.1 then reports every dependency).
   */
  readonly lockVersions?: ReadonlyMap<string, ReadonlySet<string>>;
  /** Git history; read lazily, once, by the rules that need it. */
  readonly history: () => CandidateHistory;
  /** Recorded format-only migrations; absent when the workspace has no manifest. */
  readonly migrations?: MigrationsRecord;
  /** The Foundry-placed leaf ids of a Foundry-placed agent (R01.5); read lazily, once per agent. Throws when the Foundry IA is unreadable. */
  readonly foundryLeaves: (agent: FoundryAgent) => ReadonlySet<string>;
  /**
   * The sha256s an action skill path (or a plumb action's action.json path) is known by (R14.2):
   * its installed file's, plus every state src/constitution/skill-hashes.json lists. Read lazily, once per path; empty for an unknown skill.
   */
  readonly skillShas: (path: string) => ReadonlySet<string>;
  /**
   * The registry kind of an action step (R14.2): `plumb`, `decide:judgment` or `decide:creative`
   * from pipeline/actions.json; undefined for a step the registry does not have. Read lazily, once.
   */
  readonly actionKind: (pkg: string, step: string) => string | undefined;
  /**
   * The slots one write guard or one `--slot` preflight judges (INLINE-GATES); absent, the whole
   * tree. The per-candidate checks (R03.2, R05.1, R06.7, R20) iterate only these slots, and R20 also
   * judges a focus entry's `candidate` before it is pinned (a submit's target). Global lookups (every
   * slot id, the pinned Director slots, the citation graph) still read every slot.
   */
  readonly focus?: readonly FocusTarget[];
}

/** One focused slot, and the candidate file a write is putting there (submit, reissue) or pinning. */
export interface FocusTarget { readonly agent: string; readonly slot: string; readonly candidate?: string }

/** The agents whose IA Foundry places (R01.5). */
export type FoundryAgent = "director" | "designer" | "writer";

/** A check: one pure function from the context to rows. */
export type Check = (ctx: ConstitutionContext) => Row[];

/** A rule module: its checks by check id. A pending check id maps to a pending stub. */
export interface RuleModule {
  readonly rule: RuleId;
  readonly checks: Readonly<Record<string, Check>>;
}
