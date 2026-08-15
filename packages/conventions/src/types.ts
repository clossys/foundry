/**
 * Shared vocabulary for every check in this package.
 *
 * Each validator returns findings rather than throwing or printing. A caller
 * decides what a finding means: a repository gate exits non-zero on one, a
 * migration tool might report and continue. Encoding that decision here would
 * make the package usable in exactly one of those roles.
 */

export type Severity = "high" | "medium" | "low";

export interface Finding {
  /** Stable machine-readable identifier for the rule that produced this. */
  readonly rule: string;
  readonly severity: Severity;
  /** Human-readable, and written to be actionable on its own. */
  readonly message: string;
}

/** A document shipped by this package as a default. */
export interface ConventionDocument {
  readonly id: string;
  /** Filename as shipped, relative to the documents root. */
  readonly filename: string;
  readonly title: string;
  /**
   * True when the document contains `${TOKEN}` placeholders that a provisioning
   * step must expand before the content is correct. A templated document must
   * never be symlinked into place: the reader would get the literal token.
   */
  readonly templated: boolean;
}

/** An adapter file shipped by this package as a default. */
export interface ConventionAdapter {
  readonly id: string;
  readonly filename: string;
  readonly description: string;
  readonly templated: boolean;
  /** Octal string, when the file is only useful with a specific mode. */
  readonly mode?: string;
}

/**
 * A routine declaration: a pointer to a procedure, never a copy of one.
 * See `documents/routine-declaration.md` for why every field is required.
 */
export interface RoutineDeclaration {
  readonly id: string;
  /** Name of a skill the declaring plane owns. Never a document. */
  readonly skill: string;
  /** Owning repository for a repository-scoped skill. Omit for the plane root. */
  readonly skillRepository?: string;
  readonly cadence: string;
  /** Registry identifiers, never paths. */
  readonly scope: readonly string[];
  readonly mode: string;
  readonly purpose: string;
}

/**
 * The declaring plane's own closed lists. This package defines the grammar;
 * a plane supplies the values, which is the whole point of the split.
 */
export interface RoutineRegistry {
  /** Repository identifiers this plane governs. Scope may name nothing else. */
  readonly repositories: readonly string[];
  /** Skills this plane owns and can resolve inside its own skills root. */
  readonly skills: readonly string[];
  readonly cadences: readonly string[];
  readonly modes: readonly string[];
}

/**
 * A schedule declaration: a pointer to deployed code driven by a clock the
 * declaring plane does not run. See `documents/schedule-declaration.md`.
 *
 * The sibling of `RoutineDeclaration`, deliberately not merged with it. Both
 * tiers carry an identifier, a cadence and a scope; they diverge on what they
 * point at, and the checks worth making follow from that divergence.
 */
export interface ScheduleDeclaration {
  readonly id: string;
  /**
   * The expression the host itself will match, not a word. A schedule's clock
   * belongs to a stranger, so the declaration must carry what that stranger
   * reads.
   */
  readonly cadence: string;
  /** Registry identifiers, never paths. */
  readonly scope: readonly string[];
  /** Where the work runs. Drawn from the plane's own closed list of hosts. */
  readonly executionHost: string;
  /** Repository-relative location of what actually runs. Never absolute. */
  readonly artifact: string;
  readonly purpose: string;
  /**
   * Cadences the host's own trigger configuration declares, when the artifact
   * dispatches by matching a fired cadence against its own table. Supplying
   * this is what lets a check compare the two copies of one fact instead of
   * trusting that someone kept them aligned.
   */
  readonly hostTriggers?: readonly string[];
}

/**
 * The declaring plane's closed lists for the schedule tier.
 */
export interface ScheduleRegistry {
  /** Repository identifiers this plane governs. Scope may name nothing else. */
  readonly repositories: readonly string[];
  /**
   * Execution hosts this plane declares. Kept open as data rather than fixed
   * here: naming vendors in the grammar would date it, and a plane that adopts
   * a new host should not need this package to be republished first.
   */
  readonly hosts: readonly string[];
}
