/** Immutable role and position contracts shipped beside this package. */
import { readFileSync } from "node:fs";

function readSnapshot(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`../../contracts/${name}`, import.meta.url), "utf8"));
}

export function readCanonicalRoleLoopContract(): unknown { return readSnapshot("role-loop-archetypes.json"); }
export function readInstalledPositionContract(): unknown { return readSnapshot("installed-position-contract.json"); }
export function readCompletionEvidenceContract(): unknown { return readSnapshot("completion-evidence-contract.json"); }

/** One prior canonical contract this package has ever shipped, and the controller version it shipped in. */
export interface HistoricalContractSnapshot { readonly version: string; readonly contract: unknown; }

// Every version whose role-loop-archetypes.json or installed-position-contract.json
// this package still recognizes as a byte-for-byte-shipped prior canonical
// contract, oldest first. A caller's exact copy of one of these -- never a
// loose match -- is accepted on read; see index.ts. Extend this list --
// never replace or remove an entry -- the next time either contract's
// content changes. Currently only 0.9.10, npm's latest published version
// of this package, is known.
const historicalContractVersions = ["0.9.10"] as const;

export function readHistoricalRoleLoopContracts(): readonly HistoricalContractSnapshot[] {
  return historicalContractVersions.map((version) => ({ version, contract: readSnapshot(`historical/${version}/role-loop-archetypes.json`) }));
}
export function readHistoricalInstalledPositionContracts(): readonly HistoricalContractSnapshot[] {
  return historicalContractVersions.map((version) => ({ version, contract: readSnapshot(`historical/${version}/installed-position-contract.json`) }));
}
