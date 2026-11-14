/**
 * The constitution runner (`clossys check --constitution [--rule Rxx] [--json]`): reads the agent
 * trees once, runs every registered check over all records, and reports every row grouped by rule
 * with counts per rule and agent. Pure compute: no browser, no LLM, no network, no writes. Any row,
 * pending rows included, fails the run, except rows of `building` checks (section 4), which are
 * reported and fail only under `strict`.
 */
import { buildContext, type ContextOptions } from "./context.js";
import { registeredRules, type RegisteredRule } from "./registry.js";
import type { Row } from "./types.js";

export const REPORT_SCHEMA = "clossys.constitution-report/1";

export interface RuleSummary {
  readonly id: string;
  readonly statement: string;
  readonly status: RegisteredRule["status"];
  readonly rows: number;
  readonly pending: number;
  /** Rows of `building` checks: reported, failing only under `strict`. */
  readonly building: number;
  readonly byAgent: Readonly<Record<string, number>>;
  readonly byCheck: Readonly<Record<string, number>>;
}

export interface ConstitutionReport {
  readonly schema: typeof REPORT_SCHEMA;
  readonly ok: boolean;
  readonly total: number;
  readonly pending: number;
  /** Rows of `building` checks (included in `total`). */
  readonly building: number;
  /** Whether building rows failed the run. */
  readonly strict: boolean;
  readonly records: { readonly slots: number; readonly liveSlots: number; readonly pins: number; readonly candidates: number };
  readonly rules: readonly RuleSummary[];
  readonly rows: readonly Row[];
  readonly ms: number;
}

export interface RunOptions extends ContextOptions {
  /** Workspace root rows are relative to. */
  readonly root: string;
  /** The consumer folder holding `agents/`. */
  readonly consumer: string;
  /** Only this rule (R01..R16). */
  readonly rule?: string;
  /** Fail on rows of `building` checks too (section 4); otherwise they are reported only. */
  readonly strict?: boolean;
  /** Only the rows about this agent's records, plus rows about no one agent (`*`, pending rows); record counts narrow to it. */
  readonly agent?: string;
  /** Clock for the timing field; tests pass a fixed one. */
  readonly now?: () => number;
}

const tally = (rows: readonly Row[], key: (row: Row) => string) => {
  const counts: Record<string, number> = {};
  for (const item of rows) counts[key(item)] = (counts[key(item)] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
};

export function runConstitution(options: RunOptions): ConstitutionReport {
  const now = options.now ?? (() => performance.now());
  const started = now();
  const rules = registeredRules().filter(rule => !options.rule || rule.id === options.rule);
  if (options.rule && !rules.length) throw new Error(`Unknown constitution rule ${options.rule} (R01..R16)`);
  const ctx = buildContext(options.root, options.consumer, options);
  const summaries: RuleSummary[] = [];
  const rows: Row[] = [];
  let building = 0;
  for (const rule of rules) {
    let ruleBuilding = 0;
    const ruleRows = rule.run.flatMap(check => {
      const out = check.fn(ctx).filter(item => !options.agent || item.agent === options.agent || item.agent === "*");
      if (check.status === "building") ruleBuilding += out.filter(item => !item.pending).length;
      return out;
    });
    rows.push(...ruleRows);
    building += ruleBuilding;
    summaries.push({
      id: rule.id, statement: rule.statement, status: rule.status,
      rows: ruleRows.length, pending: ruleRows.filter(item => item.pending).length, building: ruleBuilding,
      byAgent: tally(ruleRows, item => item.agent), byCheck: tally(ruleRows, item => item.check),
    });
  }
  let slots = 0, liveSlots = 0, pins = 0, candidates = 0;
  for (const agent of ctx.agents) if (!options.agent || agent.agent === options.agent) for (const slot of agent.slots.values()) {
    slots++; if (slot.live) liveSlots++; if (slot.pin) pins++; candidates += slot.candidates.length;
  }
  const pending = rows.filter(item => item.pending).length;
  const strict = options.strict === true;
  return {
    schema: REPORT_SCHEMA, ok: rows.length - (strict ? 0 : building) === 0, total: rows.length, pending, building, strict,
    records: { slots, liveSlots, pins, candidates }, rules: summaries, rows, ms: Math.round(now() - started),
  };
}

const counts = (record: Readonly<Record<string, number>>) => Object.entries(record).map(([key, value]) => `${key} ${value}`).join(", ");

/** The human table: every row, grouped by rule, with per-rule and per-agent counts, then a total line. */
export function formatReport(report: ConstitutionReport): string {
  const lines: string[] = [];
  for (const rule of report.rules) {
    const failing = rule.rows - (report.strict ? 0 : rule.building);
    const state = rule.status === "pending" ? "PENDING" : failing ? "FAIL" : rule.status === "building" ? (rule.rows ? "BUILDING" : "ok (building)") : "ok";
    const head = `${rule.id} ${state}  rows ${rule.rows}${rule.building ? ` (building ${rule.building})` : ""}`;
    lines.push(rule.rows ? `${head}  (${counts(rule.byAgent)}; ${counts(rule.byCheck)})` : head);
    lines.push(`  ${rule.statement}`);
    for (const item of report.rows.filter(entry => entry.rule === rule.id)) {
      const where = item.candidate ? `${item.slot} ${item.candidate}` : item.slot;
      lines.push(`  ${item.check.padEnd(8)} ${item.agent.padEnd(9)} ${where}: ${item.reason}${item.path && !item.pending ? `  [${item.path}]` : ""}`);
    }
  }
  const { slots, liveSlots, pins, candidates } = report.records;
  lines.push("");
  lines.push(`constitution: ${report.ok ? "PASS" : "FAIL"}  rows ${report.total} (pending ${report.pending}, building ${report.building}${report.strict ? " strict" : " report-only"}, findings ${report.total - report.pending - report.building})  over ${slots} slot folders (${liveSlots} live), ${pins} pins, ${candidates} candidates  in ${report.ms} ms`);
  lines.push(`  by rule: ${report.rules.map(rule => `${rule.id} ${rule.rows}`).join(", ")}`);
  return lines.join("\n");
}
