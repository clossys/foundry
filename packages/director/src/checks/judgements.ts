import type { Finding, StrategyModel } from '../format/types.js';
import type { JudgeVerdict, JudgmentFinding } from './types.js';

/** A cell judgement (Q<n>:<cell>@<N>) counts only when it cites a run record that ran (exit 0 or 1). */
const CELL_JUDGE = /^Q[1-7]:(.+)@([1-9][0-9]*)$/;
function citedRun(model: StrategyModel, finding: Finding): boolean {
  const run = finding.run === undefined ? undefined : model.runs?.[finding.run];
  return run !== undefined && (run.exit === 0 || run.exit === 1);
}

/** The cell ids a verdict must have judged to count: every storyline cell, both sides of a judge pair, or the one cell. */
export function judgedCells(model: StrategyModel, judge: string): string[] | undefined {
  if (judge === 'C4') return [...model.catalog.coherence.storyline];
  const pair = /^C2:(X[1-9][0-9]*)$/.exec(judge)?.[1];
  if (pair !== undefined) {
    const found = model.catalog.coherence.contradictions.find(candidate => candidate.id === pair);
    return found?.kind === 'judge' ? [found.a, ...[found.b].flat()] : undefined;
  }
  const cell = /^Q[1-7]:(.+)@[1-9][0-9]*$/.exec(judge)?.[1];
  return cell === undefined ? undefined : [cell];
}

/**
 * Judge verdicts recorded as Director judgement findings (`judge`, `verdict`, `judged`), keyed as
 * CheckOptions.judgeVerdicts expects. A verdict counts only while it is current: every cell it judged
 * is still pinned at the judged version, and it judged every cell its judge id covers (a Q judge id
 * names its own version). A newer pin of any judged cell drops the verdict back to not judged, so
 * the judge must run again. When current verdicts for one judge id disagree, fail wins.
 */
export function recordedJudgeVerdicts(model: StrategyModel): Record<string, JudgeVerdict> {
  const verdicts: Record<string, JudgeVerdict> = Object.create(null);
  for (const finding of model.findings) {
    if (finding.judge === undefined || finding.verdict === undefined || finding.judged === undefined) continue;
    const required = judgedCells(model, finding.judge);
    if (!required) continue;
    const judged = new Map(finding.judged.map(ref => {
      const at = ref.lastIndexOf('@');
      return [ref.slice(0, at), Number(ref.slice(at + 1))] as const;
    }));
    if (finding.judged.length !== judged.size) continue;
    const current = [...judged].every(([cell, version]) => model.tree?.active[cell] === version);
    const covers = required.every(cell => judged.has(cell));
    const ownVersion = /^Q[1-7]:/.test(finding.judge) ? finding.judge.slice(finding.judge.indexOf(':') + 1) : undefined;
    if (!current || !covers || (ownVersion !== undefined && !finding.judged.includes(ownVersion))) continue;
    if (ownVersion !== undefined && !citedRun(model, finding)) continue;
    verdicts[finding.judge] = verdicts[finding.judge] === 'fail' || finding.verdict === 'fail' ? 'fail' : 'pass';
  }
  return verdicts;
}

/**
 * `judgment-uncited`: a cell judgement (Q<n>:<cell>@<N>) on the cell's pinned version whose run
 * citation is missing or does not resolve to a run record in the local run store. Such a verdict
 * is not counted (recordedJudgeVerdicts drops it) and the finding blocks the cell, so a verdict no
 * run produced can neither pass nor quietly vanish.
 */
export function uncitedJudgements(model: StrategyModel): JudgmentFinding[] {
  const findings: JudgmentFinding[] = [];
  for (const finding of model.findings) {
    const match = finding.judge === undefined || finding.verdict === undefined ? undefined : CELL_JUDGE.exec(finding.judge);
    if (!match || model.tree?.active[match[1]!] !== Number(match[2])) continue;
    if (citedRun(model, finding)) continue;
    const why = finding.run === undefined ? 'cites no run record' : `cites run ${finding.run}, which is not a finished run in .clossys/runs`;
    findings.push({ rule: 'judgment-uncited', severity: 'hard', code: 'judgment-uncited', cell: match[1]!, path: finding.path, judgeId: finding.judge, verdict: finding.verdict,
      message: `Judgement ${finding.judge} (${finding.verdict}, finding ${finding.id}) ${why}; re-run the critic through \`clossys pipeline trace\` and cite its run as run: <step>#<run id>` });
  }
  return findings;
}
