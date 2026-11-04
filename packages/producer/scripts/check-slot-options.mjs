#!/usr/bin/env node
/**
 * CANDIDATE-OPTIONS check: every Director and Writer slot is classed by the committed
 * option-class mapping (records/slot-model/option-classes.ts), its slot.json
 * `options`/`varyOn` match its class, and a choice slot (options = N) holds at least N
 * candidates that differ on `varyOn`, each tagged with a distinct allowed value.
 * The decision is the shared module's (records/slot-options.ts over records/slots.ts).
 *
 * Usage: node scripts/check-slot-options.mjs [--repo <foundry checkout>] [--json]
 * Needs `npm run build` (reads dist). Exit 0 clean, 1 findings, 2 usage or load error.
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = name => { const at = args.indexOf(name); return at < 0 ? undefined : args[at + 1]; };
const repo = resolve(flag('--repo') ?? join(here, '../../..'));
const json = args.includes('--json');
const consumer = join(repo, 'clossys');
if (!existsSync(join(consumer, 'agents'))) { console.error(`check-slot-options: no clossys/agents under ${repo}`); process.exit(2); }

let checkSlotOptions, classCounts;
try { ({ checkSlotOptions, classCounts } = await import('../dist/records/slot-options.js')); }
catch { console.error('check-slot-options: build @clossys/producer first (dist/records/slot-options.js)'); process.exit(2); }

const { findings, slots } = checkSlotOptions(consumer);
const counts = classCounts(slots);
const choice = slots.filter(slot => slot.options > 1);
if (json) console.log(JSON.stringify({ ok: findings.length === 0, classes: counts, choiceSlots: choice.length, findings }, null, 2));
else {
  for (const row of findings) console.log(`${row.code}\t${row.agent}/${row.slot}\t${row.message}`);
  const byCode = {};
  for (const row of findings) byCode[row.code] = (byCode[row.code] ?? 0) + 1;
  console.log(`check-slot-options: ${slots.length} classed slots ${JSON.stringify(counts)}; ${choice.length} choice slots; ${findings.length} finding(s)${findings.length ? ` ${JSON.stringify(byCode)}` : ''}`);
}
process.exit(findings.length ? 1 : 0);
