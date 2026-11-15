import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { pickRepin, repinFinding } from './compile-pure-repin.mjs';
import { consumerPath } from './consumer-root.mjs';

const actions = consumerPath('agents', 'writer', 'strings.actions', 'candidates');
const memory = files => name => Buffer.from(files[name]);

test('foundry-audit-0004: a byte-identical pair (strings.actions studio-v1/v2) is SKIP no-distinct-candidate, never a re-pin', () => {
  const read = name => readFileSync(join(actions, name));
  assert.deepEqual(read('studio-v1.md'), read('studio-v2.md'), 'fixture: the pair is byte-identical');
  assert.deepEqual(pickRepin(['studio-v1.md', 'studio-v2.md'], 'studio-v1.md', read), { skip: 'no-distinct-candidate' });
  assert.deepEqual(pickRepin(['a-v1.md', 'a-v2.md'], 'a-v1.md', memory({ 'a-v1.md': 'same', 'a-v2.md': 'same' })), { skip: 'no-distinct-candidate' });
});

test('a distinct candidate is picked (the last distinct by name, skipping identical copies); a distinct re-pin that changes nothing still flags', () => {
  const files = { 'a-v1.md': 'one', 'a-v2.md': 'two', 'a-v3.md': 'one', 'notes.json': '{}' };
  assert.deepEqual(pickRepin(Object.keys(files), 'a-v1.md', memory(files)), { other: 'a-v2.md' });
  assert.deepEqual(pickRepin(['a-v1.md'], 'a-v1.md', memory(files)), { none: true });
  assert.equal(repinFinding('writer/x/pin.json -> a-v2.md', 0), 're-pinning writer/x/pin.json -> a-v2.md did not change the rendered output');
  assert.equal(repinFinding('writer/x/pin.json -> a-v2.md', 3), undefined);
});
