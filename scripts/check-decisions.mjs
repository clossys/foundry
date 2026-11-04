#!/usr/bin/env node
/**
 * Decision records check (rule R-DECISIONS-BY-CLI).
 *
 * A slot's decision is written by `clossys pin` (or an agent seat's `clossys pick`) only: pin.json {candidate, sha256, decidedBy, basis, at}
 * or slot.json `notNeeded: {reason, since, decidedBy}`. This check reads the files directly (no
 * build needed) and fails on any decision record a hand edit could leave behind:
 *
 *   pin-shape          pin.json is not JSON, has keys other than {candidate, sha256, decidedBy, basis, at},
 *                      is missing decidedBy / at, or has a basis other than picked | bulk | planner | agent
 *                      (a missing basis is check:git-cms's finding, rule R-GIT-CMS)
 *   pin-candidate      the pinned candidate file does not exist
 *   pin-hash           sha256 in pin.json differs from the candidate file's bytes
 *   both               the slot is pinned and marked not needed at once
 *   not-needed-shape   slot.json notNeeded is missing reason, since or decidedBy
 *
 * Usage: node scripts/check-decisions.mjs [--repo <checkout>] [--json]
 * Exit 0 clean, 1 findings, 2 usage or load error.
 */
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PIN_BASES } from './check-git-cms.mjs';

const PIN_KEYS = ['candidate', 'sha256', 'decidedBy', 'basis', 'at'];
const NOT_NEEDED_KEYS = ['reason', 'since', 'decidedBy'];
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

const isDir = path => { try { const stat = lstatSync(path); return stat.isDirectory() && !stat.isSymbolicLink(); } catch { return false; } };
const isFile = path => { try { const stat = lstatSync(path); return stat.isFile() && !stat.isSymbolicLink(); } catch { return false; } };
const nonEmpty = value => typeof value === 'string' && value.trim().length > 0;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Every decision finding and the state count under `<consumer>/agents`. */
export function checkDecisions(consumer) {
  const agents = join(consumer, 'agents');
  const findings = [];
  const counts = { pinned: 0, 'not-needed': 0, open: 0 };
  const add = (rule, path, message) => findings.push({ rule, path, message });
  for (const agent of readdirSync(agents).filter(name => !name.startsWith('_') && !name.startsWith('.')).sort()) {
    const agentDir = join(agents, agent);
    if (!isDir(agentDir)) continue;
    for (const slot of readdirSync(agentDir).filter(name => !name.startsWith('_') && !name.startsWith('.')).sort()) {
      const dir = join(agentDir, slot);
      if (!isDir(dir)) continue;
      const pinPath = join(dir, 'pin.json'), slotPath = join(dir, 'slot.json');
      if (!isFile(pinPath) && !isFile(slotPath)) continue;
      const where = `${agent}/${slot}`;
      let notNeeded;
      if (isFile(slotPath)) {
        try { notNeeded = JSON.parse(readFileSync(slotPath, 'utf8')).notNeeded; }
        catch { add('not-needed-shape', `${where}/slot.json`, 'slot.json is not JSON'); }
        if (notNeeded !== undefined) {
          if (!object(notNeeded)) add('not-needed-shape', `${where}/slot.json`, 'notNeeded must be an object');
          else {
            for (const key of Object.keys(notNeeded)) if (!NOT_NEEDED_KEYS.includes(key)) add('not-needed-shape', `${where}/slot.json`, `notNeeded has unknown key ${key}`);
            if (!nonEmpty(notNeeded.reason)) add('not-needed-shape', `${where}/slot.json`, 'notNeeded is missing reason');
            if (typeof notNeeded.since !== 'string' || !ISO_DATE.test(notNeeded.since)) add('not-needed-shape', `${where}/slot.json`, 'notNeeded is missing since (ISO date)');
            if (!nonEmpty(notNeeded.decidedBy)) add('not-needed-shape', `${where}/slot.json`, 'notNeeded is missing decidedBy');
          }
        }
      }
      const pinned = isFile(pinPath);
      if (pinned && notNeeded !== undefined) add('both', where, 'slot is both pinned and marked not needed');
      if (pinned) counts.pinned++; else if (notNeeded !== undefined) counts['not-needed']++; else counts.open++;
      if (!pinned) continue;
      let pin;
      try { pin = JSON.parse(readFileSync(pinPath, 'utf8')); }
      catch { add('pin-shape', `${where}/pin.json`, 'pin.json is not JSON'); continue; }
      if (!object(pin)) { add('pin-shape', `${where}/pin.json`, 'pin.json must be an object'); continue; }
      for (const key of Object.keys(pin)) if (!PIN_KEYS.includes(key)) add('pin-shape', `${where}/pin.json`, `unknown key ${key}`);
      if (!nonEmpty(pin.decidedBy)) add('pin-shape', `${where}/pin.json`, 'missing decidedBy');
      if (pin.basis !== undefined && !PIN_BASES.includes(pin.basis)) add('pin-shape', `${where}/pin.json`, `basis ${JSON.stringify(pin.basis)} is not ${PIN_BASES.join(' | ')}`);
      if (typeof pin.at !== 'string' || !ISO_TIME.test(pin.at) || Number.isNaN(Date.parse(pin.at))) add('pin-shape', `${where}/pin.json`, 'missing at (ISO timestamp)');
      if (!nonEmpty(pin.candidate) || pin.candidate.includes('/') || pin.candidate.includes('\\')) { add('pin-candidate', `${where}/pin.json`, 'pin names no candidate file'); continue; }
      const candidatePath = join(dir, 'candidates', pin.candidate);
      if (!isFile(candidatePath)) { add('pin-candidate', `${where}/pin.json`, `pinned candidate ${pin.candidate} does not exist`); continue; }
      const sha256 = createHash('sha256').update(readFileSync(candidatePath)).digest('hex');
      if (pin.sha256 !== sha256) add('pin-hash', `${where}/pin.json`, `sha256 differs from ${pin.candidate}`);
    }
  }
  return { findings, counts };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const at = args.indexOf('--repo');
  if (at >= 0 && (!args[at + 1] || args[at + 1].startsWith('--'))) { console.error('check-decisions: --repo requires a value'); process.exit(2); }
  const repo = resolve(at >= 0 ? args[at + 1] : join(dirname(fileURLToPath(import.meta.url)), '..'));
  const consumer = join(repo, 'clossys');
  if (!existsSync(join(consumer, 'agents'))) { console.error(`check-decisions: no clossys/agents under ${repo}`); process.exit(2); }
  const { findings, counts } = checkDecisions(consumer);
  if (args.includes('--json')) console.log(JSON.stringify({ ok: findings.length === 0, counts, findings }, null, 2));
  else {
    const byRule = {};
    for (const row of findings) byRule[row.rule] = (byRule[row.rule] ?? 0) + 1;
    console.log(`check-decisions: ${findings.length} findings (${Object.entries(byRule).map(([rule, n]) => `${rule} ${n}`).join(', ') || 'none'}); `
      + `${counts.pinned} pinned, ${counts['not-needed']} not-needed, ${counts.open} open`);
    for (const row of findings) console.log(`  ${row.path} [${row.rule}] ${row.message}`);
  }
  process.exit(findings.length ? 1 : 0);
}
