import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveAgent } from '../agents.js';
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
 * A synthetic consumer whose Writer store places current-tree slots: two copy slots of keyed records (one single pin,
 * one two-record pin map), a voice slot (rules, never copy), a retired `strings.*` id, and, pinned byte-for-byte from
 * Writer's shipped defaults, page.home.meta's `.json` field record and the privacy prose piece (neither is keyed copy).
 */
const writerDefault = (slot: string, name: string) => readFileSync(join(resolveAgent('writer').packageRoot, 'defaults', slot, name), 'utf8');
function consumer(extra: { duplicate?: boolean; keyed?: boolean } = {}) {
  const keyed = extra.keyed ?? true;
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
    { id: 'prose.reference', label: 'Reference', children: [{ id: 'policies', label: 'Policies', slots: ['narratives.legal-document'] }] },
    { id: 'copy.component-text', label: 'Component text', children: [{ id: 'actions', label: 'Actions', slots: ['components.command.copy'] }] },
    { id: 'copy.page-metadata', label: 'Page metadata', children: [{ id: 'home', label: 'Home', slots: ['page.home.meta'] }] },
    { id: 'copy.section-text', label: 'Section text', children: [{ id: 'hero', label: 'Hero', slots: ['sections.hero.copy'] }] },
    { id: 'strings.retired', label: 'Retired', children: [{ id: 'names', label: 'Names', slots: ['strings.names'] }] },
  ] }));
  const privacy = writerDefault('narratives.legal-document', 'privacy-v1.md');
  seat('narratives.legal-document', { 'privacy-v1.md': privacy }, pinOf('privacy-v1.md', privacy));
  const meta = writerDefault('page.home.meta', 'home.meta-v1.json');
  seat('page.home.meta', { 'home.meta-v1.json': meta }, pinOf('home.meta-v1.json', meta));
  const voice = body('lexicon.formality', [['site.voice.rule', 'Rule']]);
  seat('lexicon.formality', { 'formality-v1.md': voice }, pinOf('formality-v1.md', voice));
  const retired = body('strings.names', [['site.retired.name', 'Retired']]);
  seat('strings.names', { 'names-v1.md': retired }, pinOf('names-v1.md', retired));
  if (!keyed) return join(root, 'clossys');
  const command = body('components.command.copy', [['site.home.title', 'Home'], ...(extra.duplicate ? [['site.article.lede', 'Twice'] as [string, string]] : [])]);
  seat('components.command.copy', { 'command-v1.md': command }, pinOf('command-v1.md', command));
  const lede = body('sections.hero.copy', [['site.article.lede', 'Lede']]), close = body('sections.hero.copy', [['site.article.close', 'Close']]);
  const record = (name: string, bytes: string, previous?: ReturnType<typeof setPinMapRecord>) => setPinMapRecord(previous ?? undefined, {
    agent: 'writer', slotId: 'sections.hero.copy', record: name, pin: pinOf(`${name}-v1.md`, bytes) as never,
    createdBy: { actor: 'code', cli: 'synthetic-test-only', version: '0.0.0' } as never, at: '2026-01-01T00:00:00Z' });
  seat('sections.hero.copy', { 'lede-v1.md': lede, 'close-v1.md': close }, record('close', close, record('lede', lede)));
  return join(root, 'clossys');
}

describe('Writer copy slots (Writer tree data, not an id prefix)', () => {
  const rule = writerCopyRule();

  it('reads every keyed copy slot of the installed Writer tree, and no prose or voice slot', () => {
    const foundry = writerIa();
    const copyIds = [...foundry.slots].filter(([, slot]) => slot.targetKind === 'copy').map(([id]) => id);
    const otherIds = [...foundry.slots].filter(([, slot]) => slot.targetKind === 'voice' || slot.targetKind === 'prose').map(([id]) => id);
    expect(copyIds.length).toBeGreaterThan(0);
    expect(otherIds.length).toBeGreaterThan(0);
    for (const node of foundry.ia.nodes) for (const child of node.children) for (const id of child.slots) {
      expect(isWriterCopySlot({ id, position: { l0: node.id.split('.')[0], l1: node.id, l2: child.id, order: 0 } }, rule), id).toBe(copyIds.includes(id));
    }
    expect(isWriterCopySlot({ id: 'narratives.legal-document', position: { l0: 'copy', l1: 'copy.x', l2: 'y', order: 0 } }, rule)).toBe(false);
    // None of the tree's copy slots is a `strings.*` id: a prefix reader reads none of them.
    expect(copyIds.filter(id => id.startsWith('strings.'))).toEqual([]);
    expect(rule.nonCopyGroups).toEqual(new Set(['prose', 'voice']));
  });

  it('keeps every id in Writer retired.json unreadable, wherever a store places it', () => {
    const retired = writerRetired();
    expect(retired.has('strings.names')).toBe(true);
    for (const id of retired) for (const l0 of ['copy', 'prose', 'strings', undefined]) expect(isWriterCopySlot({ id, position: { l0, l1: 'x', l2: 'y', order: 0 } }, rule), id).toBe(false);
  });

  it('reads a consumer extension outside the tree as copy unless it sits in the voice or prose group', () => {
    expect(isWriterCopySlot({ id: 'strings.site', position: { l0: 'copy', l1: 'copy.page-metadata', l2: 'site', order: 0 } }, rule)).toBe(true);
    expect(isWriterCopySlot({ id: 'site.extra', position: { l0: 'strings', l1: 'strings.test', l2: 'x', order: 0 } }, rule)).toBe(true);
    expect(isWriterCopySlot({ id: 'lexicon.house', position: { l0: 'voice', l1: 'voice.extensions', l2: 'x', order: 0 } }, rule)).toBe(false);
    expect(isWriterCopySlot({ id: 'narratives.house-story', position: { l0: 'prose', l1: 'prose.extensions', l2: 'x', order: 0 } }, rule)).toBe(false);
  });

  it('passes Writer\'s shipped page.home.meta field record and privacy prose default through every reader without error', () => {
    // Only the shipped defaults (plus voice and retired) pinned: no keyed copy, the reader's own "none pinned" answer.
    const root = consumer({ keyed: false });
    expect(writerCopyPins(root)).toEqual([]);
    expect(() => writerCopy(root)).toThrow(/^Writer copy: no pinned Writer strings/);
    // Beside keyed copy, the defaults stay out of the resolved copy.
    expect(writerCopy(consumer()).text('site.home.title')).toBe('Home');
    expect(writerCopyDuplicates(root)).toEqual([]);
    expect([...writerKeyHolders(root)]).toEqual([]);
    expect(writerCopyInputs(root)).toEqual([]);
  });

  it('lists every pinned keyed record of a copy slot, a pin map included, and skips prose, field, voice and retired records', () => {
    const pins = writerCopyPins(consumer()).map(row => `${row.entry.id}/${row.pin.candidate}`);
    expect(pins).toEqual(['components.command.copy/command-v1.md', 'sections.hero.copy/close-v1.md', 'sections.hero.copy/lede-v1.md']);
  });

  it('resolves current-tree copy keys through the pinned Writer copy', () => {
    const copy = writerCopy(consumer());
    expect(copy.text('site.home.title')).toBe('Home');
    expect(copy.text('site.article.lede')).toBe('Lede');
    expect(copy.text('site.article.close')).toBe('Close');
    expect(copy.has('site.voice.rule')).toBe(false);
    expect(copy.has('site.retired.name')).toBe(false);
  });

  it('finds a key recorded by two current-tree copy slots', () => {
    expect(writerCopyDuplicates(consumer({ duplicate: true }))).toEqual([{ id: 'site.article.lede', slots: ['components.command.copy', 'sections.hero.copy'] }]);
    expect(writerCopyDuplicates(consumer())).toEqual([]);
  });

  it('groups the interview\'s Writer key holders by current-tree copy slot, every pin-map record included', () => {
    expect(Object.fromEntries(writerKeyHolders(consumer()))).toEqual({
      'components.command.copy': ['site.home.title'],
      'sections.hero.copy': ['site.article.close', 'site.article.lede'],
    });
  });

  it('records every pinned current-tree keyed copy candidate as a compile-lock input', () => {
    expect(writerCopyInputs(consumer()).map(input => input.path)).toEqual([
      'agents/writer/components.command.copy/candidates/command-v1.md',
      'agents/writer/sections.hero.copy/candidates/close-v1.md',
      'agents/writer/sections.hero.copy/candidates/lede-v1.md',
    ]);
  });
});
