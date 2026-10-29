import type { StrategyModel } from '../format/types.js';
import type { CheckOptions, CompletionReport, Scope, StatusReport, StorylineReport } from './types.js';
import { blocks } from './types.js';
import { activeCell, fresh, scopeIds } from './shared.js';
import { checkCell } from './quality.js';
import { checkCoherence } from './coherence.js';
export function strategyStatus(model: StrategyModel, scope: Scope = 'full', options: CheckOptions = {}): StatusReport {
  const ids = scopeIds(model, scope), selected = new Set(ids), core = new Set(scopeIds(model, 'core'));
  const cells = ids.map(id => {
    const cell = activeCell(model, id);
    const findings = cell ? checkCell(cell, { model, ...options }) : [];
    return { id, version: cell?.version, active: Boolean(cell) && !findings.some(blocks), fresh: Boolean(cell && fresh(cell, model)), findings };
  });
  const valid = (id: string) => cells.some(cell => cell.id === id && cell.active && cell.fresh);
  const findings = checkCoherence(model, scope, options);
  const pairsPass = (members: Set<string>, among?: Set<string>) => !findings.some(finding => (finding.rule === 'C1' || finding.rule === 'C2') && finding.cells?.some(id => members.has(id)) && (!among || finding.cells.every(id => among.has(id))) && (blocks(finding) || (finding.severity === 'judge' && finding.verdict !== 'pass')));
  const nodes = model.tree?.tree ?? model.catalog.ia.nodes.map(node => ({ ...node, children: node.children.map(child => ({ ...child, cells: child.leaves })) }));
  const l2 = nodes.flatMap(node => node.children.map(child => {
    const members = child.cells.filter(id => selected.has(id));
    return { id: child.id, coherent: members.every(valid) && pairsPass(new Set(members)) };
  }));
  const l1 = nodes.map(node => {
    const members = node.children.flatMap(child => child.cells).filter(id => core.has(id) && selected.has(id));
    return { id: node.id, unlocked: members.every(valid) && pairsPass(new Set(members), core) };
  });
  const headlines = model.catalog.coherence.storyline.filter(id => selected.has(id)).map(id => { const cell = activeCell(model, id); return { cell: id, text: cell?.direction[0]?.text, fresh: Boolean(cell && fresh(cell, model)) }; });
  const critic = options.judgeVerdicts?.C4 ?? 'not judged';
  const storyline: StorylineReport = { headlines, critic, clean: critic === 'pass' && !findings.some(finding => finding.rule === 'C4' && blocks(finding)) };
  const openContradiction = model.requests.some(request => request.kind === 'contradiction' && (request.status === 'open' || request.status === 'drafted') && request.cells.some(id => selected.has(id)));
  const l0Clean = l1.every(group => group.unlocked) && storyline.clean && !findings.some(finding => finding.rule === 'C3' && blocks(finding)) && !openContradiction && cells.every(cell => !activeCell(model, cell.id) || cell.fresh);
  const nextUnlock = l1.find(group => !group.unlocked)?.id;
  return { scope, cells, l2, l1, l0Clean, storyline, findings, nextUnlock, counts: { active: cells.filter(cell => cell.active).length, fresh: cells.filter(cell => cell.active && cell.fresh).length, total: cells.length, coherentL2: l2.filter(group => group.coherent).length, unlockedL1: l1.filter(group => group.unlocked).length } };
}
/** Exact completion, including an independent archetype-core MVS calculation. */
export function completion(model: StrategyModel, options: CheckOptions = {}): CompletionReport {
  const full = strategyStatus(model, 'full', options), core = strategyStatus(model, 'core', options);
  return { ...full, core, mvs: core.l0Clean && core.cells.every(cell => cell.active && cell.fresh) && !core.findings.some(finding => ['C1', 'C2', 'C3'].includes(finding.rule) && (blocks(finding) || (finding.severity === 'judge' && finding.verdict !== 'pass'))), complete: full.l0Clean && full.cells.every(cell => cell.active && cell.fresh) && full.l2.every(group => group.coherent) };
}
