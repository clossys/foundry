'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const fs = require('node:fs');
const Module = require('node:module');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { buildSync } = require('esbuild');

const studio = path.resolve(__dirname, '..');
const projection = JSON.parse(fs.readFileSync(path.join(studio, 'generated/studio-map.json'), 'utf8'));

// Exercise the real frame and generated projection with only runtime ports substituted.
function frameModule() {
  const mocks = {
    'next/navigation': `export const usePathname=()=>globalThis.__studioFrameTest.path; export const useRouter=()=>({push(){}}); export const useSearchParams=()=>new URLSearchParams(globalThis.__studioFrameTest.query);`,
    './StudioSelection': `export const useStudioSelection=()=>({selection:{leaves:[]}}); export const useStudioUI=()=>({Icon:()=>null,AppFrame:props=>{globalThis.__studioFrameTest.frame=props;return props.children;}});`,
    './StudioApps': `export const useStudioApps=()=>globalThis.__studioFrameTest.apps;`,
    './StudioBrand': `export const useStudioBrand=()=>({source:'consumer'});`,
  };
  const source = fs.readFileSync(path.join(studio, 'components/StudioFrame.tsx'), 'utf8');
  const scratch = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'studio-frame-test-'));
  try {
    const rewritten = source.replace(/from ('[^']+')/g, (match, quoted) => {
      const name = quoted.slice(1, -1);
      if (!mocks[name]) return match;
      const file = path.join(scratch, `${Object.keys(mocks).indexOf(name)}.js`);
      fs.writeFileSync(file, mocks[name]);
      return `from ${JSON.stringify(file)}`;
    });
    const output = buildSync({ stdin: { contents: rewritten, resolveDir: path.join(studio, 'components'), loader: 'tsx' }, bundle: true, platform: 'node', format: 'cjs', packages: 'external', jsx: 'automatic', write: false }).outputFiles[0].text;
    const compiled = new Module(path.join(studio, 'checks/frame-test.cjs'), module);
    compiled.filename = path.join(studio, 'checks/frame-test.cjs');
    compiled.paths = Module._nodeModulePaths(studio);
    compiled._compile(output, compiled.filename);
    return compiled.exports.StudioFrame;
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
}
const Frame = frameModule();
function render(pathname, apps = { state: 'ready', publications: [] }, query = '', pageActionCapabilities) {
  globalThis.__studioFrameTest = { path: pathname, apps, query };
  renderToStaticMarkup(React.createElement(Frame, { page: { title: 'Fixture' }, pageActionCapabilities }, 'Content'));
  const captured = globalThis.__studioFrameTest.frame;
  delete globalThis.__studioFrameTest;
  return captured;
}
function targets(tree) { return tree.flatMap(node => [...(node.href ? [{ id: node.id, label: node.label, href: node.href }] : []), ...targets(node.children ?? [])]); }

test('frame navigation, commands and breadcrumbs consume the generated Publisher projection', () => {
  for (const route of projection.routes) {
    const frame = render(route.path);
    assert.deepEqual(targets(frame.navigation.tree), targets(projection.navigation[route.instanceId].tree));
    assert.deepEqual(frame.commands.groups.flatMap(group => group.items.map(({ id, label, href }) => ({ id, label, href }))), projection.commands.flatMap(group => group.items.filter(item => item.href).map(({ id, label, href }) => ({ id, label, href }))));
    assert.deepEqual(frame.page.breadcrumb, projection.breadcrumbs[route.instanceId]);
    assert.deepEqual(frame.page.actions.map(({ id, label }) => ({ id, label })), projection.pageActions[route.instanceId].map(({ id, label }) => ({ id, label })));
    assert.ok(frame.page.actions.every(action => action.icon), 'every projected page action uses the selected Designer icon');
  }
});

test('page module actions dispatch the complete generated manifest to the module host', () => {
  const route = projection.routes.find(row => projection.pageActions[row.instanceId].some(action => action.module && action.defaultOpen));
  const frame = render(route.path);
  const target = new EventTarget();
  const received = [];
  target.addEventListener('studio:page-action', event => received.push(event.detail));
  const priorWindow = globalThis.window;
  globalThis.window = target;
  try {
    const manifest = projection.pageActions[route.instanceId].filter(action => action.module);
    for (const action of manifest) frame.page.actions.find(item => item.id === action.id).onAction();
    assert.deepEqual(received, manifest.map(action => ({ pageId: route.instanceId, action })));
    assert.ok(received.some(item => item.action.defaultOpen), 'host receives the authored Explorer default');
  } finally {
    if (priorWindow === undefined) delete globalThis.window;
    else globalThis.window = priorWindow;
  }
});

test('app actions require a declared runtime URL and workspaces contain no inline actions', () => {
  const route = projection.routes.find(row => projection.pageActions[row.instanceId].some(action => action.intent));
  const frame = render(route.path);
  for (const action of projection.pageActions[route.instanceId].filter(item => item.intent)) {
    const item = frame.page.actions.find(item => item.id === action.id);
    assert.equal(item.isDisabled, true);
    assert.equal(item.href, undefined);
  }
  for (const name of ['CellsWorkspace.tsx', 'AppsWorkspace.tsx']) {
    const source = fs.readFileSync(path.join(studio, 'components', name), 'utf8');
    assert.doesNotMatch(source, /actions\s*:/);
    assert.doesNotMatch(source, /Reload cells|label:\s*`Open/);
  }
});

test('declared app runtime capabilities open normalized URLs in a protected new tab', () => {
  const route = projection.routes.find(row => projection.pageActions[row.instanceId].some(action => action.intent === 'open-app-dev-server'));
  const manifest = projection.pageActions[route.instanceId].find(action => action.intent === 'open-app-dev-server');
  const opened = [];
  const priorWindow = globalThis.window;
  globalThis.window = { open: (...args) => opened.push(args) };
  try {
    const frame = render(route.path, undefined, '', { appDevServerUrl: 'http://localhost:3000' });
    const action = frame.page.actions.find(item => item.id === manifest.id);
    assert.equal(action.isDisabled, false);
    action.onAction();
    assert.deepEqual(opened, [['http://localhost:3000/', '_blank', 'noopener,noreferrer']]);
    for (const url of ['invalid', 'javascript:alert(1)', 'https://example.test', 'http://user:secret@localhost:3000']) {
      const invalid = render(route.path, undefined, '', { appDevServerUrl: url }).page.actions.find(item => item.id === manifest.id);
      assert.equal(invalid.isDisabled, true);
      invalid.onAction();
    }
    assert.equal(opened.length, 1);
  } finally {
    if (priorWindow === undefined) delete globalThis.window;
    else globalThis.window = priorWindow;
  }
});

test('consumer publication mutations update Apps children and commands without changing fixed Studio routes', () => {
  const route = projection.routes.find(item => item.instanceId === 'apps');
  const publication = { id: 'consumer-app', title: 'Consumer app', commands: [{ id: 'pages', label: 'Pages', items: [{ id: 'overview', label: 'Overview', href: '/consumer-page' }, { id: 'write', label: 'Write', action: 'write' }] }] };
  const first = render(route.path, { state: 'ready', publications: [publication] }, 'publication=consumer-app');
  const appNode = first.navigation.tree.find(item => item.id === 'apps');
  assert.equal(appNode.children[0].label, 'Consumer app');
  assert.equal(first.navigation.activeHref, appNode.children[0].href);
  assert.equal(new URL(appNode.children[0].href, 'https://example.test').searchParams.get('publication'), publication.id);
  const command = first.commands.groups.at(-1).items[0];
  assert.equal(command.label, 'Overview');
  assert.equal(new URL(command.href, 'https://example.test').searchParams.get('entry'), 'overview');
  assert.equal(first.commands.groups.at(-1).items.length, 1, 'read-only Studio omits consumer mutation actions');
  const changed = render(route.path, { state: 'ready', publications: [{ ...publication, title: 'Renamed app' }] });
  assert.equal(changed.navigation.tree.find(item => item.id === 'apps').children[0].label, 'Renamed app');
  const removed = render(route.path, { state: 'ready', publications: [] });
  assert.equal(removed.navigation.tree.find(item => item.id === 'apps').children, undefined);
  assert.deepEqual(targets(removed.navigation.tree), targets(projection.navigation.apps.tree));
});
