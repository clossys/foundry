import { describe, expect, it } from 'vitest';
import { loadCatalog } from '../catalog.js';
import { checkCell, checkCoherence, completion, strategyStatus } from './index.js';
import type { Cell, Ref } from '../format/types.js';
import type { StrategyModel } from '../format/types.js';
import { readStrategyRoot } from '../store.js';
import { serializeCell } from '../format/cell.js';
import { formatRef } from '../format/ref.js';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
const catalog = loadCatalog();
const ref = (cell: string, version = 1): Ref => ({ kind: 'cell', ref: { cell, version } });
const msg = (line: string): Ref => ({ kind: 'msg', session: '2026-10-29-1', line });
const bullet = (text: string, key?: string, refs: Ref[] = []) => ({ text, key, refs, line: 15 });
function fixture(): StrategyModel {
  const cells: Cell[] = catalog.cells.map((def, i) => ({
    id: def.id, version: 1, status: 'active', updated: '2026-10-29',
    cites: [{ kind: 'finding', id: 'sample' }], feeds: [], functions: def.functions,
    confirmed: msg('U2'), path: `cells/${def.id}/v1.md`,
    direction: def.mustContain.map(({ key }, k) => bullet(key === 'Date' ? `202${k + 7}-01-01` : `Only Sample ${i} choice ${k} for 20 teams`, key)),
    because: [bullet('Sample observation', undefined, [{ kind: 'finding', id: 'sample' }])],
    watch: [bullet('If trial count > 10 each month, then review this choice.')],
  }));
  const active = Object.fromEntries(cells.map(c => [c.id, c.version]));
  for (const link of catalog.coherence.links) {
    const cell = cells.find(c => c.id === link.downstream)!;
    cell.cites.push(ref(link.upstream));
    cell.because.push(bullet('Sample dependency', undefined, [ref(link.upstream)]));
  }
  // Script contradiction keys use distinct items and ordered dates.
  cells.find(c => c.id === 'aspiration.goal.annual')!.direction.find(b => b.key === 'Date')!.text = '2027-01-01';
  cells.find(c => c.id === 'aspiration.goal.long-term')!.direction.find(b => b.key === 'Date')!.text = '2030-01-01';
  const model: StrategyModel = { root: '.', catalog, tree: { schemaVersion: 1, catalog: '@clossys/strategist#strategy-v1', archetype: 'default', core: 'archetype', active }, cells,
    sessions: [{ id: '2026-10-29-1', path: 'sessions/2026-10-29-1.md', index: {}, lines: [
          { id: 'S1', role: 'strategist', text: `Playback for confirm: ${cells.map(c => formatRef(ref(c.id))).join(', ')}`, line: 1, refs: cells.map(c => ref(c.id)) },
          { id: 'U2', role: 'user', text: 'Yes, all listed.', line: 2, refs: [] },
        ] }], findings: [{ id: 'sample', source: 'user', observed: '2026-10-29', by: 'researcher', bullets: [], path: 'findings/sample.md' }], requests: [], files: {}, issues: [] };
  model.sessions[0]!.index = Object.fromEntries(model.sessions[0]!.lines.map(line => [line.id, line]));
  return model;
}
const get = (m: StrategyModel, id = 'focus.segment.core') => m.cells.find(c => c.id === id)!;
const hard = (m: StrategyModel, rule: string, id?: string) => checkCell(get(m, id), { model: m }).filter(f => f.rule === rule && f.severity === 'hard');
const judgePass = { judgeVerdicts: { 'C2:X3': 'pass', 'C2:X7': 'pass', C4: 'pass' } as Record<string, 'pass' | 'fail'> };
describe('quality rules (positive and negative fixtures)', () => {
  it('Q1 enforces both count bounds', () => {
    const m = fixture();
    expect(hard(m, 'Q1')).toEqual([]);
    get(m).direction = [get(m).direction[0]!];
    expect(hard(m, 'Q1')).toHaveLength(1);
    get(m).direction = Array.from({ length: 7 }, () => bullet('Only Sample for 20 teams'));
    expect(hard(m, 'Q1')).toHaveLength(1);
  });
  it('Q2 requires leading labels and emits judgement', () => {
    const m = fixture();
    expect(hard(m, 'Q2')).toEqual([]);
    get(m).direction[0]!.key = undefined;
    expect(hard(m, 'Q2')).toHaveLength(1);
    expect(checkCell(get(m), { model: m }).some(f => f.rule === 'Q2' && f.severity === 'judge')).toBe(true);
  });
  it('Q3 resolves cell, finding and indexed message refs and matches cites union', () => {
    const m = fixture();
    get(m).because.push(bullet('Sample words', undefined, [msg('U2'), ref('context.customer.need')]));
    get(m).cites.push(msg('U2'), ref('context.customer.need'));
    expect(hard(m, 'Q3')).toEqual([]);
    get(m).because[0]!.refs = [{ kind: 'finding', id: 'absent' }];
    expect(hard(m, 'Q3').length).toBeGreaterThan(0);
  });
  it('Q3 rejects empty Because, bare bullets, dangling refs and differing cites', () => {
    for (const mutate of [(c: Cell) => {
        c.because = [];
      }, (c: Cell) => {
        c.because[0]!.refs = [];
      }, (c: Cell) => {
        c.cites = [];
      }, (c: Cell) => {
        c.because[0]!.refs = [msg('U99')];
        c.cites = [msg('U99')];
      }, (c: Cell) => {
        c.because[0]!.refs = [ref('context.customer.need', 99)];
        c.cites = [ref('context.customer.need', 99)];
      }]) {
      const m = fixture();
      mutate(get(m));
      expect(hard(m, 'Q3').length).toBeGreaterThan(0);
    }
  });
  it('Q4 enforces every Watch grammar component', () => {
    const m = fixture();
    for (const text of ['If count >= 5 by 2027-01-01, then review.', 'If state is still "pending" in any quarter, then review.', 'If incident appears "red" each week, then review.']) {
      get(m).watch = [bullet(text)];
      expect(hard(m, 'Q4')).toEqual([]);
    }
    for (const text of ['Review later.', 'If count > many each month, then review.', 'If count > 5, then review.', 'If count > 5 each month, review.']) {
      get(m).watch = [bullet(text)];
      expect(hard(m, 'Q4').length).toBeGreaterThan(0);
    }
    get(m).watch = [];
    expect(hard(m, 'Q4')).toHaveLength(1);
  });
  it('Q5 rejects banned terms and visual hex; sparse text is judge only', () => {
    const m = fixture();
    expect(hard(m, 'Q5')).toEqual([]);
    get(m).direction[0]!.text = 'Seamless SOLUTIONS for everyone';
    expect(hard(m, 'Q5').length).toBeGreaterThan(0);
    const visual = get(m, 'identity.visual.style');
    visual.direction[0]!.text = 'Only #abcdef as the primary tone';
    expect(hard(m, 'Q5', visual.id).length).toBeGreaterThan(0);
    get(m).direction[0]!.text = 'use practical tools';
    expect(checkCell(get(m), { model: m }).some(f => f.rule === 'Q5' && f.severity === 'judge')).toBe(true);
  });
  it('Q6 only flags missing trade-offs for judgement and respects negative keys', () => {
    const m = fixture();
    expect(checkCell(get(m), { model: m }).some(f => f.rule === 'Q6' && f.code === 'absent-tradeoff')).toBe(false);
    get(m).direction = [bullet('Sample teams use 20 products', 'Who'), bullet('Sample teams use 10 services', 'Situation')];
    const flags = checkCell(get(m), { model: m }).filter(f => f.rule === 'Q6');
    expect(flags.some(f => f.severity === 'judge' && f.code === 'absent-tradeoff')).toBe(true);
    expect(flags.some(f => f.severity === 'hard')).toBe(false);
    get(m).direction.push(bullet('Sample exclusion', 'Not-yet'));
    expect(checkCell(get(m), { model: m }).some(f => f.rule === 'Q6' && f.code === 'absent-tradeoff')).toBe(false);
  });
  it('Q7 requires the exact listed ref on the immediately preceding S line', () => {
    const m = fixture();
    expect(hard(m, 'Q7')).toEqual([]);
    get(m).confirmed = undefined;
    expect(hard(m, 'Q7')).toHaveLength(1);
    get(m).confirmed = msg('S1');
    expect(hard(m, 'Q7')).toHaveLength(1);
    get(m).confirmed = msg('U99');
    expect(hard(m, 'Q7')).toHaveLength(1);
    get(m).confirmed = msg('U2');
    get(m).version = 2;
    expect(hard(m, 'Q7')).toHaveLength(1);
  });
  it('Q7 rejects an existing U confirm when its playback omits this ref (mutation witness)', () => {
    const m = fixture();
    const cell = get(m);
    const valid = completion(m, judgePass).cells.find(c => c.id === cell.id)!;
    expect(valid.active).toBe(true);
    const session = m.sessions[0]!;
    session.lines[0]!.text = 'Playback for confirm: advantage.proposition.promise@1';
    expect(hard(m, 'Q7')).toHaveLength(1);
    expect(completion(m, judgePass).cells.find(c => c.id === cell.id)!.active).toBe(false);
  });
  it('Q7 refuses prefixes, numeric suffixes and intervening user lines', () => {
    const m = fixture();
    const listed = formatRef(ref(get(m).id));
    for (const token of [formatRef(ref(get(m).id, 10)), `${listed}oops`, `${listed}.5`, `other.${listed}`, `other_${listed}`, `X${listed}`]) {
      m.sessions[0]!.lines[0]!.text = `Playback for confirm: ${token}`;
      expect(hard(m, 'Q7')).toHaveLength(1);
    }
    m.sessions[0]!.lines[0]!.text = `Playback for confirm: ${listed}. Yes?`;
    expect(hard(m, 'Q7')).toEqual([]);
    m.sessions[0]!.lines.splice(1, 0, { id: 'U1', role: 'user', text: 'Question first.', line: 2, refs: [] });
    expect(hard(m, 'Q7')).toHaveLength(1);
  });
  it('Q7 does not require confirmation on drafts or retired versions', () => {
    const m = fixture();
    for (const status of ['draft', 'retired'] as const) {
      get(m).status = status;
      get(m).confirmed = undefined;
      expect(hard(m, 'Q7')).toEqual([]);
    }
  });
});
describe('coherence rules', () => {
  for (const link of catalog.coherence.links)
    it(`C1 ${link.label} passes, reports missing/stale, and skips out-of-scope`, () => {
      const m = fixture();
      const select = () => checkCoherence(m, 'full').filter(f => f.rule === 'C1' && f.cell === link.downstream && f.cells?.includes(link.upstream));
      expect(select()).toEqual([]);
      get(m, link.downstream).cites = get(m, link.downstream).cites.filter(r => r.kind !== 'cell' || r.ref.cell !== link.upstream);
      expect(select().some(f => f.code === 'missing')).toBe(true);
      get(m, link.downstream).cites.push(ref(link.upstream, 99));
      expect(select().some(f => f.code === 'stale')).toBe(true);
      m.tree!.core = catalog.archetypes.default.filter(id => id !== link.upstream);
      expect(checkCoherence(m, 'core').some(f => f.rule === 'C1' && f.cells?.includes(link.upstream) && f.cell === link.downstream)).toBe(false);
    });
  for (const [id, a, ak, b, bk] of [['X1', 'focus.offer.included', 'Offer', 'focus.offer.excluded', 'Not'], ['X2', 'execution.priority.bet', 'Bet', 'execution.priority.parked', 'Parked']] as const)
    it(`C2 ${id} compares labelled items and quoted phrases`, () => {
      const m = fixture();
      const select = () => checkCoherence(m, 'full').filter(f => f.rule === 'C2' && f.code === id);
      expect(select()).toEqual([]);
      get(m, a).direction.find(d => d.key === ak)!.text = '"Sample A", "Sample B"';
      get(m, b).direction.find(d => d.key === bk)!.text = '"sample b"';
      expect(select().some(f => f.severity === 'hard' && f.action?.request.kind === 'contradiction')).toBe(true);
    });
  for (const [id, a, key, b] of [['X4', 'identity.verbal.voice', 'Never', 'identity.verbal.narrative'], ['X5', 'advantage.proposition.proof', 'Never-claim', 'advantage.proposition.promise']] as const)
    it(`C2 ${id} checks forbidden quoted phrases`, () => {
      const m = fixture();
      const select = () => checkCoherence(m, 'full').filter(f => f.rule === 'C2' && f.code === id);
      expect(select()).toEqual([]);
      get(m, a).direction.find(d => d.key === key)!.text = 'Never say "magic fix"';
      get(m, b).direction[0]!.text = 'A MAGIC FIX for teams';
      expect(select()).toHaveLength(1);
      get(m, b).direction[0]!.text = 'A pragmatic fix for teams';
      expect(select()).toEqual([]);
    });
  it('C2 X6 compares Date values, accepting equality', () => {
    const m = fixture();
    const select = () => checkCoherence(m, 'full').filter(f => f.rule === 'C2' && f.code === 'X6');
    expect(select()).toEqual([]);
    const date = get(m, 'aspiration.goal.annual').direction.find(d => d.key === 'Date')!;
    date.text = '2031-01-01';
    expect(select()).toHaveLength(1);
    date.text = '2030-01-01';
    expect(select()).toEqual([]);
  });
  for (const id of ['X3', 'X7'])
    it(`C2 ${id} emits judge data and failed verdict produces a proposal`, () => {
      const m = fixture();
      const f = checkCoherence(m, 'full').find(f => f.rule === 'C2' && f.code === id)!;
      expect(f.severity).toBe('judge');
      expect(f.verdict).toBeUndefined();
      const failed = checkCoherence(m, 'full', { judgeVerdicts: { [`C2:${id}`]: 'fail' } }).find(f => f.code === id)!;
      expect(failed.verdict).toBe('fail');
      expect(failed.action?.request.kind).toBe('contradiction');
    });
  it('C3 enforces pointer resolution, status agreement, unique active and current cites', () => {
    const m = fixture();
    const select = () => checkCoherence(m, 'full').filter(f => f.rule === 'C3' && f.severity === 'hard');
    expect(select()).toEqual([]);
    m.tree!.active[get(m).id] = 99;
    expect(select().length).toBeGreaterThan(0);
    m.tree!.active[get(m).id] = 1;
    get(m).status = 'draft';
    expect(select().length).toBeGreaterThan(0);
    get(m).status = 'active';
    m.cells.push({ ...get(m), version: 2 });
    expect(select().length).toBeGreaterThan(0);
    m.cells.pop();
    get(m).cites.push(ref('context.customer.need', 99));
    expect(select().some(f => f.code === 'stale')).toBe(true);
    get(m).cites.push({ kind: 'finding', id: 'absent' });
    expect(select().some(f => f.code === 'dangling')).toBe(true);
  });
  it('C3 warns for unknown installed contracts without blocking', () => {
    const m = fixture();
    get(m).feeds = ['writer.messaging'];
    expect(checkCoherence(m, 'full', { contracts: [{ id: 'writer.messaging' }] }).some(f => f.code === 'unknown-feed')).toBe(false);
    expect(checkCoherence(m, 'full', { contracts: [] }).find(f => f.code === 'unknown-feed')?.severity).toBe('warning');
  });
  it('C4 checks presence and freshness while reporting script-only not judged', () => {
    const m = fixture();
    expect(checkCoherence(m, 'full').find(f => f.rule === 'C4' && f.code === 'critic')?.message).toContain('not judged');
    expect(checkCoherence(m, 'full').filter(f => f.rule === 'C4' && f.severity === 'hard')).toEqual([]);
    get(m, catalog.coherence.storyline[0]!).cites.push(ref('focus.segment.core', 99));
    expect(checkCoherence(m, 'full').some(f => f.rule === 'C4' && f.code === 'stale')).toBe(true);
    m.tree!.active[catalog.coherence.storyline[0]!] = null;
    expect(checkCoherence(m, 'full').some(f => f.rule === 'C4' && f.code === 'missing')).toBe(true);
  });
});
describe('exact completion levels', () => {
  it('all 57 cells, 28 L2, 7 L1 and judged clean L0 yield Complete', () => {
    const m = fixture();
    const r = completion(m, judgePass);
    expect(r.cells.filter(c => c.active && c.fresh)).toHaveLength(57);
    expect(r.l2.filter(g => g.coherent)).toHaveLength(28);
    expect(r.l1.filter(g => g.unlocked)).toHaveLength(7);
    expect(r.l0Clean).toBe(true);
    expect(r.mvs).toBe(true);
    expect(r.complete).toBe(true);
    expect(completion(m).l0Clean).toBe(false);
    expect(completion(m).storyline.critic).toBe('not judged');
  });
  it('a hard Q failure or judge fail prevents L3 active', () => {
    const m = fixture();
    get(m).direction = [];
    expect(completion(m, judgePass).cells.find(c => c.id === get(m).id)!.active).toBe(false);
    const n = fixture();
    expect(completion(n, { ...judgePass, judgeVerdicts: { ...judgePass.judgeVerdicts, [`Q2:${get(n).id}@${get(n).version}`]: 'fail' } }).cells.find(c => c.id === get(n).id)!.active).toBe(false);
  });
  it('an inactive noncore cell blocks its L2 and Complete but does not lock L1 or MVS', () => {
    const m = fixture();
    const cell = get(m, 'context.market.size');
    m.tree!.active[cell.id] = null;
    cell.status = 'draft';
    const r = completion(m, judgePass);
    expect(r.l2.find(g => g.id === 'context.market')!.coherent).toBe(false);
    expect(r.l1.find(g => g.id === 'context')!.unlocked).toBe(true);
    expect(r.complete).toBe(false);
    expect(r.mvs).toBe(true);
  });
  it('a stale active cell and open contradiction block L0', () => {
    const m = fixture();
    get(m).cites.push(ref('context.customer.need', 99));
    expect(completion(m, judgePass).l0Clean).toBe(false);
    const n = fixture();
    n.requests.push({ id: 'REQ-0001', raisedBy: 'critic', kind: 'contradiction', cells: [get(n).id], detail: 'Sample contradiction', status: 'open', opened: '2026-10-29', resolvedBy: null });
    expect(completion(n, judgePass).l0Clean).toBe(false);
    n.requests[0]!.status = 'resolved';
    expect(completion(n, judgePass).l0Clean).toBe(true);
  });
  for (const archetype of ['default', 'product-saas', 'services', 'marketplace'])
    it(`MVS uses ${archetype} core`, () => {
      const m = fixture();
      m.tree!.archetype = archetype;
      const core = [...catalog.archetypes.default, ...(catalog.archetypes.extras[archetype] ?? [])];
      for (const c of m.cells)
        if (!core.includes(c.id)) {
          c.status = 'draft';
          m.tree!.active[c.id] = null;
        }
      expect(completion(m, judgePass).mvs).toBe(true);
      const missing = get(m, core.at(-1)!);
      missing.status = 'draft';
      m.tree!.active[missing.id] = null;
      expect(completion(m, judgePass).mvs).toBe(false);
    });
  it('a not-now choice counts as active', () => {
    const m = fixture();
    get(m).direction[0]!.text = 'Not now: only revisit Sample after 20 trials';
    get(m).direction.push(bullet('Only revisit Sample after 20 trials', 'Not-yet'));
    expect(completion(m, judgePass).cells.find(c => c.id === get(m).id)!.active).toBe(true);
  });
  it('a newer draft does not stale active cites; an activated newer version does', () => {
    const m = fixture();
    const original = get(m, 'context.customer.need');
    m.cells.push({ ...original, version: 2, status: 'draft' });
    expect(completion(m, judgePass).cells.find(c => c.id === 'advantage.proposition.promise')!.fresh).toBe(true);
    original.status = 'retired';
    m.cells.at(-1)!.status = 'active';
    m.tree!.active[original.id] = 2;
    expect(completion(m, judgePass).cells.find(c => c.id === 'advantage.proposition.promise')!.fresh).toBe(false);
  });
});
describe('completion boundaries and pure reports', () => {
  it('C1 and failed judge pairs prevent the touching L2 and L1', () => {
    const model = fixture();
    get(model, 'advantage.proposition.promise').cites = [];
    const missing = completion(model, judgePass);
    expect(missing.l2.find(group => group.id === 'advantage.proposition')!.coherent).toBe(false);
    expect(missing.l1.find(group => group.id === 'advantage')!.unlocked).toBe(false);
    expect(missing.mvs).toBe(false);
    const failed = completion(fixture(), { judgeVerdicts: { ...judgePass.judgeVerdicts, 'C2:X3': 'fail' } });
    expect(failed.l2.find(group => group.id === 'focus.segment')!.coherent).toBe(false);
    expect(failed.complete).toBe(false);
  });
  it('a noncore contradiction request blocks full L0, while MVS uses core scope', () => {
    const model = fixture();
    model.requests.push({ id: 'REQ-0002', raisedBy: 'critic', kind: 'contradiction', cells: ['context.market.size'], detail: 'Sample unresolved choice', status: 'open', opened: '2026-10-29', resolvedBy: null });
    const result = completion(model, judgePass);
    expect(result.l0Clean).toBe(false);
    expect(result.mvs).toBe(true);
    expect(completion(fixture(), { judgeVerdicts: { ...judgePass.judgeVerdicts, C4: 'fail' } }).mvs).toBe(false);
  });
  it('checks return proposed contradiction data without changing the input model', () => {
    const model = fixture();
    get(model, 'focus.offer.included').direction.find(b => b.key === 'Offer')!.text = 'Sample reporting';
    get(model, 'focus.offer.excluded').direction.find(b => b.key === 'Not')!.text = 'Sample reporting';
    const before = JSON.stringify(model);
    const result = completion(model, judgePass);
    expect(result.findings.find(f => f.code === 'X1')!.action?.proposal.nextVersion).toBe(2);
    expect(JSON.stringify(model)).toBe(before);
  });
});


it('public strategyStatus delegates scope without requiring the read API', () => {
  const model = fixture();
  const full = strategyStatus(model, 'full', judgePass);
  const core = strategyStatus(model, 'core', judgePass);
  expect(full.counts.total).toBe(57);
  expect(core.counts.total).toBe(24);
  expect(core.l0Clean).toBe(true);
  expect(strategyStatus(model).storyline.critic).toBe('not judged');
});


it('actual root reader feeds completion and catches an unlisted confirm', () => {
  const root = mkdtempSync(join(tmpdir(), 'strategy-checks-'));
  try {
    const model = fixture();
    const write = (path: string, text: string) => {
      mkdirSync(dirname(join(root, path)), { recursive:true });
      writeFileSync(join(root, path), text);
    };
    write('tree.json', JSON.stringify(model.tree));
    for (const cell of model.cells) {
      const serializable = { ...cell, because: cell.because.map(b => ({ ...b, text: `${b.text} (${b.refs.map(formatRef).join(', ')}).` })) };
      write(cell.path, serializeCell(serializable));
    }
    const playback = model.sessions[0]!.lines[0]!.text;
    write('sessions/2026-10-29-1.md', `- S1: ${playback}\n- U2: Yes, all listed.\n`);
    write('findings/sample.md', '---\nid: sample\nsource: user\nobserved: 2026-10-29\nby: researcher\n---\n- Sample observations for 20 teams.\n');
    const read = readStrategyRoot(root);
    expect(read.issues).toEqual([]);
    expect(completion(read, judgePass).complete).toBe(true);
    write('sessions/2026-10-29-1.md', '- S1: Playback for confirm: advantage.proposition.promise@1\n- U2: Yes.\n');
    const unlisted = readStrategyRoot(root);
    expect(unlisted.issues).toEqual([]);
    expect(checkCell(get(unlisted), { model:unlisted }).some(f => f.rule === 'Q7' && f.severity === 'hard')).toBe(true);
    expect(completion(unlisted, judgePass).mvs).toBe(false);
  } finally {
    rmSync(root, { recursive:true, force:true });
  }
});
