#!/usr/bin/env node
/**
 * Git CMS layout check (rule R-GIT-CMS).
 *
 * Every folder under `<repo>/clossys/agents/` is an agent tree in the flat slot layout and holds
 * nothing else:
 *
 *   clossys/agents/<agent>/ia.json
 *   clossys/agents/<agent>/<slot>/slot.json
 *   clossys/agents/<agent>/<slot>/candidates/<file>
 *   clossys/agents/<agent>/<slot>/pin.json            (absent only when slot.json says notNeeded)
 *
 * Evidence, findings and other working files live outside the agent trees (clossys/evidence/).
 * The check reads the files directly (no build needed) and fails on:
 *
 *   missing-ia          an agent folder has no ia.json, or ia.json lists no slots
 *   stray-entry         an entry that is neither ia.json nor a slot folder in an agent folder, an entry
 *                       other than slot.json, candidates/ and pin.json in a slot folder, or a
 *                       non-file inside candidates/
 *   unlisted-slot       a slot folder (it has a slot.json) that ia.json does not list
 *   missing-slot        an ia.json slot with no folder
 *   slot-shape          a listed slot folder has no readable slot.json
 *   no-candidates       a slot with zero candidate files
 *   pin-candidate       pin.json names a candidate file that does not exist
 *   pin-hash            pin.json sha256 differs from the candidate file's bytes
 *   pin-attribution     pin.json has no decidedBy, or no basis (picked | bulk | planner)
 *   not-needed-reason   slot.json notNeeded has no reason
 *
 * Nothing is exempt: an agent folder that is not in this layout fails until it is converted.
 *
 * Usage: node scripts/check-git-cms.mjs [--repo <checkout>] [--json]
 * Exit 0 clean, 1 findings, 2 usage or load error.
 */
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PIN_BASES = Object.freeze(['picked', 'bulk', 'planner']);
const SLOT_ENTRIES = new Set(['slot.json', 'candidates', 'pin.json']);

const stat = path => { try { return lstatSync(path); } catch { return undefined; } };
const isDir = path => { const info = stat(path); return !!info && info.isDirectory() && !info.isSymbolicLink(); };
const isFile = path => { const info = stat(path); return !!info && info.isFile() && !info.isSymbolicLink(); };
const nonEmpty = value => typeof value === 'string' && value.trim().length > 0;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const readJson = path => { try { return { ok: true, value: JSON.parse(readFileSync(path, 'utf8')) }; } catch { return { ok: false }; } };

/** The slot ids an ia.json lists (nodes -> children -> slots, plus extensions), or undefined when it lists none. */
export function iaSlots(doc) {
  if (!object(doc) || !Array.isArray(doc.nodes)) return undefined;
  const ids = new Set();
  for (const node of doc.nodes) for (const child of Array.isArray(node?.children) ? node.children : []) {
    for (const slot of Array.isArray(child?.slots) ? child.slots : []) if (nonEmpty(slot)) ids.add(slot);
  }
  for (const slot of Array.isArray(doc.extensions) ? doc.extensions : []) if (nonEmpty(slot)) ids.add(slot);
  return ids.size ? ids : undefined;
}

function checkSlot(agentDir, agent, slot, add) {
  const dir = join(agentDir, slot), where = `${agent}/${slot}`;
  for (const name of readdirSync(dir).sort()) {
    if (!SLOT_ENTRIES.has(name)) add('stray-entry', `${where}/${name}`, 'a slot folder holds only slot.json, candidates/ and pin.json');
  }
  let notNeeded;
  if (!isFile(join(dir, 'slot.json'))) add('slot-shape', `${where}/slot.json`, 'slot folder has no slot.json');
  else {
    const read = readJson(join(dir, 'slot.json'));
    if (!read.ok || !object(read.value)) add('slot-shape', `${where}/slot.json`, 'slot.json is not a JSON object');
    else if (read.value.notNeeded !== undefined) {
      notNeeded = read.value.notNeeded;
      if (!object(notNeeded) || !nonEmpty(notNeeded.reason)) add('not-needed-reason', `${where}/slot.json`, 'notNeeded has no reason');
    }
  }
  const candidatesDir = join(dir, 'candidates');
  const candidates = [];
  if (isDir(candidatesDir)) {
    for (const name of readdirSync(candidatesDir).sort()) {
      if (isFile(join(candidatesDir, name))) candidates.push(name);
      else add('stray-entry', `${where}/candidates/${name}`, 'candidates/ holds only candidate files');
    }
  } else if (stat(candidatesDir)) add('stray-entry', `${where}/candidates`, 'candidates must be a folder');
  if (!candidates.length) add('no-candidates', where, 'slot has no candidate files');
  const pinPath = join(dir, 'pin.json');
  if (!stat(pinPath)) return { pinned: false, notNeeded: notNeeded !== undefined };
  if (!isFile(pinPath)) { add('stray-entry', `${where}/pin.json`, 'pin.json must be a file'); return { pinned: false, notNeeded: notNeeded !== undefined }; }
  const read = readJson(pinPath);
  if (!read.ok || !object(read.value)) { add('pin-attribution', `${where}/pin.json`, 'pin.json is not a JSON object'); return { pinned: true }; }
  const pin = read.value;
  if (!nonEmpty(pin.decidedBy)) add('pin-attribution', `${where}/pin.json`, 'pin has no decidedBy');
  if (pin.basis === undefined) add('pin-attribution', `${where}/pin.json`, `pin has no basis (${PIN_BASES.join(' | ')})`);
  else if (!PIN_BASES.includes(pin.basis)) add('pin-attribution', `${where}/pin.json`, `pin basis ${JSON.stringify(pin.basis)} is not ${PIN_BASES.join(' | ')}`);
  if (!nonEmpty(pin.candidate) || pin.candidate.includes('/') || pin.candidate.includes('\\') || !candidates.includes(pin.candidate)) {
    add('pin-candidate', `${where}/pin.json`, `pinned candidate ${nonEmpty(pin.candidate) ? pin.candidate : '(none)'} does not exist`);
  } else {
    const sha256 = createHash('sha256').update(readFileSync(join(candidatesDir, pin.candidate))).digest('hex');
    if (pin.sha256 !== sha256) add('pin-hash', `${where}/pin.json`, `sha256 differs from ${pin.candidate}`);
  }
  return { pinned: true, basis: pin.basis };
}

/** Every Git CMS finding and a per-agent summary under `<consumer>/agents`. */
export function checkGitCms(consumer) {
  const agents = join(consumer, 'agents');
  const findings = [];
  const summary = {};
  for (const agent of readdirSync(agents).sort()) {
    const agentDir = join(agents, agent);
    const before = findings.length;
    const add = (rule, path, message) => findings.push({ rule, agent, path, message });
    const row = summary[agent] = { slots: 0, pinned: 0, notNeeded: 0, basis: { picked: 0, bulk: 0, planner: 0 }, findings: 0 };
    if (!isDir(agentDir)) { add('stray-entry', agent, 'clossys/agents holds only agent folders'); row.findings = findings.length - before; continue; }
    let listed;
    if (!isFile(join(agentDir, 'ia.json'))) add('missing-ia', `${agent}/ia.json`, 'agent folder has no ia.json');
    else {
      const read = readJson(join(agentDir, 'ia.json'));
      listed = read.ok ? iaSlots(read.value) : undefined;
      if (!listed) add('missing-ia', `${agent}/ia.json`, 'ia.json is not an IA document that lists slots');
    }
    const present = new Set();
    for (const name of readdirSync(agentDir).sort()) {
      if (name === 'ia.json') continue;
      const path = join(agentDir, name);
      if (!isDir(path)) { add('stray-entry', `${agent}/${name}`, 'an agent folder holds only ia.json and slot folders'); continue; }
      if (listed?.has(name)) { present.add(name); continue; }
      if (isFile(join(path, 'slot.json'))) add('unlisted-slot', `${agent}/${name}`, 'slot folder is not listed in ia.json');
      else add('stray-entry', `${agent}/${name}`, 'an agent folder holds only ia.json and slot folders');
    }
    for (const slot of listed ?? []) {
      if (!present.has(slot)) { add('missing-slot', `${agent}/${slot}`, 'ia.json lists a slot with no folder'); continue; }
      row.slots++;
      const state = checkSlot(agentDir, agent, slot, add);
      if (state.pinned) row.pinned++;
      if (state.notNeeded) row.notNeeded++;
      if (PIN_BASES.includes(state.basis)) row.basis[state.basis]++;
    }
    row.findings = findings.length - before;
  }
  return { findings, summary };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const at = args.indexOf('--repo');
  if (at >= 0 && (!args[at + 1] || args[at + 1].startsWith('--'))) { console.error('check-git-cms: --repo requires a value'); process.exit(2); }
  const repo = resolve(at >= 0 ? args[at + 1] : join(dirname(fileURLToPath(import.meta.url)), '..'));
  const consumer = join(repo, 'clossys');
  if (!isDir(join(consumer, 'agents'))) { console.error(`check-git-cms: no clossys/agents under ${repo}`); process.exit(2); }
  const { findings, summary } = checkGitCms(consumer);
  if (args.includes('--json')) console.log(JSON.stringify({ ok: findings.length === 0, summary, findings }, null, 2));
  else {
    for (const row of findings) console.log(`FAIL ${row.rule} ${row.path}: ${row.message}`);
    for (const [agent, row] of Object.entries(summary)) {
      console.log(`${row.findings ? 'red  ' : 'green'} ${agent}: ${row.slots} slots, ${row.pinned} pinned (picked ${row.basis.picked}, bulk ${row.basis.bulk}, planner ${row.basis.planner}), ${row.notNeeded} not needed, ${row.findings} finding(s)`);
    }
    const red = Object.entries(summary).filter(([, row]) => row.findings).map(([agent]) => agent);
    console.log(`check-git-cms: ${findings.length} finding(s); ${red.length ? `red: ${red.join(', ')}` : 'every agent tree is green'}`);
  }
  process.exit(findings.length ? 1 : 0);
}
