/**
 * `clossys check --engine` (engine.md "Checks"): on a workspace root, the event chain verifies (engine/chain.ts
 * verifyChain), the stored index agrees with a rebuild of the log plus the records (engine/derived.ts), and every
 * record the log names holds the bytes its last event logged. Read-only: it writes nothing, not even the index.
 */
import { resolve } from "node:path";
import { verifyChain, type ChainIssue } from "./chain.js";
import { indexAgreement, recordDrift } from "./derived.js";

export interface EngineCheckReport {
  readonly check: "engine";
  readonly root: string;
  readonly ok: boolean;
  readonly events: number;
  readonly head: string | null;
  readonly chain: readonly ChainIssue[];
  /** Absent index with an empty log agrees; any other difference is a line here. */
  readonly index: readonly string[];
  /** Records changed outside the engine: bytes on disk are not the bytes their last event logged. */
  readonly drift: readonly string[];
}

export function runEngineCheck(root: string): EngineCheckReport {
  const at = resolve(root);
  const chain = verifyChain(at);
  const agreement = indexAgreement(at);
  const drift = recordDrift(agreement.rebuilt);
  return {
    check: "engine", root: at, ok: chain.ok && agreement.agrees && drift.length === 0,
    events: chain.count, head: chain.head, chain: chain.issues, index: agreement.diffs, drift,
  };
}

export function formatEngineCheck(report: EngineCheckReport): string {
  const head = `engine: ${report.ok ? "pass" : "fail"} (${report.events} event(s), ${report.chain.length} chain issue(s), ${report.index.length} index difference(s), ${report.drift.length} drifted record(s))`;
  return [
    head,
    ...report.chain.map(issue => `  chain ${issue.code}: ${issue.message}`),
    ...report.index.map(line => `  index: ${line}`),
    ...report.drift.map(line => `  drift: ${line}`),
  ].join("\n");
}
