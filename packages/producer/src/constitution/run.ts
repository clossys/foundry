/**
 * The constitution runner (`clossys check --constitution [--rule Rxx] [--json]`): reads the agent
 * trees once, runs every registered check over all records, and reports every row grouped by rule
 * with counts per rule and agent. Pure compute: no browser, no LLM, no network, no writes. Any row,
 * pending rows included, fails the run.
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
  readonly byAgent: Readonly<Record<string, number>>;
  readonly byCheck: Readonly<Record<string, number>>;
}

export interface ConstitutionReport {
  readonly schema: typeof REPORT_SCHEMA;
  readonly ok: boolean;
  readonly total: number;
  readonly pending: number;
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
  /** Only this rule (R01..R14). */
  readonly rule?: string;
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
  if (options.rule && !rules.length) throw new Error(`Unknown constitution rule ${options.rule} (R01..R14)`);
  const ctx = buildContext(options.root, options.consumer, options);
  const summaries: RuleSummary[] = [];
  const rows: Row[] = [];
  for (const rule of rules) {
    const ruleRows = rule.run.flatMap(check => check.fn(ctx)).filter(item => !options.agent || item.agent === options.agent || item.agent === "*");
    rows.push(...ruleRows);
    summaries.push({
      id: rule.id, statement: rule.statement, status: rule.status,
      rows: ruleRows.length, pending: ruleRows.filter(item => item.pending).length,
      byAgent: tally(ruleRows, item => item.agent), byCheck: tally(ruleRows, item => item.check),
    });
  }
  let slots = 0, liveSlots = 0, pins = 0, candidates = 0;
  for (const agent of ctx.agents) if (!options.agent || agent.agent === options.agent) for (const slot of agent.slots.values()) {
    slots++; if (slot.live) liveSlots++; if (slot.pin) pins++; candidates += slot.candidates.length;
  }
  const pending = rows.filter(item => item.pending).length;
  return {
    schema: REPORT_SCHEMA, ok: rows.length === 0, total: rows.length, pending,
    records: { slots, liveSlots, pins, candidates }, rules: summaries, rows, ms: Math.round(now() - started),
  };
}

const counts = (record: Readonly<Record<string, number>>) => Object.entries(record).map(([key, value]) => `${key} ${value}`).join(", ");

/** The human table: every row, grouped by rule, with per-rule and per-agent counts, then a total line. */
export function formatReport(report: ConstitutionReport): string {
  const lines: string[] = [];
  for (const rule of report.rules) {
    const head = `${rule.id} ${rule.status === "pending" ? "PENDING" : rule.rows ? "FAIL" : "ok"}  rows ${rule.rows}`;
    lines.push(rule.rows ? `${head}  (${counts(rule.byAgent)}; ${counts(rule.byCheck)})` : head);
    lines.push(`  ${rule.statement}`);
    for (const item of report.rows.filter(entry => entry.rule === rule.id)) {
      const where = item.candidate ? `${item.slot} ${item.candidate}` : item.slot;
      lines.push(`  ${item.check.padEnd(8)} ${item.agent.padEnd(9)} ${where}: ${item.reason}${item.path && !item.pending ? `  [${item.path}]` : ""}`);
    }
  }
  const { slots, liveSlots, pins, candidates } = report.records;
  lines.push("");
  lines.push(`constitution: ${report.ok ? "PASS" : "FAIL"}  rows ${report.total} (pending ${report.pending}, findings ${report.total - report.pending})  over ${slots} slot folders (${liveSlots} live), ${pins} pins, ${candidates} candidates  in ${report.ms} ms`);
  lines.push(`  by rule: ${report.rules.map(rule => `${rule.id} ${rule.rows}`).join(", ")}`);
  return lines.join("\n");
}
