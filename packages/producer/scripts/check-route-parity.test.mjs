import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkRouteParity, checkSiteTemplateParity, PARITY_INSTALL } from './check-route-parity.mjs';
import { checkSiteTemplateRoutesPublished } from './check-routes-published.mjs';
import { SITE_TEMPLATE } from './site-template-install.mjs';
import { STUDIO_ASSEMBLY, STUDIO_STATES } from './generate-studio-map.mjs';

const studioApp = fileURLToPath(new URL('../studio/app/', import.meta.url));
const copyApp = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'route-parity-test-'));
  fs.cpSync(studioApp, path.join(dir, 'app'), { recursive: true });
  return path.join(dir, 'app');
};
const rules = result => result.findings.map(finding => `${finding.rule} ${finding.file}`).sort();

test('reinstalls with the same call generate:studio-map makes', () => {
  assert.equal(PARITY_INSTALL.assembly, STUDIO_ASSEMBLY);
  assert.equal(PARITY_INSTALL.states, STUDIO_STATES);
  assert.equal(PARITY_INSTALL.live, true);
});

test('the checked-in studio/app is byte-identical to a fresh Publisher install', async () => {
  const result = await checkRouteParity();
  assert.deepEqual(result.findings, []);
  assert.ok(result.compared > 5 && result.compared === result.installed);
});

test('a hand edit under a copied marker, a hand-made marked route and a removed state file all fail', async () => {
  const app = copyApp();
  try {
    const layout = path.join(app, 'layout.tsx');
    const [marker] = fs.readFileSync(layout, 'utf8').split('\n', 1);
    // The marker survives, the body is hand-written: only a byte compare catches it.
    fs.writeFileSync(layout, `${marker}\nexport default function Layout({ children }) { return children; }\n`);
    fs.mkdirSync(path.join(app, 'hand'));
    fs.writeFileSync(path.join(app, 'hand', 'page.tsx'), fs.readFileSync(path.join(app, 'page.tsx')));
    fs.writeFileSync(path.join(app, 'globals.css'), '@import "tailwindcss";\n');
    fs.unlinkSync(path.join(app, 'not-found.tsx'));
    const result = await checkRouteParity({ appDir: app });
    assert.deepEqual(rules(result), ['route-drift app/layout.tsx', 'route-missing app/not-found.tsx', 'route-not-installed app/globals.css', 'route-not-installed app/hand/page.tsx']);
  } finally { fs.rmSync(path.dirname(app), { recursive: true, force: true }); }
});

const repository = fileURLToPath(new URL('../../../', import.meta.url));
/** A repository tree holding only a copy of the site template, for the site-template surface. */
const copyTemplate = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'site-template-test-'));
  fs.cpSync(path.join(repository, SITE_TEMPLATE), path.join(root, SITE_TEMPLATE), { recursive: true, filter: source => !/[\\/](?:node_modules|\.next)(?:[\\/]|$)/.test(source) });
  return root;
};
const where = result => result.findings.map(finding => `${finding.rule} ${finding.file ?? finding.where}`).sort();

test('the site template ships no route file and its installed routes are stable and published', async () => {
  const parity = await checkSiteTemplateParity();
  assert.deepEqual(parity.findings, []);
  assert.ok(parity.installed >= 7, `the install writes the shell and both page routes (${parity.installed})`);
  const published = await checkSiteTemplateRoutesPublished();
  assert.deepEqual(published.findings, []);
  assert.equal(published.routes, 7);
});

test('a hand-written site-template route, metadata route or install script fails both site-template checks', async () => {
  const root = copyTemplate();
  try {
    const app = path.join(root, SITE_TEMPLATE, 'app');
    fs.mkdirSync(path.join(app, 'pack'));
    fs.writeFileSync(path.join(app, 'pack', 'page.tsx'), 'export default function Page() { return null; }\n');
    fs.writeFileSync(path.join(app, 'robots.ts'), 'export default function robots() { return { rules: [] }; }\n');
    const pkg = path.join(root, SITE_TEMPLATE, 'package.json');
    const manifest = JSON.parse(fs.readFileSync(pkg, 'utf8'));
    delete manifest.scripts.prebuild;
    fs.writeFileSync(pkg, JSON.stringify(manifest, null, 2));
    assert.deepEqual(where(await checkSiteTemplateParity({ root })), ['route-missing site/package.json#scripts.prebuild', 'route-not-installed site/app/pack/page.tsx', 'route-not-installed site/app/robots.ts']);
    assert.deepEqual(where(await checkSiteTemplateRoutesPublished({ root })), ['route-unpublished site/app/pack/page.tsx', 'route-unpublished site/app/robots.ts']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a hand-written root layout in the template is refused by the install and reported by both checks', async () => {
  const root = copyTemplate();
  try {
    fs.writeFileSync(path.join(root, SITE_TEMPLATE, 'app', 'layout.tsx'), 'export default function Layout({ children }) { return children; }\n');
    const parity = where(await checkSiteTemplateParity({ root }));
    assert.ok(parity.includes('route-not-installed site/app/layout.tsx') && parity.includes('route-missing site/app'), parity.join('; '));
    assert.deepEqual(where(await checkSiteTemplateRoutesPublished({ root })), ['shell-unpublished site/app/layout.tsx']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
