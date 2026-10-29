import { statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export type CellAgent = "designer" | "writer" | "publisher" | "strategist";

export interface ResolveCellRootOptions {
  /** Explicit cell root, resolved against cwd rather than repoRoot. */
  root?: string;
  /** Repository root, resolved against cwd; bypasses repository discovery. */
  repoRoot?: string;
  /** Invocation directory; defaults to process.cwd(). */
  cwd?: string;
}

const agents = new Set<string>(["designer", "writer", "publisher", "strategist"]);

function checkPath(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "" || value.includes("\0")) {
    throw new TypeError(`${name} must be a non-empty path without NUL characters`);
  }
}

function findRepoRoot(cwd: string): string {
  let directory = cwd;
  for (;;) {
    try {
      const marker = statSync(join(directory, ".git"));
      if (marker.isDirectory() || marker.isFile()) return directory;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
    }
    const parent = dirname(directory);
    if (parent === directory) return cwd;
    directory = parent;
  }
}

/**
 * Resolve a consumer cell root without reading cell contents or creating files.
 * Defaults to <repo>/clossys/agents/<agent>, using the nearest ancestor .git
 * file/directory. Without a marker, cwd is the repository root; callers in
 * source archives can supply repoRoot explicitly. Explicit root overrides
 * resolve against cwd and are not prefixed with the default layout.
 */
export function resolveCellRoot(agent: CellAgent, options: ResolveCellRootOptions = {}): string {
  if (!agents.has(agent)) throw new TypeError("agent must be designer, writer, publisher or strategist");
  if (!options || typeof options !== "object" || Array.isArray(options)) throw new TypeError("options must be an object");
  for (const key of ["root", "repoRoot", "cwd"] as const) {
    if (options[key] !== undefined) checkPath(options[key], key);
  }
  const cwd = options.cwd === undefined ? process.cwd() : resolve(options.cwd);
  if (options.root !== undefined) return resolve(cwd, options.root);
  const repoRoot = options.repoRoot === undefined ? findRepoRoot(cwd) : resolve(cwd, options.repoRoot);
  return join(repoRoot, "clossys", "agents", agent);
}
