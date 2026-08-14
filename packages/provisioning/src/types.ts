/**
 * Vocabulary for applying a provisioning manifest to a machine.
 *
 * Provisioning is the only capability here whose target is a machine rather
 * than a repository or a registry, and the only one that mutates state outside
 * version control. That earns it distinctive rules: every path is resolved
 * before anything is touched, every mutation is backed up first, and the engine
 * owns no manifest of its own.
 */

export type Severity = "high" | "medium" | "low";

export interface Finding {
  readonly rule: string;
  readonly severity: Severity;
  readonly message: string;
}

/** A symlink from a destination back to a source that stays canonical. */
export interface LinkEntry {
  /** Path relative to the source root. Mutually exclusive with `target`. */
  readonly source?: string;
  /** An already-resolved destination to point at, for chaining one link to another. */
  readonly target?: string;
  readonly destination: string;
}

/** A real file written to the destination, optionally with tokens expanded. */
export interface CopyEntry {
  readonly source: string;
  readonly destination: string;
  /** Octal string, e.g. "600". Enforced on every run, not only on first write. */
  readonly mode?: string;
  /** Expand `${TOKEN}` placeholders against the runtime context. */
  readonly template?: boolean;
}

/** A marker-delimited region inside a file the engine does not otherwise own. */
export interface ManagedBlockEntry {
  readonly source: string;
  readonly destination: string;
  readonly startMarker: string;
  readonly endMarker: string;
  readonly template?: boolean;
}

export interface PrivateDirectoryEntry {
  readonly path: string;
  /** Create it when absent. When false, its absence is simply not a finding. */
  readonly create: boolean;
}

export interface Manifest {
  readonly version: 1;
  readonly defaults?: { readonly workspaceRoot?: string };
  readonly links: readonly LinkEntry[];
  readonly copies: readonly CopyEntry[];
  readonly managedBlocks: readonly ManagedBlockEntry[];
  readonly privateDirectories: readonly PrivateDirectoryEntry[];
}

export interface RuntimeContext {
  readonly home: string;
  readonly workspaceRoot: string;
  /** Where manifest-relative `source` paths resolve from. */
  readonly sourceRoot: string;
  readonly tokens: Readonly<Record<string, string>>;
}

export type OperationKind = "link" | "copy" | "managed-block" | "private-directory";

/**
 * One fully-resolved unit of work. A plan is computed without touching the
 * filesystem, so it can be printed, diffed, or reviewed before anything runs --
 * and so the same plan drives both applying and verifying.
 */
export interface PlanOperation {
  readonly kind: OperationKind;
  /** Absolute source path, or undefined for a private directory. */
  readonly sourcePath?: string;
  /** Absolute destination path, or the directory path for a private directory. */
  readonly destinationPath: string;
  readonly mode?: string;
  readonly template: boolean;
  readonly startMarker?: string;
  readonly endMarker?: string;
  readonly create?: boolean;
}

export interface Plan {
  readonly runtime: RuntimeContext;
  readonly operations: readonly PlanOperation[];
}

/**
 * The filesystem this engine acts through. Injected rather than imported so
 * that the engine's behavior is testable without a real home directory -- and
 * so a caller can wrap it to audit, sandbox, or refuse writes.
 */
export interface FileStats {
  readonly isFile: boolean;
  readonly isDirectory: boolean;
  readonly isSymbolicLink: boolean;
  /** Permission bits only, already masked to 0o777. */
  readonly mode: number;
}

export interface FileSystemPort {
  /** Stat without following symlinks. Returns undefined when absent. */
  lstat(path: string): FileStats | undefined;
  /** Fully resolved path. Returns undefined for a missing or broken path. */
  realpath(path: string): string | undefined;
  readFile(path: string): Uint8Array;
  writeFile(path: string, contents: Uint8Array): void;
  readlink(path: string): string;
  symlink(target: string, path: string): void;
  mkdir(path: string, mode?: number): void;
  /** Remove a file, symlink, or directory tree. */
  remove(path: string): void;
  chmod(path: string, mode: number): void;
  /** Recursive copy, preserving symlinks as symlinks. Used only for backups. */
  copy(from: string, to: string): void;
}

export interface ApplyOptions {
  /**
   * Directory to back every replaced destination into before it is replaced.
   * Required: this engine will not overwrite anything it has not first copied,
   * because the thing it overwrites lives outside version control and has no
   * other copy.
   */
  readonly backupRoot: string;
}

export interface ApplyResult {
  readonly changed: readonly PlanOperation[];
  readonly unchanged: readonly PlanOperation[];
  readonly backupRoot: string;
}
