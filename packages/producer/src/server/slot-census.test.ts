import { existsSync, readFileSync, readdirSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sha256Hex } from '../records/hash.js';
import {
  AGENT_KIND, SLOT_AGENTS, serializeFrontmatter, slotDir, slotPositions,
  validateCandidate, validateIa, validatePin, validateSlotDoc,
  type IaDoc, type SlotAgent, type SlotDoc,
} from '../records/slot-model/index.js';
import { checkSlotModel } from '../records/slot-check.js';
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
    const dir = slotDir(root, agent, id);
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
        const pin = { candidate: name, sha256: sha256Hex(bytes), decidedBy: 'owner:synthetic-test-only:slot-census', basis: 'bulk', at: '2026-01-01T00:00:00Z' };
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
    const empty = join(root, 'agents/director/director.empty');
    save(join(empty, 'pin.json'), { candidate: 'missing-v1.md', sha256: '0'.repeat(64), decidedBy: 'owner:synthetic-test-only:missing-candidate', basis: 'bulk', at: '2026-01-01T00:00:00Z' });
    expect(agentSlotCensus(root, 'director')).toMatchObject({ state: 'ready', total: 2, withCandidate: 1, pinned: 2 });
    writeFileSync(join(root, 'agents/director/director.options/candidates/sample-v1.md'), 'changed bytes');
    expect(agentSlotCensus(root, 'director')).toMatchObject({ state: 'ready', total: 2, withCandidate: 1, pinned: 2 });
  });

  it('reports each IA row and its independent document and pin outcomes in order', () => {
    for (const agent of SLOT_AGENTS) {
      const ids = ['absent', 'empty', 'bad-slot', 'bad-pin', 'missing', 'drift', 'unreadable', 'valid']
        .map(name => `${agent}.${name}`);
      fixture(agent, ids);
      const dir = (name: string) => join(root, 'agents', agent, `${agent}.${name}`);
      rmSync(dir('absent'), { recursive: true });
      rmSync(join(dir('empty'), 'slot.json'));
      rmSync(join(dir('empty'), 'candidates'), { recursive: true });
      writeFileSync(join(dir('bad-slot'), 'slot.json'), '{');
      writeFileSync(join(dir('bad-pin'), 'pin.json'), '{');
      const pin = (name: string, candidate: string, sha256: string, basis = 'bulk') => save(join(dir(name), 'pin.json'), {
        candidate, sha256, decidedBy: 'owner:synthetic-test-only:census', basis, at: '2026-01-01T00:00:00Z',
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
      pin('valid', candidate, sha256Hex(bytes), 'picked');
      const census = agentSlotCensus(root, agent);
      expect(census.state).toBe('ready');
      if (census.state !== 'ready') throw new Error('expected census');
      // A bulk or planner pin is `confirm`; only an owner-picked pin is `pinned`.
      expect(census).toMatchObject({ total: 8, withCandidate: 6, pinned: 4, confirm: 3 });
      expect(census.rows).toEqual([
        { id: ids[0], agent, folder: 'missing', candidates: [], slot: 'missing', pin: 'missing' },
        { id: ids[1], agent, folder: 'present', candidates: [], slot: 'missing', pin: 'missing' },
        { id: ids[2], agent, folder: 'present', candidates: [candidate], slot: 'invalid', pin: 'missing' },
        { id: ids[3], agent, folder: 'present', candidates: [candidate], slot: 'valid', pin: 'invalid' },
        { id: ids[4], agent, folder: 'present', candidates: [candidate], slot: 'valid', pin: 'missing-candidate', basis: 'bulk', status: 'confirm' },
        { id: ids[5], agent, folder: 'present', candidates: [candidate], slot: 'valid', pin: 'hash-drift', basis: 'bulk', status: 'confirm' },
        { id: ids[6], agent, folder: 'present', candidates: [candidate], slot: 'valid', pin: 'error', basis: 'bulk', status: 'confirm' },
        { id: ids[7], agent, folder: 'present', candidates: [candidate], slot: 'valid', pin: 'valid', basis: 'picked', status: 'pinned' },
      ]);
      expect(JSON.stringify(census)).not.toContain(root);
      expect(JSON.stringify(census)).not.toContain(bytes);
    }
  });

  it('distinguishes strict slot validation failures from filesystem errors', () => {
    const ids = ['schema', 'id', 'agent', 'position', 'filesystem', 'neighbor'].map(name => `writer.${name}`);
    fixture('writer', ids);
    const path = (name: string) => join(root, 'agents/writer', `writer.${name}`, 'slot.json');
    const change = (name: string, edit: (doc: SlotDoc) => void) => {
      const doc = JSON.parse(readFileSync(path(name), 'utf8')) as SlotDoc;
      edit(doc);
      save(path(name), doc);
    };
    change('schema', doc => { (doc as { schema: string }).schema = 'wrong'; });
    change('id', doc => { doc.id = 'writer.foreign'; });
    change('agent', doc => { doc.agent = 'director'; });
    change('position', doc => { doc.ia = { ...doc.ia, order: doc.ia.order + 1 }; });
    rmSync(path('filesystem'));
    mkdirSync(path('filesystem'));
    const census = agentSlotCensus(root, 'writer');
    expect(census.state).toBe('ready');
    if (census.state !== 'ready') throw new Error('expected census');
    expect(census.rows.map(row => [row.id, row.slot])).toEqual([
      [ids[0], 'invalid'], [ids[1], 'invalid'], [ids[2], 'invalid'],
      [ids[3], 'invalid'], [ids[4], 'error'], [ids[5], 'valid'],
    ]);
    expect(JSON.stringify(census)).not.toContain(root);
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

describe('flat slot folders: grouping lives only in ia.json', () => {
  const tree = (dir: string): Record<string, string> => Object.fromEntries(readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? Object.entries(tree(path)).map(([name, bytes]) => [`${entry.name}/${name}`, bytes]) : [[entry.name, readFileSync(path, 'utf8')]];
  }));

  it('a slot moved to another L1/L2 keeps its folder, its pin and candidates, and the census', () => {
    expect(checkSlotModel(root)).toEqual([]);
    const census = slotCensus(root);
    const dir = slotDir(root, 'writer', 'writer.options');
    expect(dir).toBe(join(root, 'agents/writer/writer.options'));
    const before = tree(dir);
    // Regroup: writer.options leaves examples/group for a new L1/L2; only ia.json and slot.json `ia` change.
    const ia: IaDoc = { schema: 'clossys.ia/1', source: 'synthetic-test-only#slot-census', extensions: [], nodes: [
      { id: 'examples', label: 'Examples', children: [{ id: 'group', label: 'Group', slots: ['writer.empty'] }] },
      { id: 'regrouped', label: 'Regrouped', children: [{ id: 'moved', label: 'Moved', slots: ['writer.options'] }] },
    ] };
    expect(validateIa(ia)).toEqual([]);
    save(join(root, 'agents/writer/ia.json'), ia);
    for (const [id, position] of slotPositions('writer', ia)) {
      const path = join(slotDir(root, 'writer', id), 'slot.json');
      save(path, { ...JSON.parse(readFileSync(path, 'utf8')), ia: position });
    }
    expect(slotPositions('writer', ia).get('writer.options')).toMatchObject({ l1: 'regrouped', l2: 'moved' });
    expect(slotDir(root, 'writer', 'writer.options')).toBe(dir);
    expect(existsSync(join(root, 'agents/writer/regrouped'))).toBe(false);
    const after = tree(dir);
    expect(Object.keys(after)).toEqual(Object.keys(before));
    for (const name of Object.keys(before)) if (name !== 'slot.json') expect(after[name]).toBe(before[name]);
    expect(slotCensus(root)).toEqual(census);
    expect(checkSlotModel(root)).toEqual([]);
  });

  it('treats `_`-prefixed folders as non-slot and grouping folders or misplaced slots as findings', () => {
    mkdirSync(join(root, 'agents/director/_evidence'), { recursive: true });
    writeFileSync(join(root, 'agents/director/_evidence/finding.md'), 'evidence');
    expect(checkSlotModel(root)).toEqual([]);
    writeFileSync(join(root, 'agents/director/_note.md'), 'not a folder');
    mkdirSync(join(root, 'agents/director/examples/group'), { recursive: true });
    mkdirSync(join(root, 'agents/director/writer.options'));
    expect(checkSlotModel(root).map(issue => [issue.code, issue.path])).toEqual([
      ['orphan', 'agents/director/_note.md'],
      ['orphan', 'agents/director/examples'],
      ['ia-path', 'agents/director/writer.options'],
    ]);
  });
});
