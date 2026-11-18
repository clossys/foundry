import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { serializeFrontmatter } from './slot-model/index.js';
import { setPinMapRecord } from './pin-map.js';
import { writerIa } from './slot-model/foundry-ia.js';
import { isWriterCopySlot, writerCopyPins, writerCopyRule, writerRetired } from './writer-copy-slots.js';
import { writerCopy, writerCopyDuplicates } from './writer-copy.js';
import { writerKeyHolders } from '../pipeline/interview.js';
import { writerCopyInputs } from '../publish/compile-publications.js';

// foundry-build-0048 U14: copy readers read every copy slot in Writer's current tree, never a `strings.` prefix.
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

const sha = (bytes: string) => createHash('sha256').update(bytes).digest('hex');
const body = (slot: string, records: readonly [string, string][]) => serializeFrontmatter({ slot, locales: ['en'], source: { kind: 'original', ref: [] } },
  `## en\n\n${records.map(([id, text]) => `### ${id}\n<!-- {"id":"${id}","bindings":[]} -->\n${text}\n`).join('\n')}`);
const pinOf = (candidate: string, bytes: string) => ({ candidate, sha256: sha(bytes), decidedBy: 'planner:synthetic-test-only', basis: 'planner', at: '2026-01-01T00:00:00Z' });

/**
 * A synthetic consumer whose Writer store places current-tree slots: a copy slot with one pin, a prose slot with a
 * two-record pin map, a voice slot (rules, never copy) and a retired `strings.*` id, each pinned to keyed records.
 */
function consumer(extra: { duplicate?: boolean } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'writer-copy-slots-'))); roots.push(root);
  const writer = join(root, 'clossys/agents/writer');
  const seat = (slot: string, files: Record<string, string>, pin: unknown) => {
    mkdirSync(join(writer, slot, 'candidates'), { recursive: true });
    for (const [name, bytes] of Object.entries(files)) writeFileSync(join(writer, slot, 'candidates', name), bytes);
    writeFileSync(join(writer, slot, 'pin.json'), JSON.stringify(pin));
  };
  mkdirSync(writer, { recursive: true });
  writeFileSync(join(writer, 'ia.json'), JSON.stringify({ schema: 'clossys.ia/1', source: 'synthetic-test-only#writer-copy-slots', extensions: [], nodes: [
    { id: 'voice.tone', label: 'Tone', children: [{ id: 'attitude', label: 'Attitude', slots: ['lexicon.formality'] }] },
    { id: 'prose.editorial', label: 'Editorial', children: [{ id: 'narratives', label: 'Narratives', slots: ['narratives.article'] }] },
    { id: 'copy.page-metadata', label: 'Page metadata', children: [{ id: 'home', label: 'Home', slots: ['page.home.meta'] }] },
    { id: 'strings.retired', label: 'Retired', children: [{ id: 'names', label: 'Names', slots: ['strings.names'] }] },
  ] }));
  const meta = body('page.home.meta', [['site.home.title', 'Home'], ...(extra.duplicate ? [['site.article.lede', 'Twice'] as [string, string]] : [])]);
  seat('page.home.meta', { 'home-v1.md': meta }, pinOf('home-v1.md', meta));
  const lede = body('narratives.article', [['site.article.lede', 'Lede']]), close = body('narratives.article', [['site.article.close', 'Close']]);
  const record = (name: string, bytes: string, previous?: ReturnType<typeof setPinMapRecord>) => setPinMapRecord(previous ?? undefined, {
    agent: 'writer', slotId: 'narratives.article', record: name, pin: pinOf(`${name}-v1.md`, bytes) as never,
    createdBy: { actor: 'code', cli: 'synthetic-test-only', version: '0.0.0' } as never, at: '2026-01-01T00:00:00Z' });
  seat('narratives.article', { 'lede-v1.md': lede, 'close-v1.md': close }, record('close', close, record('lede', lede)));
  const voice = body('lexicon.formality', [['site.voice.rule', 'Rule']]);
  seat('lexicon.formality', { 'formality-v1.md': voice }, pinOf('formality-v1.md', voice));
  const retired = body('strings.names', [['site.retired.name', 'Retired']]);
  seat('strings.names', { 'names-v1.md': retired }, pinOf('names-v1.md', retired));
  return join(root, 'clossys');
}

describe('Writer copy slots (Writer tree data, not an id prefix)', () => {
  const rule = writerCopyRule();

  it('reads every prose and copy slot of the installed Writer tree, and no voice slot', () => {
    const foundry = writerIa();
    const copyIds = [...foundry.slots].filter(([, slot]) => slot.targetKind === 'prose' || slot.targetKind === 'copy').map(([id]) => id);
    const voiceIds = [...foundry.slots].filter(([, slot]) => slot.targetKind === 'voice').map(([id]) => id);
    expect(copyIds.length).toBeGreaterThan(0);
    expect(voiceIds.length).toBeGreaterThan(0);
    for (const node of foundry.ia.nodes) for (const child of node.children) for (const id of child.slots) {
      expect(isWriterCopySlot({ id, position: { l0: node.id.split('.')[0], l1: node.id, l2: child.id, order: 0 } }, rule), id).toBe(copyIds.includes(id));
    }
    // None of the tree's copy slots is a `strings.*` id: a prefix reader reads none of them.
    expect(copyIds.filter(id => id.startsWith('strings.'))).toEqual([]);
    expect(rule.nonCopyGroups).toEqual(new Set(['voice']));
  });

  it('keeps every id in Writer retired.json unreadable, wherever a store places it', () => {
    const retired = writerRetired();
    expect(retired.has('strings.names')).toBe(true);
    for (const id of retired) for (const l0 of ['copy', 'prose', 'strings', undefined]) expect(isWriterCopySlot({ id, position: { l0, l1: 'x', l2: 'y', order: 0 } }, rule), id).toBe(false);
  });

  it('reads a consumer extension outside the tree as copy unless it sits in the voice group', () => {
    expect(isWriterCopySlot({ id: 'strings.site', position: { l0: 'copy', l1: 'copy.page-metadata', l2: 'site', order: 0 } }, rule)).toBe(true);
    expect(isWriterCopySlot({ id: 'site.extra', position: { l0: 'strings', l1: 'strings.test', l2: 'x', order: 0 } }, rule)).toBe(true);
    expect(isWriterCopySlot({ id: 'lexicon.house', position: { l0: 'voice', l1: 'voice.extensions', l2: 'x', order: 0 } }, rule)).toBe(false);
  });

  it('lists every pinned record of a copy slot, a pin map included, and skips voice and retired slots', () => {
    const pins = writerCopyPins(consumer()).map(row => `${row.entry.id}/${row.pin.candidate}`);
    expect(pins).toEqual(['narratives.article/close-v1.md', 'narratives.article/lede-v1.md', 'page.home.meta/home-v1.md']);
  });

  it('resolves current-tree copy and prose keys through the pinned Writer copy', () => {
    const copy = writerCopy(consumer());
    expect(copy.text('site.home.title')).toBe('Home');
    expect(copy.text('site.article.lede')).toBe('Lede');
    expect(copy.text('site.article.close')).toBe('Close');
    expect(copy.has('site.voice.rule')).toBe(false);
    expect(copy.has('site.retired.name')).toBe(false);
  });

  it('finds a key recorded by two current-tree copy slots', () => {
    expect(writerCopyDuplicates(consumer({ duplicate: true }))).toEqual([{ id: 'site.article.lede', slots: ['narratives.article', 'page.home.meta'] }]);
    expect(writerCopyDuplicates(consumer())).toEqual([]);
  });

  it('groups the interview\'s Writer key holders by current-tree copy slot, every pin-map record included', () => {
    expect(Object.fromEntries(writerKeyHolders(consumer()))).toEqual({
      'narratives.article': ['site.article.close', 'site.article.lede'],
      'page.home.meta': ['site.home.title'],
    });
  });

  it('records every pinned current-tree copy candidate as a compile-lock input', () => {
    expect(writerCopyInputs(consumer()).map(input => input.path)).toEqual([
      'agents/writer/narratives.article/candidates/close-v1.md',
      'agents/writer/narratives.article/candidates/lede-v1.md',
      'agents/writer/page.home.meta/candidates/home-v1.md',
    ]);
  });
});
