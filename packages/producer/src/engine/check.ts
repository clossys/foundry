/**
 * `clossys check --engine` (engine.md "Checks"): on a workspace root, the event chain verifies (engine/chain.ts
 * verifyChain), the stored index agrees with a rebuild of the log plus the records (engine/derived.ts), and every
 * record the log names holds the bytes its last event logged, and the workspace keeps the consumer layout: engine state
 * lives only in the contract's state folder (STATE_DIR), so a root LEGACY_STATE_DIR (a file, folder or link) fails
 * (`layoutFindings`). Read-only: it writes nothing, not even the index.
 */
import { lstatSync } from "node:fs";
import { join, resolve } from "node:path";
import { verifyChain, type ChainIssue } from "./chain.js";
import { indexAgreement, recordDrift } from "./derived.js";
import { LEGACY_STATE_DIR, STATE_DIR } from "./state-dir.js";

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
  /** Consumer-layout findings: a root LEGACY_STATE_DIR, which the contract does not allow beside STATE_DIR. */
  readonly layout: readonly string[];
}

/** The consumer-layout findings of a workspace root: one line when LEGACY_STATE_DIR exists there, in any form. */
export function layoutFindings(root: string): string[] {
  try { lstatSync(join(root, LEGACY_STATE_DIR)); } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return [];
    throw error;
  }
  return [`${LEGACY_STATE_DIR}/ exists at the workspace root; the consumer layout keeps engine state only in ${STATE_DIR}/ (move it: clossys migrate state --apply)`];
}

export function runEngineCheck(root: string): EngineCheckReport {
  const at = resolve(root);
  const chain = verifyChain(at);
  const agreement = indexAgreement(at);
  const drift = recordDrift(agreement.rebuilt);
  const layout = layoutFindings(at);
  return {
    check: "engine", root: at, ok: chain.ok && agreement.agrees && drift.length === 0 && layout.length === 0,
    events: chain.count, head: chain.head, chain: chain.issues, index: agreement.diffs, drift, layout,
  };
}

export function formatEngineCheck(report: EngineCheckReport): string {
  const head = `engine: ${report.ok ? "pass" : "fail"} (${report.events} event(s), ${report.chain.length} chain issue(s), ${report.index.length} index difference(s), ${report.drift.length} drifted record(s), ${report.layout.length} layout finding(s))`;
  return [
    head,
    ...report.chain.map(issue => `  chain ${issue.code}: ${issue.message}`),
    ...report.index.map(line => `  index: ${line}`),
    ...report.drift.map(line => `  drift: ${line}`),
    ...report.layout.map(line => `  layout: ${line}`),
  ].join("\n");
}
