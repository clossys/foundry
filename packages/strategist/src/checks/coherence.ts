import type { Cell } from '../format/types.js';
import type { StrategyModel } from '../format/types.js';
import type { CheckOptions, CoherenceFinding, Scope } from './types.js';
import { activeCell, containsPhrase, fresh, quoted, refText, resolves, scopeIds } from './shared.js';
function labelled(cell: Cell, key: string): string[] { return cell.direction.filter(bullet => bullet.key === key).map(bullet => bullet.text); }
function items(texts: string[]): string[] {
  return texts.flatMap(text => {
    const phrases = quoted(text);
    return phrases.length ? phrases : text.split(/[,;\n]|\s+and\s+/i).map(item => item.trim().toLowerCase().replace(/[.!]$/, '')).filter(Boolean);
  });
}
function contradicts(id: string, a: Cell, b: Cell): boolean {
  if (id === 'X1' || id === 'X2') {
    const left = items(labelled(a, id === 'X1' ? 'Offer' : 'Bet'));
    const right = items(labelled(b, id === 'X1' ? 'Not' : 'Parked'));
    return left.some(item => right.includes(item));
  }
  if (id === 'X4' || id === 'X5') {
    const forbidden = labelled(a, id === 'X4' ? 'Never' : 'Never-claim').flatMap(quoted);
    return forbidden.some(phrase => b.direction.some(bullet => containsPhrase(bullet.text, phrase)));
  }
  if (id === 'X6') {
    const date = (cell: Cell) => labelled(cell, 'Date').join(' ').match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0];
    const annual = date(a), longTerm = date(b);
    return Boolean(annual && longTerm && annual > longTerm);
  }
  return false;
}
/** C1–C4. Contradiction actions are data for a caller, never filesystem mutations. */
export function checkCoherence(model: StrategyModel, scope: Scope, options: CheckOptions = {}): CoherenceFinding[] {
  const findings: CoherenceFinding[] = [];
  const ids = new Set(scopeIds(model, scope));
  const add = (rule: CoherenceFinding['rule'], message: string, extra: Partial<CoherenceFinding> = {}) => findings.push({ rule, severity: 'hard', message, ...extra });
  for (const link of model.catalog.coherence.links) {
    if (!ids.has(link.upstream) || !ids.has(link.downstream))
      continue;
    const a = activeCell(model, link.upstream), b = activeCell(model, link.downstream);
    const extra = { cell: link.downstream, cells: [link.upstream, link.downstream], path: b?.path };
    const cites = b?.cites.filter(ref => ref.kind === 'cell' && ref.ref.cell === link.upstream) ?? [];
    if (!a || !b || !cites.length)
      add('C1', `Required link ${link.label} lacks an active cell or citation`, { ...extra, code: 'missing' });
    else if (!cites.some(ref => ref.kind === 'cell' && ref.ref.version === a.version))
      add('C1', `Required link ${link.label} cites a version that is no longer active`, { ...extra, code: 'stale' });
  }
  for (const pair of model.catalog.coherence.contradictions) {
    for (const bId of [pair.b].flat()) {
      if (!ids.has(pair.a) || !ids.has(bId))
        continue;
      const a = activeCell(model, pair.a), b = activeCell(model, bId);
      if (!a || !b)
        continue;
      const cells = [pair.a, bId];
      const judgeId = `C2:${pair.id}`;
      const verdict = options.judgeVerdicts?.[judgeId];
      const action = { request: { kind: 'contradiction' as const, cells, detail: `${pair.id}: ${pair.rule}` }, proposal: { cell: a.id, fromVersion: a.version, nextVersion: Math.max(...model.cells.filter(cell => cell.id === a.id).map(cell => cell.version)) + 1 } };
      if (pair.kind === 'judge')
        add('C2', pair.rule, { severity: 'judge', code: pair.id, cell: a.id, cells, judgeId, verdict, ...(verdict === 'fail' ? { action } : {}) });
      else if (contradicts(pair.id, a, b))
        add('C2', pair.rule, { code: pair.id, cell: a.id, cells, action });
    }
  }
  if (!model.tree)
    add('C3', 'No readable tree.json', { path: 'tree.json', code: 'tree' });
  for (const issue of model.issues) {
    const cellPath = /^cells\/([^/]+)\//.exec(issue.path);
    if (!cellPath || ids.has(cellPath[1]!))
      add('C3', `${issue.reason}: ${issue.message}`, { path: issue.path, line: issue.line, code: 'read-issue' });
  }
  for (const [id, version] of Object.entries(model.tree?.active ?? {})) {
    if (!ids.has(id)) {
      if (!model.catalog.cells.some(cell => cell.id === id))
        add('C3', 'Active pointer names an unknown catalog cell', { cell: id, path: 'tree.json', code: 'pointer' });
      continue;
    }
    if (version !== null && !model.cells.some(cell => cell.id === id && cell.version === version))
      add('C3', 'Active pointer does not resolve', { cell: id, path: 'tree.json', code: 'pointer' });
  }
  for (const id of ids) {
    const versions = model.cells.filter(cell => cell.id === id);
    const active = versions.filter(cell => cell.status === 'active');
    if (active.length > 1)
      add('C3', 'More than one active version', { cell: id, code: 'duplicate-active' });
    for (const cell of versions) {
      const pointsHere = model.tree?.active[id] === cell.version;
      if ((cell.status === 'active') !== pointsHere)
        add('C3', 'Cell status disagrees with active pointer', { cell: id, path: cell.path, code: 'status' });
      for (const ref of cell.cites) {
        if (!resolves(ref, model))
          add('C3', `Unresolved cite ${refText(ref)}`, { cell: id, path: cell.path, code: 'dangling' });
        if (cell.status === 'active' && ref.kind === 'cell' && model.tree?.active[ref.ref.cell] !== ref.ref.version)
          add('C3', `Cite ${refText(ref)} is no longer active`, { cell: id, path: cell.path, code: 'stale' });
      }
      if (options.contracts)
        for (const feed of cell.feeds)
          if (!options.contracts.some(contract => contract.id === feed))
            add('C3', `Unknown installed brief contract ${feed}`, { severity: 'warning', cell: id, path: cell.path, code: 'unknown-feed' });
    }
  }
  for (const id of model.catalog.coherence.storyline) {
    if (!ids.has(id))
      continue;
    const cell = activeCell(model, id);
    if (!cell || !cell.direction.length)
      add('C4', 'Storyline cell has no active headline', { cell: id, code: 'missing' });
    else if (!fresh(cell, model))
      add('C4', 'Storyline headline is stale', { cell: id, path: cell.path, code: 'stale' });
  }
  add('C4', options.judgeVerdicts?.C4 ? 'Storyline critic verdict supplied' : 'Storyline critic: not judged', { severity: 'judge', code: 'critic', judgeId: 'C4', verdict: options.judgeVerdicts?.C4 });
  return findings;
}
