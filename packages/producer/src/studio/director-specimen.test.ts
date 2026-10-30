import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { directorDocument, directorPassages, directorSections, evidenceHref, specimenTitle } from '../../studio/lib/director-specimen';
import type { AgentCells } from '../../studio/lib/cells-client';

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
});
