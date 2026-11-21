/**
 * Where a release lives (publisher.md 9.4.3, flows.md F8): the release slot `publisher/release.<pub>` named by the
 * publication in `clossys/agents/publisher/ia.json`, its manifest candidates, and the build output under
 * `clossys/.state/builds/` (generated, never committed: only the build id is).
 */
import { STATE_DIR } from "../engine/state-dir.js";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { slotDir } from "../records/candidate.js";

export const PUBLICATION_ID = /^[a-z0-9][a-z0-9-]*$/;
export const RELEASE_SLOT = /^release\.[a-z0-9][a-z0-9-]*$/;
/** Build output, relative to the workspace root. */
export const BUILDS_DIR = join(STATE_DIR, "builds");

/** `publisher/ia.json` publications, or undefined when the file is missing or unreadable. */
function publications(root: string): Record<string, { release?: unknown }> | undefined {
  const file = join(root, "clossys", "agents", "publisher", "ia.json");
  if (!existsSync(file)) return undefined;
  try {
    const doc = JSON.parse(readFileSync(file, "utf8")) as { publications?: unknown };
    return typeof doc.publications === "object" && doc.publications !== null ? doc.publications as Record<string, { release?: unknown }> : undefined;
  } catch { return undefined; }
}

/** The publication ids `publisher/ia.json` lists under `publications` (none when the file or the map is missing). */
export const listedPublications = (root: string): string[] => Object.keys(publications(root) ?? {}).sort();

/** The release slot id of a publication: the ia.json `release` entry, else `release.<pub>`. */
export function releaseSlotId(root: string, publication: string): string {
  const named = publications(root)?.[publication]?.release;
  return typeof named === "string" && RELEASE_SLOT.test(named) ? named : `release.${publication}`;
}

/** The publication a release slot belongs to: the ia.json publication naming it, else the id after `release.`. */
export function publicationOf(root: string, slotId: string): string {
  for (const [id, publication] of Object.entries(publications(root) ?? {})) if (publication?.release === slotId) return id;
  return slotId.slice("release.".length);
}

export const releaseDir = (root: string, publication: string): string => slotDir(root, "publisher", releaseSlotId(root, publication));
export const buildsDir = (root: string): string => join(root, BUILDS_DIR);
/** `clossys/.state/builds/<id first 8>/` */
export const buildDir = (root: string, id: string): string => join(buildsDir(root), id.slice(0, 8));
/** The publication's latest build: `clossys/.state/builds/latest-<pub>.json`. */
export const latestBuildFile = (root: string, publication: string): string => join(buildsDir(root), `latest-${publication}.json`);
