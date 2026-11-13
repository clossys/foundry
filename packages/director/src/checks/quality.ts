import { isSlotCandidatePath } from '../format/slot.js';
import type { Cell } from '../format/types.js';
import type { CellFinding, CheckContext } from './types.js';
import { cellJudgeId } from './types.js';
import { containsPhrase, escapeRegex, refText, resolves, scopeIds, staleCandidate, words } from './shared.js';
/** A Watch is a complete conditional with a measurable threshold and a review window. */
/**
 * Whether a pin satisfies the cell's decider. A core cell's decider is the owner: it counts only
 * when owner-picked (`--by owner[:<ref>] --basis picked`). Any other cell may also be agent-picked
 * (`clossys pick --by agent:<seat>`, basis `agent`). Bulk and planner pins are hypotheses and never count.
 */
export function pinSatisfiesDecider(pin: { decidedBy: string; basis: string }, decider: 'owner' | 'agent'): boolean {
  const owner = pin.basis === 'picked' && /^owner(?::\S.*)?$/.test(pin.decidedBy);
  return owner || decider === 'agent' && pin.basis === 'agent' && /^agent:\S+$/.test(pin.decidedBy);
}

/** Drops double-quoted spans: a Direction bullet under a negative key quotes the words it bans. */
function unquoted(text: string): string { return text.replace(/["“][^"”]*["”]/g, ' '); }

export function validWatch(text: string): boolean {
  const match = /^If\s+(.+?)\s+(>=|<=|>|<|=|rises above|falls below|reaches|stays below|stays above|is still|appears)\s+(.+?)\s+(by\s+(\d{4}-\d{2}-\d{2})|each\s+[\p{L}\p{N}][\p{L}\p{N}\s-]*|in any\s+[\p{L}\p{N}][\p{L}\p{N}\s-]*),\s+then\s+(.+)\.$/iu.exec(text.trim());
  if (!match || !(/\d/.test(match[3]!) || /"[^"\n]+"|'[^'\n]+'/.test(match[3]!)))
    return false;
  if (match[5]) {
    const date = new Date(`${match[5]}T00:00:00Z`);
    if (!Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 10) !== match[5])
      return false;
  }
  return true;
}
/** Q1–Q7. Hard findings and supplied judge failures block activation. */
export function checkCell(cell: Cell, ctx: CheckContext): CellFinding[] {
  const findings: CellFinding[] = [];
  const add = (rule: CellFinding['rule'], message: string, line?: number, code?: string) => findings.push({ rule, severity: 'hard', message, cell: cell.id, path: cell.path, line, code });
  const judge = (rule: CellFinding['rule'], message: string, code?: string, line?: number) => {
    const judgeId = cellJudgeId(rule, cell);
    findings.push({ rule, severity: 'judge', message, cell: cell.id, path: cell.path, line, code, judgeId, verdict: ctx.judgeVerdicts?.[judgeId] });
  };
  const definition = ctx.model.catalog.cells.find(def => def.id === cell.id);
  if (cell.direction.length < 2 || cell.direction.length > 6)
    add('Q1', 'Direction requires 2–6 bullets');
  if (!definition)
    add('Q2', 'Cell id has no catalog definition');
  else
    for (const { key } of definition.mustContain)
      if (!cell.direction.some(bullet => bullet.key === key))
        add('Q2', `Missing Direction label ${key}`);
  judge('Q2', 'Judge whether each labelled bullet answers its key rather than supplying filler');
  if (!cell.because.length)
    add('Q3', 'Because requires at least one grounded bullet');
  for (const bullet of cell.because) {
    if (!bullet.refs.length)
      add('Q3', 'Because bullet requires a trailing reference', bullet.line);
    for (const ref of bullet.refs)
      // A recorded but unpinned version is stale (still hard: the cell cannot be active until it is re-cited).
      if (ref.kind === 'cell' && staleCandidate(ref, ctx.model)) {
        const pinned = ctx.model.tree?.active[ref.ref.cell];
        add('Q3', `Stale reference ${refText(ref)}: ${pinned == null
          ? `${ref.ref.cell} has no pinned version; pin one and re-cite it`
          : `the pinned version is ${ref.ref.cell}@${pinned}; re-cite the pinned version`} (clossys migrate director-refs) or re-draft this cell`, bullet.line, 'stale');
      }
      else if (!resolves(ref, ctx.model))
        add('Q3', `Unresolved reference ${refText(ref)}`, bullet.line, 'dangling');
  }
  const expected = new Set(cell.because.flatMap(bullet => bullet.refs.map(refText)));
  const actual = new Set(cell.cites.map(refText));
  if (actual.size !== expected.size || [...expected].some(ref => !actual.has(ref)))
    add('Q3', 'cites must equal the union of Because references', undefined, 'cites-union');
  judge('Q3', 'Judge whether the cited evidence supports each Because bullet');
  if (!cell.watch.length)
    add('Q4', 'Watch requires at least one testable tripwire');
  for (const bullet of cell.watch)
    if (!validWatch(bullet.text))
      add('Q4', 'Watch must contain a signal, comparator, numeric or quoted threshold, window, and action', bullet.line);
  judge('Q4', 'Judge whether each Watch threshold is meaningful for this Direction');
  for (const bullet of [...cell.direction, ...cell.because, ...cell.watch]) {
    // A banned phrase quoted under a negative key (Never: "seamless") is the ban itself, not a use of it.
    const negative = cell.direction.includes(bullet) && ctx.model.catalog.lexicon.negativeKeys.includes(bullet.key ?? '');
    const scanned = negative ? unquoted(bullet.text) : bullet.text;
    for (const phrase of ctx.model.catalog.lexicon.banned)
      if (containsPhrase(scanned, phrase))
        add('Q5', `Banned generic phrase: ${phrase}`, bullet.line, 'generic');
    if (cell.id.startsWith('identity.visual.') && /#[\da-f]{3,8}\b/i.test(bullet.text))
      add('Q5', 'Visual strategy must not prescribe hex colours', bullet.line, 'hex');
    const properNoun = /\b[A-Z]{2,}\b|\b[A-Z][a-z]+\b/g;
    const names = [...bullet.text.matchAll(properNoun)].map(match => match[0]).filter(name => !['If', 'Only', 'The', 'A', 'An', 'We', 'Our', 'Not', 'Never', 'No', 'Use'].includes(name));
    if (!/\d/.test(bullet.text) && !names.length && words(bullet.text).length < 5)
      judge('Q5', 'Short bullet has no number or apparent proper noun; judge specificity', 'sparse', bullet.line);
  }
  const hasTradeoff = cell.direction.some(bullet => ctx.model.catalog.lexicon.negativeKeys.includes(bullet.key ?? '') || ctx.model.catalog.lexicon.tradeOffMarkers.some(marker => containsPhrase(bullet.text, marker)));
  judge('Q6', hasTradeoff ? 'Judge whether a real alternative was given up' : 'No trade-off marker or negative key; judge whether a real alternative was given up', hasTradeoff ? 'tradeoff' : 'absent-tradeoff');
  // A pinned slot candidate is confirmed by its pin (pin.json decidedBy/basis), not by a session line:
  // it counts only when the pin satisfies the cell's decider.
  if (cell.status === 'active' && isSlotCandidatePath(cell.id, cell.path)) {
    const decider = scopeIds(ctx.model, 'core').includes(cell.id) ? 'owner' : 'agent';
    if (!cell.pin)
      add('Q7', `Pinned candidate ${cell.id}@${cell.version} carries no pin decision`, undefined, 'pin-basis');
    else if (!pinSatisfiesDecider(cell.pin, decider))
      add('Q7', `Pin of ${cell.id}@${cell.version} is decided by "${cell.pin.decidedBy}" with basis ${cell.pin.basis}; ${decider === 'owner'
        ? 'a core cell counts only when owner-picked (clossys pin --by owner --basis picked)'
        : 'this cell counts only when owner-picked or agent-picked (basis picked or agent)'}`, undefined, 'pin-basis');
  }
  if (cell.status === 'active' && !isSlotCandidatePath(cell.id, cell.path)) {
    const ref = cell.confirmed;
    const session = ref?.kind === 'msg' ? ctx.model.sessions.find(session => session.id === ref.session) : undefined;
    const index = session && ref?.kind === 'msg' ? session.lines.findIndex(line => line.id === ref.line) : -1;
    const user = session?.lines[index];
    const playback = session?.lines[index - 1];
    const listed = playback?.role === 'director' && new RegExp(`(^|[^A-Za-z0-9._-])${escapeRegex(cell.id)}@${cell.version}(?=$|[\\s,;:)\\]!?]|\\.(?=\\s|$))`, 'u').test(playback.text);
    if (ref?.kind !== 'msg' || !/^U[1-9]\d*$/.test(ref.line) || user?.role !== 'user' || !listed)
      add('Q7', 'Active cell requires a U confirmation immediately after an S line listing this exact id@version', undefined, 'confirm-listing');
  }
  return findings;
}
