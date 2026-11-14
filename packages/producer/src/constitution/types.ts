/**
 * The constitution check suite (rules R01-R14, programs/release2-swaps/slot-constitution.md): types
 * shared by the context builder, the rule modules and the runner. Every rule is a pure function of
 * one `ConstitutionContext`, built once per run from one read of the tree. A rule module never opens
 * a file itself; the same records in give the same rows out.
 */
import type { ModelAgent } from "../records/slot-model/index.js";

/** Rule ids R01..R14. */
export type RuleId = `R${"01" | "02" | "03" | "04" | "05" | "06" | "07" | "08" | "09" | "10" | "11" | "12" | "13" | "14"}`;

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
}

/** One file under a slot's `candidates/` folder, read once. */
export interface CandidateRecord {
  readonly name: string;
  /** Workspace-relative path. */
  readonly path: string;
  readonly text: string;
  /** Hex sha256 of the file bytes. */
  readonly sha256: string;
  /** Parsed JSON for a `.json` candidate; undefined for `.md` or unparseable JSON. */
  readonly json?: unknown;
  readonly jsonError?: string;
  /** Why the file could not be read (an alias, not a regular file); `text` is then empty. */
  readonly readError?: string;
}

/** A JSON record file in a slot folder (slot.json, pin.json, ledger.json): its text and parse. */
export interface JsonRecord {
  readonly path: string;
  readonly text: string;
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
  /** Slot ids ia.json places, in IA order (read leniently: an invalid IA still places its ids). */
  readonly liveIds: readonly string[];
  /** Every folder in the agent tree, by name. */
  readonly slots: ReadonlyMap<string, SlotRecord>;
  /** Names of the agent folder's entries, sorted. */
  readonly entries: readonly string[];
  /** Records under the agent's `retired/` folder. */
  readonly retired: readonly RetiredRecord[];
}

/** One commit's change to one path (git `--name-status --no-renames`), oldest first per path. */
export interface PathChange { readonly commit: string; readonly status: "A" | "M" | "D" | "T" }

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
}

/** A check: one pure function from the context to rows. */
export type Check = (ctx: ConstitutionContext) => Row[];

/** A rule module: its checks by check id. A pending check id maps to a pending stub. */
export interface RuleModule {
  readonly rule: RuleId;
  readonly checks: Readonly<Record<string, Check>>;
}
