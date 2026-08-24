/** Immutable role and position contracts shipped beside this package. */
import { readFileSync } from "node:fs";

function readSnapshot(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`../../contracts/${name}`, import.meta.url), "utf8"));
}

export function readCanonicalRoleLoopContract(): unknown { return readSnapshot("role-loop-archetypes.json"); }
export function readInstalledPositionContract(): unknown { return readSnapshot("installed-position-contract.json"); }
export function readCompletionEvidenceContract(): unknown { return readSnapshot("completion-evidence-contract.json"); }
