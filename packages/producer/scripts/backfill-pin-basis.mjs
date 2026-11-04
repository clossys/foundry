#!/usr/bin/env node
/**
 * One-shot backfill (G15-GITCMS-HARDEN): give every existing pin.json its `basis`
 * (picked | bulk | planner), derived deterministically from its decidedBy text, and write it
 * through `clossys pin` itself (rule R-DECISIONS-BY-CLI), never by editing the file.
 * Each pin keeps its candidate, sha256, decidedBy and at.
 *
 *   planner:<unit>                                   -> planner
 *   owner:... planner pin(s) ... / owner:... planner-pin ...  -> planner
 *   owner:... pin-if-agree                           -> bulk
 *   owner:... <UNIT> go                              -> bulk
 *   owner words that name the specific choice (PICKED below)  -> picked
 *   anything else (ambiguous)                        -> bulk
 *
 * Usage: node scripts/backfill-pin-basis.mjs [--repo <foundry checkout>] [--dry-run] [--json]
 * Needs `npm run build` (runs dist/cli/index.js). Exit 0 all written, 1 any refusal or drift.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Owner words that name the specific candidate chosen (not a blanket approval). */
export const PICKED = Object.freeze(['owner:2026-11-03 one-brand clossys asterisk']);

/** The basis one decidedBy text maps to, and the mapping rule that matched. */
export function basisFor(decidedBy) {
  if (/^planner(?::|$)/.test(decidedBy)) return { basis: 'planner', rule: 'planner:<unit>' };
  if (/^owner\b/.test(decidedBy) && /\bplanner[- ]pins?\b/.test(decidedBy)) return { basis: 'planner', rule: 'owner: planner pin(s) / planner-pin' };
  if (/\bpin-if-agree\b/.test(decidedBy)) return { basis: 'bulk', rule: 'pin-if-agree' };
  if (/\b[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)* go$/.test(decidedBy)) return { basis: 'bulk', rule: '<UNIT> go' };
  if (PICKED.includes(decidedBy)) return { basis: 'picked', rule: 'owner names the choice' };
  return { basis: 'bulk', rule: 'ambiguous' };
}

/**
 * Backfill every pin under <repo>/clossys/agents/<agent>/ (agents with an ia.json). `runPin(args)`
 * runs `clossys pin <args>` and resolves to {ok, output}. Returns {written, skipped, failures, table}.
 */
export async function backfill({ repo, runPin, dryRun = false }) {
  const agents = join(repo, 'clossys', 'agents');
  let written = 0, skipped = 0;
  const failures = [], table = new Map();
  for (const agent of readdirSync(agents).sort()) {
    if (!existsSync(join(agents, agent, 'ia.json'))) continue;
    for (const slot of readdirSync(join(agents, agent)).sort()) {
      const pinPath = join(agents, agent, slot, 'pin.json');
      if (!existsSync(pinPath)) continue;
      const before = JSON.parse(readFileSync(pinPath, 'utf8'));
      const { basis, rule } = basisFor(before.decidedBy);
      const key = `${before.decidedBy}\t${rule}\t${basis}`;
      table.set(key, (table.get(key) ?? 0) + 1);
      if (before.basis === basis) { skipped++; continue; }
      const args = ['pin', `${agent}/${slot}`, before.candidate, '--by', before.decidedBy, '--at', before.at, '--root', repo, '--json'];
      if (!before.decidedBy.startsWith('planner')) args.push('--basis', basis);
      if (dryRun) { written++; continue; }
      const result = await runPin(args);
      if (!result.ok) { failures.push(`${agent}/${slot}: ${String(result.output).trim()}`); continue; }
      const after = JSON.parse(readFileSync(pinPath, 'utf8'));
      for (const field of ['candidate', 'sha256', 'decidedBy', 'at']) {
        if (after[field] !== before[field]) failures.push(`${agent}/${slot}: ${field} changed ${before[field]} -> ${after[field]}`);
      }
      if (after.basis !== basis) failures.push(`${agent}/${slot}: basis is ${after.basis}, expected ${basis}`);
      else written++;
    }
  }
  const rows = [...table].map(([key, count]) => { const [decidedBy, rule, basis] = key.split('\t'); return { decidedBy, rule, basis, count }; })
    .sort((a, b) => b.count - a.count || a.decidedBy.localeCompare(b.decidedBy));
  return { written, skipped, failures, table: rows };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const here = dirname(fileURLToPath(import.meta.url));
  const args = process.argv.slice(2);
  const at = args.indexOf('--repo');
  const repo = resolve(at >= 0 ? args[at + 1] : join(here, '../../..'));
  const cli = join(here, '../dist/cli/index.js');
  if (!existsSync(cli)) { console.error('backfill-pin-basis: build @clossys/producer first (dist/cli/index.js)'); process.exit(2); }
  const runPin = async pinArgs => {
    try { return { ok: true, output: execFileSync(process.execPath, [cli, ...pinArgs], { encoding: 'utf8' }) }; }
    catch (error) { return { ok: false, output: `${error.stdout ?? ''}${error.stderr ?? ''}` }; }
  };
  const result = await backfill({ repo, runPin, dryRun: args.includes('--dry-run') });
  if (args.includes('--json')) console.log(JSON.stringify(result, null, 2));
  else {
    for (const row of result.table) console.log(`${String(row.count).padStart(4)}  ${row.basis.padEnd(7)}  ${row.rule.padEnd(36)}  ${row.decidedBy}`);
    const totals = {};
    for (const row of result.table) totals[row.basis] = (totals[row.basis] ?? 0) + row.count;
    console.log(`backfill-pin-basis: ${result.written} written, ${result.skipped} already set; ${Object.entries(totals).map(([basis, n]) => `${basis} ${n}`).join(', ')}`);
    for (const failure of result.failures) console.log(`  FAIL ${failure}`);
  }
  process.exit(result.failures.length ? 1 : 0);
}
