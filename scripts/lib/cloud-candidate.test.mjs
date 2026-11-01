import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parseCandidate, treeDigest, encode, LIMITS } from './cloud-candidate.mjs';

const blob = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const entry = (path, text = 'safe\n', mode = '100644') => ({ path, mode, blob: blob(Buffer.from(text)), bytes: Buffer.from(text).toString('base64') });
function candidate(files = [entry('readme.txt')]) {
  return { version: 1, repository: 'sample/repository', owner: 'sample', base: 'a'.repeat(40), unit: 'unit-1', message: 'Add candidate validation\n', tree: treeDigest(files), files };
}

test('bounded canonical parser binds all bytes, paths, modes and metadata', () => {
  const value = candidate();
  assert.deepEqual(parseCandidate(encode(value)), value);
  for (const mutate of [
    v => { v.files[0].bytes = Buffer.from('changed').toString('base64'); },
    v => { v.files = []; },
    v => { v.files.push(v.files[0]); },
    v => { v.files[0].mode = '120000'; },
    v => { v.files[0].mode = '160000'; },
    v => { v.extra = true; },
    v => { v.files[0].bytes += '\n'; },
  ]) {
    const changed = structuredClone(value); mutate(changed);
    assert.throws(() => parseCandidate(encode(changed)));
  }
  for (const path of ['../escape', '/absolute', 'a/../../b', 'a\\b', '.git/config', 'a/node_modules/data', 'a//b', 'a/./b', 'a:stream', 'name.', 'name ', 'a\u0000b', 'nonascii-\ufffd']) {
    assert.throws(() => parseCandidate(encode({ ...value, files: [entry(path)] })), path);
  }
  for (const files of [[entry('A/data'), entry('a/other')], [entry('a'), entry('a/b')]]) {
    assert.throws(() => parseCandidate(encode({ ...value, files })));
  }
  assert.throws(() => parseCandidate(Buffer.from('{"version":1,"version":1}\n')));
  assert.throws(() => parseCandidate(Buffer.from([0xff])));
  assert.throws(() => parseCandidate(encode(value), { base: 'b'.repeat(40) }));
  assert.throws(() => parseCandidate(encode(value), { owner: 'other' }));
  assert.throws(() => parseCandidate(encode(value), { unit: 'other' }));
  assert.throws(() => parseCandidate(encode(value), { messageSha256: '0'.repeat(64) }));
});

test('portable Git tree digest includes executable modes and directory ordering', () => {
  assert.equal(treeDigest([]), '4b825dc642cb6eb9a060e54bf8d69288fbee4904');
  assert.notEqual(treeDigest([entry('a')]), treeDigest([entry('a', 'safe\n', '100755')]));
  assert.notEqual(treeDigest([entry('a')]), treeDigest([entry('dir/a')]));
});

test('parser refuses resource amplification and malformed text before extraction', () => {
  const value = candidate();
  assert.throws(() => parseCandidate(encode({ ...value, files: Array(LIMITS.files + 1).fill(value.files[0]) })), /file count/);
  assert.throws(() => parseCandidate(encode({ ...value, message: 'x'.repeat(LIMITS.message + 1) })), /bounded text/);
  assert.throws(() => parseCandidate(encode({ ...value, message: '\ud800' })), /Invalid message/);
  assert.throws(() => parseCandidate(encode({ ...value, files: [entry(`${'a/'.repeat(33)}file`)] })), /depth/);
  assert.throws(() => parseCandidate(encode({ ...value, files: [entry('a'.repeat(256))] })), /path/);
});
