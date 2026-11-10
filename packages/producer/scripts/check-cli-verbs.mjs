#!/usr/bin/env node
/**
 * The read-only clossys verbs run on the real consumer store (rule R-CLI-DETERMINISTIC: clossys
 * verbs = brief, check, compile only; agents derive).
 *
 * Runs every read-only verb of the built CLI (dist/cli/index.js) twice with `--root <root> --json`:
 * the agent briefs and checks, the publish dry run, decisions and the option-class check. Each must
 * exit 0 and print byte-identical output on both runs. `clossys check` is held to the same bar: on
 * the committed store it must exit 0 (a finding, exit 1, is a red verb, never an accepted outcome)
 * and repeat byte for byte.
 * compile writes the generated files; check:compile-pure proves it.
 *
 * Usage: node scripts/check-cli-verbs.mjs [--root <foundry checkout>]
 * Needs `npm run build` (reads dist). Exit 0 clean, 1 findings, 2 usage or load error.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** [verb argv, exit codes allowed]: every read-only verb must exit 0 on the committed store. */
export const VERBS = [
  [['direct', '--brief'], [0]], [['direct', '--check'], [0]],
  [['design', '--brief'], [0]], [['design', '--check'], [0]],
  [['write', '--brief'], [0]], [['write', '--check'], [0]],
  [['publish'], [0]],
  [['decisions'], [0]],
  [['options', '--classes', '--check'], [0]],
  [['check'], [0]],
];

/** The findings of one verb from its two runs (`{ status, stdout, stderr }` each). */
export function verbFindings(argv, allowed, first, second) {
  const findings = [];
  const name = `clossys ${argv.join(' ')}`;
  const code = first.status ?? 1;
  if (!allowed.includes(code)) {
    const why = (first.stderr || first.stdout).trim().split('\n').slice(-1)[0] ?? '';
    findings.push(`${name} [exit] exited ${code} on the store (allowed ${allowed.join(' or ')})${why ? `: ${why.slice(0, 240)}` : ''}`);
  }
  if (second.status !== first.status || second.stdout !== first.stdout) findings.push(`${name} [nondeterministic] two runs on the same store differ (exit ${first.status} vs ${second.status}, ${first.stdout.length} vs ${second.stdout.length} bytes)`);
  return findings;
}

function main() {
  const args = process.argv.slice(2);
  const at = args.indexOf('--root');
  if (at >= 0 && !args[at + 1]) { console.error('check-cli-verbs: --root needs a directory'); process.exit(2); }
  const root = at >= 0 ? realpathSync(resolve(args[at + 1])) : resolve(here, '../../..');
  const cli = join(here, '../dist/cli/index.js');
  if (!existsSync(cli)) { console.error('check-cli-verbs: build @clossys/producer first (dist/cli/index.js)'); process.exit(2); }
  if (!existsSync(join(root, 'clossys', 'agents'))) { console.error(`check-cli-verbs: no clossys/agents under ${root}`); process.exit(2); }
  const run = argv => spawnSync(process.execPath, [cli, ...argv, '--root', root, '--json'], { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' } });
  const findings = [];
  for (const [argv, allowed] of VERBS) findings.push(...verbFindings(argv, allowed, run(argv), run(argv)));
  console.log(`check-cli-verbs: ${VERBS.length} verbs, ${findings.length} finding(s)`);
  for (const finding of findings) console.log(`  ${finding}`);
  process.exit(findings.length ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
