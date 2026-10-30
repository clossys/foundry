import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadSpecimenCells, specimenCellRequests } from '../../studio/lib/director-specimen-resource';
import type { AgentCells } from '../../studio/lib/cells-client';

afterEach(() => vi.unstubAllGlobals());
const index: AgentCells = {
  agent: 'director', state: 'ready',
  cells: [
    { id: 'sample.page', title: 'Page', version: 2, status: 'draft' },
    { id: 'sample.other', title: 'Other', version: 3, status: 'draft' },
  ],
  tree: { active: { 'sample.page': 1, 'sample.other': 2 } },
};

describe('Director specimen resources', () => {
  it('loads only the selected cell and its independently pointed active version', () => {
    expect(specimenCellRequests({ ...index, contentScope: { kind: 'cell', cellId: 'sample.page' } })).toEqual([
      { id: 'sample.page', version: 2 }, { id: 'sample.page', version: 1 },
    ]);
    expect(specimenCellRequests({ ...index, contentScope: { kind: 'version', cellId: 'sample.page', version: 2 } })).toEqual([{ id: 'sample.page', version: 2 }]);
  });
  it('retains an explicit no-active-version pointer and deduplicates active/latest requests', () => {
    expect(specimenCellRequests({ ...index, tree: { active: { 'sample.page': null, 'sample.other': 3 } } })).toEqual([
      { id: 'sample.page', version: 2 }, { id: 'sample.other', version: 3 },
    ]);
  });
  it('rejects invalid scoped identities and mismatched exact versions', () => {
    expect(() => specimenCellRequests({ ...index, contentScope: { kind: 'cell', cellId: 'sample.missing' } })).toThrow('content-cell scope');
    expect(() => specimenCellRequests({ ...index, contentScope: { kind: 'version', cellId: 'sample.page', version: 1 } })).toThrow('content-version scope');
  });
  it.each([0, -1, 1.5, '1', Number.MAX_SAFE_INTEGER + 1])('rejects an invalid active pointer %s through the asynchronous error path', async value => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const broken = { ...index, tree: { active: { 'sample.page': value } } };
    expect(() => specimenCellRequests(broken)).toThrow('active-version pointer');
    await expect(loadSpecimenCells(broken, new AbortController().signal)).rejects.toThrow('active-version pointer');
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([null, [], 'invalid'])('rejects malformed active metadata %s instead of silently omitting the active version', async active => {
    await expect(loadSpecimenCells({ ...index, tree: { active } }, new AbortController().signal)).rejects.toThrow('active-version metadata');
  });
  it('propagates a version request failure instead of presenting a partial cell snapshot', async () => {
    const response = { agent: 'director', state: 'ready', cell: { id: 'sample.page', version: 2, status: 'draft', path: 'cells/sample.page/v2.md', fields: {}, source: '## Direction\n- Complete source' } };
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(response))).mockResolvedValueOnce(new Response('', { status: 404 }));
    vi.stubGlobal('fetch', fetch);
    await expect(loadSpecimenCells({ ...index, contentScope: { kind: 'cell', cellId: 'sample.page' } }, new AbortController().signal)).rejects.toThrow('could not find');
    expect(fetch.mock.calls.map(call => call[0])).toEqual(['/api/cells/director/sample.page?version=2', '/api/cells/director/sample.page?version=1']);
  });
});
