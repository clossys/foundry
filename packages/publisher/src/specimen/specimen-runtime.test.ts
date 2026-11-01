import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { createSpecimenBuilder, specimenEntry } from './build.js';
import { specimenRecordFrom, adaptPreview } from './source.js';
import { renderSpecimenPage } from './render.js';
import { libraryRecordSource } from '../../../producer/src/specimen/library-source.js';
import { slotDetail } from '../../../producer/src/server/slot-detail.js';
import { slotDetailInputs } from '../../../producer/studio/lib/slot-detail.js';
import type { SpecimenFile } from './types.js';

const { JSDOM } = createRequire(import.meta.url)('jsdom');
const workspace = fileURLToPath(new URL('../../../../', import.meta.url));
const detail = slotDetail(workspace, 'designer', 'sections.studio.checks')!;
const props = { checks: slotDetailInputs(detail, { gallery: agent => `/${agent}`, leaf: (agent, id) => `/${agent}/${id}` }, 'light').checks };
const files: SpecimenFile[] = [
  // This helper precedes the entry and is executed by it. Props are the native detail projection.
  { path: 'helpers.tsx', content: 'export const finding = checks => checks.find(row => !row.ok)?.label ?? checks[0].label;' },
  { path: 'index.tsx', content: 'import { Button } from "@clossys/designer-ui"; import { finding } from "./helpers"; export default function Checks({ checks }) { return <Button>{finding(checks)}</Button>; }' },
  // A package-local @/components/ui/dialog must never capture this virtual record file.
  { path: 'components/ui/dialog.tsx', content: 'export const RecordOnlyDialog = () => <span>virtual-record-dialog</span>;' },
];
const record = (payload = files, preview: unknown = { fixtures: { file: 'index.tsx', export: 'default', props } }) => specimenRecordFrom({
  id: 'sections.test/runtime', version: 1, kind: 'registry:block',
  files: [{ path: 'runtime.json', content: JSON.stringify({ files: payload }) }], preview, contentHash: 'fixture',
});

describe('specimen runtime source boundaries', () => {
  it('bundles a multi-file record while package-local aliases retain the real package resolution', async () => {
    expect(props.checks).toEqual(expect.arrayContaining([expect.objectContaining({ label: 'Pin matches candidate bytes' })]));
    const input = record();
    expect(specimenEntry(input)?.path).toBe('index.tsx');
    expect(input.preview).toEqual({ entry: 'index.tsx', export: 'default', fixtures: props });
    const built = await createSpecimenBuilder({ workspace }).build(input);
    expect(built.errors).toEqual([]);
    expect(built.js).toContain('createElement');
    expect(built.js).not.toContain('virtual-record-dialog');
    const html = renderSpecimenPage({ query: { element: input.id }, record: input, build: built, mode: 'light', assetBase: '/assets/', nonce: 'test' });
    const config = JSON.parse(/id="specimen-props">([^<]+)/.exec(html)![1]!);
    expect(config).toEqual({ props, export: 'default' });
    expect(built.js).toContain('payload has no component export ');
  }, 30_000);

  it('retains explicit entry/export and rejects a descriptor that names no actual source file', () => {
    expect(adaptPreview({ fixtures: { file: 'helpers.tsx', export: 'finding', props }, entry: 'index.tsx', export: 'default' }))
      .toEqual({ entry: 'index.tsx', export: 'default', fixtures: props });
    expect(adaptPreview({ fixtures: { checks: props.checks } })).toEqual({ fixtures: props });
    for (const file of ['missing.tsx', '../index.tsx', '/index.tsx', 'runtime.json']) {
      expect(() => record(files, { fixtures: { file, export: 'default', props } })).toThrow(/not a code file in the payload/);
    }
    expect(() => record(files, { fixtures: { file: 'index.tsx', export: '', props } })).toThrow(/fixtures need/);
  });

  it('parses the actual canonical fixture descriptor without inventing missing required inputs', () => {
    const native = JSON.parse(detail.candidates.find(candidate => candidate.pinned)!.content);
    const input = specimenRecordFrom({ id: 'sections.studio.checks/studio-checks', version: 1, kind: native.type,
      files: [{ path: 'studio-checks.json', content: JSON.stringify(native) }], preview: native.meta.preview, contentHash: detail.pin!.sha256 });
    expect(input.preview).toMatchObject({ entry: 'index.tsx', export: 'default', fixtures: {} });
    expect(input.contentHash).toBe(detail.pin!.sha256);
    expect(input.payload.files.find(file => file.path === 'index.tsx')!.content).toContain('checks: rows');
    expect(input.preview.fixtures).not.toHaveProperty('checks');
    // Source membership and normalization also hold for the helper-first canonical shell.
    const shell = slotDetail(workspace, 'designer', 'frames.studio-shell')!;
    const item = JSON.parse(shell.candidates.find(candidate => candidate.pinned)!.content);
    const shellRecord = specimenRecordFrom({ id: 'frames.studio-shell/studio-shell', version: 6, kind: item.type,
      files: [{ path: 'studio-shell.json', content: JSON.stringify(item) }], preview: item.meta.preview, contentHash: shell.pin!.sha256 });
    expect(shellRecord.payload.files.find(file => file.path.endsWith('.tsx'))!.path).toBe('PageNotice.tsx');
    expect(specimenEntry(shellRecord)?.path).toBe('index.tsx');
    expect(shellRecord.preview.fixtures).toEqual({});
  });

  it('does not resolve a virtual alias by basename, escape to the filesystem, or mount a bundle on build failure', async () => {
    const input = record([
      { path: 'index.tsx', content: 'import { Missing } from "@/unrelated/button"; export default Missing;' },
      { path: 'one/button.tsx', content: 'export const Missing = () => null;' },
      { path: 'two/button.tsx', content: 'export const Missing = () => null;' },
    ]);
    const built = await createSpecimenBuilder({ workspace }).build(input);
    expect(built.js).toBeUndefined();
    expect(built.errors).toContain('unresolved element import @/unrelated/button');
    const html = renderSpecimenPage({ query: { element: input.id }, record: input, build: built, mode: 'light', assetBase: '/assets/', nonce: 'test' });
    expect(html).toContain('"preErrors":[{"source":"build","message":"unresolved element import @/unrelated/button"}]');
    expect(html).not.toContain('type="module"');
    const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
    try {
      dom.window.eval(dom.window.document.querySelector('head script')!.textContent!);
      expect(dom.window.document.querySelector('[data-specimen-error][role="alert"]')?.textContent).toContain('unresolved element import @/unrelated/button');
      expect(dom.window.document.getElementById('specimen-root')).toBeNull();
      const health = (dom.window as any).__clossysSpecimen.health();
      expect(health.errors).toMatchObject({ count: 1, items: [{ source: 'build', message: 'unresolved element import @/unrelated/button' }] });
      expect(health.weight.jsBytes).toBe(0);
    } finally { dom.window.close(); }
    const external = record([{ path: 'index.tsx', content: 'import X from "../../host-only"; export default X;' }]);
    expect((await createSpecimenBuilder({ workspace }).build(external)).errors).toContain('unresolved relative import ../../host-only from index.tsx');
  }, 30_000);

  it('keeps the actual canonical shell build visible as executable output or actual diagnostics', async () => {
    const source = libraryRecordSource({ roots: [workspace + 'clossys'] });
    const record = (await source.read('frames.studio-shell/studio-shell'))!;
    expect(record.kind).toBe('visual');
    const built = await createSpecimenBuilder({ workspace }).build(record, source);
    expect(Boolean(built.js) || built.errors.length > 0).toBe(true);
    const html = renderSpecimenPage({ query: { element: record.id, width: 375 }, record, build: built, mode: 'dark', assetBase: '/assets/', nonce: 'test' });
    const dom = new JSDOM(html);
    try {
      if (built.js) {
        expect(dom.window.document.getElementById('specimen-root')).not.toBeNull();
        expect(dom.window.document.querySelector('script[type="module"]')?.getAttribute('src')).toBe(`/assets/${built.hash}.js`);
        expect(dom.window.document.querySelector('[data-specimen-error]')).toBeNull();
      } else {
        const failure = dom.window.document.querySelector('[data-specimen-error][role="alert"]');
        expect(failure).not.toBeNull();
        for (const message of built.errors) expect(failure!.textContent).toContain(message);
        expect(dom.window.document.getElementById('specimen-root')).toBeNull();
        expect(dom.window.document.querySelector('script[type="module"]')).toBeNull();
      }
    } finally { dom.window.close(); }
  }, 30_000);

  it('keeps a missing executable bundle red even if the bundler returns no diagnostics', async () => {
    const input = record();
    const built = await createSpecimenBuilder({ workspace, esbuild: { build: async () => ({ outputFiles: [], errors: [] }) } }).build(input);
    expect(built.js).toBeUndefined();
    expect(built.errors).toEqual(['visual specimen has no executable bundle']);
    const html = renderSpecimenPage({ query: { element: input.id }, record: input, build: built, mode: 'light', assetBase: '/assets/', nonce: 'test' });
    expect(html).toContain('"preErrors":[{"source":"build","message":"visual specimen has no executable bundle"}]');
    expect(html).not.toContain('type="module"');
    expect(html).toContain('data-specimen-error role="alert">visual specimen has no executable bundle');
    expect(html).not.toContain('id="specimen-root"');
  });
});
