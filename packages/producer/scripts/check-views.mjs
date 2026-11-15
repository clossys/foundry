#!/usr/bin/env node
/**
 * View prompts read only through the four read verbs (`views.inputs-only`, system.md 6.6).
 *
 * 1. Every package view (packages/<agent>/views/*.md) and every consumer shadow
 *    (<consumer>/clossys/agents/<agent>/views/*.md) passes `checkViews`: a valid clossys.view/1
 *    header, inputs only `clossys status|slot|render|preview`, no paths, no file reads, no tool names.
 * 2. The nine starter views ship.
 *
 * Usage: node scripts/check-views.mjs [--repo <foundry checkout>] [--root <consumer root>] [--json]
 * The consumer root is --root, else $CLOSSYS_ROOT, else none (package views only).
 * Needs `npm run build` (reads dist). Exit 0 clean, 1 findings, 2 usage or load error.
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = name => { const at = args.indexOf(name); return at < 0 ? undefined : args[at + 1]; };
const repo = resolve(flag('--repo') ?? join(here, '../../..'));
const consumerArg = flag('--root') ?? process.env.CLOSSYS_ROOT;
const consumer = consumerArg ? resolve(consumerArg) : undefined;
const json = args.includes('--json');
if (!existsSync(join(repo, 'packages'))) { console.error(`check-views: no packages/ under ${repo}`); process.exit(2); }

let checkViews;
try { ({ checkViews } = await import('../dist/check/views-inputs-only.js')); }
catch { console.error('check-views: build @clossys/producer first (dist/check/views-inputs-only.js)'); process.exit(2); }

const STARTERS = [
  'director/roadmap-board',
  'designer/theme-board', 'designer/slot-compare',
  'writer/copy-table',
  'publisher/directory-map', 'publisher/page-preview', 'publisher/release-manifest',
  'producer/queue-inbox', 'producer/ledger-runs',
];

const packages = checkViews(repo, { consumer: false });
const findings = [...packages.findings];
let files = packages.files;
if (consumer) {
  const shadows = checkViews(consumer, { packages: false });
  findings.push(...shadows.findings);
  files += shadows.files;
}
for (const id of STARTERS) {
  const [agent, view] = id.split('/');
  if (!existsSync(join(repo, 'packages', agent, 'views', `${view}.md`))) {
    findings.push({ check: 'views.inputs-only', subject: id, detail: `starter view ${id} is missing` });
  }
}

if (json) console.log(JSON.stringify({ check: 'views.inputs-only', status: findings.length ? 'fail' : 'pass', files, findings }, null, 2));
else if (findings.length) {
  for (const f of findings) console.error(`check-views: ${f.subject}: ${f.detail}`);
  console.error(`check-views: ${findings.length} finding(s) over ${files} view file(s)`);
} else console.log(`check-views: ok (${files} view files, ${STARTERS.length} starters)`);
process.exit(findings.length ? 1 : 0);
