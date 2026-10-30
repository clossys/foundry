import { specimenCellRequests } from '../../studio/lib/director-specimen-resource';
import type { AgentCells, CellDetail } from '../../studio/lib/cells-client';
import { describe, expect, it } from 'vitest';
import { cellContentHref, cellContentTarget, contentVersion, contentCellIndex } from '../../studio/lib/cell-content';

describe('content-only targets', () => {
  it('links every registered agent without frame or module state', () => {
    for (const agent of ['director', 'designer', 'writer', 'publisher']) expect(cellContentTarget(agent, 'sample.page')).toEqual({ href: `/content/${agent}/sample.page`, target: '_blank', rel: 'noopener noreferrer' });
    expect(cellContentHref('director', 'sample.page', { version: 2 })).toBe('/content/director/sample.page?version=2');
  });
  it.each(['../sample.page', 'sample.page/extra', 'sample%2epage', 'sample..page', 'https://example.invalid', 'sample'])('refuses unsafe cell identity %s', id => expect(() => cellContentHref('writer', id)).toThrow());
  it('expands real active and latest versions unless an exact version was requested', () => {
    const latest = { agent: 'director', id: 'sample.page', title: 'Page', version: 2, status: 'draft', content: '' } as CellDetail;
    const index: AgentCells = { agent: 'director', state: 'ready', cells: [latest], tree: { active: { 'sample.page': 1 } } };
    expect(specimenCellRequests(contentCellIndex(index, latest))).toEqual([{ id: 'sample.page', version: 2 }, { id: 'sample.page', version: 1 }]);
    const active = { ...latest, version: 1, status: 'active' as const };
    const exact = contentCellIndex(index, active, 1);
    expect(exact.tree).toBe(index.tree); expect(exact.contentScope).toEqual({ kind: 'version', cellId: 'sample.page', version: 1 });
    expect(specimenCellRequests(exact)).toEqual([{ id: 'sample.page', version: 1 }]);
    expect(() => contentCellIndex(index, latest, 1)).toThrow();
  });
  it('refuses unknown agents and ambiguous versions', () => {
    expect(() => cellContentHref('unknown', 'sample.page')).toThrow();
    for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) expect(() => cellContentHref('writer', 'sample.page', { version: value })).toThrow();
    for (const value of ['0', '01', '1.5', '9007199254740992', ['1', '2']]) expect(() => contentVersion(value)).toThrow();
    expect(contentVersion(undefined)).toBeUndefined(); expect(contentVersion('12')).toBe(12);
  });
});
