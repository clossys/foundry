import { isAbsolute, join, normalize, resolve } from "node:path";
import type { Manifest, Plan, PlanOperation, RuntimeContext } from "./types.js";

/**
 * Token resolution and plan computation. Everything here is pure -- no
 * filesystem access, no environment reads, no process spawning. A caller
 * supplies the home directory and the source root explicitly.
 *
 * That last point is deliberate. An earlier version of this engine resolved its
 * own source root by shelling out to a version-control command, so that
 * installing from a throwaway worktree would still link to the durable
 * checkout. That is a real problem, but it is the *caller's* problem: an engine
 * that spawns a subprocess to guess where it lives cannot be reasoned about, or
 * tested, or run anywhere its guess does not apply.
 */

const TOKEN = /\$\{([A-Z_]+)\}/g;

/**
 * Expand `${TOKEN}` placeholders. Throws on an unknown token rather than
 * leaving it in place: an unexpanded token that reaches a machine reads like a
 * literal instruction, and silently writing one is how a confident-looking
 * install produces a file nobody can act on.
 *
 * The grammar is exact -- `${` then all-caps and underscores then `}` -- and
 * anything outside it is content, not an error. That distinction matters
 * because this templates arbitrary files, and a shell script is full of
 * `${VAR:-default}`, `${VAR%suffix}`, and `${var}` that mean nothing to this
 * engine. An earlier version refused any leftover `${` after substitution,
 * which made it impossible to template the one kind of file most likely to need
 * it.
 *
 * The collision is still real in the other direction: a braced all-caps shell
 * variable is indistinguishable from a token and *will* be substituted. A file
 * meant to survive templating writes `$VAR` instead -- including inside its
 * comments, which are just bytes here.
 */
export function expandTokens(value: string, tokens: Readonly<Record<string, string>>): string {
  return value.replace(TOKEN, (match, name: string) => {
    const replacement = tokens[name];
    if (replacement === undefined) throw new Error(`Unknown path token ${match}`);
    return replacement;
  });
}

export interface RuntimeOptions {
  /** The operator's home directory. Required — never inferred here. */
  readonly home: string;
  /** Where manifest-relative sources resolve from. Required. */
  readonly sourceRoot: string;
  /**
   * Overrides the manifest default. Precedence is caller, then manifest
   * default, and there is deliberately no third fallback: an engine that
   * invented a workspace root would install a machine's guidance into a
   * directory nobody chose.
   */
  readonly workspaceRoot?: string;
  /** Extra tokens available to templated content. */
  readonly extraTokens?: Readonly<Record<string, string>>;
}

export function createRuntimeContext(manifest: Manifest, options: RuntimeOptions): RuntimeContext {
  const home = resolve(options.home);
  const sourceRoot = resolve(options.sourceRoot);
  const baseTokens: Record<string, string> = {
    HOME: home,
    SOURCE_ROOT: sourceRoot,
    ...(options.extraTokens ?? {}),
  };

  const configured = options.workspaceRoot ?? manifest.defaults?.workspaceRoot;
  if (configured === undefined || configured === "") {
    throw new Error(
      "No workspace root: supply one, or declare defaults.workspaceRoot in the manifest.",
    );
  }
  const workspaceRoot = resolve(expandTokens(configured, baseTokens));

  return {
    home,
    sourceRoot,
    workspaceRoot,
    tokens: Object.freeze({ ...baseTokens, WORKSPACE_ROOT: workspaceRoot }),
  };
}

function expandPath(value: string, runtime: RuntimeContext): string {
  const expanded = expandTokens(value, runtime.tokens);
  if (!isAbsolute(expanded)) throw new Error(`Managed path must be absolute: ${value}`);
  return normalize(expanded);
}

/**
 * Resolve every entry into absolute paths without touching the filesystem.
 * The same plan drives both applying and verifying, which is what makes a
 * verification meaningful: it checks the machine against the identical
 * resolution the install used, not against a second interpretation of the
 * manifest that could differ.
 */
export function planInstallation(manifest: Manifest, runtime: RuntimeContext): Plan {
  const operations: PlanOperation[] = [];

  for (const entry of manifest.links) {
    operations.push({
      kind: "link",
      sourcePath: entry.source
        ? join(runtime.sourceRoot, entry.source)
        : expandPath(entry.target as string, runtime),
      destinationPath: expandPath(entry.destination, runtime),
      template: false,
      // A `target` link points at another managed destination, so it cannot be
      // applied until that destination exists.
      chained: entry.source === undefined,
    });
  }

  for (const entry of manifest.copies) {
    operations.push({
      kind: "copy",
      sourcePath: join(runtime.sourceRoot, entry.source),
      destinationPath: expandPath(entry.destination, runtime),
      template: entry.template === true,
      ...(entry.mode !== undefined ? { mode: entry.mode } : {}),
    });
  }

  for (const entry of manifest.managedBlocks) {
    operations.push({
      kind: "managed-block",
      sourcePath: join(runtime.sourceRoot, entry.source),
      destinationPath: expandPath(entry.destination, runtime),
      template: entry.template === true,
      startMarker: entry.startMarker,
      endMarker: entry.endMarker,
    });
  }

  for (const entry of manifest.privateDirectories) {
    operations.push({
      kind: "private-directory",
      destinationPath: expandPath(entry.path, runtime),
      template: false,
      create: entry.create,
    });
  }

  return { runtime, operations: Object.freeze(operations) };
}
