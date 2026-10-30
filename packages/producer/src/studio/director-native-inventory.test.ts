import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { AgentCells, CellDetail } from '../../studio/lib/cells-client';
import { directorNativePlan } from '../../studio/lib/director-native-inventory';

const id = 'focus.segment.core';
const source = readFileSync(new URL('../../../strategist/test-fixtures/strategy-v2/example/cells/focus.segment.core/v2.md', import.meta.url), 'utf8');
const active: CellDetail = { agent: 'director', id, title: 'Core', version: 1, status: 'active', content: source.replace('version: 2', 'version: 1') };
const draft: CellDetail = { ...active, version: 2, status: 'draft', content: source.replace('status: active', 'status: draft').replace('40 to 150 members', '60 to 150 members') };
const index: AgentCells = { agent: 'director', state: 'ready', cells: [{ id, title: 'Core', version: 2, status: 'draft' }], tree: { active: { [id]: 1 } } };

describe('selected Director native version inventory', () => {
  it('keeps all full passages from latest draft and older active without another cell document', () => {
    const other: CellDetail = { ...active, id: 'focus.segment.next', content: '## Direction\n- Foreign cell text' };
    const plan = directorNativePlan(index, [active, other, draft], id);
    expect(plan.issues).toEqual([]);
    expect(plan.items).toHaveLength(6);
    expect(plan.expectedVariantIds).toEqual(plan.items.map(item => item.id));
    expect(new Set(plan.expectedVariantIds).size).toBe(6);
    expect(plan.items.map(item => item.version)).toEqual([2, 2, 2, 1, 1, 1]);
    expect(plan.items[0]).toMatchObject({ label: 'Direction · v2 (draft)', status: 'draft' });
    expect(plan.items[3]).toMatchObject({ label: 'Direction · v1 (active)', status: 'active' });
    expect(String(plan.items[0]!.value)).toContain('60 to 150 members');
    expect(String(plan.items[3]!.value)).toContain('40 to 150 members');
    expect(JSON.stringify(plan.items)).not.toContain('Foreign cell text');
  });
  it('keeps every hidden-scale passage in independent expected IDs', () => {
    const many = Array.from({ length: 15 }, (_, i) => `## Direction\n- Entire passage ${i}`).join('\n');
    const plan = directorNativePlan({ ...index, tree: undefined }, [{ ...draft, content: many }], id);
    expect(plan.items).toHaveLength(15);
    expect(plan.expectedVariantIds).toHaveLength(15);
    expect(plan.items[14]!.value).toBe('- Entire passage 14');
    expect(plan.issues).toEqual([]);
  });
  it('fails when an explicit active pointer has not loaded and never invents its content', () => {
    const plan = directorNativePlan(index, [draft], id);
    expect(plan.items).toHaveLength(3);
    expect(plan.expectedVariantIds.every(variant => variant.endsWith('#v2'))).toBe(true);
    expect(plan.issues).toContain('The pointed active Director version has not loaded: 1');
  });
  it('does not manufacture an active version when no pointer or active source exists', () => {
    const plan = directorNativePlan({ ...index, tree: undefined }, [draft], id);
    expect(plan.items).toHaveLength(3);
    expect(plan.items.every(item => item.status === 'draft')).toBe(true);
    expect(plan.issues).toEqual([]);
  });
  it('honors an explicit historical scope without rewriting or following native active pointers', () => {
    const scoped: AgentCells = { ...index, cells: [active], tree: { active: { [id]: 2 } }, contentScope: { kind: 'version', cellId: id, version: 1 } };
    const plan = directorNativePlan(scoped, [active, draft], id);
    expect(plan.issues).toEqual([]); expect(plan.items).toHaveLength(3);
    expect(plan.items.every(item => item.version === 1)).toBe(true);
    expect(plan.scope).toEqual({ kind: 'version', cellId: id, version: 1 });
    expect(scoped.tree?.active).toEqual({ [id]: 2 });
  });
  it('reports duplicate version metadata and keeps resulting item identities unique', () => {
    const plan = directorNativePlan(index, [draft, { ...draft, status: 'active' }, active], id);
    expect(plan.issues).toContain('The loaded Director version is duplicated: 2');
    expect(new Set(plan.items.map(item => item.id)).size).toBe(plan.items.length);
  });
  it.each([{ ...draft, version: undefined }, { ...draft, version: 0 }, { ...draft, status: undefined }])('fails for missing or invalid version/status metadata', broken => {
    expect(directorNativePlan(index, [broken], id).issues.length).toBeGreaterThan(0);
  });
  it('fails when source status contradicts the actual active pointer', () => {
    const plan = directorNativePlan(index, [draft, { ...active, status: 'draft' }], id);
    expect(plan.issues).toContain('The pointed active Director version has not loaded: 1');
  });
});
