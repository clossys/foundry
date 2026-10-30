import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createCopyResolver } from '@clossys/writer';
import { getAdminCopyRecord } from '@clossys/writer/admin-copy';
import { serializeWriterCell } from '../../../writer/src/cells/parse';
import { SHELL_COPY_REFS } from '../../../designer/src/components/Banner.copy';
import { useStudioAdminCopy } from '../../studio/components/StudioShellCopy';
import { emptyStudioAdminCopy, projectStudioAdminCopy, studioAdminCopyRequests } from '../../studio/lib/studio-shell-copy';
import type { AgentCells, CellDetail } from '../../studio/lib/cells-client';

// Fixture values are unchanged public Writer records, never production catalog fallbacks.
const native = (id: string) => structuredClone(getAdminCopyRecord(id)!);
const skip = native(SHELL_COPY_REFS.frame.skip.id);
const results = native(SHELL_COPY_REFS.commands.results.id);
function cell(records: readonly Record<string, unknown>[], version = 1, status: 'active' | 'draft' = 'active', id = 'admin.shell'): CellDetail {
  const content = serializeWriterCell({ id, version, status, updated: '2026-10-29', links: [], ...(status === 'active' ? { confirmed: 'migration:2026-10-29' } : {}), locales: ['en'], records: records.map(record => ({ locale: 'en', record, bindings: [] })) });
  return { agent: 'writer', id, title: id, version, status, fields: { locales: ['en'] }, content };
}
const index = (cells: CellDetail[], active: Record<string, unknown> = {}): AgentCells => ({ agent: 'writer', state: 'ready', cells, tree: { active } });

describe('consumer Writer shell copy', () => {
  it('has no labels or package fallback before data loads, including the first server render', () => {
    expect(emptyStudioAdminCopy('loading').resolve(SHELL_COPY_REFS.frame.skip)).toBeUndefined();
    function Probe() { const data = useStudioAdminCopy(); return createElement('output', null, `${data.state}:${Object.keys(data.labels).length}:${data.resolve(SHELL_COPY_REFS.frame.skip) === undefined}`); }
    expect(renderToStaticMarkup(createElement(Probe))).toContain('loading:0:true');
  });
  it('resolves actual canonical cell records with preview status unchanged', () => {
    const source = cell([skip, results]); const before = source.content;
    const data = projectStudioAdminCopy(index([source], { [source.id]: 1 }), [source]);
    expect(data.state).toBe('ready'); expect(data.resolve(SHELL_COPY_REFS.frame.skip)?.text).toBe(skip.text);
    expect(data.labels[skip.id]).toBe(skip.text); expect(data.labels[results.id]).toBeUndefined();
    expect(data.cells).toEqual([{ id: source.id, version: 1, status: 'active', records: 2 }]);
    expect(source.content).toBe(before); expect(data.issues).toEqual([]);
  });
  it('uses native ICU rather than returning raw templates or locally substituting arguments', () => {
    const source = cell([results]); const data = projectStudioAdminCopy(index([source]), [source]);
    const ref = { ...SHELL_COPY_REFS.commands.results, values: { count: 2 } };
    const nativeResolve = createCopyResolver({ id: source.id, locale: 'en', revision: '1', source: { kind: 'consumer', reference: source.id }, entries: [{ ...results, placeholders: 'args' in results ? results.args?.map(arg => arg.name) : undefined }] }, { target: 'preview' });
    expect(data.resolve(ref)?.text).toBeTruthy(); expect(data.resolve(ref)?.text).not.toBe(results.text);
    const before = structuredClone(ref);
    expect(data.resolve(ref)?.text).toBe(nativeResolve(ref)?.text); expect(ref).toEqual(before);
    expect(data.resolve(SHELL_COPY_REFS.commands.results)).toBeUndefined();
    expect(data.resolve({ ...ref, values: { count: Infinity } })).toBeUndefined();
    expect(data.resolve({ ...ref, values: { count: 2, extra: 1 } })).toBeUndefined();
    expect(data.resolve({ ...ref, locale: 'fr' })).toBeUndefined();
  });
  it('loads the actual active pointer instead of replacing it with a newer draft', () => {
    const active = cell([skip]); const draft = cell([{ ...skip, text: native(SHELL_COPY_REFS.frame.navigationOpen.id).text }], 2, 'draft');
    const writer = index([draft], { [active.id]: 1 });
    expect(studioAdminCopyRequests(writer).requests).toEqual([{ id: active.id, version: 1 }]);
    expect(projectStudioAdminCopy(writer, [active, draft]).resolve(SHELL_COPY_REFS.frame.skip)?.text).toBe(skip.text);
    expect(projectStudioAdminCopy(writer, [draft]).resolve(SHELL_COPY_REFS.frame.skip)).toBeUndefined();
  });
  it('permits actual unactivated draft source in explicit preview without inventing approval', () => {
    const source = cell([skip], 2, 'draft'); const data = projectStudioAdminCopy(index([source]), [source]);
    expect(data.resolve(SHELL_COPY_REFS.frame.skip)?.text).toBe(skip.text);
    expect(data.cells[0]?.status).toBe('draft'); expect(skip.status).toBe('draft');
  });
  it('reads older Fill profiles and never displays frontmatter or rationale', () => {
    const source = { ...cell([]), content: `---\nid: admin.shell\n---\n## Rationale\n${native(SHELL_COPY_REFS.frame.navigationClose.id).text}\n## Fill\n\n\`\`\`json\n${JSON.stringify({ locale: 'en', records: [skip] })}\n\`\`\`` };
    const data = projectStudioAdminCopy(index([source]), [source]);
    expect(data.resolve(SHELL_COPY_REFS.frame.skip)?.text).toBe(skip.text); expect(Object.keys(data.labels)).toEqual([skip.id]);
  });
  it('refuses conflicting IDs, missing lifecycle, retired source and missing inventory without catalog substitution', () => {
    const one = cell([skip]); const two = cell([{ ...skip, text: native(SHELL_COPY_REFS.frame.navigationOpen.id).text }], 1, 'active', 'admin.other');
    expect(projectStudioAdminCopy(index([one, two]), [one, two]).resolve(SHELL_COPY_REFS.frame.skip)).toBeUndefined();
    const invalid = cell([{ ...skip, status: undefined }]); expect(projectStudioAdminCopy(index([invalid]), [invalid]).resolve(SHELL_COPY_REFS.frame.skip)).toBeUndefined();
    expect(projectStudioAdminCopy({ ...index([one]), state: 'missing' }, []).resolve(SHELL_COPY_REFS.frame.skip)).toBeUndefined();
    expect(projectStudioAdminCopy(index([{ ...one, status: 'retired' }]), [one]).state).toBe('missing');
  });
  it('refuses invalid pointers and a pointer whose loaded source is still a draft', () => {
    const source = cell([skip]); expect(studioAdminCopyRequests(index([source], { [source.id]: undefined })).requests).toEqual([]);
    expect(projectStudioAdminCopy(index([source], { [source.id]: 1 }), [{ ...source, status: 'draft' }]).resolve(SHELL_COPY_REFS.frame.skip)).toBeUndefined();
  });
});
