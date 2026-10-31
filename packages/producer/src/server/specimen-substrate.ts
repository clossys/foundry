import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The one specimen substrate for a workspace: where the install pipeline puts the pinned
 * items' npm dependencies (font packages included). Specimens build in it; Studio's shell
 * resolves pinned font packages from it when the consumer has not installed them.
 */
export function specimenSubstrate(root: string): string {
  const digest = createHash("sha256").update(root).update("\0").digest("hex");
  return join(tmpdir(), "clossys-studio-specimens", digest.slice(0, 12), "substrate");
}
