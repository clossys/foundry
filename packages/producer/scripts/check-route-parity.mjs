#!/usr/bin/env node
/**
 * route-parity: Studio's served app directory is exactly what Publisher installs, byte for byte.
 * The check reinstalls `publication.studio` from the pinned records (`publish --install --next`, the
 * same call `npm run generate:studio-map` makes) into an empty temporary app directory, then compares
 * every file under `studio/app` with that fresh install in both directions:
 *
 *   route-not-installed  a file under studio/app that a fresh install does not write (a hand-made
 *                        route, layout, state file or stylesheet, even one that copies the marker)
 *   route-drift          an installed file whose bytes differ from the fresh install (a hand edit
 *                        under a copied marker, or records changed without reinstalling)
 *   route-missing        a file the fresh install writes that studio/app does not have
 *
 * The marker only says who should have written a file; this check proves it. Fix by reinstalling
 * (`npm run generate:studio-map` or `clossys compile`), never by editing studio/app.
 *
 * Usage: node scripts/check-route-parity.mjs [--root <repository>] [--clossys <records>] [--json].
 * `--root` compares another repository tree's packages/producer/studio/app; the records come from
 * `--clossys` (default: this repository's clossys/). Exit 1 on any finding.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { publishNext } from '../dist/publish/install-next.js';

const PRODUCER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPOSITORY_ROOT = path.resolve(PRODUCER_ROOT, '../..');
/** Kept equal to generate-studio-map.mjs (STUDIO_ASSEMBLY, STUDIO_STATES); the tests pin them. */
export const PARITY_INSTALL = Object.freeze({ publication: 'studio', assembly: '../components/StudioInstalledPage.tsx', states: '../components/StudioPage.tsx', live: true });

const posix = file => file.split(path.sep).join('/');
function walk(directory, root = directory) {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(file, root));
    else files.push(posix(path.relative(root, file)));
  }
  return files.sort();
}

/** Reinstall into a temporary app directory and compare it with `appDir`. */
export async function checkRouteParity({ appDir = path.join(REPOSITORY_ROOT, 'packages/producer/studio/app'), clossysRoot = path.join(REPOSITORY_ROOT, 'clossys') } = {}) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'route-parity-'));
  try {
    const fresh = path.join(scratch, 'app');
    fs.mkdirSync(fresh);
    const result = await publishNext({ root: path.dirname(path.resolve(clossysRoot)), app: fresh, out: path.join(scratch, 'out'), ...PARITY_INSTALL });
    const blocking = result.findings.filter(finding => finding.severity !== 'info');
    if (blocking.length) throw new Error(`Publisher could not reinstall the studio routes: ${blocking.map(finding => finding.detail).join('; ')}`);
    const installed = new Set(walk(fresh));
    const served = walk(appDir);
    const findings = [];
    for (const file of served) {
      const rel = `app/${file}`;
      if (!installed.has(file)) findings.push({ rule: 'route-not-installed', file: rel, message: 'a fresh Publisher install does not write this file; reinstall instead of adding files to app/' });
      else if (!fs.readFileSync(path.join(appDir, file)).equals(fs.readFileSync(path.join(fresh, file)))) findings.push({ rule: 'route-drift', file: rel, message: 'differs from a fresh Publisher install; reinstall instead of editing it' });
    }
    const servedSet = new Set(served);
    for (const file of installed) if (!servedSet.has(file)) findings.push({ rule: 'route-missing', file: `app/${file}`, message: 'a fresh Publisher install writes this file, but app/ does not have it' });
    return { findings, compared: served.length, installed: installed.size };
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const option = name => { const at = args.indexOf(name); return at >= 0 ? path.resolve(args[at + 1]) : undefined; };
  const root = option('--root') ?? REPOSITORY_ROOT;
  const clossys = option('--clossys');
  const result = await checkRouteParity({ appDir: path.join(root, 'packages/producer/studio/app'), ...(clossys ? { clossysRoot: clossys } : {}) });
  if (args.includes('--json')) console.log(JSON.stringify(result, null, 2));
  else {
    for (const finding of result.findings) console.log(`${finding.rule}  ${finding.file}  ${finding.message}`);
    console.log(result.findings.length ? `route-parity: ${result.findings.length} finding(s)` : `route-parity: OK (${result.compared} files under app/ match a fresh Publisher install)`);
  }
  process.exitCode = result.findings.length ? 1 : 0;
}
