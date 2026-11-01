import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
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
    expect(agentSlotCensus(root, 'writer')).toEqual({ state: 'ready', total: 2, withCandidate: 1, pinned: 1 });
    fixture('writer', ['writer.empty', 'writer.options', 'writer.draft', 'writer.extension'], ['writer.extension']);
    expect(agentSlotCensus(root, 'writer')).toEqual({ state: 'ready', total: 4, withCandidate: 3, pinned: 1 });
  });

  it('counts native pins independently of newest candidates, missing candidates and readiness', () => {
    // The options slot pins v1 while v2 exists. Empty inputs never establish readiness.
    expect(agentSlotCensus(root, 'director')).toEqual({ state: 'ready', total: 2, withCandidate: 1, pinned: 1 });
    const empty = join(root, 'agents/director/examples/group/director.empty');
    save(join(empty, 'pin.json'), { candidate: 'missing-v1.md', sha256: '0'.repeat(64), pinnedBy: 'owner:synthetic-test-only:missing-candidate', at: '2026-01-01T00:00:00Z' });
    expect(agentSlotCensus(root, 'director')).toEqual({ state: 'ready', total: 2, withCandidate: 1, pinned: 2 });
    writeFileSync(join(root, 'agents/director/examples/group/director.options/candidates/sample-v1.md'), 'changed bytes');
    expect(agentSlotCensus(root, 'director')).toEqual({ state: 'ready', total: 2, withCandidate: 1, pinned: 2 });
  });

  it('isolates an agent census error without leaking paths or replacing it with zero', () => {
    writeFileSync(join(root, 'agents/designer/ia.json'), '{');
    const census = slotCensus(root);
    expect(census.designer).toEqual({ state: 'error', message: 'The slot census could not load.' });
    for (const agent of ['director', 'writer', 'publisher'] as const) {
      expect(census[agent]).toEqual({ state: 'ready', total: 2, withCandidate: 1, pinned: 1 });
    }
    expect(JSON.stringify(census)).not.toContain(root);
    expect(JSON.stringify(census)).not.toContain('candidate');
  });

  it('distinguishes an unavailable IA from a valid empty inventory', () => {
    rmSync(join(root, 'agents/writer/ia.json'));
    expect(agentSlotCensus(root, 'writer')).toEqual({ state: 'error', message: 'The slot census could not load.' });
    fixture('writer', []);
    expect(agentSlotCensus(root, 'writer')).toEqual({ state: 'ready', total: 0, withCandidate: 0, pinned: 0 });
  });
});
