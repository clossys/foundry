'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { checkStudioRoutes, readStudioPublication, ROUTE_MARKER } = require('./check-studio-routes.cjs');

const studioRoot = path.resolve(__dirname, '..');
const repositoryRoot = path.resolve(studioRoot, '../../..');

/** A copy of Studio's app/ tree and of the pinned publication's projection, which a mutation may change. */
async function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'studio-routes-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.cpSync(path.join(studioRoot, 'app'), path.join(root, 'studio/app'), { recursive: true });
  const publication = structuredClone(await readStudioPublication(repositoryRoot));
  return { root, publication, options: { studioRoot: path.join(root, 'studio'), repositoryRoot: root, publication } };
}
const rules = findings => findings.map(row => row.rule);

test('the checked-in Studio routes are all installed by Publisher', async () => {
  assert.deepEqual(await checkStudioRoutes(), []);
});

test('the route marker is the one Publisher writes', async () => {
  const { NEXT_ROUTE_MARKER } = await import('@clossys/publisher/install');
  assert.equal(ROUTE_MARKER, NEXT_ROUTE_MARKER);
});

test('a copy of the tree passes before it is mutated', async t => {
  assert.deepEqual(await checkStudioRoutes((await fixture(t)).options), []);
});

test('mutation: a map page entry with no installed page fails', async t => {
  const { root, options } = await fixture(t);
  fs.rmSync(path.join(root, 'studio/app/writer/page.tsx'));
  assert.deepEqual(await checkStudioRoutes(options), [{ rule: 'map-page-not-installed', page: 'writer', kind: 'page', file: 'app/writer/page.tsx' }]);
});

test('mutation: a new map page entry Publisher has not installed fails', async t => {
  const { publication: { map }, options } = await fixture(t);
  map.entries.push({ ...map.entries.find(row => row.id === 'writer'), id: 'strategist', path: '/strategist', title: 'Strategist' });
  assert.deepEqual(rules(await checkStudioRoutes(options)), ['map-page-not-installed']);
});

test('mutation: a leaf template with no installed dynamic route fails', async t => {
  const { root, options } = await fixture(t);
  fs.rmSync(path.join(root, 'studio/app/designer/[slug]'), { recursive: true });
  assert.deepEqual(await checkStudioRoutes(options), [{ rule: 'map-page-not-installed', page: 'designer', kind: 'leaf', file: 'app/designer/[slug]/page.tsx' }]);
});

test('mutation: a map page whose route file was hand-edited past the marker fails', async t => {
  const { root, options } = await fixture(t);
  const page = path.join(root, 'studio/app/designer/page.tsx');
  fs.writeFileSync(page, fs.readFileSync(page, 'utf8').replace(`${ROUTE_MARKER}\n`, ''));
  assert.deepEqual(rules(await checkStudioRoutes(options)), ['map-page-not-installed-by-publisher']);
});

test('mutation: a hand-made route file under app/ fails', async t => {
  const { root, options } = await fixture(t);
  fs.mkdirSync(path.join(root, 'studio/app/settings'), { recursive: true });
  fs.writeFileSync(path.join(root, 'studio/app/settings/page.tsx'), 'export default function Page() { return null; }\n');
  assert.deepEqual(await checkStudioRoutes(options), [{ rule: 'route-not-installed', file: 'app/settings/page.tsx' }]);
});

test('mutation: a catch-all or API route handler beside the installed routes fails', async t => {
  const { root, options } = await fixture(t);
  fs.mkdirSync(path.join(root, 'studio/app/[[...route]]'), { recursive: true });
  fs.writeFileSync(path.join(root, 'studio/app/[[...route]]/page.tsx'), 'export default function Page() { return null; }\n');
  fs.mkdirSync(path.join(root, 'studio/app/api/x'), { recursive: true });
  fs.writeFileSync(path.join(root, 'studio/app/api/x/route.ts'), 'export function GET() { return new Response(); }\n');
  assert.deepEqual(rules(await checkStudioRoutes(options)), ['route-not-installed', 'route-not-installed']);
});

test('mutation: a marked route no map page installs any more fails', async t => {
  const { root, options } = await fixture(t);
  fs.mkdirSync(path.join(root, 'studio/app/old'), { recursive: true });
  fs.copyFileSync(path.join(root, 'studio/app/writer/page.tsx'), path.join(root, 'studio/app/old/page.tsx'));
  assert.deepEqual(await checkStudioRoutes(options), [{ rule: 'stale-installed-route', file: 'app/old/page.tsx' }]);
});

test('the specimen frame is the one named exemption, and only at its own path', async t => {
  const { root, options } = await fixture(t);
  fs.mkdirSync(path.join(root, 'studio/app/designer/%5F_specimen'), { recursive: true });
  fs.copyFileSync(path.join(root, 'studio/app/%5F_specimen/page.tsx'), path.join(root, 'studio/app/designer/%5F_specimen/page.tsx'));
  fs.rmSync(path.join(root, 'studio/app/%5F_specimen'), { recursive: true });
  assert.deepEqual(rules(await checkStudioRoutes(options)), ['route-not-installed', 'missing-exempt-route']);
});

test('without a pinned Studio publication the check fails closed', async t => {
  const { options } = await fixture(t);
  await assert.rejects(checkStudioRoutes({ studioRoot: options.studioRoot, repositoryRoot: options.repositoryRoot }));
});
