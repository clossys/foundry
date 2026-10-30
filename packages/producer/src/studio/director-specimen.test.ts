import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { directorDocument, directorPassages, directorVersionedPassages, directorProjection, directorSections, evidenceHref, specimenTitle } from '../../studio/lib/director-specimen';
import { loadCell, type CellDetail, type AgentCells } from '../../studio/lib/cells-client';
import { specimenCellRequests } from '../../studio/lib/director-specimen-resource';
afterEach(() => vi.unstubAllGlobals());

const index: AgentCells = { agent: 'director', state: 'ready', cells: [
  { id: 'focus.segment.core', title: 'Ignored summary title', status: 'active', version: 2, fields: { title: 'Core segment' } },
  { id: 'focus.segment.next', title: 'Next', status: 'draft', version: 1 },
  { id: 'identity.purpose.promise', title: 'Old', status: 'retired', version: 1 },
], tree: { tree: [{ id: 'focus', name: 'Focus', children: [{ id: 'focus.segment', name: 'Segment', cells: ['focus.segment.next', 'focus.segment.core'] }] }, { id: 'identity', name: 'Identity', cells: ['identity.purpose.promise'] }] } };

describe('Director specimen projection', () => {
  it('projects canonical anonymous strategy body and hides frontmatter', () => {
    const source = readFileSync(new URL('../../../strategist/test-fixtures/strategy-v2/example/cells/focus.segment.core/v2.md', import.meta.url), 'utf8');
    const sections = directorSections(source);
    expect(sections.map(section => section.title)).toEqual(['Direction', 'Because', 'Watch']);
    expect(sections[0]!.value).toContain('independent ceramics studios');
    expect(sections.map(section => section.value).join('\n')).not.toMatch(/status: active|confirmed:|^---/m);
  });
  it('preserves complete body-projection Markdown including continuation lines and rich content', () => {
    const value = '- Choice: **Keep the full decision.**  \n  A continuation with [evidence](https://example.invalid/study).\n\nA second paragraph with `literal code`.\n\n### Detail\n1. An ordered criterion.\n2. Another criterion.\n\n> A quoted qualification.\n\n| Signal | Threshold |\n| --- | --- |\n| Trial | 20% |\n\n````markdown\n## Watch\n```\nAn example heading stays inside Direction.\n````';
    const projection = directorProjection(`## Direction\n${value}\n\n## Because\n- The stated reason.\n\n## Watch\n- The full tripwire.`);
    expect(projection.issues).toEqual([]);
    expect(projection.sections).toEqual([{ title: 'Direction', value }, { title: 'Because', value: '- The stated reason.' }, { title: 'Watch', value: '- The full tripwire.' }]);
  });
  it('does not interpret tilde-fenced examples outside a passage as native headings', () => {
    expect(directorProjection('~~~markdown\n## Direction\n- Example only\n~~~\n## Direction\n- Actual decision')).toEqual({ sections: [{ title: 'Direction', value: '- Actual decision' }], issues: [] });
  });
  it('surfaces malformed native frontmatter without exposing it as a passage', () => {
    const malformed = directorProjection('---\nid: sample.page\nid: another.page\n---\n## Direction\n- Real text');
    expect(malformed.sections).toEqual([]);
    expect(malformed.issues).toEqual(['Director frontmatter, line 3: Duplicate frontmatter key']);
    expect(directorProjection('---\nid: sample.page\n## Direction\n- Real text').issues[0]).toContain('Expected closing ---');
  });
  it('reports empty passages and unfinished code while retaining every actual source line', () => {
    const projection = directorProjection('## Direction\n\n## Because\n- Actual evidence\n\n## Watch\n```text\nUnfinished example');
    expect(projection.sections).toEqual([{ title: 'Because', value: '- Actual evidence' }, { title: 'Watch', value: '```text\nUnfinished example' }]);
    expect(projection.issues).toHaveLength(2);
    expect(projection.issues.join(' ')).toContain('Expected closing code fence');
    expect(projection.issues.join(' ')).toContain('A declared Director passage has no supported semantic content');
  });
  it('preserves TREE chapter, section and passage order, retains drafts and omits retired passages', () => {
    const chapters = directorDocument(index);
    expect(chapters[0]!.title).toBe('Focus');
    expect(chapters[0]!.children[0]!.title).toBe('Segment');
    expect(directorPassages(chapters).map(cell => [cell.id, cell.status])).toEqual([['focus.segment.next', 'draft'], ['focus.segment.core', 'active']]);
  });
  it('uses fields.title then ID leaf without guessing an active state', () => {
    expect(specimenTitle(index.cells[0]!)).toBe('Core segment');
    expect(specimenTitle(index.cells[1]!)).toBe('next');
    expect(directorPassages(directorDocument({ ...index, tree: undefined, cells: [{ id: 'focus.segment.unknown', title: 'Unknown' }] }))).toEqual([]);
  });
  it('never projects template fences or unexpected instruction sections', () => {
    expect(directorSections('## Instructions\n- Edit this file\n```markdown\n## Direction\n- fake: choose\n```\n## Direction\n- Real: choice\n## Instructions\n- Do not show')).toEqual([{ title: 'Direction', value: '- Real: choice' }]);
  });
  it('links real references without inventing destinations for evidence identifiers', () => {
    expect(evidenceHref('focus.segment.core@2')).toBe('?agent=director&cell=focus.segment.core&version=2');
    expect(evidenceHref('finding:anonymous-study')).toBeUndefined();
    expect(evidenceHref('javascript:alert(1)')).toBeUndefined();
  });
  it('keeps the pointed active v1 and latest draft v2 of the same ID in TREE order', () => {
    const source = readFileSync(new URL('../../../strategist/test-fixtures/strategy-v2/example/cells/focus.segment.core/v2.md', import.meta.url), 'utf8');
    const draftIndex: AgentCells = { ...index, cells: index.cells.map(cell => cell.id === 'focus.segment.core' ? { ...cell, status: 'draft', version: 2 } : cell), tree: { ...index.tree, active: { 'focus.segment.core': 1 } } };
    expect(specimenCellRequests(draftIndex)).toEqual([{ id: 'focus.segment.core', version: 2 }, { id: 'focus.segment.next', version: 1 }, { id: 'focus.segment.core', version: 1 }]);
    const active: CellDetail = { ...draftIndex.cells[0]!, agent: 'director', status: 'active', version: 1, content: source.replace('version: 2', 'version: 1') };
    const draft: CellDetail = { ...active, status: 'draft', version: 2, content: source.replace('status: active', 'status: draft').replace('40 to 150 members', '60 to 150 members') };
    const next: CellDetail = { ...draftIndex.cells[1]!, agent: 'director', content: source };
    const passages = directorVersionedPassages(draftIndex, [draft, next, active]);
    expect(passages.map(cell => [cell.id, cell.version, cell.status])).toEqual([['focus.segment.next', 1, 'draft'], ['focus.segment.core', 1, 'active'], ['focus.segment.core', 2, 'draft']]);
    expect(directorSections(passages[1]!.content)[0]!.value).toContain('40 to 150 members');
    expect(directorSections(passages[2]!.content)[0]!.value).toContain('60 to 150 members');
  });
  it('loads an exact requested version and refuses a mismatched response instead of relabelling it', async () => {
    const response = (version: number) => new Response(JSON.stringify({ agent: 'director', state: 'ready', cell: { id: 'focus.segment.core', version, status: version === 1 ? 'active' : 'draft', path: `cells/focus.segment.core/v${version}.md`, fields: {}, source: '## Direction\n- Fixture: choice' } }));
    const fetch = vi.fn().mockResolvedValueOnce(response(1)).mockResolvedValueOnce(response(2));
    vi.stubGlobal('fetch', fetch);
    expect(await loadCell('director', 'focus.segment.core', new AbortController().signal, 1)).toMatchObject({ version: 1, status: 'active' });
    expect(fetch.mock.calls[0]![0]).toBe('/api/cells/director/focus.segment.core?version=1');
    await expect(loadCell('director', 'focus.segment.core', new AbortController().signal, 1)).rejects.toThrow('different cell version');
  });

});
