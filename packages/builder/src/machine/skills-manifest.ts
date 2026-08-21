import { join } from "node:path";
import { loadManifest } from "../manifest.js";
import type { Manifest } from "../types.js";

/**
 * Per-account (and third-party) Manifest construction: turns a discovered
 * skill tree into a `Manifest` that `loadManifest`/`planInstallation`
 * (`../manifest.ts`, `../runtime.ts`) consume completely unchanged — no new
 * manifest vocabulary, no bypass of validation.
 *
 * This is decision 2 from the package README's "Machine composition"
 * section, made concrete: composition is PER-SKILL LINKS into one composed
 * directory, never a single directory symlink (which can only point at one
 * source, so it cannot union several accounts' trees) and never a
 * materialized copy (which drifts from its source the moment the source
 * changes). One skill, one `links` entry, one destination inside the
 * composed directory — which is exactly the shape that makes
 * `composeInstallationPlans`'s existing per-DESTINATION collision check work
 * unmodified: two sources both naming a skill `foo` both produce a `links`
 * entry with destination `<composedSkillsRoot>/foo`, and composing them
 * throws `DestinationCollisionError` for free, with both sources named. No
 * new collision logic was written for this module because none was needed.
 *
 * THE SHAPE TRANSITION, AND WHY `composedSkillsRoot` IS ALSO A `privateDirectories`
 * ENTRY NOW (#240's own reproduction, closing the retirement #410 tracks)
 * -----------------------------------------------------------------------
 * On the machine this replaces, `composedSkillsRoot` is today a SINGLE
 * DIRECTORY SYMLINK into the repository being retired — decision 2 above is
 * a different shape (per-skill links) at that exact same path. #240
 * reproduced what happens when the old symlink is left in place and per-skill
 * links are planned into it: `../apply.ts`'s `replace()` calls the generic
 * filesystem port's recursive `mkdir` on `dirname(destination)` —
 * `composedSkillsRoot` itself — while preparing to write the FIRST per-skill
 * link, and a real filesystem throws an opaque `ENOENT` (verified against
 * real `mkdirSync(..., {recursive:true})` behavior: a dangling directory
 * symlink at that path is neither absent nor a directory it can enter) deep
 * inside machinery that has nothing to do with what actually went wrong. The
 * same crash — differently but just as opaquely — hits the NON-dangling case
 * too: a symlink still pointing at a directory that still exists lets
 * `mkdir` silently succeed by walking straight through it, so a per-skill
 * link would be written INSIDE the old repository's tree instead of into a
 * real, machine-owned directory. Neither outcome is "detected and reported."
 *
 * Declaring `composedSkillsRoot` itself as a `privateDirectories` entry
 * (`create: true`) on every source's manifest closes both cases WITHOUT a new
 * engine mechanism: `../apply.ts`'s `applyPrivateDirectory` and
 * `../verify.ts`'s `verifyPrivateDirectory` already refuse a destination that
 * exists as anything other than a real, non-symlinked directory — `lstat`
 * (which never follows the final path component) sees the symlink itself
 * regardless of whether its target exists, so this check fires identically
 * for the dangling and the still-resolving case. Because `applyInstallation`
 * runs its private-directory phase BEFORE any link phase (`../apply.ts`'s
 * own documented ordering), this refusal happens before the first per-skill
 * link is even attempted — the stale symlink is left completely untouched,
 * never silently overwritten, and the failure a caller sees is one clear,
 * named `Error` instead of the crash #240 reproduced. `verifyMachine`'s
 * verify-only path (which never applies) reports the identical situation as
 * a normal `install/private-directory-not-a-directory` finding, no throw at
 * all — see `machine-layer.ts` and `report.test.ts` for that path exercised
 * end to end.
 *
 * Every source (each account workspace, third-party, and class one's own
 * conventions once class one starts using this composed root too) declares
 * this SAME `composedSkillsRoot` path independently. That is not a conflict:
 * `../composition.ts`'s `composeInstallationPlans` already exempts
 * `private-directory` operations from its collision check (see that module's
 * own doc comment and "Multi-source composition" in the README) — ensuring a
 * directory exists with a fixed mode is idempotent and non-destructive
 * regardless of which source asks, or how many do.
 */

const SKILL_NAME = /^[^/\\]+$/;

/**
 * Build a `Manifest` with one `links` entry per skill name, each pointing
 * `<composedSkillsRoot>/<name>` at `<name>` resolved against whatever
 * `sourceRoot` the caller later builds a `RuntimeContext` with (the
 * workspace's own `skillsPath`, or the third-party root). Throws on a name
 * that is empty or contains a path separator — a discovered directory entry
 * is trusted to exist, never trusted to be a safe manifest `source` without
 * this check, because `readdir` returning a hostile name (a symlink loop, an
 * adversarial checkout) is exactly the input this function must not turn
 * into a destination outside the composed directory.
 */
export function buildSkillsManifest(
  skillNames: readonly string[],
  options: { readonly composedSkillsRoot: string },
): Manifest {
  for (const name of skillNames) {
    if (!SKILL_NAME.test(name)) {
      throw new Error(`buildSkillsManifest: unsafe skill name ${JSON.stringify(name)} — must not contain a path separator`);
    }
  }

  return loadManifest({
    version: 1,
    links: [...skillNames]
      .sort()
      .map((name) => ({ source: name, destination: join(options.composedSkillsRoot, name) })),
    copies: [],
    managedBlocks: [],
    // See this module's header: this is what turns a stale symlink at
    // `composedSkillsRoot` — the pre-migration single-directory-symlink shape
    // — into a clear, reported refusal instead of a crash or a silent write
    // through the old link.
    privateDirectories: [{ path: options.composedSkillsRoot, create: true }],
  });
}
