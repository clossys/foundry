import type { StrategyModel } from "../format/types.js";
import { EVIDENCE_PREFIX, readStrategyRoot } from "../store.js";
import type { DirectorStoreReader } from "../store-io.js";

/** Grounding needs only the finding registry (the consumer's Director evidence), so slot issues do not block it. */
export function readGroundRoot(root: string, store: DirectorStoreReader): { model: StrategyModel; issues: string[] } {
  const model = readStrategyRoot(root, store);
  const issues = model.issues.filter(i => i.path === "." || i.path === EVIDENCE_PREFIX || i.path.startsWith(`${EVIDENCE_PREFIX}/`))
    .map(i => `${i.path}:${i.line}: ${i.message}`);
  if (model.findings.length === 0) issues.push(`${EVIDENCE_PREFIX}/: no valid findings to read`);
  return { model, issues };
}
