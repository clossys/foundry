import type { StrategyModel } from "../format/types.js";
import { readStrategyRoot } from "../store.js";

/** Grounding needs only the finding registry, so tree/cell issues do not block it. */
export function readGroundRoot(root: string): { model: StrategyModel; issues: string[] } {
  const model = readStrategyRoot(root);
  const issues = model.issues.filter(i => i.path === "." || i.path === "findings" || i.path.startsWith("findings/"))
    .map(i => `${i.path}:${i.line}: ${i.message}`);
  if (model.findings.length === 0) issues.push("findings/: no valid findings to read");
  return { model, issues };
}
