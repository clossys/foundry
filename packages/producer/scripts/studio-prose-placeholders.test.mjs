import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';

const root = new URL('../../../', import.meta.url).pathname;

test('presentText resolves Writer placeholder copy while preserving authored prose, evidence, identity and whitespace behavior', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'studio-prose-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await symlink(join(root, 'node_modules'), join(dir, 'node_modules'));
  const out = join(dir, 'studio-text.mjs');
  await build({ entryPoints: [join(root, 'packages/producer/studio/lib/studio-text.ts')], outfile: out,
    bundle: true, platform: 'node', format: 'esm', packages: 'external', nodePaths: [join(root, 'node_modules')] });
  const { presentText } = await import(out);
  const titles = new Map([['page.home', 'Home page']]);
  assert.deepEqual(presentText('Read TODO-OWNER for REQ-123 [fact:x,fact:y] using publisher:page.home@2.', titles), {
    text: 'Read awaiting owner input for the open request using Home page v2.', citations: ['x', 'y'], ownerInput: true,
  });
  assert.deepEqual(presentText('fact:x is public from record: TODO-OWNER / TODO-OWNER about REQ-123 and req-456 [fact:x,fact:y] (finding:z).', titles), {
    text: 'awaiting owner input / awaiting owner input about the open request and the open request.', citations: ['x', 'y', 'z'], ownerInput: true,
  });
  assert.deepEqual(presentText('  Authored  fact stays.\nKeep\t\tthis text and REQ-1234567.  ', titles), {
    text: 'Authored fact stays.\nKeep this text and REQ-1234567.', citations: [], ownerInput: false,
  });
  assert.deepEqual(presentText('REQ-1 needs a response.', titles), { text: 'the open request needs a response.', citations: [], ownerInput: false });
  assert.deepEqual(presentText('TODO-OWNER'), { text: 'awaiting owner input', citations: [], ownerInput: true });
});
