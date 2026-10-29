import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { main } from './cells-cli.js';
import { contentMapToCells } from './cells.js';
import { adminContentMap } from './__fixtures__/admin.js';

const roots: string[] = [];
const io = { out: (_text: string) => {}, error: (_text: string) => {} };
async function temporaryRoot() {
  const root = await mkdtemp(join(tmpdir(), 'publisher-bin-'));
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

it('compiles and checks clean content maps with exit 0 and preserves check bytes', async () => {
  const root = await temporaryRoot();
  await contentMapToCells(adminContentMap(), root);
  expect(await main(['compile', '--root', root, '--write'], io)).toBe(0);
  const before = await bytes(root);
  expect(await main(['check', '--root', root], io)).toBe(0);
  expect(await main(['compile', '--root', root, '--check'], io)).toBe(0);
  expect(await bytes(root)).toEqual(before);
});

it.each(['check', 'compile'])('returns 1 for hand edits through %s without repairing any bytes', async verb => {
  const root = await temporaryRoot(), map = adminContentMap();
  await contentMapToCells(map, root);
  const path = join(root, 'content-map', `${map.publicationId}.json`);
  const edited = JSON.parse(await readFile(path, 'utf8'));
  edited.entries[1].title = 'Example Co. edited this output';
  await writeFile(path, JSON.stringify(edited));
  const before = await bytes(root);
  expect(await main([verb, '--root', root, ...(verb === 'compile' ? ['--check'] : [])], io)).toBe(1);
  expect(await bytes(root)).toEqual(before);
});

it('returns 1 for unresolved links while reading repeated agent roots without writing to them', async () => {
  const root = await temporaryRoot(), inputs = await temporaryRoot();
  const writer = join(inputs, 'writer'), designer = join(inputs, 'designer');
  for (const agent of [writer, designer]) {
    await mkdir(agent);
    await writeFile(join(agent, 'tree.json'), JSON.stringify({ active: {} }));
  }
  await contentMapToCells(adminContentMap(), root);
  const cell = join(root, 'cells/page.designer/v1.md');
  await writeFile(cell, (await readFile(cell, 'utf8')).replace(/^links:.*$/m, 'links: [writer:copy.missing@1, designer:tokens.missing@1]'));
  const before = [await bytes(root), await bytes(inputs)], errors: string[] = [];
  expect(await main(['check', '--root', root, '--agent-root', writer, '--agent-root', `designer=${designer}`], { ...io, error: text => errors.push(text) })).toBe(1);
  expect(errors).toHaveLength(2);
  expect(errors.join('\n')).toContain('Unresolved cell link writer:copy.missing@1');
  expect(errors.join('\n')).toContain('Unresolved cell link designer:tokens.missing@1');
  expect([await bytes(root), await bytes(inputs)]).toEqual(before);
});

it('uses supplied agent roots to resolve links with exit 0', async () => {
  const root = await temporaryRoot(), writer = await temporaryRoot();
  await contentMapToCells(adminContentMap(), root);
  const cell = join(root, 'cells/page.designer/v1.md');
  await writeFile(cell, (await readFile(cell, 'utf8')).replace(/^links:.*$/m, 'links: [writer:copy.example@1]'));
  await mkdir(join(writer, 'cells/copy.example'), { recursive: true });
  await writeFile(join(writer, 'tree.json'), JSON.stringify({ active: { 'copy.example': 1 } }));
  await writeFile(join(writer, 'cells/copy.example/v1.md'), 'Example Co.');
  const before = [await bytes(root), await bytes(writer)];
  expect(await main(['check', '--root', root, '--agent-root', `writer=${writer}`], io)).toBe(0);
  expect([await bytes(root), await bytes(writer)]).toEqual(before);
});

it.each([
  ['unknown'], ['compile'], ['check', '--root'], ['compile', '--root', 'example', '--root', 'other'],
  ['compile', '--root', 'example', '--check', '--write'], ['check', '--root', 'example', '--write'],
  ['check', '--root', 'example', '--agent-root', 'writer='],
  ['check', '--root', 'example', '--agent-root', 'writer=a', '--agent-root', 'writer=b'],
].map(args => ({ args })))('returns usage exit 2 for $args before touching a consumer tree', async ({ args }) => {
  const root = await temporaryRoot();
  const before = await bytes(root);
  expect(await main(args.map(value => value === 'example' ? root : value), io)).toBe(2);
  expect(await bytes(root)).toEqual(before);
});

it('prints help with exit 0', async () => {
  const messages: string[] = [];
  expect(await main(['--help'], { ...io, out: text => messages.push(text) })).toBe(0);
  expect(messages.join('')).toContain('Usage: publisher-cells');
});
