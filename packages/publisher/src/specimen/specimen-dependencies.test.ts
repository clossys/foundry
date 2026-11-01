import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createSpecimenBuilder } from './build.js';
import { specimenRecordFrom } from './source.js';
import type { SpecimenDependencies, SpecimenRecordSource } from './types.js';

const workspace = fileURLToPath(new URL('../../../../', import.meta.url));
const record = (content = 'import { label } from "../../lib/label"; export default function Example() { return <p>{label}</p>; }') => specimenRecordFrom({
  id: 'frames.example/example', version: 1, kind: 'registry:block', contentHash: 'record',
  files: [{ path: 'example.json', content: JSON.stringify({ files: [
    { path: 'index.tsx', content },
  ] }) }], preview: { entry: 'index.tsx' },
});
const dependencies = () => ({
  identity: 'owned-host-v1', locations: [{ path: 'index.tsx', target: 'studio/frames/example/index.tsx' }],
  files: [
    { path: 'studio/lib/label.ts', content: 'import data from "./label.json"; export const label = data.label;' },
    { path: 'studio/lib/label.json', content: '{"label":"native host input"}' },
  ],
} satisfies SpecimenDependencies);
const source = (value: SpecimenDependencies): SpecimenRecordSource => ({ read: async () => undefined, theme: async () => undefined, dependencies: async () => value });

describe('bounded specimen host dependency envelope', () => {
  it('preserves the payload entry and resolves its native target against supplied code and JSON', async () => {
    const input = record(), before = JSON.stringify(input);
    const result = await createSpecimenBuilder({ workspace }).build(input, source(dependencies()));
    expect(result.errors).toEqual([]);
    expect(result.js).toContain('native host input');
    expect(JSON.stringify(input)).toBe(before);
  }, 30_000);

  it('hashes host identity, actual bytes and placement even when the record is unchanged', async () => {
    const builder = createSpecimenBuilder({ workspace }), input = record(), envelope = dependencies();
    const initial = await builder.build(input, source(envelope));
    envelope.files[1] = { ...envelope.files[1]!, content: '{"label":"changed host input"}' };
    const changed = await builder.build(input, source(envelope));
    expect(changed.hash).not.toBe(initial.hash);
    expect(changed.js).toContain('changed host input');
    const renamed = await builder.build(input, source({ ...envelope, identity: 'another-host' }));
    expect(renamed.hash).not.toBe(changed.hash);
    const moved = await builder.build(input, source({ ...envelope, locations: [{ path: 'index.tsx', target: 'studio/frames/elsewhere/index.tsx' }] }));
    expect(moved.hash).not.toBe(changed.hash);
  }, 30_000);

  it('fails closed for traversal, duplicate mappings, collisions and missing host inputs', async () => {
    const cases: SpecimenDependencies[] = [
      { ...dependencies(), files: [{ path: '../host.ts', content: 'export default 1;' }] },
      { ...dependencies(), locations: [{ path: 'index.tsx', target: 'studio/../outside.tsx' }] },
      { ...dependencies(), locations: [...dependencies().locations, ...dependencies().locations] },
      { ...dependencies(), files: [...dependencies().files, { path: 'index.tsx', content: 'export default 1;' }] },
      { ...dependencies(), files: [...dependencies().files, dependencies().files[0]!] },
      { ...dependencies(), files: [{ path: 'studio/frames/example/index.tsx', content: 'export default 1;' }] },
      { ...dependencies(), files: [] },
    ];
    for (const envelope of cases) {
      const result = await createSpecimenBuilder({ workspace }).build(record(), source(envelope));
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.js).toBeUndefined();
    }
  }, 30_000);

  it('keeps a malicious relative import outside the mapped host inventory unresolved', async () => {
    for (const specifier of ['../../host-only', '../../../outside', '../../lib/missing']) {
      const input = record(`import X from ${JSON.stringify(specifier)}; export default X;`);
      const result = await createSpecimenBuilder({ workspace }).build(input, source(dependencies()));
      expect(result.js).toBeUndefined();
      expect(result.errors).toContain(`unresolved relative import ${specifier} from index.tsx`);
    }
  }, 30_000);

  it('resolves a host backedge to authoritative payload bytes through a native cycle', async () => {
    const input = record('import { label } from "../../lib/label"; export const suffix = "payload authority"; export default function Example() { return <p>{label()}</p>; }');
    const envelope = dependencies();
    envelope.files[0] = { path: 'studio/lib/label.ts', content: 'import { suffix } from "../frames/example/index"; export const label = () => suffix;' };
    const result = await createSpecimenBuilder({ workspace }).build(input, source(envelope));
    expect(result.errors).toEqual([]);
    expect(result.js).toContain('payload authority');
  }, 30_000);
});
