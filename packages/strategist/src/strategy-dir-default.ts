import { realpathSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const CURRENT = "clossys/agents/director";
const RETIRED = ["clossys/agents/strategist", "clossys/strategist", "strategy"];
export class StrategyRootError extends Error {}

function findRepositoryRoot(cwd: string): string | undefined {
  const start = resolve(cwd);
  let directory = start;
  for (;;) {
    try {
      const marker = statSync(join(directory, ".git"));
      // Worktrees use a regular .git file; ordinary repositories use a directory.
      if (marker.isDirectory() || marker.isFile()) return directory;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
    }
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

function repositoryRoot(cwd: string): string {
  return findRepositoryRoot(cwd) ?? resolve(cwd);
}

function existingDirectory(path: string): boolean {
  try { return statSync(path).isDirectory(); }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return false;
    throw error;
  }
}
function canonical(path: string): string {
  try { return realpathSync(path); }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return path;
    throw error;
  }
}

function retiredRepository(root: string, cwd: string): string | undefined {
  const path = resolve(cwd, root);
  // Explicit roots can belong to another repository, including through an alias.
  // Without a repository marker, only the invocation's cwd boundary applies;
  // a custom directory is not retired merely because its basename matches.
  const repositories = new Set([repositoryRoot(cwd), findRepositoryRoot(path), findRepositoryRoot(canonical(path))]);
  for (const repo of repositories) {
    if (repo !== undefined && RETIRED.some(legacy => {
      const retired = join(repo, legacy);
      return path === retired || existingDirectory(retired) && canonical(path) === canonical(retired);
    })) return repo;
  }
  return undefined;
}

/** Recognize retired roots at the invocation or selected root's repository boundary, including aliases. */
export function isRetiredStrategyRoot(root: string, cwd = process.cwd()): boolean {
  return retiredRepository(root, cwd) !== undefined;
}

/** Explicit roots bypass discovery; recognized retired roots are read-only even when explicit. */
export function resolveStrategyRoot(explicit?: string, cwd = process.cwd(), access: "read" | "write" = "read"): string {
  const repo = repositoryRoot(cwd);
  const current = join(repo, CURRENT);
  let root: string;
  if (explicit !== undefined) root = resolve(cwd, explicit);
  else {
    const existing = [current, ...RETIRED.map(path => join(repo, path))].filter(existingDirectory);
    if (existing.length > 1) throw new StrategyRootError(
      `Multiple strategy roots exist (${existing.join(", ")}) — refusing to silently pick one. Move retired contents to "${current}" or pass --root explicitly.`,
    );
    root = existing[0] ?? current;
  }
  const retired = retiredRepository(root, cwd);
  if (retired !== undefined) {
    const destination = join(retired, CURRENT);
    if (access === "write") throw new StrategyRootError(`The retired strategy root "${root}" is read-only; move it to "${destination}" before writing.`);
    // Notices use stderr so --json continues to emit one parseable document.
    console.error(`Reading the retired strategy root "${root}" read-only — move it to "${destination}". Reports are not saved there.`);
  }
  return root;
}
