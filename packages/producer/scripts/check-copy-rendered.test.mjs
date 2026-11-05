// The rendered copy gate's provenance rules (studio/checks/check-copy-rendered.mjs): what a rendered
// string may resolve to, pinned on a synthetic universe so each rule fails on its own.
import assert from 'node:assert/strict';
import test from 'node:test';
import { provenance, recordWords, shortHash, templateMatcher } from '../studio/checks/check-copy-rendered.mjs';

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
