#!/usr/bin/env node
/**
 * One-off migration (PIN-CLI): rewrite every pre-CLI pin.json ({candidate, sha256, pinnedBy, at})
 * to the decision shape ({candidate, sha256, decidedBy, at}) through `clossys pin` itself, never by
 * editing the file. Each slot keeps the candidate it pins and its original `at`; decidedBy is
 * `migrated` (the earlier pinnedBy ref stays in git history).
 *
 * Usage: node scripts/migrate-pin-decided-by.mjs [--repo <foundry checkout>] [--dry-run]
 * Needs `npm run build` (runs dist/cli/index.js). Exit 0 all migrated, 1 any refusal or drift.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const at = args.indexOf('--repo');
const repo = resolve(at >= 0 ? args[at + 1] : join(here, '../../..'));
const dryRun = args.includes('--dry-run');
const cli = join(here, '../dist/cli/index.js');
if (!existsSync(cli)) { console.error('migrate-pin-decided-by: build @clossys/producer first (dist/cli/index.js)'); process.exit(2); }
const agents = join(repo, 'clossys', 'agents');

let migrated = 0, skipped = 0;
const failures = [];
for (const agent of readdirSync(agents).sort()) {
  if (agent.startsWith('_') || agent.startsWith('.') || !existsSync(join(agents, agent, 'ia.json'))) continue;
  for (const slot of readdirSync(join(agents, agent)).sort()) {
    const pinPath = join(agents, agent, slot, 'pin.json');
    if (!existsSync(pinPath)) continue;
    const before = JSON.parse(readFileSync(pinPath, 'utf8'));
    if (typeof before.decidedBy === 'string' && !('pinnedBy' in before)) { skipped++; continue; }
    const argv = [cli, 'pin', `${agent}/${slot}`, before.candidate, '--by', 'migrated', '--at', before.at, '--root', repo, '--json'];
    if (dryRun) { console.log(`would run: clossys ${argv.slice(1).join(' ')}`); migrated++; continue; }
    try {
      execFileSync(process.execPath, argv, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
    } catch (error) {
      failures.push(`${agent}/${slot}: ${String(error.stdout || error.stderr || error.message).trim()}`);
      continue;
    }
    const after = JSON.parse(readFileSync(pinPath, 'utf8'));
    if (after.candidate !== before.candidate) failures.push(`${agent}/${slot}: candidate changed ${before.candidate} -> ${after.candidate}`);
    else if (after.sha256 !== before.sha256) failures.push(`${agent}/${slot}: sha256 changed for ${before.candidate}`);
    else migrated++;
  }
}
console.log(`migrate-pin-decided-by: ${migrated} ${dryRun ? 'to migrate' : 'migrated'}, ${skipped} already in shape, ${failures.length} failed`);
for (const line of failures) console.log(`  ${line}`);
process.exit(failures.length ? 1 : 0);
