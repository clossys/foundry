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
 * Producer seats (clossys/agents/producer/<step>/, one per IA leaf of the Producer ia.json) live
 * under the same contract: each needs a candidate file and exactly one pin.json whose sha256
 * matches it (records/slots.js `seatStates`). An unpinned seat, a pin that drifts or names no
 * candidate, and a retired seat.json are findings.
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

let runSlotResolve, seatStates;
try { ({ runSlotResolve } = await import('../dist/check/slot-resolve.js')); ({ seatStates } = await import('../dist/records/slots.js')); }
catch { console.error('check-slot-pins: build @clossys/producer first (dist/check/slot-resolve.js)'); process.exit(2); }

const report = await runSlotResolve(consumer);
const seats = seatStates(consumer);
const findings = [...report.findings];
for (const seat of seats) {
  if (seat.state === 'pinned') continue;
  findings.push({ path: `agents/producer/${seat.id}`, rule: seat.state === 'open' ? 'seat-open' : 'seat-rejected', message: seat.message ?? 'the seat has no pin.json choosing a candidate file' });
}
if (args.includes('--json')) console.log(JSON.stringify({ verdict: report.verdict, slots: report.rows.length, seats: seats.length, findings }, null, 2));
else {
  console.log(`check-slot-pins: ${report.rows.length} slots, ${seats.length} seats, ${findings.length} finding(s) (${report.verdict})`);
  for (const finding of findings) console.log(`  ${finding.path ?? 'model'} [${finding.rule}] ${finding.message}`);
}
process.exit(report.verdict === 'indeterminate' ? 2 : findings.length ? 1 : 0);
