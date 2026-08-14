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
  /**
   * Owning repository when the target is repository-scoped. Omit for the
   * declaring plane's own skill root.
   */
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
