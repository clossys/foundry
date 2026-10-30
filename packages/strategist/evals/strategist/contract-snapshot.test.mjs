import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { captureRoot } from './capture.mjs';
import { normalizeCapture } from './normalize.mjs';
import { snapshotContracts } from './contract-snapshot.mjs';
import { discoverBriefContracts } from '../../dist/brief-contracts.js';

const contract = JSON.stringify({ id: 'fixture.consumer', schemaVersion: 1, owner: 'fixture', requires: [], optional: [] });
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'strategy-contract-capture-'));
  const root = join(directory, 'project', 'strategy');
  const local = join(root, 'contracts', 'consumer.json');
  const installed = join(directory, 'node_modules', '@clossys', 'consumer', 'strategy-brief.json');
  for (const path of [join(root, 'contracts'), join(directory, 'node_modules', '@clossys', 'consumer')]) mkdirSync(path, { recursive: true });
  writeFileSync(join(root, 'tree.json'), JSON.stringify({ schemaVersion: 1, catalog: '@clossys/strategist#strategy-v1', archetype: 'product-saas', core: 'archetype', active: {} }));
  writeFileSync(local, contract);
  writeFileSync(installed, contract);
  return { directory, root, local, installed, clean: () => rmSync(directory, { recursive: true, force: true }) };
}

for (const source of ['local', 'installed']) {
  for (const operation of ['modify', 'add', 'delete']) {
    test(`${source} contract ${operation} invalidates capture even with identical IDs and CLI reports`, async () => {
      const f = fixture();
      try {
        const before = await captureRoot(f.root);
        assert.equal(before.normalizationError, undefined);
        const target = f[source];
        if (operation === 'modify') writeFileSync(target, `${contract}\n`);
        else if (operation === 'delete') unlinkSync(target);
        else if (source === 'local') writeFileSync(join(f.root, 'contracts', 'duplicate.json'), contract);
        else {
          const added = join(f.directory, 'project', 'node_modules', '@clossys', 'duplicate');
          mkdirSync(added, { recursive: true });
          writeFileSync(join(added, 'strategy-brief.json'), contract);
        }
        const after = await captureRoot(f.root);
        assert.equal(after.normalizationError, undefined, 'an unchanged valid root still normalizes');
        assert.deepEqual(before.before.hashes, after.after.hashes, 'strategy reader alone misses the change');
        assert.deepEqual(before.before.briefContracts.contracts, after.after.briefContracts.contracts, 'merged IDs and meaning remain unchanged');
        assert.deepEqual(before.captures.map(c => c.stdout), after.captures.map(c => c.stdout), 'real CLI reports remain unchanged');
        const changed = structuredClone(before);
        changed.after = after.after;
        assert.throws(() => normalizeCapture(changed), /Brief contract inputs changed/);
        for (const [path, file] of Object.entries(after.after.briefContracts.files)) assert.deepEqual(Buffer.from(file.base64, 'base64'), readFileSync(path));
      } finally { f.clean(); }
    });
  }
}

test('discovery follows ancestor package links, deduplicates real roots and retains shadowed packages', () => {
  const f = fixture();
  try {
    const linked = join(f.directory, 'external-consumer');
    mkdirSync(linked);
    writeFileSync(join(linked, 'strategy-brief.json'), contract.replace('fixture.consumer', 'fixture.linked'));
    const scope = join(f.root, 'node_modules', '@clossys');
    mkdirSync(scope, { recursive: true });
    symlinkSync(linked, join(scope, 'linked'));
    symlinkSync(linked, join(scope, 'linked-again'));
    // Discovery includes both packages despite matching names at different ancestors.
    mkdirSync(join(scope, 'consumer'));
    writeFileSync(join(scope, 'consumer', 'strategy-brief.json'), contract.replace('fixture.consumer', 'fixture.nearer'));
    const snapshot = snapshotContracts(f.root);
    assert.deepEqual(snapshot.issues, []);
    assert.deepEqual(snapshot.contracts, discoverBriefContracts(f.root).contracts);
    assert.deepEqual(snapshot.contracts.map(c => c.id), ['fixture.consumer', 'fixture.linked', 'fixture.nearer']);
    assert.equal(snapshot.inventory.length, 4);
    assert.equal(snapshot.inventory.filter(entry => entry.path === join(linked, 'strategy-brief.json')).length, 1);
    assert.ok(snapshot.inventory.some(entry => entry.path === f.installed));
    assert.ok(snapshot.inventory.some(entry => entry.source === join(scope, 'linked', 'strategy-brief.json')));
  } finally { f.clean(); }
});

test('unsafe local contract paths are not read and discovery issues prevent normalization', async () => {
  const f = fixture();
  try {
    unlinkSync(f.local);
    const outside = join(f.directory, 'outside.json');
    writeFileSync(outside, contract);
    symlinkSync(outside, f.local);
    const capture = await captureRoot(f.root);
    assert.match(capture.normalizationError, /Brief contract discovery issues/);
    assert.equal(capture.measurements, undefined);
    assert.ok(!Object.hasOwn(capture.before.briefContracts.files, f.local));
    assert.ok(capture.before.briefContracts.issues.length > 0);
  } finally { f.clean(); }
});

test('missing, corrupt and incomplete contract byte evidence is rejected', async () => {
  const f = fixture();
  try {
    const capture = await captureRoot(f.root);
    for (const mutate of [
      c => { delete c.before.briefContracts; },
      c => { c.after.briefContracts.files[f.local].base64 = Buffer.from('changed').toString('base64'); },
      c => { c.after.briefContracts.inventory.pop(); },
    ]) {
      const changed = structuredClone(capture);
      mutate(changed);
      assert.throws(() => normalizeCapture(changed), /brief contract/i);
    }
  } finally { f.clean(); }
});
