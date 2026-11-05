import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkRouteParity, PARITY_INSTALL } from './check-route-parity.mjs';
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
