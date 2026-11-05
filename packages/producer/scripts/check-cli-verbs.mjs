#!/usr/bin/env node
/**
 * The read-only clossys verbs run on the real consumer store (rule R-CLI-DETERMINISTIC: clossys
 * verbs = brief, check, compile only; agents derive).
 *
 * Runs every read-only verb of the built CLI (dist/cli/index.js) twice with `--root <root> --json`:
 * the agent briefs and checks, the publish dry run, decisions and the option-class check. Each must
 * exit 0 and print byte-identical output on both runs. `clossys check` must also run (exit 0 or 1,
 * never 2) and repeat byte for byte; its findings are the slot resolver's (check:slot-pins) and
 * Designer ref-verbatim's (packages/designer check:ref-verbatim), which those checks enforce.
 * compile writes the generated files; check:compile-pure proves it.
 *
 * Usage: node scripts/check-cli-verbs.mjs [--root <foundry checkout>]
 * Needs `npm run build` (reads dist). Exit 0 clean, 1 findings, 2 usage or load error.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const at = args.indexOf('--root');
if (at >= 0 && !args[at + 1]) { console.error('check-cli-verbs: --root needs a directory'); process.exit(2); }
const root = at >= 0 ? realpathSync(resolve(args[at + 1])) : resolve(here, '../../..');
const cli = join(here, '../dist/cli/index.js');
if (!existsSync(cli)) { console.error('check-cli-verbs: build @clossys/producer first (dist/cli/index.js)'); process.exit(2); }
if (!existsSync(join(root, 'clossys', 'agents'))) { console.error(`check-cli-verbs: no clossys/agents under ${root}`); process.exit(2); }

/** [verb argv, exit codes allowed]. */
const VERBS = [
  [['direct', '--brief'], [0]], [['direct', '--check'], [0]],
  [['design', '--brief'], [0]], [['design', '--check'], [0]],
  [['write', '--brief'], [0]], [['write', '--check'], [0]],
  [['publish'], [0]],
  [['decisions'], [0]],
  [['options', '--classes', '--check'], [0]],
  [['check'], [0, 1]],
];

const run = argv => spawnSync(process.execPath, [cli, ...argv, '--root', root, '--json'], { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' } });
const findings = [];
for (const [argv, allowed] of VERBS) {
  const name = `clossys ${argv.join(' ')}`;
  const first = run(argv), second = run(argv);
  const code = first.status ?? 1;
  if (!allowed.includes(code)) {
    const why = (first.stderr || first.stdout).trim().split('\n').slice(-1)[0] ?? '';
    findings.push(`${name} [exit] exited ${code} on the store (allowed ${allowed.join(' or ')})${why ? `: ${why.slice(0, 240)}` : ''}`);
  }
  if (second.status !== first.status || second.stdout !== first.stdout) findings.push(`${name} [nondeterministic] two runs on the same store differ (exit ${first.status} vs ${second.status}, ${first.stdout.length} vs ${second.stdout.length} bytes)`);
}
console.log(`check-cli-verbs: ${VERBS.length} verbs, ${findings.length} finding(s)`);
for (const finding of findings) console.log(`  ${finding}`);
process.exit(findings.length ? 1 : 0);
