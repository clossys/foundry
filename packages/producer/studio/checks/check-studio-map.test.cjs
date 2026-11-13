'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { test } = require('node:test');
const { findRouteLiterals, inspectFrameProjection, inspectShellProjection, productionFiles, orphanModules, checkStudioMap } = require('./check-studio-map.cjs');

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

test('the renderer that is handed the pinned frame as frame={Shell} is held to the same projection rules', () => {
  const fed = `const Shell = studioFrames[page.frameId]; const projection = studioShellProjection(map, entry.id);
    const view = <StudioShell frame={Shell} {...projection} copy={copy} popovers={popovers} />;`;
  assert.deepEqual(inspectFrameProjection(fed), []);
  const overridden = `const Shell = studioFrames[page.frameId]; const projection = studioShellProjection(map, entry.id);
    const view = <StudioShell frame={Shell} {...projection} navigation={{ tree: [] }} />;`;
  assert.deepEqual(inspectFrameProjection(overridden).map(row => row.input), ['navigation']);
  const unprojected = `const Shell = studioFrames[page.frameId]; const view = <StudioShell frame={Shell} {...{ navigation, commands }} />;`;
  assert.deepEqual(inspectFrameProjection(unprojected).map(row => row.required), ['studioShellProjection']);
  const unrelated = `const Shell = studioFrames[page.frameId]; const view = <StudioShell frame={Other} {...studioShellProjection(map, id)} />;`;
  assert.deepEqual(inspectFrameProjection(unrelated).map(row => row.rule), ['missing-studio-frame']);
  const actual = fs.readFileSync(path.join(studioRoot, 'components/StudioPage.tsx'), 'utf8');
  assert.deepEqual(inspectFrameProjection(actual), []);
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

test('every Studio module is reached from app/: an unreached module is an orphan finding', () => {
  assert.deepEqual(orphanModules(studioRoot), []);
  const probe = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-orphans-'));
  try {
    for (const dir of ['app', 'components', 'lib']) fs.mkdirSync(path.join(probe, dir));
    fs.writeFileSync(path.join(probe, 'app/page.tsx'), "import { A } from '../components/A';\nexport default A;\n");
    fs.writeFileSync(path.join(probe, 'components/A.tsx'), "import { b } from '../lib/b';\nexport const A = () => b;\n");
    fs.writeFileSync(path.join(probe, 'lib/b.ts'), "export const b = 1;\n");
    fs.writeFileSync(path.join(probe, 'components/Orphan.tsx'), "export const Orphan = () => null;\n");
    assert.deepEqual(orphanModules(probe), ['components/Orphan.tsx']);
  } finally { fs.rmSync(probe, { recursive: true, force: true }); }
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
    const api = \`/api/slots/\${agent}/\${id}\`;
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

test('a constant used only as an asset attribute is an asset URL; any other use keeps it a route literal', () => {
  assert.deepEqual(findRouteLiterals('const AVATAR = "/avatars/fixture.jpg"; const v = <Image src={user.avatar ?? AVATAR} />;', 'x.tsx'), []);
  // Mutation proofs: the same constant also used as a destination, never used, or not const, still fails.
  assert.deepEqual(findRouteLiterals('const A = "/avatars/fixture.jpg"; const v = <Image src={A} />; const w = <Link href={A} />;', 'x.tsx').map(row => row.value), ['/avatars/fixture.jpg']);
  assert.deepEqual(findRouteLiterals('const A = "/avatars/fixture.jpg";', 'x.tsx').map(row => row.value), ['/avatars/fixture.jpg']);
  assert.deepEqual(findRouteLiterals('let A = "/avatars/fixture.jpg"; const v = <Image src={A} />;', 'x.tsx').map(row => row.value), ['/avatars/fixture.jpg']);
  assert.deepEqual(findRouteLiterals('const P = "/fixture-page"; const v = <Image src={P} />;', 'x.tsx').map(row => row.value), ['/fixture-page']);
});

test('a link to another site is not a Studio route; a local absolute or protocol-relative destination still is', () => {
  assert.deepEqual(findRouteLiterals('const v = <a href="https://library.example">credit</a>;', 'x.tsx'), []);
  assert.deepEqual(['http://127.0.0.1:4503/designer', 'http://localhost/fixture', '//fixture', 'mailto:fixture'].flatMap(value =>
    findRouteLiterals(`const v = <a href="${value}">x</a>;`, 'x.tsx').map(row => row.value)), ['http://127.0.0.1:4503/designer', 'http://localhost/fixture', '//fixture', 'mailto:fixture']);
});

test('the checked-in Studio projection matches its ordinary Publisher cells and production consumers', async () => {
  assert.deepEqual(await checkStudioMap(), []);
});

test('changing a pinned Publisher page without regenerating fails projection drift', async t => {
  const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'studio-map-check-')));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const clossysRoot = path.join(temporary, 'clossys');
  const outputDir = path.join(temporary, 'generated');
  const source = path.join(repositoryRoot, 'clossys');
  fs.cpSync(path.join(source, 'agents/publisher'), path.join(clossysRoot, 'agents/publisher'), { recursive: true });
  fs.cpSync(path.join(source, 'agents/designer'), path.join(clossysRoot, 'agents/designer'), { recursive: true });
  // The installed Studio routes list every gallery's leaves, so the fixture carries all agents' records and app/.
  for (const agent of ['director', 'writer']) fs.cpSync(path.join(source, 'agents', agent), path.join(clossysRoot, 'agents', agent), { recursive: true });
  fs.cpSync(path.join(studioRoot, 'generated'), outputDir, { recursive: true });
  fs.cpSync(path.join(studioRoot, 'app'), path.join(temporary, 'app'), { recursive: true });
  const generator = await import(pathToFileURL(path.resolve(studioRoot, '../scripts/generate-studio-map.mjs')).href);
  await generator.generateStudioMap({ clossysRoot, outputDir, check: true });
  // A published page title is map input (a Writer key), so re-pinning a page onto another title key must change projected bytes.
  const slot = path.join(clossysRoot, 'agents/publisher/page.designer-themes');
  const pin = JSON.parse(fs.readFileSync(path.join(slot, 'pin.json'), 'utf8'));
  const candidate = path.join(slot, 'candidates', pin.candidate);
  const record = JSON.parse(fs.readFileSync(candidate, 'utf8'));
  assert.equal(record.title, 'studio.page.designer-themes');
  const bytes = JSON.stringify({ ...record, title: 'studio.page.designer-assets' }, null, 2) + '\n';
  fs.writeFileSync(candidate, bytes);
  fs.writeFileSync(path.join(slot, 'pin.json'), JSON.stringify({ ...pin, sha256: require('node:crypto').createHash('sha256').update(bytes).digest('hex') }, null, 2) + '\n');
  const findings = await checkStudioMap({ clossysRoot, outputDir });
  assert.ok(findings.some(row => row.rule === 'publisher-projection-drift' && /Generated Studio projection drift/.test(row.message)), JSON.stringify(findings));
});
