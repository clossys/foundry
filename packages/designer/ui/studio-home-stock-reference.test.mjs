import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { treeHash } from '../scripts/check-references.mjs';

const read = path => readFileSync(new URL(path, import.meta.url));
const json = path => JSON.parse(read(path));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

test('Home application references bind official source snapshots and the existing MIT license', () => {
  const proof = json('./studio-home-stock-source/provenance.json');
  const manifest = json('../references/manifest.json');
  const sources = json('../scripts/references-sources.json');
  for (const file of proof.files.filter(file => file.reference)) {
    const ref = file.reference;
    assert.equal(ref.registry, 'shadcn-app');
    assert.equal(ref.version, proof.upstream.commit);
    assert.notEqual(ref.hash, 'sha256:' + file.sha256, 'native identity uses the item tree hash');
    const item = manifest.items.find(item => item.registry === ref.registry && item.name === ref.item && item.version === ref.version);
    assert.ok(item, 'each Home source must be vendored under its actual catalog identity');
    assert.equal(item.hash, ref.hash);
    assert.equal(treeHash(item.files), ref.hash);
    assert.notEqual(item.type, 'registry:block', 'application source is not a published block');
    const bytes = read(`../references/${item.dir}/${file.path}`);
    assert.deepEqual(bytes, read(`./studio-home-stock-source/${file.file}`));
    assert.equal(sha(bytes), file.sha256);
    assert.equal(bytes.length, file.bytes);
    assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'), file.gitBlob);
    assert.equal(item.sourceUrl, `https://raw.githubusercontent.com/shadcn-ui/ui/${ref.version}/${file.path}`);
    assert.deepEqual(sources.registries[ref.registry].items[ref.item].files, [file.path]);
    assert.ok(sources.direct.some(row => row.registry === ref.registry && row.name === ref.item));
  }
  assert.deepEqual(proof.files.filter(file => file.reference).map(file => file.reference.item), ['studio-home-section-cards', 'card-example']);
  const license = manifest.licenses.find(file => file.path === 'shadcn-app/LICENSE.md');
  assert.equal(license.sha256, proof.files.find(file => file.file === 'LICENSE.md').sha256);
  assert.deepEqual(read('../references/' + license.path), read('./studio-home-stock-source/LICENSE.md'));
  // R2F-03: the native composition pin supersedes this interim source adoption.
  assert.equal(proof.state, 'superseded');
  assert.equal(proof.nativeQualification.state, 'qualified');
  assert.equal(proof.nativeQualification.candidate, 'home-grid-v3.json');
  assert.equal(proof.nativeQualification.pinChanged, true);
});
