import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { main } from './bin.js';

const roots: string[] = [];
const fixture = fileURLToPath(new URL('./__fixtures__/generic-envelope.json', import.meta.url));
const io = { out: (_text: string) => {}, error: (_text: string) => {} };
async function temporaryRoot() {
  const root = await mkdtemp(join(tmpdir(), 'writer-bin-'));
  roots.push(root);
  return root;
}
async function bytes(root: string, prefix = ''): Promise<Record<string, Buffer>> {
  const result: Record<string, Buffer> = {};
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = join(prefix, entry.name);
    if (entry.isDirectory()) Object.assign(result, await bytes(root, path));
    else result[path] = await readFile(join(root, path));
  }
  return result;
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

it('migrates, compiles and checks consumer cells with clean exit 0', async () => {
  const root = await temporaryRoot(), out = await temporaryRoot();
  const args = ['migrate', '--root', root, '--from', fixture];
  expect(await main(args, io)).toBe(0);
  expect(args[0]).toBe('migrate');
  expect(await main(['compile', '--root', root, '--out', out], io)).toBe(0);
  const before = [await bytes(root), await bytes(out)];
  expect(await main(['check', '--root', root, '--out', out], io)).toBe(0);
  expect(await main(['compile', '--root', root, '--out', out, '--check'], io)).toBe(0);
  expect([await bytes(root), await bytes(out)]).toEqual(before);
});

it.each(['check', 'compile'])('returns 1 for hand edits through %s without repairing any bytes', async verb => {
  const root = await temporaryRoot(), out = await temporaryRoot();
  expect(await main(['migrate', '--root', root, '--from', fixture], io)).toBe(0);
  expect(await main(['compile', '--root', root, '--out', out], io)).toBe(0);
  const path = join(out, 'generic-envelope.json');
  const edited = JSON.parse(await readFile(path, 'utf8'));
  edited.records[0].text = 'Example Co. edited this output';
  await writeFile(path, JSON.stringify(edited));
  const before = [await bytes(root), await bytes(out)];
  expect(await main([verb, '--root', root, '--out', out, ...(verb === 'compile' ? ['--check'] : [])], io)).toBe(1);
  expect([await bytes(root), await bytes(out)]).toEqual(before);
});

it('returns 1 for missing generated output without creating directories', async () => {
  const root = await temporaryRoot();
  expect(await main(['migrate', '--root', root, '--from', fixture], io)).toBe(0);
  const before = await bytes(root);
  expect(await main(['check', '--root', root, '--out', join(root, 'missing')], io)).toBe(1);
  expect(await bytes(root)).toEqual(before);
});

it('proposes and activates through the shell boundary with explicit confirmation', async () => {
  const root = await temporaryRoot(), out = await temporaryRoot();
  expect(await main(['migrate', '--root', root, '--from', fixture], io)).toBe(0);
  const messages: string[] = [];
  expect(await main(['propose', 'sample.auth', '--root', root], { ...io, out: text => messages.push(text) })).toBe(0);
  expect(messages).toEqual(['cells/sample.auth/v2.md']);
  expect(await main(['activate', 'sample.auth@2', '--root', root, '--out', out, '--confirm', 'msg:example#U1'], io)).toBe(0);
  expect(JSON.parse(await readFile(join(root, 'tree.json'), 'utf8')).active['sample.auth']).toBe(2);
  expect(await main(['check', '--root', root, '--out', out], io)).toBe(0);
});

it.each([
  ['unknown'], ['compile'], ['migrate', '--from'], ['compile', '--root', 'example', '--root', 'other'],
  ['compile', '--root', 'example', '--check', '--write'], ['check', '--root', 'example', '--write'],
  ['propose', 'sample.auth', '--root', 'example', '--check'], ['activate', 'sample.auth@2', '--root', 'example'],
  ['migrate', '--root', 'example', '--from', 'source', '--to', 'elsewhere'], ['compile', '--root', 'example', '--format', 'unknown'],
].map(args => ({ args })))('returns usage exit 2 for $args before touching a consumer tree', async ({ args }) => {
  const root = await temporaryRoot();
  const before = await bytes(root);
  expect(await main(args.map(value => value === 'example' ? root : value), io)).toBe(2);
  expect(await bytes(root)).toEqual(before);
});

it('prints help with exit 0', async () => {
  const messages: string[] = [];
  expect(await main(['--help'], { ...io, out: text => messages.push(text) })).toBe(0);
  expect(messages.join('')).toContain('Usage: writer-cells');
});
