/**
 * Record suites for `clossys check`: Publisher's page conformance over the consumer's
 * page records, the Writer and Director slot suites over their active cells, and the
 * agents' slot contracts against the slot engine's `clossys.slot-contract/1` schema.
 *
 * Each suite is the owning package's own check, loaded from its shipped dist; Producer
 * only gathers inputs and prints. Report only: findings never change the exit code
 * unless `strict` is set.
 */
import { agentModule, readCells } from "../server/cells.js";
import { readPublisher, readWriter } from "../publish/site-source.js";
import { writerText } from "../publish/site-plan.js";
import { validateSlotContract } from "../records/validate.js";

export interface SuiteFinding { readonly severity: "error" | "warning" | "info"; readonly where: string; readonly code: string; readonly message: string }

export interface SuiteReport {
  readonly suite: "archetypes" | "writer-slots" | "director-slots" | "slot-contracts";
  readonly status: "ran" | "error";
  /** Pages, cells or contracts the suite looked at. */
  readonly checked: number;
  readonly totals: Readonly<Record<SuiteFinding["severity"], number>>;
  readonly findings: readonly SuiteFinding[];
  readonly error?: string;
  /** The suite's own verdict where it has one (Publisher page conformance). */
  readonly exitCode?: 0 | 1;
}

export interface RecordSuitesReport {
  readonly schemaVersion: 1;
  readonly root: string;
  readonly strict: boolean;
  /** 1 only when strict and a suite failed or reported an error; otherwise 0. */
  readonly exitCode: 0 | 1;
  readonly suites: readonly SuiteReport[];
}

const isRecord = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

function report(suite: SuiteReport["suite"], checked: number, findings: SuiteFinding[]): SuiteReport {
  const totals = { error: 0, warning: 0, info: 0 };
  for (const finding of findings) totals[finding.severity]++;
  return { suite, status: "ran", checked, totals, findings };
}
const failed = (suite: SuiteReport["suite"], error: unknown): SuiteReport =>
  ({ suite, status: "error", checked: 0, totals: { error: 0, warning: 0, info: 0 }, findings: [], error: message(error) });

/**
 * The consumer's page records: the compiled content map, its route pack, Writer's
 * section bindings and each page cell's Copy bullets resolved to Writer text. An
 * archetype is taken only from the entry or route that declares one; nothing is inferred.
 */
export async function consumerPageRecords(root: string): Promise<{ records: unknown[]; routes: string[]; directorCells: string[] }> {
  const publisher = await readPublisher(root);
  const writer = await readWriter(root);
  const text = writerText(writer);
  const pageCopy: Record<string, Record<string, string>> = {};
  const pages: Record<string, { archetype?: string; format?: string }> = {};
  for (const entry of publisher.entries as readonly Record<string, any>[]) {
    const id = String(entry.id);
    const cell = publisher.cellOfEntry[id];
    const copy: Record<string, string> = {};
    for (const bullet of cell ? publisher.copy[cell] ?? [] : []) {
      const value = text.alias(bullet.cell);
      if (value !== undefined) copy[bullet.key] = value;
    }
    pageCopy[id] = copy;
    const route = publisher.routes.find(row => isRecord(row) && row.instanceId === id) as Record<string, any> | undefined;
    const archetype = [entry.archetype, entry.source?.archetype, route?.archetype].find(value => typeof value === "string");
    const format = [entry.pageFormat, route?.pageFormat].find(value => typeof value === "string");
    if (archetype || format) pages[id] = { ...(archetype ? { archetype } : {}), ...(format ? { format } : {}) };
  }
  const archetypes = await agentModule("publisher", "archetypes/index.js");
  const records = archetypes.pageRecordsFromPublication({
    contentMap: { publicationId: publisher.publicationId, format: publisher.format, entries: publisher.entries },
    routePack: { routes: publisher.routes }, sectionBindings: writer.sections, pageCopy, pages,
  });
  const routes = (publisher.routes as readonly unknown[]).filter(isRecord).map(row => row.path).filter((path): path is string => typeof path === "string");
  const directorCells = (await readCells(root, "director", true)).map(cell => cell.id);
  return { records, routes, directorCells };
}

async function archetypeSuite(root: string, strict: boolean): Promise<SuiteReport> {
  const set = await consumerPageRecords(root);
  const archetypes = await agentModule("publisher", "archetypes/index.js");
  const result = archetypes.checkPageRecords(set, { strict });
  const findings: SuiteFinding[] = result.findings.map((finding: any) => ({
    severity: finding.severity, code: `${finding.check}/${finding.code}`, message: finding.message,
    where: `${finding.page}${typeof finding.section === "number" ? `#${finding.section}${finding.role ? ` (${finding.role})` : ""}` : ""}`,
  }));
  return { ...report("archetypes", set.records.length, findings), exitCode: result.exitCode };
}

const files = async (root: string, kind: "writer" | "director") =>
  (await readCells(root, kind, true)).map(cell => ({ path: cell.path, text: cell.source }));

async function writerSuite(root: string): Promise<SuiteReport> {
  const checks = await agentModule("writer", "slot-contracts/checks.js");
  const cells = await files(root, "writer");
  const director = await files(root, "director").catch(() => []);
  const voice = director.length ? checks.directorVoiceFromFiles(director).voice : undefined;
  const result = checks.runWriterSuite({ cells, ...(voice ? { director: voice } : {}) });
  return report("writer-slots", cells.length, result.findings.map((finding: any) => ({
    severity: finding.severity === "error" ? "error" : "warning", code: finding.check, message: finding.message,
    where: `${finding.slot}${finding.path ? ` ${finding.path}` : ""}`,
  })));
}

async function directorSuite(root: string): Promise<SuiteReport> {
  const checks = await agentModule("director", "slot-contracts/checks.js");
  const cells = await files(root, "director");
  const result = checks.runDirectorSuite({ cells });
  // Director findings carry no severity: each one is a contract miss.
  return report("director-slots", cells.length, result.findings.map((finding: any) => ({
    severity: "error", code: finding.check, message: finding.message, where: `${finding.slot}${finding.path ? ` ${finding.path}` : ""}`,
  })));
}

/** Writer and Director contracts, projected by their own packages, against the shared schema. */
export async function slotContractSuite(): Promise<SuiteReport> {
  const findings: SuiteFinding[] = [];
  let checked = 0;
  for (const [kind, load] of [["writer", "loadWriterContracts"], ["director", "loadDirectorContracts"]] as const) {
    const format = await agentModule(kind, "slot-contracts/format.js");
    for (const contract of format[load]().slots) {
      checked++;
      const record = format.toSlotContractRecord(contract);
      const result = validateSlotContract(record);
      if (!result.ok) for (const issue of result.issues) findings.push({ severity: "error", where: `${kind}:${record.slot}`, code: "slot-contract/schema", message: `${issue.path} ${issue.message}` });
    }
  }
  return report("slot-contracts", checked, findings);
}

export async function runRecordSuites(rootIn: string, options: { strict?: boolean } = {}): Promise<RecordSuitesReport> {
  const strict = options.strict === true;
  const run = (suite: SuiteReport["suite"], body: () => Promise<SuiteReport>) => body().catch(error => failed(suite, error));
  const suites = [
    await run("archetypes", () => archetypeSuite(rootIn, strict)),
    await run("writer-slots", () => writerSuite(rootIn)),
    await run("director-slots", () => directorSuite(rootIn)),
    await run("slot-contracts", () => slotContractSuite()),
  ];
  const failing = suites.some(suite => suite.status === "error" || suite.totals.error > 0 || suite.exitCode === 1);
  return { schemaVersion: 1, root: rootIn, strict, exitCode: strict && failing ? 1 : 0, suites };
}

const LABEL: Record<SuiteReport["suite"], string> = { "archetypes": "Archetypes", "writer-slots": "Writer slots", "director-slots": "Director slots", "slot-contracts": "Slot contracts" };
const UNIT: Record<SuiteReport["suite"], string> = { "archetypes": "pages", "writer-slots": "cells", "director-slots": "cells", "slot-contracts": "contracts" };

/** Human summary: every archetype finding, at most `limit` per other suite. */
export function recordSuitesSummary(result: RecordSuitesReport, limit = 20): string {
  const lines = [`Record suites (${result.strict ? "strict" : "report only"}): ${result.root}`];
  for (const suite of result.suites) {
    if (suite.status === "error") { lines.push(`  ${LABEL[suite.suite]}: error: ${suite.error}`); continue; }
    lines.push(`  ${LABEL[suite.suite]}: ${suite.checked} ${UNIT[suite.suite]}, errors=${suite.totals.error} warnings=${suite.totals.warning} info=${suite.totals.info}`);
    const shown = suite.suite === "archetypes" ? suite.findings : suite.findings.slice(0, limit);
    for (const finding of shown) lines.push(`    ${finding.severity} ${finding.where} [${finding.code}] ${finding.message}`);
    if (shown.length < suite.findings.length) lines.push(`    ... ${suite.findings.length - shown.length} more (--json for all)`);
  }
  return lines.join("\n");
}

