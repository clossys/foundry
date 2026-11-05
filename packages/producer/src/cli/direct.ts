import { join } from "node:path";
import type { Cell, FactsGateResult, WontClaimResult } from "@clossys/director";
import { agentModule } from "../server/cells.js";
import { directorRef, pinnedStrategyModel, readDirectorEvidence, readPinnedDirector } from "../records/director-pinned.js";
import { readPinned } from "../records/pinned.js";
import { hasSlotModel, readIa } from "../records/slots.js";
import type { CliArgs } from "./args.js";
import type { CliResult } from "./main.js";
import { emitProjection } from "./projection.js";

export interface DirectFinding { code: string; slot: string; path?: string; line?: number; message: string }
export interface DirectSummary {
  slots: number; pinned: number; unpinned: string[]; todoOwner: number;
  todoOwnerLocations: { id: string; version: number; file: string; line: number }[];
}
export interface DirectResult extends CliResult {
  summary?: DirectSummary;
  findings?: DirectFinding[];
  grounding?: FactsGateResult;
  wontClaim?: WontClaimResult;
  limits: string[];
}

const OWNER = /\bTODO-OWNER\b/;
const bullets = (cell: Cell) => [...cell.direction, ...cell.because, ...cell.watch];

/** The pinned Director set, as one deterministic projection: what every downstream agent reads. */
function directorProjection(cells: readonly Cell[], contracts: Map<string, unknown>) {
  return {
    schemaVersion: 1 as const, agent: "director" as const,
    slots: cells.map(cell => ({ id: cell.id, version: cell.version, ref: directorRef(cell), path: cell.path,
      question: (contracts.get(cell.id) as { question?: string } | undefined)?.question ?? null,
      direction: cell.direction.map(({ key, text }) => ({ ...(key ? { key } : {}), text })),
      watch: cell.watch.map(({ key, text }) => ({ ...(key ? { key } : {}), text })), feeds: cell.feeds })),
  };
}

/**
 * Deterministic Director verb over the slot model (`clossys/agents/director`): `--brief` and the
 * default compile print the pinned set; `--check` runs the Director's own contract, evidence,
 * grounding and won't-claim checks. It generates no content and writes only to `--out`.
 */
export async function runDirect(args: CliArgs, root: string): Promise<DirectResult> {
  const result = { verb: "direct" as const, root, check: args.check };
  const consumer = join(root, "clossys");
  try {
    if (!hasSlotModel(consumer) || !readIa(consumer, "director")) throw new Error("clossys/agents/director/ia.json is missing");
    const director = await readPinnedDirector(consumer);
    const todoOwner = director.cells.flatMap(cell => bullets(cell).filter(bullet => OWNER.test(`${bullet.key ?? ""} ${bullet.text}`))
      .map(bullet => ({ id: cell.id, version: cell.version, file: cell.path, line: bullet.line })));
    const summary: DirectSummary = { slots: director.set.pinned.length + director.set.unpinned.length + director.set.issues.length,
      pinned: director.cells.length, unpinned: [...director.set.unpinned], todoOwner: todoOwner.length, todoOwnerLocations: todoOwner };
    const contractDocs = new Map(director.set.pinned.map(candidate => [candidate.id, candidate.doc.contract as unknown]));
    if (!args.check) {
      const projection = directorProjection(director.cells, contractDocs);
      const emitted = await emitProjection(args, root, "director", projection);
      const broken = director.set.issues.length + director.unreadable.length;
      return { ...result, exitCode: broken ? 1 : 0, summary, limits: [], ...(args.brief ? { brief: projection } : { compilation: projection }), message: [
        `direct: ${args.brief ? "brief" : "compiled"} ${director.cells.length} pinned Director slot(s)${emitted ? ` to ${emitted}` : ""}; ${summary.unpinned.length} unpinned; ${todoOwner.length} TODO-OWNER line(s)`,
        ...director.set.issues.map(issue => `${issue.reason}: ${issue.message}`),
        ...director.unreadable.map(row => `unreadable: ${row.message}`),
        ...(args.out ? [] : [JSON.stringify(projection, null, 2)]),
      ].join("\n") };
    }

    const findings: DirectFinding[] = [];
    for (const issue of director.set.issues) findings.push({ code: issue.reason, slot: issue.slot, message: issue.message });
    for (const row of director.unreadable) findings.push({ code: "unreadable-candidate", slot: row.slot, path: row.path, message: row.message });
    // The slot's own contract: every mustContain key is a Direction key of its pinned candidate.
    for (const cell of director.cells) {
      const contract = contractDocs.get(cell.id) as { mustContain?: { key: string }[] } | undefined;
      for (const { key } of contract?.mustContain ?? []) {
        if (!cell.direction.some(bullet => bullet.key === key)) findings.push({ code: "missing-contract-key", slot: cell.id, path: cell.path, message: `Direction has no ${key}: bullet` });
      }
    }
    // Evidence: every finding a pinned candidate cites exists and parses.
    const evidence = await readDirectorEvidence(consumer);
    for (const issue of evidence.issues) findings.push({ code: "invalid-evidence", slot: "evidence", path: `clossys/evidence/director/${issue.file}`, line: issue.line, message: issue.detail });
    const known = new Set(evidence.findings.map(finding => finding.id));
    for (const cell of director.cells) {
      const cited = [...cell.cites, ...bullets(cell).flatMap(bullet => bullet.refs)];
      for (const ref of cited) if (ref.kind === "finding" && !known.has(ref.id)) findings.push({ code: "unknown-evidence", slot: cell.id, path: cell.path, message: `finding:${ref.id} is not in clossys/evidence/director` });
    }
    // Grounding and won't-claim over the pinned copy that ships: the Writer's pinned candidates.
    // Lexicon slots hold the prohibited terms themselves, so the Writer's own derivation rule skips them.
    const api = await agentModule("director", "index.js");
    const copy = readIa(consumer, "writer") ? readPinned(consumer, "writer").pinned.filter(candidate => !candidate.id.startsWith("lexicon.")).map(candidate => ({ path: candidate.path, content: candidate.bytes })) : [];
    const grounding: FactsGateResult = api.checkGrounding(copy, evidence.findings);
    const wontClaim: WontClaimResult = api.checkWontClaimDrift(copy, pinnedStrategyModel(consumer, director.cells, evidence.findings));
    for (const finding of grounding.findings) findings.push({ code: finding.rule, slot: "writer", path: finding.file, line: finding.line, message: finding.message });
    for (const finding of wontClaim.findings) findings.push({ code: "wont-claim", slot: "writer", path: finding.file, line: finding.line, message: finding.message });
    const limits = [...wontClaim.indeterminateReasons];
    if (!copy.length) limits.push("grounding: the consumer has no pinned Writer copy to check");
    const exitCode = limits.length ? 2 : findings.length ? 1 : 0;
    return { ...result, exitCode, summary, findings, grounding, wontClaim, limits, message: [
      `direct: ${exitCode === 2 ? "could not run in full" : findings.length ? `${findings.length} finding(s)` : "clean"}`,
      `Director: ${director.cells.length} pinned, ${summary.unpinned.length} unpinned, ${todoOwner.length} TODO-OWNER line(s); ${evidence.findings.length} evidence finding(s).`,
      `Grounding: ${grounding.findings.length} finding(s), ${grounding.filesScanned} pinned Writer file(s).`,
      `Won't claim: ${wontClaim.findings.length} finding(s), ${wontClaim.filesScanned} file(s), ${wontClaim.unchecked.length} unquoted prohibition(s) unchecked.`,
      ...findings.map(finding => `[${finding.code}] ${finding.path ?? finding.slot}${finding.line ? `:${finding.line}` : ""} ${finding.message}`),
      ...limits.map(limit => `Limit: ${limit}`),
    ].join("\n") };
  } catch (error) {
    const limit = error instanceof Error ? error.message : String(error);
    return { ...result, exitCode: 2, limits: [limit], message: `direct: could not run: ${limit}` };
  }
}
