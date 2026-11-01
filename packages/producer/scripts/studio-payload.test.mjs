import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkPayload } from './studio-payload.mjs';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'studio-payload-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const versionDir = join(dir, 'library'), studioDir = join(dir, 'studio');
  await Promise.all([mkdir(versionDir), mkdir(studioDir)]);
  await Promise.all([versionDir, studioDir].map(root => writeFile(join(root, 'index.tsx'), 'export default () => "Home";\n')));
  return {
    slot: 'sections.studio.home', element: 'studio-home', version: 1,
    versionDir, studioDir, payload: ['index.tsx', 'registry-item.json', 'LICENCE.md'],
  };
}

test('byte-equal registered payload accepts', async t => {
  const item = await fixture(t);
  await assert.doesNotReject(checkPayload(item));
});

test('extra index.test.tsx alone accepts', async t => {
  const item = await fixture(t);
  await writeFile(join(item.studioDir, 'index.test.tsx'), 'local test only\n');
  await assert.doesNotReject(checkPayload(item));
});

test('unlisted conventional test and spec files accept for JS, TS, JSX and TSX', async t => {
  for (const kind of ['test', 'spec']) for (const extension of ['js', 'ts', 'jsx', 'tsx']) {
    await t.test(`${kind}.${extension}`, async t => {
      const item = await fixture(t);
      await writeFile(join(item.studioDir, `index.${kind}.${extension}`), 'local test only\n');
      await assert.doesNotReject(checkPayload(item));
    });
  }
});

test('unlisted CJS and MJS test and spec files accept', async t => {
  for (const kind of ['test', 'spec']) for (const extension of ['cjs', 'mjs']) {
    await t.test(`${kind}.${extension}`, async t => {
      const item = await fixture(t);
      await writeFile(join(item.studioDir, `stock-frame.${kind}.${extension}`), 'local test only\n');
      await assert.doesNotReject(checkPayload(item));
    });
  }
});

test('missing registered payload fails', async t => {
  const item = await fixture(t);
  await rm(join(item.studioDir, 'index.tsx'));
  await assert.rejects(checkPayload(item), /studio folder files \[\] differ from the pinned payload \[index.tsx\]/);
});

test('unexpected runtime helper fails', async t => {
  const item = await fixture(t);
  await writeFile(join(item.studioDir, 'helper-runtime.js'), 'export const extra = true;\n');
  await assert.rejects(checkPayload(item), /studio folder files \[helper-runtime.js,index.tsx\] differ/);
});

test('ordinary CJS and MJS runtime files are not ignored', async t => {
  for (const file of ['helper-runtime.cjs', 'helper-runtime.mjs', 'test.cjs', 'spec.mjs', 'index.test.cjs.mjs', 'index.spec.mjs.cjs']) {
    await t.test(file, async t => {
      const item = await fixture(t);
      await writeFile(join(item.studioDir, file), 'unregistered runtime\n');
      await assert.rejects(checkPayload(item), /studio folder files .* differ/);
    });
  }
});

test('test-like runtime and provenance names fail', async t => {
  for (const name of ['index.test.tsx.js', 'test.js', 'index.test.json', 'test-provenance.json']) {
    await t.test(name, async t => {
      const item = await fixture(t);
      await writeFile(join(item.studioDir, name), 'unregistered\n');
      await assert.rejects(checkPayload(item), /studio folder files .* differ/);
    });
  }
});

test('test-named folders are not ignored', async t => {
  const item = await fixture(t);
  await mkdir(join(item.studioDir, 'index.test.tsx'));
  await assert.rejects(checkPayload(item), /studio folder files .* differ/);
});

test('modified runtime payload fails', async t => {
  const item = await fixture(t);
  await writeFile(join(item.studioDir, 'index.tsx'), 'export default () => "Changed";\n');
  await assert.rejects(checkPayload(item), /index.tsx differs from studio-home v1 in the library/);
});

test('explicitly listed test payload is required and validated', async t => {
  const item = await fixture(t), file = 'index.test.tsx';
  item.payload.push(file);
  await writeFile(join(item.versionDir, file), 'registered test\n');
  await assert.rejects(checkPayload(item), /studio folder files .* differ/);
  await writeFile(join(item.studioDir, file), 'registered test\n');
  await assert.doesNotReject(checkPayload(item));
  await writeFile(join(item.studioDir, file), 'changed test\n');
  await assert.rejects(checkPayload(item), /index.test.tsx differs from studio-home v1 in the library/);
});

test('explicitly pinned CJS and MJS tests are required and byte-checked', async t => {
  for (const kind of ['test', 'spec']) for (const extension of ['cjs', 'mjs']) {
    await t.test(`${kind}.${extension}`, async t => {
      const item = await fixture(t), file = `stock-frame.${kind}.${extension}`;
      item.payload.push(file);
      await writeFile(join(item.versionDir, file), 'registered test\n');
      await assert.rejects(checkPayload(item), /studio folder files .* differ/);
      await writeFile(join(item.studioDir, file), 'registered test\n');
      await assert.doesNotReject(checkPayload(item));
      await writeFile(join(item.studioDir, file), 'changed test\n');
      await assert.rejects(checkPayload(item), /stock-frame\.(?:test|spec)\.(?:cjs|mjs) differs from studio-home v1 in the library/);
    });
  }
});

test('record-only names retain their existing library-only semantics', async t => {
  const item = await fixture(t);
  for (const name of ['registry-item.json', 'LICENCE.md']) {
    await writeFile(join(item.versionDir, name), 'library provenance\n');
    await assert.doesNotReject(checkPayload(item));
    await writeFile(join(item.studioDir, name), 'library provenance\n');
    await assert.rejects(checkPayload(item), /studio folder files .* differ/);
    await rm(join(item.studioDir, name));
  }
});
