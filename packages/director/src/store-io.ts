/**
 * The strategy store is read and written only through an injected reader and
 * writer. Director owns no filesystem access to the store: the clossys CLI
 * (@clossys/producer) passes its single slot-model reader and writer in, and a
 * consumer runtime that has no CLI supplies its own.
 *
 * Every path is root-relative with "/" separators; "." names the root itself.
 */

/** Why a store operation refused. Director maps each fault to a root issue. */
export type DirectorStoreFault =
  | "root-symlink"     // the root itself is a symbolic link
  | "root-unreadable"  // the root is absent, unreadable or not a directory
  | "outside"          // the path escapes the root, or resolves outside it
  | "symlink"          // a path component is a symbolic link
  | "not-directory"    // a directory was expected
  | "not-file"         // a regular file was expected
  | "changed"          // the entry changed between confinement checks and use
  | "path-unreadable"  // a path component could not be inspected
  | "io";              // the confined open, list or read itself failed

/** A thrown store error carries its fault; match on the property, not the class. */
export interface DirectorStoreError extends Error { readonly fault: DirectorStoreFault }

export function storeFault(error: unknown): DirectorStoreFault | undefined {
  const fault = (error as { fault?: unknown } | null)?.fault;
  return typeof fault === "string" ? fault as DirectorStoreFault : undefined;
}

export interface DirectorStoreEntry {
  /** Never follows a final symbolic link. */
  readonly type: "file" | "directory" | "symlink" | "other";
  /** Hard-link count, for generated-output alias checks. */
  readonly links: number;
  readonly dev: number;
  readonly ino: number;
  /** Real path of the entry (the root's own real path for "."). */
  readonly real: string;
}

export interface DirectorStoreReader {
  /** Entry metadata, or undefined when absent. "." is the root and may be stat'ed when absent. */
  stat(root: string, path: string): DirectorStoreEntry | undefined;
  /** Sorted names of a confined directory, or undefined when absent. */
  list(root: string, path: string): string[] | undefined;
  /** UTF-8 text of a confined regular file, or undefined when absent. */
  read(root: string, path: string): string | undefined;
}

/** One optimistic file replacement: `before` undefined means the file must not exist. */
export interface DirectorStoreChange { path: string; before?: string; after: string }

export interface DirectorStoreWriter {
  /** Runs `action` under the store's exclusive writer lock. */
  locked<T>(root: string, action: () => T): T;
  /** All-or-nothing: every `before` is rechecked, then every file is replaced, with rollback. */
  commit(root: string, changes: readonly DirectorStoreChange[]): void;
  /** Replaces one generated file (reports, citations) in place, creating its parent directory. */
  replace(root: string, path: string, text: string, options?: { mode?: number }): void;
}

export interface DirectorStore {
  readonly reader: DirectorStoreReader;
  readonly writer: DirectorStoreWriter;
}
