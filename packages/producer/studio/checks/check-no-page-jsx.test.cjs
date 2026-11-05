'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { checkNoPageJsx, inspectAppSource, APP_FILES } = require('./check-no-page-jsx.cjs');

const studioRoot = path.resolve(__dirname, '..');

/** A copy of Studio's app/ tree and renderer, which a mutation may change. */
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'no-page-jsx-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.cpSync(path.join(studioRoot, 'app'), path.join(root, 'app'), { recursive: true });
  for (const file of [...APP_FILES, 'components/StudioPage.tsx', 'components/StudioInstalledPage.tsx']) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.copyFileSync(path.join(studioRoot, file), path.join(root, file));
  }
  return root;
}
const rules = findings => findings.map(row => row.rule);

test('the checked-in Studio has one generic renderer and no page JSX', () => {
  assert.deepEqual(checkNoPageJsx(), []);
});

test('a copy of the tree passes before it is mutated', t => {
  assert.deepEqual(checkNoPageJsx({ studioRoot: fixture(t) }), []);
});

test('mutation: a page rendered inline in an installed route fails', t => {
  const root = fixture(t), page = path.join(root, 'app/designer/themes/page.tsx');
  fs.writeFileSync(page, fs.readFileSync(page, 'utf8').replace('return createElement(PublishedPage, { page: "designer-themes" });', 'return <main><h1>Themes</h1></main>;'));
  assert.deepEqual([...new Set(rules(checkNoPageJsx({ studioRoot: root })))], ['page-jsx']);
});

test('mutation: a hand-made route folder beside the installed routes fails', t => {
  const root = fixture(t);
  fs.mkdirSync(path.join(root, 'app/settings'), { recursive: true });
  fs.writeFileSync(path.join(root, 'app/settings/page.tsx'), 'export default function Page() { return null; }');
  assert.deepEqual(rules(checkNoPageJsx({ studioRoot: root })), ['extra-app-route-file']);
});

test('mutation: importing a section, frame or old view into app/ fails', () => {
  for (const specifier of ['../../sections/studio-home', '../frames/studio-shell', '../../views/HomeView', '../components/CellsWorkspace', '../lib/proof-routes', '../generated/view-bindings']) {
    assert.deepEqual(rules(inspectAppSource(`import X from '${specifier}';`, 'app/layout.tsx')), ['page-composition-import'], specifier);
  }
  assert.deepEqual(rules(inspectAppSource(`const X = await import('../../sections/studio-home');`, 'app/layout.tsx')), ['page-composition-import']);
});

test('mutation: an installed route that stops mounting the assembly, or an assembly that stops using the renderer, fails', t => {
  const root = fixture(t), page = path.join(root, 'app/designer/themes/colors/[slug]/page.tsx');
  fs.writeFileSync(page, fs.readFileSync(page, 'utf8').replace('"../../../../../components/StudioInstalledPage"', '"../../../../../components/OtherPage"'));
  assert.deepEqual(rules(checkNoPageJsx({ studioRoot: root })), ['installed-route-not-generic-renderer']);
  const assembly = path.join(root, 'components/StudioInstalledPage.tsx');
  fs.writeFileSync(assembly, fs.readFileSync(assembly, 'utf8').replace("from './StudioPage'", "from './OtherPage'"));
  assert.ok(rules(checkNoPageJsx({ studioRoot: root })).includes('assembly-not-generic-renderer'));
  fs.rmSync(path.join(root, 'components/StudioPage.tsx'));
  assert.ok(rules(checkNoPageJsx({ studioRoot: root })).includes('missing-generic-renderer'));
});

test('mutation: a hand-made specimen frame page fails: /__specimen is a Producer server route', t => {
  const root = fixture(t);
  fs.mkdirSync(path.join(root, 'app/%5F_specimen'), { recursive: true });
  fs.writeFileSync(path.join(root, 'app/%5F_specimen/page.tsx'), 'export default function Page() { return null; }');
  assert.deepEqual(rules(checkNoPageJsx({ studioRoot: root })), ['extra-app-route-file']);
});

test('mutation: a parked views/ folder fails', t => {
  const root = fixture(t);
  fs.mkdirSync(path.join(root, 'views'));
  assert.deepEqual(rules(checkNoPageJsx({ studioRoot: root })), ['page-views-folder']);
});

test('the document shell, providers and renderer pass; fragments and other components do not', () => {
  assert.deepEqual(inspectAppSource('const x = <html><head><link /><script /></head><body><StudioProviders><StudioPage /></StudioProviders></body></html>;', 'app/layout.tsx'), []);
  assert.deepEqual(rules(inspectAppSource('const x = <><Card /></>;', 'app/layout.tsx')), ['page-jsx', 'page-jsx']);
});
