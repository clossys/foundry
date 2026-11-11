/**
 * Each agent verb's share of the strict findings `clossys check --slots` and `clossys check --suites --strict`
 * report, so `direct --check`, `design --check`, `write --check` and the bare `publish` dry run cannot exit 0
 * while the strict checks fail on that agent's records.
 *
 * Attribution is by owner, never by severity downgrade:
 * - slot integrity rows (`check --slots`): the row's own agent; a slot-model input error is every agent's,
 *   except the Designer references manifest, which is the Designer's;
 * - Director: also every error of the Director slots suite (`check --suites`: D-SPEC and the cell checks);
 * - Designer: also every ref-verbatim finding (the Designer's own check, already enforcing in `clossys check`);
 * - Publisher: every error of the Publisher's page conformance suite (archetype, format, links, meta, copy);
 * - Writer: the conformance errors about copy the Writer supplies (copy binding, copy fit, page meta and nav labels).
 * The pure functions below decide attribution; `strictShare` gathers the reports.
 */
import { join } from "node:path";
import type { AgentKind } from "../agents.js";
import { archetypeSuite, directorSuite, refVerbatimSuite, type SuiteReport } from "../check/record-suites.js";
import { runSlotResolve, type SlotResolveReport } from "../check/slot-resolve.js";

export interface StrictFinding { code: string; where: string; message: string }
export interface StrictShare { findings: StrictFinding[]; limits: string[] }

/** The conformance checks whose errors are about Writer-supplied copy. */
export const WRITER_CONFORMANCE_CHECKS = Object.freeze(["copy", "copy-fit", "meta"]);

type SlotReport = Pick<SlotResolveReport, "findings">;

/** The agent's slot-integrity findings: rows are `<agent>:<slot>`; model input errors have no row. */
export function slotShare(report: SlotReport, agent: AgentKind): StrictFinding[] {
  const findings: StrictFinding[] = [];
  for (const finding of report.findings as readonly { rule: string; message: string; path?: string }[]) {
    const path = finding.path ?? "";
    const owner = /^([a-z]+):/.exec(path)?.[1] ?? (path.startsWith("agents/") ? path.split("/")[1] : undefined);
    const references = /references manifest/i.test(finding.message);
    const mine = owner !== undefined ? owner === agent : references ? agent === "designer" : true;
    if (mine) findings.push({ code: `slots/${finding.rule}`, where: path || "slot model", message: finding.message });
  }
  return findings;
}

/** The agent's share of the strict page conformance suite: every error for the Publisher, copy errors for the Writer. */
export function conformanceShare(suite: Pick<SuiteReport, "status" | "findings" | "error">, agent: AgentKind): StrictFinding[] {
  if (agent !== "publisher" && agent !== "writer") return [];
  if (suite.status === "error") return [{ code: "suites/archetypes-unavailable", where: "archetypes", message: `Page conformance could not run: ${suite.error ?? "unknown error"}` }];
  return suite.findings
    .filter(finding => finding.severity === "error")
    .filter(finding => agent === "publisher" || WRITER_CONFORMANCE_CHECKS.includes(finding.code.split("/")[0]!))
    .map(finding => ({ code: `suites/${finding.code}`, where: finding.where, message: finding.message }));
}

/** The Designer's ref-verbatim findings (`clossys check` always enforces them). */
export function refVerbatimShare(suite: Pick<SuiteReport, "status" | "findings" | "error">, agent: AgentKind): StrictFinding[] {
  if (agent !== "designer") return [];
  if (suite.status === "error") return [{ code: "suites/ref-verbatim-unavailable", where: "ref-verbatim", message: `Ref-verbatim could not run: ${suite.error ?? "unknown error"}` }];
  return suite.findings.filter(finding => finding.severity === "error").map(finding => ({ code: `suites/ref-verbatim/${finding.code}`, where: finding.where, message: finding.message }));
}

/** The Director's director-slots suite errors (`check --suites`). */
export function directorSlotsShare(suite: Pick<SuiteReport, "status" | "findings" | "error">, agent: AgentKind): StrictFinding[] {
  if (agent !== "director") return [];
  if (suite.status === "error") return [{ code: "suites/director-slots-unavailable", where: "director-slots", message: `Director slots suite could not run: ${suite.error ?? "unknown error"}` }];
  return suite.findings.filter(finding => finding.severity === "error").map(finding => ({ code: `suites/director-slots/${finding.code}`, where: finding.where, message: finding.message }));
}

const message = (error: unknown) => error instanceof Error ? error.message : String(error);

/** Run the strict checks this agent has a share in, over the consumer at `<root>/clossys`. A check that cannot run is a limit. */
export async function strictShare(root: string, agent: AgentKind): Promise<StrictShare> {
  const findings: StrictFinding[] = [], limits: string[] = [];
  try { findings.push(...slotShare(await runSlotResolve(join(root, "clossys")), agent)); }
  catch (error) { limits.push(`strict slots: ${message(error)}`); }
  if (agent === "publisher" || agent === "writer") {
    try { findings.push(...conformanceShare(await archetypeSuite(root, true), agent)); }
    catch (error) { limits.push(`strict page conformance: ${message(error)}`); }
  }
  if (agent === "director") {
    try { findings.push(...directorSlotsShare(await directorSuite(root), agent)); }
    catch (error) { limits.push(`strict director slots: ${message(error)}`); }
  }
  if (agent === "designer") {
    try { findings.push(...refVerbatimShare(await refVerbatimSuite(root), agent)); }
    catch (error) { limits.push(`ref-verbatim: ${message(error)}`); }
  }
  return { findings, limits };
}

/** One summary line for a verb's message. */
export function strictShareLine(share: StrictShare): string {
  const counts = new Map<string, number>();
  for (const finding of share.findings) counts.set(finding.code, (counts.get(finding.code) ?? 0) + 1);
  return `Strict checks (this agent's share of check --slots / --suites --strict): ${share.findings.length} finding(s)${counts.size ? ` (${[...counts].map(([code, count]) => `${code} ${count}`).join(", ")})` : ""}`;
}
