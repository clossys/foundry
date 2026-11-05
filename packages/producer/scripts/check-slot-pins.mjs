#!/usr/bin/env node
/**
 * Slot pin integrity from root `check` (rule R-SLOT-PINS: every L3 is a slot, candidates are
 * files, one pinned).
 *
 * Runs the one slot resolver `clossys check` uses (dist/check/slot-resolve.js `runSlotResolve`)
 * over <root>/clossys and fails on any finding: a needed slot with no pin, more than one pin, a pin
 * naming no candidate file or drifting from its bytes, a candidate outside the IA, or a pinned
 * source the slot model or the references manifest does not accept. A slot marked not-needed in
 * slot.json holds no pin by design. It runs only the slot resolver, not the other `clossys check`
 * suites.
 *
 * Usage: node scripts/check-slot-pins.mjs [--root <foundry checkout>] [--json]
 * Needs `npm run build` (reads dist). Exit 0 clean, 1 findings, 2 usage or load error.
 */
import { existsSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const at = args.indexOf('--root');
if (at >= 0 && !args[at + 1]) { console.error('check-slot-pins: --root needs a directory'); process.exit(2); }
const root = at >= 0 ? realpathSync(resolve(args[at + 1])) : resolve(here, '../../..');
const consumer = join(root, 'clossys');
if (!existsSync(join(consumer, 'agents'))) { console.error(`check-slot-pins: no clossys/agents under ${root}`); process.exit(2); }

let runSlotResolve;
try { ({ runSlotResolve } = await import('../dist/check/slot-resolve.js')); }
catch { console.error('check-slot-pins: build @clossys/producer first (dist/check/slot-resolve.js)'); process.exit(2); }

const report = await runSlotResolve(consumer);
if (args.includes('--json')) console.log(JSON.stringify({ verdict: report.verdict, slots: report.rows.length, findings: report.findings }, null, 2));
else {
  console.log(`check-slot-pins: ${report.rows.length} slots, ${report.findings.length} finding(s) (${report.verdict})`);
  for (const finding of report.findings) console.log(`  ${finding.path ?? 'model'} [${finding.rule}] ${finding.message}`);
}
process.exit(report.verdict === 'indeterminate' ? 2 : report.findings.length ? 1 : 0);
