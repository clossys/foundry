import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createSpecimenBuilder, specimenEntry, specimenExport } from './build.js';
import { specimenRecordFrom } from './source.js';
import type { SpecimenFile } from './types.js';

const workspace = fileURLToPath(new URL('../../../../', import.meta.url));
const record = (files: SpecimenFile[]) => specimenRecordFrom({
  id: 'frames.test/shell', version: 1, kind: 'registry:block',
  files: [{ path: 'shell.json', content: JSON.stringify({ files }) }], preview: {}, contentHash: 'fixture',
});

describe('specimen entry and browser environment', () => {
  it('mounts a block page that composes its parts, not the first part', () => {
    const input = record([
      { path: 'components/app-sidebar.tsx', type: 'registry:component', content: 'export function AppSidebar() { return null; }' },
      { path: 'page.tsx', type: 'registry:page', content: 'import { AppSidebar } from "./components/app-sidebar"; export default function Page() { return <AppSidebar />; }' },
    ]);
    expect(specimenEntry(input)?.path).toBe('page.tsx');
    expect(specimenExport(input)).toBe('default');
  });

  it('prefers a block over its component parts when there is no page', () => {
    const input = record([
      { path: 'table.tsx', type: 'registry:component', content: 'export function Table() { return null; }' },
      { path: 'features.tsx', type: 'registry:block', content: 'import { Table } from "./table"; export default function Features() { return <Table />; }' },
    ]);
    expect(specimenEntry(input)?.path).toBe('features.tsx');
  });

  it('gives npm code reading process.env an empty browser env', async () => {
    const input = record([
      { path: 'index.tsx', type: 'registry:block', content: 'const flag = process.env.SOME_FLAG; export default function Env() { return <span>{String(flag ?? "none")}</span>; }' },
    ]);
    const built = await createSpecimenBuilder({ workspace }).build(input);
    expect(built.errors).toEqual([]);
    expect(built.js).toBeDefined();
    expect(built.js).not.toMatch(/process\.env/);
  }, 30_000);
});
