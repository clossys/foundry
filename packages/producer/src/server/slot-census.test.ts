import { readFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sha256Hex } from '../records/hash.js';
import {
  AGENT_KIND, SLOT_AGENTS, serializeFrontmatter, slotDir, slotPositions,
  validateCandidate, validateIa, validatePin, validateSlotDoc,
  type IaDoc, type SlotAgent, type SlotDoc,
} from '../records/slot-model/index.js';
import { agentSlotCensus, slotCensus } from './slot-census.js';

let root: string;
const source = { kind: 'original', ref: [] };
const save = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value));

/** Disposable F1 documents: never real owner approval or production records. */
function fixture(agent: SlotAgent, ids = [`${agent}.empty`, `${agent}.options`], extensions: string[] = []) {
  const ia: IaDoc = { schema: 'clossys.ia/1', source: 'synthetic-test-only#slot-census', extensions,
    nodes: [{ id: 'examples', label: 'Examples', children: [{ id: 'group', label: 'Group', slots: ids }] }] };
  expect(validateIa(ia)).toEqual([]);
  const positions = slotPositions(agent, ia);
  for (const id of ids) {
    const position = positions.get(id)!;
    const dir = slotDir(root, agent, position, id);
    mkdirSync(join(dir, 'candidates'), { recursive: true });
    const kind = AGENT_KIND[agent][0]!;
    const slot: SlotDoc = { schema: 'clossys.slot/1', id, agent, ia: position, kind, contract: {}, inputs: [], uses: [] };
    expect(validateSlotDoc(slot)).toEqual([]);
    save(join(dir, 'slot.json'), slot);
    if (id.endsWith('.empty')) continue;
    for (const version of id.endsWith('.options') ? [1, 2] : [1]) {
      const bytes = kind === 'brief'
        ? serializeFrontmatter({ slot: id, source, feeds: [], functions: [] }, `## Direction\nExample ${version}\n## Because\nEvidence\n## Watch\nSignals\n`)
        : kind === 'strings'
          ? serializeFrontmatter({ slot: id, source, locales: ['en'] }, `## en\n### greeting\n<!-- {"id":"greeting","bindings":[]} -->\nExample ${version}\n`)
          : JSON.stringify(kind === 'element'
            ? { name: 'example', type: 'registry:item', files: [], meta: { slot: id, source } }
            : { schema: 'clossys.page/1', path: '/', title: 'Example', frame: null, sections: [], copy: {}, meta: { slot: id, source } });
      const name = `sample-v${version}.${kind === 'brief' || kind === 'strings' ? 'md' : 'json'}`;
      expect(validateCandidate(kind, id, name, bytes)).toEqual([]);
      writeFileSync(join(dir, 'candidates', name), bytes);
      if (version === 1 && id.endsWith('.options')) {
        const pin = { candidate: name, sha256: sha256Hex(bytes), pinnedBy: 'owner:synthetic-test-only:slot-census', at: '2026-01-01T00:00:00Z' };
        expect(validatePin(pin)).toEqual([]);
        save(join(dir, 'pin.json'), pin);
      }
    }
  }
  save(join(root, 'agents', agent, 'ia.json'), ia);
  return ia;
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'slot-census-')));
  for (const agent of SLOT_AGENTS) fixture(agent);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('authoritative slot census', () => {
  it('counts every IA row including empties and new extensions, not candidate versions', () => {
    expect(agentSlotCensus(root, 'writer')).toMatchObject({ state: 'ready', total: 2, withCandidate: 1, pinned: 1 });
    fixture('writer', ['writer.empty', 'writer.options', 'writer.draft', 'writer.extension'], ['writer.extension']);
    expect(agentSlotCensus(root, 'writer')).toMatchObject({ state: 'ready', total: 4, withCandidate: 3, pinned: 1 });
  });

  it('counts native pins independently of newest candidates, missing candidates and readiness', () => {
    // The options slot pins v1 while v2 exists. Empty inputs never establish readiness.
    expect(agentSlotCensus(root, 'director')).toMatchObject({ state: 'ready', total: 2, withCandidate: 1, pinned: 1 });
    const empty = join(root, 'agents/director/examples/group/director.empty');
    save(join(empty, 'pin.json'), { candidate: 'missing-v1.md', sha256: '0'.repeat(64), pinnedBy: 'owner:synthetic-test-only:missing-candidate', at: '2026-01-01T00:00:00Z' });
    expect(agentSlotCensus(root, 'director')).toMatchObject({ state: 'ready', total: 2, withCandidate: 1, pinned: 2 });
    writeFileSync(join(root, 'agents/director/examples/group/director.options/candidates/sample-v1.md'), 'changed bytes');
    expect(agentSlotCensus(root, 'director')).toMatchObject({ state: 'ready', total: 2, withCandidate: 1, pinned: 2 });
  });

  it('reports each IA row and its independent document and pin outcomes in order', () => {
    for (const agent of SLOT_AGENTS) {
      const ids = ['absent', 'empty', 'bad-slot', 'bad-pin', 'missing', 'drift', 'unreadable', 'valid']
        .map(name => `${agent}.${name}`);
      fixture(agent, ids);
      const dir = (name: string) => join(root, 'agents', agent, 'examples/group', `${agent}.${name}`);
      rmSync(dir('absent'), { recursive: true });
      rmSync(join(dir('empty'), 'slot.json'));
      rmSync(join(dir('empty'), 'candidates'), { recursive: true });
      writeFileSync(join(dir('bad-slot'), 'slot.json'), '{');
      writeFileSync(join(dir('bad-pin'), 'pin.json'), '{');
      const pin = (name: string, candidate: string, sha256: string) => save(join(dir(name), 'pin.json'), {
        candidate, sha256, pinnedBy: 'owner:synthetic-test-only:census', at: '2026-01-01T00:00:00Z',
      });
      const extension = agent === 'director' || agent === 'writer' ? 'md' : 'json';
      const candidate = `sample-v1.${extension}`;
      pin('missing', `missing-v1.${extension}`, '0'.repeat(64));
      const driftPath = join(dir('drift'), 'candidates', candidate);
      pin('drift', candidate, sha256Hex(readFileSync(driftPath, 'utf8')));
      writeFileSync(driftPath, 'changed bytes');
      const unreadablePath = join(dir('unreadable'), 'candidates', candidate);
      pin('unreadable', candidate, sha256Hex(readFileSync(unreadablePath, 'utf8')));
      rmSync(unreadablePath);
      mkdirSync(unreadablePath);
      const bytes = readFileSync(join(dir('valid'), 'candidates', candidate), 'utf8');
      pin('valid', candidate, sha256Hex(bytes));
      const census = agentSlotCensus(root, agent);
      expect(census.state).toBe('ready');
      if (census.state !== 'ready') throw new Error('expected census');
      expect(census).toMatchObject({ total: 8, withCandidate: 6, pinned: 4 });
      expect(census.rows).toEqual([
        { id: ids[0], agent, folder: 'missing', candidates: [], slot: 'missing', pin: 'missing' },
        { id: ids[1], agent, folder: 'present', candidates: [], slot: 'missing', pin: 'missing' },
        { id: ids[2], agent, folder: 'present', candidates: [candidate], slot: 'invalid', pin: 'missing' },
        { id: ids[3], agent, folder: 'present', candidates: [candidate], slot: 'valid', pin: 'invalid' },
        { id: ids[4], agent, folder: 'present', candidates: [candidate], slot: 'valid', pin: 'missing-candidate' },
        { id: ids[5], agent, folder: 'present', candidates: [candidate], slot: 'valid', pin: 'hash-drift' },
        { id: ids[6], agent, folder: 'present', candidates: [candidate], slot: 'valid', pin: 'error' },
        { id: ids[7], agent, folder: 'present', candidates: [candidate], slot: 'valid', pin: 'valid' },
      ]);
      expect(JSON.stringify(census)).not.toContain(root);
      expect(JSON.stringify(census)).not.toContain(bytes);
    }
  });

  it('isolates an agent census error without leaking paths or replacing it with zero', () => {
    writeFileSync(join(root, 'agents/designer/ia.json'), '{');
    const census = slotCensus(root);
    expect(census.designer).toEqual({ state: 'error', message: 'The slot census could not load.' });
    for (const agent of ['director', 'writer', 'publisher'] as const) {
      expect(census[agent]).toMatchObject({ state: 'ready', total: 2, withCandidate: 1, pinned: 1 });
    }
    expect(JSON.stringify(census)).not.toContain(root);
    expect(JSON.stringify(census.designer)).not.toContain('candidate');
  });

  it('distinguishes an unavailable IA from a valid empty inventory', () => {
    rmSync(join(root, 'agents/writer/ia.json'));
    expect(agentSlotCensus(root, 'writer')).toEqual({ state: 'error', message: 'The slot census could not load.' });
    fixture('writer', []);
    expect(agentSlotCensus(root, 'writer')).toMatchObject({ state: 'ready', total: 0, withCandidate: 0, pinned: 0 });
  });
});
