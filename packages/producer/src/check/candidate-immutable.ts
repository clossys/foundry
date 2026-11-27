/**
 * `candidate.immutable` (system.md 6.2, 7, 9): a candidate is never edited after submit.
 *
 * Reads every Producer ledger entry (`clossys/agents/producer/ledger.*\/entries/*.json`) and each step's
 * `wrote` list. A written file under `<agent>/<slot-id>/candidates/` with a recorded sha256 must still exist
 * with exactly those bytes; a retired candidate keeps its file (system.md 7), so a deleted one fails too.
 * When two entries recorded different digests for the same candidate, the candidate was rewritten: that fails.
 */
import { AGENT_LISTS } from "../agent-lists.generated.js";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { CANDIDATE_NAME } from "../records/candidate.js";
import { sha256Hex } from "../records/hash.js";
import type { LedgerEntry } from "../records/types.js";
import { runOf, type TargetCheckRun, type TargetFinding } from "./pins-resolve.js";

export const CANDIDATE_IMMUTABLE = "candidate.immutable";

const CANDIDATE_WRITE = new RegExp(String.raw`^(${AGENT_LISTS.live.join("|")})\/[a-z][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*){1,3}\/candidates\/([^/]+)$`);
const isDir = (path: string): boolean => existsSync(path) && statSync(path).isDirectory();

/** Every ledger entry file, sorted by path. */
export function ledgerEntryFiles(root: string): string[] {
  const producer = join(root, "clossys", "agents", "producer");
  if (!isDir(producer)) return [];
  const files: string[] = [];
  for (const folder of readdirSync(producer).filter(name => name.startsWith("ledger.")).sort()) {
    const entries = join(producer, folder, "entries");
    if (isDir(entries)) for (const name of readdirSync(entries).filter(file => file.endsWith(".json")).sort()) files.push(join(entries, name));
  }
  return files;
}

export function checkCandidateImmutable(root: string): TargetCheckRun {
  const findings: TargetFinding[] = [];
  /** candidate path (relative to clossys/agents/) -> first recorded digest and the entry that recorded it. */
  const recorded = new Map<string, { sha256: string; entry: string }>();
  for (const file of ledgerEntryFiles(root)) {
    let entry: LedgerEntry;
    try { entry = JSON.parse(readFileSync(file, "utf8")) as LedgerEntry; } catch {
      findings.push({ check: CANDIDATE_IMMUTABLE, subject: file, detail: "ledger entry is not JSON" });
      continue;
    }
    for (const step of Array.isArray(entry.steps) ? entry.steps : []) {
      for (const wrote of Array.isArray(step.wrote) ? step.wrote : []) {
        const match = CANDIDATE_WRITE.exec(wrote.file);
        if (!match || !CANDIDATE_NAME.test(match[3]!) || wrote.sha256 === null) continue;
        const prior = recorded.get(wrote.file);
        if (prior && prior.sha256 !== wrote.sha256) {
          findings.push({ check: CANDIDATE_IMMUTABLE, subject: wrote.file, detail: `ledger ${entry.id} records ${wrote.sha256.slice(0, 12)}, but ${prior.entry} recorded ${prior.sha256.slice(0, 12)}: the candidate was rewritten` });
        } else if (!prior) recorded.set(wrote.file, { sha256: wrote.sha256, entry: entry.id });
      }
    }
  }
  for (const [rel, { sha256, entry }] of [...recorded].sort(([a], [b]) => a.localeCompare(b))) {
    const path = join(root, "clossys", "agents", rel);
    if (!existsSync(path)) {
      findings.push({ check: CANDIDATE_IMMUTABLE, subject: rel, detail: `ledger ${entry} recorded it at submit, but the file is gone (retire keeps the file)` });
      continue;
    }
    const now = sha256Hex(readFileSync(path));
    if (now !== sha256) findings.push({ check: CANDIDATE_IMMUTABLE, subject: rel, detail: `sha256 ${now.slice(0, 12)} differs from ${sha256.slice(0, 12)} recorded by ledger ${entry} at submit` });
  }
  return runOf(CANDIDATE_IMMUTABLE, findings);
}
