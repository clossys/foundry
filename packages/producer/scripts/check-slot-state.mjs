#!/usr/bin/env node
/**
 * Slot state class check (wiring audit rules 8 and 11).
 *
 * 1. Every IA slot under <repo>/clossys/agents/ is in the closed slot-state union: `pinned`
 *    (pin.json) or `not-needed` (slot.json `notNeeded: {reason, since}`). The decision is the
 *    shared loader's (records/slots.ts `rejectedSlots`), never re-derived here.
 * 2. No Studio specimen or slot-groups code path renders candidate file contents as text.
 *
 * Usage: node scripts/check-slot-state.mjs [--repo <foundry checkout>] [--json]
 * Needs `npm run build` (reads dist). Exit 0 clean, 1 findings, 2 usage or load error.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = name => { const at = args.indexOf(name); return at < 0 ? undefined : args[at + 1]; };
const repo = resolve(flag('--repo') ?? join(here, '../../..'));
const json = args.includes('--json');
const consumer = join(repo, 'clossys');
if (!existsSync(join(consumer, 'agents'))) { console.error(`check-slot-state: no clossys/agents under ${repo}`); process.exit(2); }

let rejectedSlots;
try { ({ rejectedSlots } = await import('../dist/records/slots.js')); }
catch { console.error('check-slot-state: build @clossys/producer first (dist/records/slots.js)'); process.exit(2); }

const findings = [];
for (const slot of rejectedSlots(consumer)) {
  findings.push({ rule: 'slot-state', path: `${slot.agent}/${slot.id}`, reason: slot.reason, candidates: slot.candidates, message: slot.message });
}

// The raw-text renderer: a specimen or option row whose text is a candidate's file content, or a
// specimen `fallback` that draws the shown candidate when nothing renders it.
const RAW_TEXT = [
  { pattern: /\btext\s*:\s*[\w.?]*\b(?:content|bytes)\b/, message: 'a row renders candidate file contents as text' },
  { pattern: /\bfallback\s*[:?]/, message: 'a specimen fallback path draws the candidate instead of an explicit state' },
];
const studio = join(repo, 'packages/producer/studio');
const files = [join(studio, 'lib/slot-detail.ts')];
const walk = dir => existsSync(dir) ? readdirSync(dir).flatMap(name => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? walk(path) : /\.tsx?$/.test(name) && !/\.test\./.test(name) ? [path] : [];
}) : [];
files.push(...walk(join(studio, 'sections/studio-specimen')), ...walk(join(studio, 'sections/studio-slot-groups')));
for (const file of files) {
  if (!existsSync(file)) continue;
  readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
    if (/^\s*(?:\/\/|\*|\/\*)/.test(line)) return;
    for (const { pattern, message } of RAW_TEXT) if (pattern.test(line)) {
      findings.push({ rule: 'raw-candidate-text', path: `${relative(repo, file)}:${index + 1}`, message });
    }
  });
}

if (json) console.log(JSON.stringify({ ok: findings.length === 0, findings }, null, 2));
else {
  const slots = findings.filter(row => row.rule === 'slot-state');
  console.log(`check-slot-state: ${slots.length} slots in neither state, ${findings.length - slots.length} raw-text renderer findings`);
  for (const row of findings) console.log(row.rule === 'slot-state'
    ? `  ${row.path} [${row.reason}] ${row.candidates} candidates`
    : `  ${row.path} [${row.rule}] ${row.message}`);
}
process.exit(findings.length ? 1 : 0);
