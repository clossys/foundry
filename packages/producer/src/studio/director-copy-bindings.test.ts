import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createAdminCopy,
  getAdminDirectorCellTitleBinding,
  resolveAdminDirectorCellTitle,
  type AdminCopy,
} from '@clossys/writer/admin-copy';
import { ADMIN_STUDIO_COPY_EN } from '@clossys/writer/admin-studio';
import { createDirectorCopyBindings, type DirectorLabelResult } from '../../studio/lib/director-copy-bindings';

const cellId = 'context.market.size';
const preview = { target: 'preview' as const };
const factId = 'reachable-market';
const authoredTitle = 'Reachable market: API/eBay, v2';
const brief = { reference: 'fixture/strategy-brief.json', facts: [{ id: factId, title: authoredTitle }] };

function changedTitleCopy(change: (record: Record<string, unknown>, binding: Record<string, unknown>, envelope: { records: Record<string, unknown>[]; bindings: Record<string, unknown>[] }) => void): AdminCopy {
  const envelope = JSON.parse(JSON.stringify(ADMIN_STUDIO_COPY_EN));
  const binding = envelope.bindings.find((row: Record<string, unknown>) => row.sourceCellId === cellId);
  const record = envelope.records.find((row: Record<string, unknown>) => row.id === binding.recordId);
  change(record, binding, envelope);
  return createAdminCopy([envelope]);
}

function expectNeed(result: DirectorLabelResult): void {
  expect(result.state).toBe('need');
  expect(result).not.toHaveProperty('text');
  expect(result).not.toHaveProperty('provenance');
  if (result.state === 'need') {
    expect(result.code).toBeTruthy();
    expect(result.message).toMatch(/not available yet/);
    expect(result.message).not.toMatch(/NEED|fact:|context\.market\.size|reachable-market|fixture\/|st\./);
  }
}

describe('Director Writer title binding through the public package API', () => {
  it('binds every public strategy cell in explicit preview while keeping its draft out of production', () => {
    const catalog: { id: string }[] = JSON.parse(readFileSync(new URL('../../../strategist/src/catalog/cells/strategy.json', import.meta.url), 'utf8'));
    expect(catalog).toHaveLength(57);
    const bindings = createDirectorCopyBindings({ options: preview });
    const production = createDirectorCopyBindings();
    for (const cell of catalog) {
      const result = bindings.cellTitle(cell.id);
      expect(result, cell.id).toMatchObject({ state: 'bound', role: 'heading', provenance: { kind: 'writer-copy', binding: { sourceCellId: cell.id } } });
      if (result.state === 'bound') {
        expect(result.text.trim(), cell.id).toBeTruthy();
        expect(result.text, cell.id).not.toBe(cell.id);
        expect(result.text, cell.id).not.toBe(cell.id.split('.').at(-1));
      }
      expectNeed(production.cellTitle(cell.id));
    }
  });

  it('resolves the authoritative market-size title as a heading, retaining its Writer binding', () => {
    const binding = getAdminDirectorCellTitleBinding(cellId);
    expect(binding).toMatchObject({
      cellId: 'director.item.context.market.size', sourceCellId: cellId,
      target: 'packages/strategist/src/catalog/cells/strategy.json', kind: 'item-name', role: 'heading',
    });
    expect(resolveAdminDirectorCellTitle(cellId, undefined, preview)).toMatchObject({
      text: 'Market size', role: 'heading', servedLocale: 'en', status: 'draft', activation: 'none',
      ref: { id: binding!.recordId }, binding,
    });
    expect(binding!.role).not.toBe('link');
  });

  it('requires explicit preview for the shipped draft instead of inventing approval', () => {
    expect(resolveAdminDirectorCellTitle(cellId)).toBeUndefined();
    expect(resolveAdminDirectorCellTitle(cellId, undefined, { target: 'production' })).toBeUndefined();
    expectNeed(createDirectorCopyBindings().cellTitle(cellId));
  });

  it.each(['size', 'context.market.unknown', 'director.item.context.market.size', 'context..size'])('leaves unsupported exact cell identity %s unresolved', id => {
    expect(getAdminDirectorCellTitleBinding(id)).toBeUndefined();
    expect(resolveAdminDirectorCellTitle(id, undefined, preview)).toBeUndefined();
    expectNeed(createDirectorCopyBindings({ options: preview }).cellTitle(id));
  });

  it.each([
    ['missing binding', (_record: Record<string, unknown>, binding: Record<string, unknown>, envelope: { bindings: Record<string, unknown>[] }) => { envelope.bindings = envelope.bindings.filter(row => row !== binding); }],
    ['link role', (_record: Record<string, unknown>, binding: Record<string, unknown>) => { binding.role = 'link'; }],
    ['wrong source cell', (_record: Record<string, unknown>, binding: Record<string, unknown>) => { binding.sourceCellId = 'context.market.structure'; }],
    ['raw leaf copy', (record: Record<string, unknown>) => { record.text = 'size'; }],
  ] as const)('refuses %s without a local title fallback', (_name, change) => {
    const copy = changedTitleCopy(change);
    expect(getAdminDirectorCellTitleBinding(cellId, copy)).toBeUndefined();
    expect(resolveAdminDirectorCellTitle(cellId, copy, preview)).toBeUndefined();
    expectNeed(createDirectorCopyBindings({ copy, options: preview }).cellTitle(cellId));
  });
});

describe('Director label ports keep display text separate from machine provenance', () => {
  it('passes a Writer heading and its source identity through separate fields', () => {
    const title = createDirectorCopyBindings({ options: preview }).cellTitle(cellId);
    expect(title).toMatchObject({ state: 'bound', text: 'Market size', role: 'heading', provenance: {
      kind: 'writer-copy', binding: { sourceCellId: cellId, role: 'heading' }, servedLocale: 'en', status: 'draft', activation: 'none',
    } });
    if (title.state === 'bound') expect(title.text).not.toMatch(/context\.|director\.|st\.|fact:/);
  });

  it('turns a malformed host copy source into a structured need with plain display words', () => {
    expectNeed(createDirectorCopyBindings({ copy: {} as AdminCopy, options: preview }).cellTitle(cellId));
  });

  it('preserves the exact authored brief fact title, including its case and punctuation', () => {
    expect(createDirectorCopyBindings({ brief }).factLabel(factId)).toEqual({
      state: 'bound', text: authoredTitle, role: 'source-label',
      provenance: { kind: 'director-brief-fact', reference: brief.reference, factId, field: 'title' },
    });
  });

  it('changes source labels with the supplied brief title rather than title-casing the fact id', () => {
    const title = 'a deliberately lowercase source title';
    const result = createDirectorCopyBindings({ brief: { ...brief, facts: [{ id: factId, title }] } }).factLabel(factId);
    expect(result).toMatchObject({ state: 'bound', text: title, role: 'source-label' });
    if (result.state === 'bound') expect(result.text).not.toContain(factId);
  });

  it('keeps missing briefs, unknown ids and citation syntax unresolved', () => {
    expectNeed(createDirectorCopyBindings().factLabel(factId));
    expectNeed(createDirectorCopyBindings({ brief }).factLabel('unknown-public-fact'));
    expectNeed(createDirectorCopyBindings({ brief }).factLabel(`fact:${factId}`));
    expectNeed(createDirectorCopyBindings({ brief: { ...brief, reference: '' } }).factLabel(factId));
  });

  it('matches structured fact identities exactly without stripping citation prefixes', () => {
    const bindings = createDirectorCopyBindings({ brief: { reference: brief.reference, facts: [{ id: 'position', title: 'Position in the market' }] } });
    expect(bindings.factLabel('position')).toEqual({ state: 'bound', text: 'Position in the market', role: 'source-label', provenance: {
      kind: 'director-brief-fact', reference: brief.reference, factId: 'position', field: 'title',
    } });
    expectNeed(bindings.factLabel('fact:position'));
  });

  it.each([undefined, '', '   ', 23, { text: 'Not a title' }, factId, `fact:${factId}`])('refuses missing or malformed fact title %j', title => {
    expectNeed(createDirectorCopyBindings({ brief: { ...brief, facts: [{ id: factId, title }] } }).factLabel(factId));
  });

  it('refuses duplicate fact ids instead of choosing the first authored title', () => {
    expectNeed(createDirectorCopyBindings({ brief: { ...brief, facts: [...brief.facts, { id: factId, title: 'Another source title' }] } }).factLabel(factId));
  });
});
