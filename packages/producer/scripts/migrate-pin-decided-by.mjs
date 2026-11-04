#!/usr/bin/env node
/**
 * One-off migration (PIN-CLI): rewrite every pin.json to the decision shape
 * ({candidate, sha256, decidedBy, at}) through `clossys pin` itself, never by editing the file.
 *
 * The recorded provenance is kept: decidedBy is the pin's original `pinnedBy`, verbatim, read from
 * the base commit (default 452003304, the last commit before the decidedBy rename) or from the
 * current file when it still has one. `migrated` is used only when a pin had no pinnedBy. Each slot
 * keeps the candidate it pins, its sha256 and its original `at`.
 *
 * Usage: node scripts/migrate-pin-decided-by.mjs [--repo <foundry checkout>] [--base <commit>] [--dry-run]
 * Needs `npm run build` (runs dist/cli/index.js). Exit 0 all migrated, 1 any refusal or drift.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_BASE = '452003304';

/** The pin.json at `base`, or null when the slot had no pin there (or `base` is unknown). */
function basePin(repo, base, rel) {
  try {
    return JSON.parse(execFileSync('git', ['-C', repo, 'show', `${base}:${rel}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch {
    return null;
  }
}

/** The decidedBy a migrated pin must carry: the original pinnedBy verbatim, else `migrated`. */
export function decidedByFor(current, original) {
  if (typeof current?.pinnedBy === 'string' && current.pinnedBy) return current.pinnedBy;
  if (typeof original?.pinnedBy === 'string' && original.pinnedBy) return original.pinnedBy;
  if (typeof original?.decidedBy === 'string' && original.decidedBy) return original.decidedBy;
  return 'migrated';
}

/**
 * Migrate every pin under <repo>/clossys/agents. `runPin(args)` runs `clossys pin <args>` and
 * resolves to {ok, output}. Returns {migrated, skipped, failures, planned}.
 */
export async function migratePins({ repo, base = DEFAULT_BASE, runPin, dryRun = false }) {
  const agents = join(repo, 'clossys', 'agents');
  let migrated = 0, skipped = 0;
  const failures = [], planned = [];
  for (const agent of readdirSync(agents).sort()) {
    if (agent.startsWith('_') || agent.startsWith('.') || !existsSync(join(agents, agent, 'ia.json'))) continue;
    for (const slot of readdirSync(join(agents, agent)).sort()) {
      const rel = `clossys/agents/${agent}/${slot}/pin.json`;
      const pinPath = join(repo, rel);
      if (!existsSync(pinPath)) continue;
      const before = JSON.parse(readFileSync(pinPath, 'utf8'));
      const original = basePin(repo, base, rel);
      const by = decidedByFor(before, original);
      const at = typeof original?.at === 'string' && original?.candidate === before.candidate ? original.at : before.at;
      if (before.decidedBy === by && before.at === at && !('pinnedBy' in before)) { skipped++; continue; }
      const args = ['pin', `${agent}/${slot}`, before.candidate, '--by', by, '--at', at, '--root', repo, '--json'];
      if (dryRun) { planned.push(args); migrated++; continue; }
      const result = await runPin(args);
      if (!result.ok) { failures.push(`${agent}/${slot}: ${String(result.output).trim()}`); continue; }
      const after = JSON.parse(readFileSync(pinPath, 'utf8'));
      if (after.candidate !== before.candidate) failures.push(`${agent}/${slot}: candidate changed ${before.candidate} -> ${after.candidate}`);
      else if (after.sha256 !== before.sha256) failures.push(`${agent}/${slot}: sha256 changed for ${before.candidate}`);
      else if (after.decidedBy !== by) failures.push(`${agent}/${slot}: decidedBy is ${after.decidedBy}, expected ${by}`);
      else migrated++;
    }
  }
  return { migrated, skipped, failures, planned };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const here = dirname(fileURLToPath(import.meta.url));
  const args = process.argv.slice(2);
  const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const repo = resolve(flag('--repo') ?? join(here, '../../..'));
  const base = flag('--base') ?? DEFAULT_BASE;
  const dryRun = args.includes('--dry-run');
  const cli = join(here, '../dist/cli/index.js');
  if (!existsSync(cli)) { console.error('migrate-pin-decided-by: build @clossys/producer first (dist/cli/index.js)'); process.exit(2); }
  const runPin = async (pinArgs) => {
    try {
      return { ok: true, output: execFileSync(process.execPath, [cli, ...pinArgs], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }) };
    } catch (error) {
      return { ok: false, output: error.stdout || error.stderr || error.message };
    }
  };
  const { migrated, skipped, failures, planned } = await migratePins({ repo, base, runPin, dryRun });
  for (const line of planned) console.log(`would run: clossys ${line.join(' ')}`);
  console.log(`migrate-pin-decided-by: ${migrated} ${dryRun ? 'to migrate' : 'migrated'}, ${skipped} already in shape, ${failures.length} failed`);
  for (const line of failures) console.log(`  ${line}`);
  process.exit(failures.length ? 1 : 0);
}
