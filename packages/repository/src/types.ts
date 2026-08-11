/** The only profile shape supported by this package version. */
export const REPOSITORY_PROFILE_VERSION = 1 as const;

/** A consumer-owned command that tooling may invoke from the repository. */
export interface RepositoryCommand {
  /** Stable lowercase name, using hyphens or colons as separators. */
  readonly name: string;
  /** The command line exactly as the consumer declares it. */
  readonly run: string;
  /** Optional repository-relative working directory. */
  readonly cwd?: string;
}

/**
 * Consumer-owned repository values. This package defines and validates the
 * shape only; it ships no repository profile instance.
 */
export interface RepositoryProfile {
  readonly schemaVersion: typeof REPOSITORY_PROFILE_VERSION;
  readonly defaultBranch: string;
  /** Ordered commands with explicit names; never an inherited-property dictionary. */
  readonly commands: readonly RepositoryCommand[];
  /** Repository-relative paths using literal segments plus `*` or `**` wildcards. */
  readonly protectedPaths: readonly string[];
}

export type RepositoryProfileFindingRule =
  | "profile-shape"
  | "unknown-field"
  | "schema-version"
  | "default-branch"
  | "commands-shape"
  | "command-name"
  | "duplicate-command-name"
  | "command-shape"
  | "command-run"
  | "command-cwd"
  | "protected-paths-shape"
  | "protected-path"
  | "duplicate-protected-path";

/** One deterministic structural finding, attributed to its input path. */
export interface RepositoryProfileFinding {
  rule: RepositoryProfileFindingRule;
  severity: "error";
  path: string;
  message: string;
}
