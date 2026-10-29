import { discoverBriefContracts } from "../brief-contracts.js";
import { blocks, checkCell, checkCoherence, completion, strategyStatus, type CheckFinding, type StatusReport } from "../checks/index.js";
import type { StrategyModel } from "../format/types.js";
import { readStrategyRoot } from "../store.js";
import type { ReadArgs, ReadResult } from "./read.js";
import { persistReport } from "./reports.js";

function result(data: unknown, ready: boolean, text: string[]): ReadResult { return { code: ready ? 0 : 1, data, text }; }
function findingText(findings: readonly CheckFinding[]): string[] {
  return findings.map(finding => `[${finding.rule} ${finding.severity}${finding.severity === "judge" ? `: ${finding.verdict ?? "not judged"}` : ""}] ${finding.cell ? `${finding.cell}: ` : ""}${finding.message}`);
}
function quality(model: StrategyModel, targets: string[]) {
  const cells = targets.length ? targets.map(target => {
    const [id, version] = target.split("@");
    const cell = model.cells.filter(cell => cell.id === id && (version === undefined || cell.version === Number(version))).sort((a, b) => b.version - a.version)[0];
    if (!cell) throw new Error(`Cell not found: ${target}`);
    return cell;
  }) : [...model.cells].sort((a, b) => a.id.localeCompare(b.id) || a.version - b.version);
  return { cells: cells.map(cell => ({ cell: cell.id, version: cell.version })), findings: cells.flatMap(cell => checkCell(cell, { model })) };
}
function progress(model: StrategyModel, full: StatusReport, core: StatusReport): string {
  const name = (id: string) => model.catalog.ia.nodes.find(node => node.id === id)?.name ?? id;
  const unlocked = full.l1.filter(group => group.unlocked).map(group => name(group.id));
  const requests = model.requests.filter(request => request.status === "open" || request.status === "drafted").length;
  return `MVS ${core.counts.fresh}/${core.counts.total} · L1 unlocked ${full.counts.unlockedL1}/${full.l1.length}${unlocked.length ? ` (${unlocked.join(", ")})` : ""} · L2 coherent ${full.counts.coherentL2}/${full.l2.length} · active ${full.counts.active}/${full.counts.total} · requests ${requests} open · next: ${full.nextUnlock ? name(full.nextUnlock) : "none"}`;
}
function related(finding: CheckFinding, ids: Set<string>): boolean {
  return finding.cell !== undefined && ids.has(finding.cell) || finding.cells?.some(id => ids.has(id)) === true || finding.cell === undefined && finding.cells === undefined;
}

/** Presentation and CLI report persistence around the canonical pure checks. */
export function executeChecksCommand(args: ReadArgs): ReadResult {
  const model = readStrategyRoot(args.root);
  if (model.issues.length) throw new Error(model.issues.map(issue => `${issue.path}:${issue.line}: ${issue.message}`).join("; "));
  const discovered = discoverBriefContracts(args.root, model.catalog);
  if (discovered.issues.length) throw new Error(discovered.issues.map(issue => `${issue.path}: ${issue.message}`).join("; "));
  const options = { contracts: discovered.contracts };
  if (args.command === "check" || args.command === "cell" && args.verb === "create") {
    const report = quality(model, args.targets);
    if (args.command === "check") persistReport(args.root, "cell-quality", report);
    return result(report, !report.findings.some(blocks), [`Quality: ${report.cells.length} cell version(s).`, ...findingText(report.findings)]);
  }
  if (args.command === "cohere") {
    const groups = model.catalog.ia.nodes.flatMap(node => node.children);
    for (const id of args.targets) if (!groups.some(group => group.id === id)) throw new Error(`Unknown L2 id: ${id}`);
    const ids = new Set(groups.filter(group => !args.targets.length || args.targets.includes(group.id)).flatMap(group => group.leaves));
    const report = checkCoherence(model, "full", options).filter(finding => finding.rule !== "C4" && related(finding, ids));
    persistReport(args.root, "coherence", report);
    return result(report, !report.some(blocks), ["Coherence: C1–C3.", ...findingText(report)]);
  }
  if (args.command === "complete") {
    const report = completion(model, options);
    persistReport(args.root, "completion", report);
    const ready = args.level === "mvs" ? report.mvs : args.level === "l0" ? report.l0Clean : report.complete;
    return result(report, ready, [`${args.level}: ${ready ? "ready" : "not ready"}`, `Storyline critic: ${report.storyline.critic}`, ...findingText(report.findings)]);
  }
  if (args.command === "status") {
    const report = strategyStatus(model, { scope: args.scope }, options);
    const levels = completion(model, options);
    const findings = [...report.findings, ...report.cells.flatMap(cell => cell.findings)];
    return result(report, !findings.some(blocks), [progress(model, levels, levels.core), `L0: ${report.l0Clean ? "clean" : "not clean"} · Storyline critic: ${report.storyline.critic}`, ...findingText(findings)]);
  }
  if (args.command === "cell") {
    const id = args.targets[0]!;
    const report = strategyStatus(model, { scope: "full" }, options);
    if (args.verb === "normalize") return result(report, report.l0Clean, [`L0: ${report.l0Clean ? "clean" : "not clean"}`, `Storyline critic: ${report.storyline.critic}`, ...findingText(report.findings)]);
    const groups = args.verb === "cohere" ? report.l2 : report.l1;
    const group = groups.find(group => group.id === id);
    if (!group) throw new Error(`Unknown ${args.verb === "cohere" ? "L2" : "L1"} id: ${id}`);
    const ready = "coherent" in group ? group.coherent : group.unlocked;
    const ids = new Set(model.catalog.cells.filter(cell => cell.id.startsWith(`${id}.`)).map(cell => cell.id));
    const data = { ...group, cells: report.cells.filter(cell => ids.has(cell.id)), findings: report.findings.filter(finding => related(finding, ids)) };
    return result(data, ready, [`${id}: ${ready ? args.verb === "cohere" ? "coherent" : "unlocked" : "not ready"}`, ...findingText(data.findings)]);
  }
  throw new Error(`Expected a status, cell, check, cohere or complete command`);
}
