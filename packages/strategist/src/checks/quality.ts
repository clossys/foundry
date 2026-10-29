import type { Cell } from '../format/types.js';
import type { CellFinding, CheckContext } from './types.js';
import { cellJudgeId } from './types.js';
import { containsPhrase, escapeRegex, refText, resolves, words } from './shared.js';
/** A Watch is a complete conditional with a measurable threshold and a review window. */
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
      if (!resolves(ref, ctx.model))
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
    for (const phrase of ctx.model.catalog.lexicon.banned)
      if (containsPhrase(bullet.text, phrase))
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
  if (cell.status === 'active') {
    const ref = cell.confirmed;
    const session = ref?.kind === 'msg' ? ctx.model.sessions.find(session => session.id === ref.session) : undefined;
    const index = session && ref?.kind === 'msg' ? session.lines.findIndex(line => line.id === ref.line) : -1;
    const user = session?.lines[index];
    const playback = session?.lines[index - 1];
    const listed = playback?.role === 'strategist' && new RegExp(`(^|[^A-Za-z0-9._-])${escapeRegex(cell.id)}@${cell.version}(?=$|[\\s,;:)\\]!?]|\\.(?=\\s|$))`, 'u').test(playback.text);
    if (ref?.kind !== 'msg' || !/^U[1-9]\d*$/.test(ref.line) || user?.role !== 'user' || !listed)
      add('Q7', 'Active cell requires a U confirmation immediately after an S line listing this exact id@version', undefined, 'confirm-listing');
  }
  return findings;
}
