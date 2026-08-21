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
    privateDirectories: [],
  });
}
