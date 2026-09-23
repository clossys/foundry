/**
 * `resolveDefaultStrategyDirectory` — legacy-fallback discovery for the
 * `strategy-dir` argument every `strategist-check` subcommand takes
 * (default, `handoff`, `apply`), used only when a caller omits it. An
 * explicit `strategy-dir` argument always wins outright and never reaches
 * this function — see `cli.ts`'s `resolveStrategyDirArgument`.
 *
 * #1171's owner decision (approved 2026-09-22): the consumer-facing
 * convention moves from a root `strategy/` directory to `clossys/strategist/`.
 * This package reads the retired `strategy/` location for exactly one
 * release as a migration bridge — see this package's CHANGELOG for the
 * release the fallback is removed in.
 *
 * PURE, the same I/O split this package always draws (`facts-dir.ts`,
 * `scan.ts`): this function takes the two already-resolved candidate paths
 * and whether each is a real, already-checked directory — it does no
 * filesystem work of its own and can be unit tested with zero real
 * filesystem involved. The CLI's own small adapter supplies the real
 * `existsSync`/`statSync` check and the real `process.cwd()`-anchored paths.
 *
 * THE THREE OUTCOMES, exactly as #1171 specifies — never a silent pick:
 *   - `currentDir` exists (or neither directory does): resolve to the
 *     current convention. A caller that resolves "current" while neither
 *     directory is actually present gets the ordinary missing-directory
 *     error one step later, naming the CURRENT path — never the retired
 *     one — because the current convention is what a fresh consumer should
 *     create.
 *   - only `legacyDir` exists: read it, with a plain-language notice to
 *     move it. This is the one-release migration bridge.
 *   - both exist: refuse to guess which is authoritative — silently
 *     preferring one risks acting on stale, superseded strategy records.
 *     Reported `indeterminate` with a notice, the same fail-closed
 *     discipline every other gate in this package holds to (mapped to exit
 *     code 2 by the CLI, like any other "could not run" state).
 */

/** Relative path segments (repository-root-anchored) for the current consumer convention. Join with the base directory using `node:path` `join`, the same way `readStrategy`'s callers always have. */
export const CURRENT_STRATEGY_DIR_SEGMENTS = ["clossys", "strategist"] as const;
/** Relative path segments for the retired convention, read for one release only. */
export const LEGACY_STRATEGY_DIR_SEGMENTS = ["strategy"] as const;

export type StrategyDirectoryDefault =
  | { reason: "current"; dir: string }
  | { reason: "legacy"; dir: string; notice: string }
  | { reason: "indeterminate"; notice: string };

export function resolveDefaultStrategyDirectory(
  currentDir: string,
  legacyDir: string,
  hasCurrentDir: boolean,
  hasLegacyDir: boolean,
): StrategyDirectoryDefault {
  if (hasCurrentDir && hasLegacyDir) {
    return {
      reason: "indeterminate",
      notice:
        `Both "${currentDir}" and the retired "${legacyDir}" exist — refusing to silently pick one. ` +
        `Remove "${legacyDir}" once everything in it has moved to "${currentDir}" (or pass strategy-dir ` +
        `explicitly to force a choice), then run this command again.`,
    };
  }
  if (hasLegacyDir && !hasCurrentDir) {
    return {
      reason: "legacy",
      dir: legacyDir,
      notice:
        `Reading the retired "${legacyDir}" directory — move it to "${currentDir}". ` +
        `This package reads the retired location for one release only; see this package's CHANGELOG.`,
    };
  }
  return { reason: "current", dir: currentDir };
}
