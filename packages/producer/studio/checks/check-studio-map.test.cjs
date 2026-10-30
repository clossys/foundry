'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { test } = require('node:test');
const { findRouteLiterals, inspectFrameProjection, checkStudioMap } = require('./check-studio-map.cjs');

const studioRoot = path.resolve(__dirname, '..');
const repositoryRoot = path.resolve(studioRoot, '../../..');

test('production navigation and command inputs follow the same generated Publisher projection', () => {
  const source = `
    import { studioNavigation as nav, studioCommands as cmd } from '../generated/studio-map';
    function navigation() { return nav[page]; }
    const commands = cmd.map(group => group);
    const view = <AppFrame navigation={{ tree: navigation() }} commands={{ groups: commands }} />;
  `;
  assert.deepEqual(inspectFrameProjection(source), []);
});

test('a redundant route list inserted into StudioFrame fails even when it is unused', () => {
  const source = fs.readFileSync(path.join(studioRoot, 'components/StudioFrame.tsx'), 'utf8');
  const mutation = source + `\nconst redundantDestinations = [{ id: 'fixture', label: 'Fixture', href: '/fixture-page' }];\n`;
  assert.ok(findRouteLiterals(mutation).some(row => row.value === '/fixture-page'));
});

test('replacing projected navigation or commands with a hand-authored list fails', () => {
  const source = `import { studioNavigation } from '../generated/studio-map';
    const view = <AppFrame navigation={{ tree: studioNavigation[page] }} commands={{ groups: [{id: 'pages', items: []}] }} />;`;
  assert.ok(inspectFrameProjection(source).some(row => row.input === 'commands' && row.rule === 'frame-input-outside-projection'));
});

test('referencing generated data does not conceal an added hand-authored navigation node', () => {
  const source = `import { studioNavigation, studioCommands } from '../generated/studio-map';
    const tree = [...studioNavigation[page], { id: 'fixture', label: 'Fixture', href: studioNavigation[page][0].href }];
    const view = <AppFrame navigation={{ tree }} commands={{ groups: studioCommands }} />;`;
  assert.deepEqual(inspectFrameProjection(source).map(row => row.rule), ['hand-authored-frame-map-node']);
});

test('a similarly named foreign generated module cannot supply the authoritative frame inputs', () => {
  const source = `import { studioNavigation, studioCommands } from '../foreign/generated/studio-map';
    const view = <AppFrame navigation={{ tree: studioNavigation[page] }} commands={{ groups: studioCommands }} />;`;
  assert.deepEqual(inspectFrameProjection(source).map(row => row.input), ['navigation', 'commands']);
});

test('literal and constructed route destinations fail in executable AST nodes', () => {
  const source = `const routes = ['/fixture-page']; const route = \`/fixture/\${id}\`;
    const view = <Link href="relative-page" />; router.push('/api/fixture');
    const disguisedRoute = '/fixture.html'; const iconLink = <Link href="/fixture.svg" />;`;
  assert.deepEqual(findRouteLiterals(source).map(row => row.value), ['/fixture-page', '/fixture/', 'relative-page', '/api/fixture', '/fixture.html', '/fixture.svg']);
});

test('data requests, asset URLs, URL shape checks and cell/Source query state are distinct from Studio routes', () => {
  const source = `import value from '/module';
    const image = <Brand markSrc="/fixture.svg" />;
    fetch('/api/fixture'); new EventSource('/api/events');
    const api = \`/api/cells/\${agent}/\${id}\`;
    const dataPath = value.startsWith('/') && !value.startsWith('//');
    const origin = new URL(value); const rootOrigin = origin.pathname === '/';
    Object.assign(globalThis, { modules: { 'react/runtime': value } });
    const parts = value.split('/');
    const source = <Link href={\`?cell=\${id}&source=open\`} />;
    router.replace(\`?\${params}\`); const fragment = <Link href="#source" />;
    // href: '/comment-is-not-code'
    const prose = "Example href='/not-a-route-literal'";
    const pattern = /\\/fixture\\//;
  `;
  assert.deepEqual(findRouteLiterals(source), []);
});

test('the checked-in Studio projection matches its ordinary Publisher cells and production consumers', async () => {
  assert.deepEqual(await checkStudioMap(), []);
});

test('changing a Publisher page cell without regenerating fails projection drift', async t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-map-check-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const cellRoot = path.join(temporary, 'publisher');
  const outputDir = path.join(temporary, 'generated');
  fs.cpSync(path.join(repositoryRoot, 'clossys/agents/publisher'), cellRoot, { recursive: true });
  fs.cpSync(path.join(studioRoot, 'generated'), outputDir, { recursive: true });
  const generator = await import(pathToFileURL(path.resolve(studioRoot, '../scripts/generate-studio-map.mjs')).href);
  await generator.generateStudioMap({ cellRoot, outputDir, check: true });
  const cells = fs.readdirSync(path.join(cellRoot, 'cells')).filter(name => name.startsWith('page.'));
  assert.ok(cells.length, 'the proof uses an actual ordinary Publisher page cell');
  const page = path.join(cellRoot, 'cells', cells[0], 'v1.md');
  const source = fs.readFileSync(page, 'utf8');
  // A published page title is map input, so changing it must change projected bytes.
  assert.match(source, /^title:\s*.+$/m);
  fs.writeFileSync(page, source.replace(/^(title:\s*)(.+)$/m, '$1Fixture changed title'));
  const findings = await checkStudioMap({ cellRoot, outputDir });
  assert.ok(findings.some(row => row.rule === 'publisher-projection-drift'), JSON.stringify(findings));
  const { compileContentMaps } = await import('@clossys/publisher/content-map/cells');
  await compileContentMaps(cellRoot);
  const staleStudio = await checkStudioMap({ cellRoot, outputDir });
  assert.ok(staleStudio.some(row => row.rule === 'publisher-projection-drift' && /Generated Studio projection drift/.test(row.message)), JSON.stringify(staleStudio));
});
