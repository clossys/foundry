'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { test } = require('node:test');
const { findRouteLiterals, inspectFrameProjection, inspectShellProjection, productionFiles, checkStudioMap } = require('./check-studio-map.cjs');

const studioRoot = path.resolve(__dirname, '..');
const repositoryRoot = path.resolve(studioRoot, '../../..');

test('the renderer feeds the pinned frame only by spreading the map projection', () => {
  const source = `
    import { studioFrames } from '../generated/assembly-bindings';
    function Frame({ entry, page }) {
      const Shell = studioFrames[page.frameId];
      const projection = useMemo(() => studioShellProjection(map, entry.id), [map, entry.id]);
      return <Shell {...projection} actions={[]} />;
    }`;
  assert.deepEqual(inspectFrameProjection(source), []);
});

test('a redundant route list inserted into the renderer fails even when it is unused', () => {
  const source = fs.readFileSync(path.join(studioRoot, 'components/StudioPage.tsx'), 'utf8');
  const mutation = source + `\nconst redundantDestinations = [{ id: 'fixture', label: 'Fixture', href: '/fixture-page' }];\n`;
  assert.ok(findRouteLiterals(mutation, 'components/StudioPage.tsx').some(row => row.value === '/fixture-page'));
});

test('overriding a projected frame input with a hand-written attribute fails', () => {
  const source = `const Shell = studioFrames[id]; const projection = studioShellProjection(map, id);
    const view = <Shell {...projection} commands={[{ id: 'pages', items: [] }]} />;`;
  assert.ok(inspectFrameProjection(source).some(row => row.input === 'commands' && row.rule === 'frame-input-outside-projection'));
});

test('spreading the projection does not conceal an added hand-authored navigation node', () => {
  const source = `const Shell = studioFrames[id]; const base = studioShellProjection(map, id);
    const projection = { ...base, navigation: { tree: [{ id: 'fixture', label: 'Fixture' }] } };
    const view = <Shell {...projection} />;`;
  assert.deepEqual(inspectFrameProjection(source).map(row => row.rule), ['hand-authored-frame-map-node']);
});

test('a frame fed by anything but studioShellProjection fails', () => {
  const source = `const Shell = studioFrames[id]; const projection = { navigation, commands };
    const view = <Shell {...projection} />;`;
  assert.deepEqual(inspectFrameProjection(source).map(row => row.required), ['studioShellProjection']);
});

test('the shell projection must be the Publisher content-map projections', () => {
  assert.deepEqual(inspectShellProjection('const nav = projectNavigation(map, id); const cmd = projectCommands(map); const crumbs = projectBreadcrumbs(map, id);'), []);
  assert.deepEqual(inspectShellProjection('const nav = projectNavigation(map, id); const cmd = [];').map(row => row.projector), ['projectCommands', 'projectBreadcrumbs']);
});

test('only code the App Router entries reach is production: orphan modules are not scanned, the map module owns its strings', () => {
  const files = productionFiles(studioRoot).map(file => path.relative(studioRoot, file).split(path.sep).join('/'));
  assert.ok(files.includes('components/StudioPage.tsx') && files.includes('frames/studio-shell/index.tsx'));
  assert.ok(!files.includes('lib/studio-route-map.ts') && !files.includes('generated/studio-map.ts'));
  assert.ok(files.every(file => !file.startsWith('checks/')));
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
    const sheet = <link rel="stylesheet" href="/api/designer/globals.css" />;
    const specimen = \`/__specimen?\${params}\`;
  `;
  assert.deepEqual(findRouteLiterals(source), []);
});

test('the checked-in Studio projection matches its ordinary Publisher cells and production consumers', async () => {
  assert.deepEqual(await checkStudioMap(), []);
});

test('changing a Publisher page cell without regenerating fails projection drift', async t => {
  const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'studio-map-check-')));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const clossysRoot = path.join(temporary, 'clossys');
  const outputDir = path.join(temporary, 'generated');
  const source = path.join(repositoryRoot, 'clossys');
  fs.mkdirSync(path.join(clossysRoot, 'agents', 'designer'), { recursive: true });
  fs.cpSync(path.join(source, 'agents/publisher'), path.join(clossysRoot, 'agents/publisher'), { recursive: true });
  fs.cpSync(path.join(source, 'agents/designer/slot-contracts'), path.join(clossysRoot, 'agents/designer/slot-contracts'), { recursive: true });
  fs.cpSync(path.join(source, 'library'), path.join(clossysRoot, 'library'), { recursive: true });
  fs.cpSync(path.join(source, 'selection.json'), path.join(clossysRoot, 'selection.json'));
  fs.cpSync(path.join(studioRoot, 'generated'), outputDir, { recursive: true });
  const generator = await import(pathToFileURL(path.resolve(studioRoot, '../scripts/generate-studio-map.mjs')).href);
  await generator.generateStudioMap({ clossysRoot, outputDir, check: true });
  const cellRoot = path.join(clossysRoot, 'agents/publisher');
  const page = path.join(cellRoot, 'cells', 'page.designer', 'v2.md');
  const text = fs.readFileSync(page, 'utf8');
  // A published page title is map input, so changing it must change projected bytes.
  assert.match(text, /^title:\s*.+$/m);
  fs.writeFileSync(page, text.replace(/^(title:\s*)(.+)$/m, '$1Fixture changed title'));
  const findings = await checkStudioMap({ clossysRoot, outputDir });
  assert.ok(findings.some(row => row.rule === 'publisher-projection-drift'), JSON.stringify(findings));
  const { compileContentMaps } = await import('@clossys/publisher/content-map/cells');
  await compileContentMaps(cellRoot);
  const staleStudio = await checkStudioMap({ clossysRoot, outputDir });
  assert.ok(staleStudio.some(row => row.rule === 'publisher-projection-drift' && /Generated Studio projection drift/.test(row.message)), JSON.stringify(staleStudio));
});
