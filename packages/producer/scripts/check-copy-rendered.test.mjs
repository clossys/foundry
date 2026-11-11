// The rendered copy gate's provenance rules (studio/checks/check-copy-rendered.mjs): what a rendered
// string may resolve to, pinned on a synthetic universe so each rule fails on its own.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROUTE_SECONDS, WORKERS, installedRoutes, provenance, recordWords, registryUniverse, renderedFrames, shortHash, templateMatcher, timeoutSeconds } from '../studio/checks/check-copy-rendered.mjs';
import { checkTimeoutMs } from './check-studio.mjs';

const universe = (extra = {}) => ({
  copy: new Set(['Pinned', 'Options']),
  templates: [{ text: '{count} slots', matcher: templateMatcher('{count} slots') }],
  data: new Set(['8a3f19c2', 'page-v4.json']),
  ids: new Set(['hero', 'en/greeting']),
  locale: 'en',
  scope: new Map([['/designer/sections', [new Set(['A draft heading'])]], ['/designer/sections/hero', [new Set(['A draft heading'])]]]),
  ...extra,
});

test('a glyph-joined string resolves only when every part resolves', () => {
  assert.equal(provenance(universe(), 'hero · Pinned'), 'copy');
  assert.equal(provenance(universe(), 'hero · page-v4.json'), 'data');
  assert.equal(provenance(universe(), 'hero · Hand written'), undefined);
  assert.equal(provenance(universe(), 'Hand written · Pinned'), undefined);
});

test("a Writer option's words are data only on its slot's routes", () => {
  assert.equal(provenance(universe(), 'A draft heading', '/designer/sections/hero'), 'data');
  assert.equal(provenance(universe(), 'A draft heading', '/designer/sections'), 'data');
  assert.equal(provenance(universe(), 'A draft heading', '/writer/strings'), undefined);
  assert.equal(provenance(universe(), 'A draft heading'), undefined);
});

test('copy, templates, ids and letterless text keep their classes', () => {
  assert.equal(provenance(universe(), '12 slots'), 'copy');
  assert.equal(provenance(universe(), 'en/greeting'), 'data');
  assert.equal(provenance(universe(), '8a3f19c2'), 'data');
  assert.equal(provenance(universe(), '— 12 ·'), 'none');
  assert.equal(provenance(universe(), 'Hand written'), undefined);
});

test('a structured record gives every string field but its key', () => {
  const words = [];
  recordWords({ id: 'voice.rule', context: 'voice', rule: 'Say it plainly', examples: ['Use one verb', 'Name the thing'] }, text => words.push(text));
  assert.deepEqual(words, ['Say it plainly', 'Use one verb', 'Name the thing']);
  const plain = [];
  recordWords({ id: 'x', context: 'y', text: 'Only the text', note: 'not this' }, text => plain.push(text));
  assert.deepEqual(plain, ['Only the text']);
});

test('a short hash is the first 8 hex characters, prefix dropped', () => {
  assert.equal(shortHash('sha256:8a3f19c2d4e5'), '8a3f19c2');
  assert.equal(shortHash('8a3f19c2d4e5'), '8a3f19c2');
});

test("the live gate's bound grows with the installed routes, and check:studio gives it that bound", async () => {
  assert.equal(timeoutSeconds(0), 120);
  assert.equal(timeoutSeconds(606), 120 + Math.ceil(606 / WORKERS) * ROUTE_SECONDS);
  const repository = new URL('../../../', import.meta.url).pathname;
  assert.equal(timeoutSeconds(), timeoutSeconds(installedRoutes(repository).length));
  const row = JSON.parse(readFileSync(new URL('./check-studio.json', import.meta.url), 'utf8')).checks.find(check => check.id === 'producer check-copy-rendered (live)');
  assert.equal(row?.timeout, 'copy-routes');
  assert.equal(await checkTimeoutMs(row, 600_000), Math.max(600, timeoutSeconds()) * 1000);
});

// Fake-gates audit row 11: every slot.json string and every candidate, pinned or not, fed one global pool, so an
// unpinned candidate's text passed on any route. Only the intact pin is global; the rest is its slot's own.
function fixtureRepo() {
  const repo = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'copy-rendered-'));
  const slot = join(repo, 'clossys/agents/designer/hero');
  mkdirSync(join(slot, 'candidates'), { recursive: true });
  writeFileSync(join(slot, 'slot.json'), JSON.stringify({ id: 'hero', purpose: 'Contract prose of the slot' }));
  const pinned = JSON.stringify({ heading: 'Pinned specimen heading' });
  writeFileSync(join(slot, 'candidates/hero-v1.json'), pinned);
  writeFileSync(join(slot, 'candidates/hero-v2.json'), JSON.stringify({ heading: 'Unpinned draft heading' }));
  writeFileSync(join(slot, 'pin.json'), JSON.stringify({ candidate: 'hero-v1.json', sha256: createHash('sha256').update(pinned).digest('hex') }));
  const map = join(repo, 'packages/producer/studio/generated');
  mkdirSync(map, { recursive: true });
  writeFileSync(join(map, 'studio-map.json'), JSON.stringify({ routes: [], leaves: [{ path: '/designer/sections/hero' }] }));
  return repo;
}

test("an unpinned candidate's text and the slot's own record pass only on that slot's routes", async () => {
  const repo = fixtureRepo();
  try {
    const world = await registryUniverse(repo);
    assert.equal(provenance(world, 'Pinned specimen heading', '/writer/strings'), 'data');
    for (const text of ['Unpinned draft heading', 'Contract prose of the slot']) {
      assert.equal(provenance(world, text, '/writer/strings'), undefined, text);
      assert.equal(provenance(world, text, '/'), undefined, text);
      assert.equal(provenance(world, text, '/designer/sections/hero'), 'data', text);
      assert.equal(provenance(world, text, '/designer/sections'), 'data', text);
    }
    assert.equal(provenance(world, 'hero-v2.json', '/writer/strings'), 'data');
    // An altered pin is not intact: its text loses the global pool too.
    writeFileSync(join(repo, 'clossys/agents/designer/hero/candidates/hero-v1.json'), JSON.stringify({ heading: 'Pinned specimen heading', extra: 'Tampered' }));
    const altered = await registryUniverse(repo);
    assert.equal(provenance(altered, 'Pinned specimen heading', '/writer/strings'), undefined);
  } finally { rmSync(join(repo, 'clossys'), { recursive: true }); rmSync(join(repo, 'packages'), { recursive: true }); rmSync(repo, { recursive: true }); }
});

test('child frames are read like the page, and an unreadable frame is a failure, never skipped', async () => {
  const main = { name: () => '', url: () => 'http://studio/' };
  const frame = (name, evaluate) => ({ name: () => name, url: () => 'about:srcdoc', waitForLoadState: async () => {}, evaluate });
  const page = {
    mainFrame: () => main,
    frames: () => [main, frame('specimen', async () => ({ strings: [{ kind: 'text', text: 'Hand-rolled specimen', where: 'p' }] })), frame('locked', async () => { throw new Error('Execution context was destroyed'); })],
  };
  const result = await renderedFrames(page, [], 50);
  assert.deepEqual(result.strings, [{ kind: 'text', text: 'Hand-rolled specimen', where: 'iframe specimen p' }]);
  assert.deepEqual(result.failures, ['iframe locked: Execution context was destroyed']);
  const silent = { mainFrame: () => main, frames: () => [main, frame('hung', () => new Promise(() => {}))] };
  assert.match((await renderedFrames(silent, [], 20)).failures[0], /iframe hung: not readable within 20 ms/);
});

test('the live gate no longer answers child frames with an empty document', () => {
  const source = readFileSync(new URL('../studio/checks/check-copy-rendered.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /parentFrame\(\) \? route\.fulfill/);
  assert.match(source, /renderedFrames\(page, ATTRIBUTES\)/);
});
