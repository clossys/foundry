import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { serializeFrontmatter } from './slot-model/index.js';
import { writerKeysUnapproved } from '../pipeline/status.js';
import { writerCopy, writerCopyDuplicates } from './writer-copy.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

/** A synthetic consumer with one pinned Writer strings slot. */
function consumer(basis: 'picked' | 'bulk' | 'planner' | 'agent' = 'planner') {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'writer-copy-'))); roots.push(root);
  const writer = join(root, 'clossys/agents/writer');
  const dir = join(writer, 'strings.probe');
  mkdirSync(join(dir, 'candidates'), { recursive: true });
  writeFileSync(join(writer, 'ia.json'), JSON.stringify({ schema: 'clossys.ia/1', source: 'synthetic-test-only#writer-copy', extensions: [],
    nodes: [{ id: 'strings.test', label: 'Strings', children: [{ id: 'probe', label: 'Probe', slots: ['strings.probe'] }] }] }));
  const bytes = serializeFrontmatter({ slot: 'strings.probe', locales: ['en'], source: { kind: 'original', ref: [] } },
    '## en\n\n### studio.probe.held\n<!-- {"id":"studio.probe.held","bindings":[]} -->\nHeld\n');
  writeFileSync(join(dir, 'candidates/studio-v1.md'), bytes);
  writeFileSync(join(dir, 'pin.json'), JSON.stringify({ candidate: 'studio-v1.md', sha256: createHash('sha256').update(bytes).digest('hex'), decidedBy: basis === 'agent' ? 'agent:writer' : basis === 'planner' ? 'planner:synthetic-test-only' : 'owner:synthetic-test-only', basis, at: '2026-01-01T00:00:00Z' }));
  return { clossys: join(root, 'clossys'), candidate: join(dir, 'candidates/studio-v1.md') };
}

describe('pinned Writer copy', () => {
  it('stops serving its cached copy when a pinned candidate drifts after a first read (same pin, same consumer)', () => {
    const { clossys, candidate } = consumer();
    const copy = writerCopy(clossys);
    expect(copy.text('studio.probe.held')).toBe('Held');
    expect(writerCopy(clossys)).toBe(copy);
    appendFileSync(candidate, '\n');
    expect(() => writerCopy(clossys)).toThrow(/drifted from its pin/);
  });

  // Pin = approval (owner Producer round 2): an owner pin is the editorial approval; a planner or agent pick stays a confirm item.
  it.each(['picked', 'bulk'] as const)('reports a key under an owner %s pin as approved, in agreement with pipeline status', basis => {
    const { clossys } = consumer(basis);
    const copy = writerCopy(clossys);
    expect(copy.approved('studio.probe.held')).toBe(true);
    expect(copy.text('studio.probe.held')).toBe('Held');
    expect(writerKeysUnapproved(join(clossys, '..')).has('strings.probe')).toBe(false);
  });
  it.each(['agent', 'planner'] as const)('keeps a key under a %s pin unapproved until the owner pins', basis => {
    const copy = writerCopy(consumer(basis).clossys);
    expect(copy.approved('studio.probe.held')).toBe(false);
    expect(copy.text('studio.probe.held')).toBe('Held');
  });
});

/** A synthetic consumer whose Writer IA places and pins one candidate per slot: slot id to its `### <row>` texts. */
function metaConsumer(slots: Record<string, Record<string, string>>) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'writer-copy-meta-'))); roots.push(root);
  const writer = join(root, 'clossys/agents/writer');
  mkdirSync(writer, { recursive: true });
  writeFileSync(join(writer, 'ia.json'), JSON.stringify({ schema: 'clossys.ia/1', source: 'synthetic-test-only#writer-copy-meta', extensions: [],
    nodes: [{ id: 'pages', label: 'Pages', children: [{ id: 'meta', label: 'Meta', slots: Object.keys(slots) }] }] }));
  for (const [slot, rows] of Object.entries(slots)) {
    const dir = join(writer, slot);
    mkdirSync(join(dir, 'candidates'), { recursive: true });
    const body = Object.entries(rows).map(([id, text]) => `### ${id}\n<!-- {"id":${JSON.stringify(id)},"bindings":[]} -->\n${text}\n`).join('\n');
    const bytes = serializeFrontmatter({ slot, locales: ['en'], source: { kind: 'original', ref: [] } }, `## en\n\n${body}`);
    writeFileSync(join(dir, 'candidates/meta-v1.md'), bytes);
    writeFileSync(join(dir, 'pin.json'), JSON.stringify({ candidate: 'meta-v1.md', sha256: createHash('sha256').update(bytes).digest('hex'), decidedBy: 'planner:synthetic-test-only', basis: 'planner', at: '2026-01-01T00:00:00Z' }));
  }
  return join(root, 'clossys');
}

describe('pinned Writer copy row keys (BR-E2E5 option A)', () => {
  it('registers two pinned meta slots\' same-named rows as <slot>.<row>: both resolve, with no collision', () => {
    const clossys = metaConsumer({
      'page.home.meta': { title: 'Home title', description: 'Home description' },
      'page.about.meta': { title: 'About title', description: 'About description' },
    });
    expect(writerCopyDuplicates(clossys)).toEqual([]);
    const copy = writerCopy(clossys);
    expect(copy.text('page.home.meta.title')).toBe('Home title');
    expect(copy.text('page.about.meta.title')).toBe('About title');
    expect(copy.text('page.about.meta.description')).toBe('About description');
    expect(copy.has('title')).toBe(false);
  });

  it('keeps a dotted row id as its own key', () => {
    const copy = writerCopy(metaConsumer({ 'strings.probe': { 'studio.probe.held': 'Held' } }));
    expect(copy.text('studio.probe.held')).toBe('Held');
    expect(copy.has('strings.probe.studio.probe.held')).toBe(false);
  });
});
