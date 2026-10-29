import { statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** Resolve CLI roots without creating directories or changing explicit-root semantics. */
export function resolveStrategyRoot(explicit?: string, cwd = process.cwd()): string {
  if (explicit !== undefined) return resolve(cwd, explicit);

  const start = resolve(cwd);
  let directory = start;
  while (true) {
    try {
      const marker = statSync(join(directory, ".git"));
      // Worktrees use a regular .git file; ordinary repositories use a directory.
      if (marker.isDirectory() || marker.isFile()) return join(directory, "clossys", "agents", "strategist");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
    }
    const parent = dirname(directory);
    if (parent === directory) return join(start, "clossys", "agents", "strategist");
    directory = parent;
  }
}
