import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { PackItem } from "./types.js";

export interface PackAdoptionCandidate {
  /** The pack item id this path would register as, if found. */
  itemId: string;
  /** Path to check, relative to `rootDir`. */
  path: string;
}

export interface PackAdoptionResult {
  itemId: string;
  path: string;
  /** sha256 hex digest of the file's current bytes. */
  fingerprint: string;
}

/**
 * "Adopt, don't override" (#1204): detect an existing site, logo, deck, or
 * brand document already in the repository and register it as `found` with
 * a fingerprint, rather than a fresh package assuming a missing item and
 * generating over it. This only detects and fingerprints — it never reads
 * an item as "the same as before" beyond the fingerprint, never deletes or
 * replaces anything, and never writes a pack manifest itself; the caller
 * decides what a `found` registration means for the surrounding manifest.
 */
export async function detectExistingPackItems(rootDir: string, candidates: readonly PackAdoptionCandidate[]): Promise<readonly PackAdoptionResult[]> {
  const found: PackAdoptionResult[] = [];
  for (const candidate of candidates) {
    let bytes: Buffer;
    try {
      bytes = await readFile(resolve(rootDir, candidate.path));
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") continue;
      throw error;
    }
    found.push({ itemId: candidate.itemId, path: candidate.path, fingerprint: createHash("sha256").update(bytes).digest("hex") });
  }
  return found;
}

/**
 * Builds a fresh `found` pack item for a just-detected adoption candidate.
 * The caller supplies `layer`/`owner`/`visibility`/`needs` (this module has
 * no opinion on the pack's shape) and `now` (an injected clock, for
 * deterministic tests); everything lifecycle-shaped is set to the "just
 * detected, nothing judged yet" state the #1228 vocabulary calls `found`.
 */
export function foundPackItem(
  adoption: PackAdoptionResult,
  fields: Pick<PackItem, "layer" | "owner" | "visibility" | "needs">,
  now: string,
): PackItem {
  return {
    id: adoption.itemId,
    layer: fields.layer,
    owner: fields.owner,
    visibility: fields.visibility,
    needs: fields.needs,
    status: "found",
    condition: "current",
    version: "v0.1",
    createdAt: now,
    updatedAt: now,
    approvedAt: null,
    verifiedAt: null,
    sourcePins: [{ path: adoption.path, fingerprint: adoption.fingerprint }],
    outputPaths: [],
    publishedTo: [],
    nextAction: "judge against world-class and propose the next iteration as a diff",
  };
}
