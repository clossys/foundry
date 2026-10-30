import { mkdtemp, mkdir, copyFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { propose } from '@clossys/strategist/cell-format';
import { parseWriterCell, serializeWriterCell } from '../../../writer/src/cells/parse';
import { migrateWriterCells } from '../../../writer/src/cells/migrate';
import { readCells, summary, writerSpecimenInventory } from '../server/cells';
import { parseCellResponse, type AgentCells } from '../../studio/lib/cells-client';
import { writerProjection, copyRole } from '../../studio/lib/writer-specimen';
import { agentSpecimenPlan } from '../../studio/lib/agent-specimen-data';

const catalog = new URL('../../../writer/src/catalog/records/', import.meta.url);
const textNodes = (value: unknown): string[] => typeof value === 'object' && value !== null ? [...('type' in value && value.type === 'text' && 'text' in value && typeof value.text === 'string' ? [value.text] : []), ...Object.values(value).flatMap(textNodes)] : [];

describe('native Writer site projection', () => {
  it('uses the actual migrated public site and common inventory with full reference-backed passages', async () => {
    const root = await mkdtemp(join(tmpdir(), 'writer-native-specimen-'));
    try {
      const input = join(root, 'input'); await mkdir(input);
      for (const file of ['site.en.json', 'common-labels.r1.en.json']) await copyFile(new URL(file, catalog), join(input, file));
      await migrateWriterCells(input, join(root, 'clossys/agents/writer'), { date: '2026-10-30' });
      const all = await readCells(root, 'writer');
      const stored = all.find(cell => cell.id === 'generic-draft-site-starter.root')!;
      expect(stored).toBeDefined();
      const inventory = await writerSpecimenInventory(root, stored, all);
      const detail = parseCellResponse({ agent: 'writer', state: 'ready', cell: { ...summary(stored), source: stored.source, writerInventory: inventory } }, 'writer', stored.id);
      const index: AgentCells = { agent: 'writer', state: 'ready', cells: [detail] };
      const projection = writerProjection(detail), plan = agentSpecimenPlan(index, detail);
      expect(inventory.issues).toEqual([]);
      expect(plan.issues).toEqual([]);
      expect(plan.items.length).toBeGreaterThan(50);
      expect(plan.items).toHaveLength(projection.records.filter(copy => !copy.inspectorOnly).length);
      expect(plan.expectedVariantIds).toEqual(plan.items.map(item => item.id));
      expect(plan.axes?.map(axis => axis.id)).toEqual(['string', 'context']);
      for (const copy of projection.records.filter(copy => copy.passage)) {
        expect(textNodes(copy.passage).length, copy.id).toBeGreaterThan(0);
        expect(plan.items.find(item => (item.record as any).id === copy.id)?.value).toEqual(copy.passage);
      }
      expect(projection.records.filter(copy => copy.inspectorOnly).map(copy => copy.record.leaf)).toEqual(Array(4).fill('passages.band'));
      expect(plan.items.every(item => item.record && item.locale === 'en')).toBe(true);
      const proposed = await propose(join(root, 'clossys/agents/writer'), stored.id);
      const draft = parseWriterCell(proposed.source, proposed.path);
      const changed = draft.records.find(item => typeof item.record.text === 'string')!;
      const activeText = changed.record.text;
      changed.record.text = `${activeText}\nDraft revision.`;
      await writeFile(join(root, 'clossys/agents/writer', proposed.path), serializeWriterCell(draft));
      const withDraft = await readCells(root, 'writer');
      const draftStored = withDraft.find(cell => cell.id === stored.id && cell.version === 2)!;
      const draftInventory = await writerSpecimenInventory(root, draftStored, withDraft);
      const draftDetail = parseCellResponse({ agent: 'writer', state: 'ready', cell: { ...summary(draftStored), source: draftStored.source, writerInventory: draftInventory } }, 'writer', stored.id);
      const draftPlan = agentSpecimenPlan({ ...index, cells: [draftDetail] }, draftDetail);
      expect(draftPlan.issues).toEqual([]);
      expect(draftDetail).toMatchObject({ version: 2, status: 'draft' });
      expect(draftPlan.items.find(item => (item.record as any).id === changed.record.id)?.value).toBe(changed.record.text);
      const pinnedInventory = await writerSpecimenInventory(root, stored, withDraft);
      expect(pinnedInventory.version).toBe(1);
      expect(pinnedInventory.records.find(item => item.record.id === changed.record.id)?.record.text).toBe(activeText);
      expect(draftInventory.records.filter(item => item.cellId === stored.id).every(item => item.version === 2 && item.status === 'draft')).toBe(true);
      const mixed = { ...inventory, records: inventory.records.map(item => item.cellId === stored.id ? { ...item, version: 2 } : item) };
      expect(() => parseCellResponse({ agent: 'writer', state: 'ready', cell: { ...summary(stored), source: stored.source, writerInventory: mixed } }, 'writer', stored.id)).toThrow('mixes cell snapshots');
      const wrong = { ...inventory, version: inventory.version + 1 };
      expect(() => parseCellResponse({ agent: 'writer', state: 'ready', cell: { ...summary(stored), source: stored.source, writerInventory: wrong } }, 'writer', stored.id)).toThrow('Writer reference inventory');
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it('uses neutral complete text only for verified canonical leaves, with explicit invalid roles refused', () => {
    expect(copyRole({ leaf: 'strings.field-labels', context: 'Generic draft site starter' })).toBe('body');
    expect(copyRole({ leaf: 'strings.unknown', context: 'sample.body' })).toBe('unknown');
    expect(copyRole({ leaf: 'strings.field-labels', context: 'sample.body', role: 'not-a-role' })).toBe('unknown');
    expect(copyRole({ leaf: 'strings.field-labels', context: 'sample.nav', role: 'headline' })).toBe('headline');
  });
});
