#!/usr/bin/env node
/**
 * Report guards check (rule R-REPORT-GUARD, CP1-LOOP-LEARN): no fixed close without a guard; a repeat after a fixed
 * close fails.
 *
 * Producer's report store (`clossys/agents/producer/queue.report/entries/<id>.json`, written by `clossys request
 * --kind report`, packages/producer/src/records/report.ts) learns from what it fixed: a fixed close names a guard rule,
 * and a signed report matching a report closed fixed is filed as a REPEAT. This check reads those records directly (no
 * build needed) and fails on a store that broke either half:
 *
 *   unguarded-fixed   a report closed fixed names no guard
 *   guard-unknown     a fixed close's guard is no rule of the root's scripts/rules/registry.json
 *   guard-no-fixture  a fixed close's guard rule has no fixture_runs entry (no check is shown to fail on it)
 *   repeat-open       an open report repeats a report closed fixed (repeatOf): the fixed problem came back
 *   repeat-unlinked   an open signed report has the about, what and signature of a report closed fixed before it,
 *                     but no repeatOf (filed around the engine's repeat check)
 *   unreadable        an entry is not a JSON object
 *
 * A REPEAT stays a finding until the report closes again, fixed with a guard (or declined as a duplicate).
 *
 * Usage: node scripts/check-report-guards.mjs [--root <dir holding clossys/>] [--json]
 *   --root defaults to $CLOSSYS_ROOT, else this checkout. The guard registry is <root>/scripts/rules/registry.json.
 * Exit 0 clean, 1 findings, 2 usage error.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const ENTRIES = ['clossys', 'agents', 'producer', 'queue.report', 'entries'];
export const REGISTRY = ['scripts', 'rules', 'registry.json'];

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keyOf = report => JSON.stringify([report.about, report.what, report.evidence?.signature]);

/** The rules of `<root>/scripts/rules/registry.json` by id, or undefined when the root has none (or it is not JSON). */
function registryRules(root) {
  const file = join(root, ...REGISTRY);
  if (!existsSync(file)) return undefined;
  try {
    const rules = JSON.parse(readFileSync(file, 'utf8'))?.rules;
    return new Map((Array.isArray(rules) ? rules : []).filter(object).map(rule => [rule.id, rule]));
  } catch { return undefined; }
}

/** Every finding of the report store under `root`. */
export function checkReportGuards(root) {
  const findings = [];
  const dir = join(root, ...ENTRIES);
  const reports = [];
  for (const name of existsSync(dir) ? readdirSync(dir).filter(file => file.endsWith('.json')).sort() : []) {
    let doc;
    try { doc = JSON.parse(readFileSync(join(dir, name), 'utf8')); } catch { doc = undefined; }
    if (!object(doc)) { findings.push({ rule: 'unreadable', id: name, message: `${name} is not a JSON object` }); continue; }
    reports.push({ ...doc, id: typeof doc.id === 'string' ? doc.id : name.slice(0, -'.json'.length) });
  }
  const rules = registryRules(root);
  const fixed = reports.filter(report => report.status === 'closed' && report.outcome === 'fixed');
  for (const report of fixed) {
    const guard = report.guard;
    if (typeof guard !== 'string' || !guard) { findings.push({ rule: 'unguarded-fixed', id: report.id, message: `queue.report#${report.id} closed fixed (${report.result ?? 'no result'}) with no guard: a fixed close names a rule of scripts/rules/registry.json with a fixture run (--guard R-<id>)` }); continue; }
    const rule = rules?.get(guard);
    if (!rule) findings.push({ rule: 'guard-unknown', id: report.id, message: `queue.report#${report.id} closed fixed with guard ${guard}, ${rules ? `which scripts/rules/registry.json does not list` : 'but this root has no scripts/rules/registry.json'}` });
    else if (!Array.isArray(rule.fixture_runs) || rule.fixture_runs.length === 0) findings.push({ rule: 'guard-no-fixture', id: report.id, message: `queue.report#${report.id} closed fixed with guard ${guard}, a rule with no fixture_runs entry: no check is shown to fail on its violation` });
  }
  for (const report of reports.filter(each => each.status === 'open')) {
    if (object(report.repeatOf)) {
      findings.push({ rule: 'repeat-open', id: report.id, message: `queue.report#${report.id} is a REPEAT of queue.report#${report.repeatOf.report}, closed fixed${report.repeatOf.guard ? ` with guard ${report.repeatOf.guard}` : ''}: the fixed problem is back; fix it and close it fixed with a guard that catches it` });
      continue;
    }
    if (typeof report.evidence?.signature !== 'string') continue;
    const before = fixed.find(other => keyOf(other) === keyOf(report) && String(other.closedAt ?? '') <= String(report.createdAt ?? ''));
    if (before) findings.push({ rule: 'repeat-unlinked', id: report.id, message: `queue.report#${report.id} has the about, what and signature of queue.report#${before.id}, closed fixed, but no repeatOf: file reports with clossys request, which links the repeat` });
  }
  return { root, reports: reports.length, findings };
}

function main(argv) {
  let root = process.env.CLOSSYS_ROOT ? resolve(process.env.CLOSSYS_ROOT) : resolve(here, '..');
  let json = false;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--json') json = true;
    else if (arg === '--root' && argv[index + 1] !== undefined) root = resolve(argv[++index]);
    else { process.stderr.write(`check-report-guards: unknown argument ${arg}\nUsage: node scripts/check-report-guards.mjs [--root <dir>] [--json]\n`); return 2; }
  }
  const result = checkReportGuards(root);
  if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else {
    for (const finding of result.findings) process.stdout.write(`[${finding.rule}] ${finding.message}\n`);
    process.stdout.write(`check:report-guards: ${result.reports} report${result.reports === 1 ? '' : 's'}, ${result.findings.length} finding${result.findings.length === 1 ? '' : 's'}\n`);
  }
  return result.findings.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
