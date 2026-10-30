'use strict';
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const fs = require('node:fs');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { buildSync } = require('esbuild');

const studio = path.resolve(__dirname, '..');
const projection = JSON.parse(fs.readFileSync(path.join(studio, 'generated/studio-map.json'), 'utf8'));

// Exercise the real frame and generated projection with only runtime ports substituted.
async function frameModule() {
  const mocks = {
    'next/navigation': `export const usePathname=()=>globalThis.__studioFrameTest.path; export const useRouter=()=>({push(){}});`,
    './StudioSelection': `export const useStudioSelection=()=>({selection:{leaves:[]}}); export const useStudioUI=()=>({Icon:()=>null,AppFrame:props=>{globalThis.__studioFrameTest.frame=props;return props.children;}});`,
    './StudioBrand': `export const useStudioBrand=()=>({source:'consumer'});`,
  };
  const source = fs.readFileSync(path.join(studio, 'components/StudioFrame.tsx'), 'utf8');
  const scratch = fs.mkdtempSync(path.join(__dirname, '.studio-frame-test-'));
  try {
    const rewritten = source.replace(/from ('[^']+')/g, (match, quoted) => {
      const name = quoted.slice(1, -1);
      if (!mocks[name]) return match;
      const file = path.join(scratch, `${Object.keys(mocks).indexOf(name)}.js`);
      fs.writeFileSync(file, mocks[name]);
      return `from ${JSON.stringify(file)}`;
    });
    const output = buildSync({ stdin: { contents: rewritten, resolveDir: path.join(studio, 'components'), loader: 'tsx' }, bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', write: false }).outputFiles[0].text;
    const entry = path.join(scratch, 'frame.mjs');
    fs.writeFileSync(entry, output);
    return (await import(pathToFileURL(entry).href)).StudioFrame;
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
}
let Frame;
before(async () => { Frame = await frameModule(); });
function render(pathname) {
  globalThis.__studioFrameTest = { path: pathname };
  renderToStaticMarkup(React.createElement(Frame, { page: { title: 'Fixture' } }, 'Content'));
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

test('page actions dispatch every generated manifest to the module host', () => {
  const target = new EventTarget();
  const received = [];
  target.addEventListener('studio:page-action', event => received.push(event.detail));
  const priorWindow = globalThis.window;
  globalThis.window = target;
  try {
    const expected = [];
    for (const route of projection.routes) {
      const frame = render(route.path);
      const manifest = projection.pageActions[route.instanceId];
      for (const action of manifest) frame.page.actions.find(item => item.id === action.id).onAction();
      expected.push(...manifest.map(action => ({ pageId: route.instanceId, action })));
    }
    assert.deepEqual(received, expected);
    assert.ok(received.some(item => item.action.defaultOpen), 'host receives the authored Explorer default');
  } finally {
    if (priorWindow === undefined) delete globalThis.window;
    else globalThis.window = priorWindow;
  }
});

test('cell workspaces leave page actions to the Publisher manifest', () => {
  const source = fs.readFileSync(path.join(studio, 'components/CellsWorkspace.tsx'), 'utf8');
  assert.doesNotMatch(source, /actions\s*:/);
  assert.doesNotMatch(source, /Reload cells|label:\s*`Open/);
});
