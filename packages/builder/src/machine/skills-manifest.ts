import { join } from "node:path";
import { loadManifest } from "../manifest.js";
import type { Manifest } from "../types.js";
import type { DestinationCollision } from "../composition.js";

/**
 * Per-source (account or third-party) Manifest construction: turns one
 * discovered skill tree into a `Manifest` that `loadManifest`/`planInstallation`
 * (`../manifest.ts`, `../runtime.ts`) consume completely unchanged — no new
 * manifest vocabulary, no bypass of validation.
 *
 * This is decision 2 from the package README's "Machine composition"
 * section, made concrete, AS RECORDED BY THE OWNER on 2026-09-21: composition
 * is UNION BY DIRECTORY LINK. `~/.agents/skills` (`composedSkillsRoot`)
 * presents the union of several source trees by linking each source tree in
 * as a DIRECTORY — one link per discovered account workspace, plus one for
 * the third-party-scoped skills root — never a single directory symlink
 * (which can only point at one source, so it cannot union several trees at
 * all) and never a materialized copy (which drifts from its source the
 * moment the source changes).
 *
 * THIS SUPERSEDES AN EARLIER DECISION. #393 was first implemented with
 * per-skill links — one `links` entry per skill name, all destined inside
 * `composedSkillsRoot` — specifically because that shape let
 * `composeInstallationPlans`'s existing per-DESTINATION collision check catch
 * a name collision as a side effect of link creation, with no new collision
 * logic. The owner overturned that shape on 2026-09-21 (#393): one link per
 * skill does not compose — under multiple accounts, an account with a large
 * skill tree floods the composed root with entries no reader can attribute to
 * a source at a glance, and nothing marks which account a skill actually
 * belongs to. Directory-linking fixes both: `composedSkillsRoot/<name>` is a
 * whole source tree, immediately attributable, and the per-skill drift a
 * malicious or careless `readdir` could otherwise cause is moot because
 * nothing here ever names an individual skill as its own destination.
 *
 * THE COST OF THAT CHANGE: collision detection is no longer free
 * ------------------------------------------------------------------
 * A directory-level union means a name collision is a collision BETWEEN TWO
 * DIRECTORIES' CONTENTS, not between two individually-tracked links.
 * `composeInstallationPlans`'s collision check only ever sees one destination
 * per source now (`composedSkillsRoot/<sourceName>`), and two different
 * source names never collide with each other at that level — the whole
 * point of directory-linking. So the installer cannot discover a same-named
 * skill living in two source trees as a side effect of link creation the way
 * per-skill linking could; it has to enumerate the skills in every source
 * tree and compare BEFORE creating any link. `detectSkillNameCollisions`
 * below is that enumeration-and-compare step. It reuses `../composition.ts`'s
 * own `DestinationCollision` shape — never a second collision vocabulary —
 * so a caller that already knows how to fold a `DestinationCollisionError`
 * into a report (`report.ts` already does, for the class-1/account/third-party
 * collisions `composeInstallationPlans` itself still catches) folds a
 * skill-name collision the identical way, with no second code path.
 *
 * WHY `composedSkillsRoot` IS STILL A `privateDirectories` ENTRY (#240's own
 * reproduction, closing the retirement #410 tracks)
 * -----------------------------------------------------------------------
 * On the machine this replaces, `composedSkillsRoot` is today a SINGLE
 * DIRECTORY SYMLINK into the repository being retired. That old shape is
 * PARTLY the shape this module now adopts — a directory symlink at
 * `composedSkillsRoot` was a hazard specifically because it could only point
 * at ONE source, silently excluding every other account's tree. Linking each
 * source tree in as its own named subdirectory of `composedSkillsRoot` is not
 * that hazard: it is many directory links, each scoped under a real,
 * non-symlinked parent, never a single directory symlink standing in for the
 * whole union.
 *
 * `composedSkillsRoot` ITSELF must therefore still never be a symlink -- #240
 * reproduced what happens when the OLD symlink is left in place and this
 * module's links are planned into it: `../apply.ts`'s `replace()` calls the
 * generic filesystem port's recursive `mkdir` on `dirname(destination)` —
 * `composedSkillsRoot` itself — while preparing to write the FIRST directory
 * link, and a real filesystem throws an opaque `ENOENT` (verified against
 * real `mkdirSync(..., {recursive:true})` behavior: a dangling directory
 * symlink at that path is neither absent nor a directory it can enter) deep
 * inside machinery that has nothing to do with what actually went wrong. The
 * same crash — differently but just as opaquely — hits the NON-dangling case
 * too: a symlink still pointing at a directory that still exists lets
 * `mkdir` silently succeed by walking straight through it, so a per-source
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
 * own documented ordering), this refusal happens before the first directory
 * link is even attempted — the stale symlink is left completely untouched,
 * never silently overwritten, and the failure a caller sees is one clear,
 * named `Error` instead of the crash #240 reproduced. `verifyMachine`'s
 * verify-only path (which never applies) reports the identical situation as
 * a normal `install/private-directory-not-a-directory` finding, no throw at
 * all — see `machine-layer.ts` and `report.test.ts` for that path exercised
 * end to end.
 *
 * What DOES change with this decision: an individual entry directly under
 * `composedSkillsRoot` (`composedSkillsRoot/<sourceName>`) is now EXPECTED to
 * be a directory symlink — that is this module's entire output. The refusal
 * above stays scoped to `composedSkillsRoot` itself, never to its children:
 * this module declares exactly one `privateDirectories` entry (the root) and
 * exactly one `links` entry (the whole source tree), so nothing here ever
 * asks the generic engine to refuse a directory symlink it itself just
 * created.
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

/** A source-tree directory link name, or a skill name being checked for collisions — never a path separator, never empty. */
const SAFE_NAME = /^[^/\\]+$/;

/**
 * Build a `Manifest` linking one ENTIRE source tree into
 * `<composedSkillsRoot>/<linkName>` as a single directory symlink — never one
 * entry per skill. `linkName` is the identifier this source composes under
 * (an account's declared `account`, or the literal `"third-party"` — see
 * `report.ts`'s `buildNamedPlan`, which always passes the same string it
 * already uses as the `NamedSourcePlan.source`). Throws on a `linkName` that
 * is empty or contains a path separator: `account` is read out of a
 * caller-controlled marker file (`discovery.ts`'s
 * `AccountWorkspaceDeclaration`), and a hostile value (`"../escape"`) must
 * never become a destination outside the composed directory.
 */
export function buildSkillsManifest(options: {
  readonly composedSkillsRoot: string;
  readonly linkName: string;
}): Manifest {
  if (!SAFE_NAME.test(options.linkName)) {
    throw new Error(
      `buildSkillsManifest: unsafe link name ${JSON.stringify(options.linkName)} — must not contain a path separator`,
    );
  }

  return loadManifest({
    version: 1,
    links: [{ source: ".", destination: join(options.composedSkillsRoot, options.linkName) }],
    copies: [],
    managedBlocks: [],
    // See this module's header: this is what turns a stale symlink at
    // `composedSkillsRoot` — the pre-migration single-directory-symlink shape
    // — into a clear, reported refusal instead of a crash or a silent write
    // through the old link.
    privateDirectories: [{ path: options.composedSkillsRoot, create: true }],
  });
}

/** One source tree's name and the skill names discovered directly under it. */
export interface SkillNameSource {
  /** The identifier this source composes under — matches `NamedSourcePlan.source` / `buildSkillsManifest`'s `linkName`. */
  readonly name: string;
  readonly skillNames: readonly string[];
}

/**
 * Enumerate the skills in every source tree and report every skill name
 * claimed by more than one source, BEFORE any link is created — see this
 * module's header for why directory-linking makes this a required, explicit
 * step rather than a side effect of `composeInstallationPlans`.
 *
 * Returns `../composition.ts`'s own `DestinationCollision` shape, never a
 * second collision vocabulary: `destinationPath` is the NOTIONAL flat
 * address (`<composedSkillsRoot>/<skillName>`) two or more sources would
 * both resolve a reader to once their directories are unioned, even though
 * no single filesystem operation this module plans ever writes exactly that
 * path — it is the address a caller reading "the skill named X" off the
 * union would be handed, and ambiguous readers are exactly what a collision
 * report exists to prevent. Empty, contributing no collisions either way.
 *
 * Pure: no filesystem access. Callers pass whatever skill-name enumeration
 * they already gathered from discovery (`WorkspaceCandidate.skillNames`,
 * `ThirdPartySkillsResult.skills`) — this function reads none of it itself.
 */
export function detectSkillNameCollisions(
  sources: readonly SkillNameSource[],
  options: { readonly composedSkillsRoot: string },
): readonly DestinationCollision[] {
  const claimants = new Map<string, Set<string>>();
  for (const { name, skillNames } of sources) {
    for (const skillName of skillNames) {
      const claimSet = claimants.get(skillName) ?? new Set<string>();
      claimSet.add(name);
      claimants.set(skillName, claimSet);
    }
  }

  const collisions: DestinationCollision[] = [];
  for (const [skillName, claimSet] of claimants) {
    if (claimSet.size > 1) {
      collisions.push({
        destinationPath: join(options.composedSkillsRoot, skillName),
        sources: [...claimSet].sort(),
      });
    }
  }

  return collisions.sort((a, b) => a.destinationPath.localeCompare(b.destinationPath));
}
