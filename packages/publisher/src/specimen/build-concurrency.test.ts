import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { specimenRecordFrom } from './source.js';
import type { SpecimenRecord, SpecimenRecordSource } from './types.js';

// Count Tailwind compiles; each one still compiles for real.
const tailwind = vi.hoisted(() => ({ compiles: 0 }));
vi.mock('tailwindcss', async importOriginal => {
  const actual = await importOriginal<typeof import('tailwindcss')>();
  return { ...actual, compile: (...args: Parameters<typeof actual.compile>) => { tailwind.compiles++; return actual.compile(...args); } };
});
const { createSpecimenBuilder, SPECIMEN_COLD_BUILDS } = await import('./build.js');

const workspace = fileURLToPath(new URL('../../../../', import.meta.url));
const record = (name: string, content = `export default function ${name}() { return <div className="p-4">${name}</div>; }`, path = 'index.tsx', notes?: string): SpecimenRecord => specimenRecordFrom({
  id: `components.${name.toLowerCase()}/${name.toLowerCase()}`, version: 1, kind: 'registry:block',
  files: [{ path: `${name}.json`, content: JSON.stringify({ files: [{ path, content }, ...(notes ? [{ path: 'notes.md', content: notes }] : [])] }) }], preview: { fixtures: { file: path, export: 'default', props: {} } }, contentHash: name,
});

/** An esbuild whose every bundle waits until the test releases it. */
function heldEsbuild() {
  const held: (() => void)[] = [];
  return {
    held,
    esbuild: { build: () => new Promise<{ outputFiles: { path: string; text: string }[]; errors: { text: string }[] }>(done => held.push(() => done({ outputFiles: [{ path: 'specimen.js', text: 'export {};' }], errors: [] }))) },
  };
}

describe('specimen builder load', () => {
  it(`runs at most ${SPECIMEN_COLD_BUILDS} cold builds at once: the third waits for a free place`, async () => {
    const { held, esbuild } = heldEsbuild();
    const builder = createSpecimenBuilder({ workspace, esbuild });
    const builds = ['Alpha', 'Beta', 'Gamma'].map(name => builder.build(record(name)));
    await vi.waitFor(() => expect(held).toHaveLength(2), { timeout: 20_000 });
    // Give the third every chance to start: it must not while two hold their places.
    await new Promise(done => setTimeout(done, 300));
    expect(held).toHaveLength(2);
    held[0]!();
    await vi.waitFor(() => expect(held).toHaveLength(3), { timeout: 20_000 });
    held[1]!(); held[2]!();
    expect((await Promise.all(builds)).map(build => build.errors)).toEqual([[], [], []]);
  }, 60_000);

  it('joins concurrent requests for one record to one closure walk', async () => {
    let aliases = 0;
    const source: SpecimenRecordSource = {
      read: async () => undefined, list: async () => [], theme: async () => undefined,
      alias: async () => { aliases++; return record('Part', 'export const Part = () => <span className="m-1" />;', 'components/ui/part.tsx'); },
    } as unknown as SpecimenRecordSource;
    const builder = createSpecimenBuilder({ workspace, esbuild: { build: async () => ({ outputFiles: [{ path: 'specimen.js', text: 'export {};' }], errors: [] }) } });
    const card = record('Card', 'import { Part } from "@/components/ui/part"; export default function Card() { return <Part />; }');
    const built = await Promise.all(Array.from({ length: 20 }, () => builder.build(card, source)));
    expect(new Set(built.map(build => build.hash)).size).toBe(1);
    expect(aliases).toBe(1);
  }, 60_000);

  it('compiles one stylesheet for records whose sources use the same utilities', async () => {
    const builder = createSpecimenBuilder({ workspace, esbuild: { build: async () => ({ outputFiles: [{ path: 'specimen.js', text: 'export {};' }], errors: [] }) } });
    const content = 'export default function Same() { return <div className="flex gap-2" />; }';
    tailwind.compiles = 0;
    const [first, second] = [await builder.build(record('One', content, 'index.tsx', 'one')), await builder.build(record('Two', content, 'index.tsx', 'two'))];
    expect(first.hash).not.toBe(second.hash);
    expect(second.css).toBe(first.css);
    expect(tailwind.compiles).toBe(1);
  }, 60_000);
});
