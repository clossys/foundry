/**
 * The constitution runner (`clossys check --constitution [--rule Rxx] [--json]`): reads the agent
 * trees once, runs every registered check over all records, and reports every row grouped by rule
 * with counts per rule and agent. Pure compute: no browser, no LLM, no network, no writes. Any row
 * from an enforced or pending check fails the run; rows from a `building` check are reported and fail
 * it only under `strict`; rows from a `warn` check are warnings, reported apart, and never fail it.
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
  /** Rows from building checks (counted in `rows`). */
  readonly building: number;
  /** Rows that fail the run: every row except building rows outside strict. */
  readonly failing: number;
  /** Warn-check rows (not in `rows`). */
  readonly warnings: number;
  readonly byAgent: Readonly<Record<string, number>>;
  readonly byCheck: Readonly<Record<string, number>>;
}

export interface ConstitutionReport {
  readonly schema: typeof REPORT_SCHEMA;
  readonly ok: boolean;
  /** Building checks fail the run too. */
  readonly strict: boolean;
  readonly total: number;
  readonly pending: number;
  /** Rows from building checks (counted in `total`). */
  readonly building: number;
  readonly records: { readonly slots: number; readonly liveSlots: number; readonly pins: number; readonly candidates: number };
  readonly rules: readonly RuleSummary[];
  readonly rows: readonly Row[];
  /** Rows from warn checks: reported, never failing, not counted in `total`. */
  readonly warnings: readonly Row[];
  readonly ms: number;
}

export interface RunOptions extends ContextOptions {
  /** Workspace root rows are relative to. */
  readonly root: string;
  /** The consumer folder holding `agents/`. */
  readonly consumer: string;
  /** Only these rules (R01..R14). */
  readonly rule?: string | readonly string[];
  /** Only the rows about this agent's records, plus rows about no one agent (`*`, pending rows); record counts narrow to it. */
  readonly agent?: string;
  /** Building checks fail the run too (`clossys check --constitution --strict`). */
  readonly strict?: boolean;
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
  const only = options.rule === undefined ? undefined : new Set(typeof options.rule === "string" ? [options.rule] : options.rule);
  const rules = registeredRules().filter(rule => !only || only.has(rule.id));
  const unknown = only && [...only].filter(id => !rules.some(rule => rule.id === id));
  if (unknown?.length) throw new Error(`Unknown constitution rule ${unknown.join(", ")} (R01..R14)`);
  const ctx = buildContext(options.root, options.consumer, options);
  const strict = options.strict === true;
  const fails = (item: Row) => item.level !== "building" || strict;
  const summaries: RuleSummary[] = [];
  const rows: Row[] = [];
  const warnings: Row[] = [];
  for (const rule of rules) {
    const ruleRows: Row[] = [], ruleWarnings: Row[] = [];
    for (const check of rule.run) {
      const found = check.fn(ctx).filter(item => !options.agent || item.agent === options.agent || item.agent === "*");
      if (check.status === "warn") ruleWarnings.push(...found.map(item => ({ ...item, level: "warn" as const })));
      else ruleRows.push(...(check.status === "building" ? found.map(item => ({ ...item, level: "building" as const })) : found));
    }
    rows.push(...ruleRows);
    warnings.push(...ruleWarnings);
    summaries.push({
      id: rule.id, statement: rule.statement, status: rule.status,
      rows: ruleRows.length, pending: ruleRows.filter(item => item.pending).length,
      building: ruleRows.filter(item => item.level === "building").length, failing: ruleRows.filter(fails).length, warnings: ruleWarnings.length,
      byAgent: tally(ruleRows, item => item.agent), byCheck: tally(ruleRows, item => item.check),
    });
  }
  let slots = 0, liveSlots = 0, pins = 0, candidates = 0;
  for (const agent of ctx.agents) if (!options.agent || agent.agent === options.agent) for (const slot of agent.slots.values()) {
    slots++; if (slot.live) liveSlots++; if (slot.pin) pins++; candidates += slot.candidates.length;
  }
  const pending = rows.filter(item => item.pending).length;
  return {
    schema: REPORT_SCHEMA, ok: !rows.some(fails), strict, total: rows.length, pending, building: rows.filter(item => item.level === "building").length,
    records: { slots, liveSlots, pins, candidates }, rules: summaries, rows, warnings, ms: Math.round(now() - started),
  };
}

const counts = (record: Readonly<Record<string, number>>) => Object.entries(record).map(([key, value]) => `${key} ${value}`).join(", ");

/** The human table: every row, grouped by rule, with per-rule and per-agent counts, then a total line. */
export function formatReport(report: ConstitutionReport): string {
  const lines: string[] = [];
  for (const rule of report.rules) {
    const head = `${rule.id} ${rule.status === "pending" ? "PENDING" : rule.failing ? "FAIL" : rule.rows ? "BUILDING" : "ok"}  rows ${rule.rows}`;
    lines.push(rule.rows ? `${head}  (${counts(rule.byAgent)}; ${counts(rule.byCheck)})` : head);
    lines.push(`  ${rule.statement}`);
    const line = (item: Row) => {
      const where = item.candidate ? `${item.slot} ${item.candidate}` : item.slot;
      return `  ${item.check.padEnd(8)} ${item.agent.padEnd(9)} ${where}: ${item.reason}${item.path && !item.pending ? `  [${item.path}]` : ""}`;
    };
    for (const item of report.rows.filter(entry => entry.rule === rule.id)) lines.push(line(item));
    const warned = report.warnings.filter(entry => entry.rule === rule.id);
    if (warned.length) {
      lines.push(`  warnings ${warned.length} (never fail the run)`);
      for (const item of warned) lines.push(line(item));
    }
  }
  const { slots, liveSlots, pins, candidates } = report.records;
  lines.push("");
  const building = report.building ? `  building ${report.building} (${report.strict ? "strict: failing" : "report only; --strict fails them"})` : "";
  const warned = report.warnings.length ? `  warnings ${report.warnings.length}` : "";
  lines.push(`constitution: ${report.ok ? "PASS" : "FAIL"}  rows ${report.total} (pending ${report.pending}, findings ${report.total - report.pending})${building}${warned}  over ${slots} slot folders (${liveSlots} live), ${pins} pins, ${candidates} candidates  in ${report.ms} ms`);
  lines.push(`  by rule: ${report.rules.map(rule => `${rule.id} ${rule.rows}`).join(", ")}`);
  return lines.join("\n");
}
