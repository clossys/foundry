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
 * The site template (`--surface site-template`, packages/publisher/templates/site) is a Publisher
 * install too: it ships no route file, and its `publish:site` script (run before `dev` and `build`)
 * has `clossys publish --install --next app --bind` write every route file, the assembly, the states
 * and the page modules from the consumer's pinned page records. The check installs the template for
 * the fixture consumer (site-template-install.mjs) and fails on:
 *
 *   route-not-installed  code or a name-served App Router file (icon, robots, sitemap, OG image) the
 *                        template ships under app/, which only Publisher may install
 *   route-missing        a template whose publish:site script is not that bound install, or whose
 *                        predev/prebuild do not run it; an install Publisher refuses
 *   route-drift          a reinstall (`--check`) that would change any file the install wrote
 *
 * Usage: node scripts/check-route-parity.mjs [--root <repository>] [--clossys <records>]
 * [--surface studio|site-template] [--json]. `--root` checks another repository tree's
 * packages/producer/studio/app and packages/publisher/templates/site; the Studio records come from
 * `--clossys` (default: this repository's clossys/). Both surfaces run unless `--surface` names one.
 * Exit 1 on any finding.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { publishNext } from '../dist/publish/install-next.js';
import { installSiteTemplate, isRouteSource, SITE_TEMPLATE, walk as walkSite } from './site-template-install.mjs';

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

/** The site template's app/ ships no route file, its install script is the bound install, and the install is stable. */
export async function checkSiteTemplateParity({ root = REPOSITORY_ROOT, consumer } = {}) {
  const template = path.join(root, SITE_TEMPLATE);
  const findings = [];
  const add = (rule, file, message) => findings.push({ rule, file, message });
  if (!fs.existsSync(template)) { add('route-missing', 'site', `${SITE_TEMPLATE} does not exist`); return { findings, compared: 0, installed: 0 }; }
  const shipped = walkSite(path.join(template, 'app'));
  for (const file of shipped.filter(isRouteSource)) add('route-not-installed', `site/app/${file}`, 'the template ships this file by hand; Publisher installs every route file from page records (publish:site)');
  let scripts = {};
  try { scripts = JSON.parse(fs.readFileSync(path.join(template, 'package.json'), 'utf8')).scripts ?? {}; } catch { add('route-missing', 'site/package.json', 'the template has no readable package.json'); }
  const publish = scripts['publish:site'] ?? '';
  if (!/^clossys publish --install\b/.test(publish) || !/ --next app\b/.test(publish) || !/ --bind\b/.test(publish) || !/ --selection \S/.test(publish)) {
    add('route-missing', 'site/package.json#scripts.publish:site', 'is not `clossys publish --install --site <publication> --next app --bind --selection <module>`, so nothing installs the routes');
  }
  for (const hook of ['predev', 'prebuild']) if (scripts[hook] !== 'npm run publish:site') add('route-missing', `site/package.json#scripts.${hook}`, 'does not run publish:site, so the site can start or build without its installed routes');

  const install = await installSiteTemplate({ template, ...(consumer ? { consumer } : {}) });
  try {
    const blocking = install.result.findings.filter(finding => finding.severity !== 'info');
    if (blocking.length) { add('route-missing', 'site/app', `Publisher could not install the site template: ${blocking.map(finding => finding.detail).join('; ')}`); return { findings, compared: shipped.length, installed: 0 }; }
    const written = install.result.files.filter(file => file.state !== 'removed');
    const again = await install.reinstall();
    for (const file of again.files.filter(row => row.state === 'drift')) add('route-drift', `site/${file.kind === 'bind' ? file.file : `app/${file.file}`}`, 'a reinstall would change this file: the install is not stable');
    const reported = new Set(findings.map(finding => finding.file));
    const owned = new Set(written.map(file => file.kind === 'bind' ? file.file : `app/${file.file}`));
    for (const file of walkSite(path.join(install.site, 'app'))) {
      const rel = `app/${file}`;
      if (isRouteSource(file) && !owned.has(rel) && !reported.has(`site/${rel}`)) add('route-not-installed', `site/${rel}`, 'is under the installed app/ but no Publisher install wrote it');
    }
    return { findings, compared: shipped.length, installed: written.length };
  } finally {
    fs.rmSync(install.scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const option = name => { const at = args.indexOf(name); return at >= 0 ? path.resolve(args[at + 1]) : undefined; };
  const root = option('--root') ?? REPOSITORY_ROOT;
  const clossys = option('--clossys');
  const surfaceAt = args.indexOf('--surface');
  const surface = surfaceAt >= 0 ? args[surfaceAt + 1] : 'all';
  if (!['all', 'studio', 'site-template'].includes(surface)) throw new Error(`route-parity: --surface is studio or site-template, not ${surface}`);
  const results = {};
  if (surface !== 'site-template') results.studio = await checkRouteParity({ appDir: path.join(root, 'packages/producer/studio/app'), ...(clossys ? { clossysRoot: clossys } : {}) });
  if (surface !== 'studio') results['site-template'] = await checkSiteTemplateParity({ root });
  const findings = Object.values(results).flatMap(result => result.findings);
  if (args.includes('--json')) console.log(JSON.stringify(surface === 'studio' ? results.studio : results, null, 2));
  else {
    for (const finding of findings) console.log(`${finding.rule}  ${finding.file}  ${finding.message}`);
    if (results.studio && !results.studio.findings.length) console.log(`route-parity: studio OK (${results.studio.compared} files under app/ match a fresh Publisher install)`);
    if (results['site-template'] && !results['site-template'].findings.length) console.log(`route-parity: site-template OK (no hand-made route file; ${results['site-template'].installed} files installed from records, stable on reinstall)`);
    if (findings.length) console.log(`route-parity: ${findings.length} finding(s)`);
  }
  process.exitCode = findings.length ? 1 : 0;
}
