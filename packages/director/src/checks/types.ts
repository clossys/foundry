import type { Cell } from '../format/types.js';
import type { StrategyModel } from '../format/types.js';
export type Scope = 'core' | 'full';
export type JudgeVerdict = 'pass' | 'fail';
/** Judgements are caller-supplied data. These checks never invoke a model. */
export interface CheckOptions {
  judgeVerdicts?: Record<string, JudgeVerdict>;
  contracts?: readonly {
    id: string;
  }[];
}
export interface CheckContext extends CheckOptions {
  model: StrategyModel;
}
export interface CheckFinding {
  rule: string;
  severity: 'hard' | 'judge' | 'warning';
  message: string;
  cell?: string;
  cells?: string[];
  path?: string;
  line?: number;
  code?: string;
  /** Stable key accepted by CheckOptions.judgeVerdicts. */
  judgeId?: string;
  verdict?: JudgeVerdict;
  /** A proposal for the caller; checks do not write requests or cell files. */
  action?: {
    request: {
      kind: 'contradiction';
      cells: string[];
      detail: string;
    };
    proposal: {
      cell: string;
      fromVersion: number;
      nextVersion: number;
    };
  };
}
export interface CellFinding extends CheckFinding {
  rule: 'Q1' | 'Q2' | 'Q3' | 'Q4' | 'Q5' | 'Q6' | 'Q7';
}
export interface CoherenceFinding extends CheckFinding {
  rule: 'C1' | 'C2' | 'C3' | 'C4';
}
export interface CellCompletion {
  id: string;
  version?: number;
  active: boolean;
  fresh: boolean;
  findings: CellFinding[];
}
export interface StorylineReport {
  headlines: {
    cell: string;
    text?: string;
    fresh: boolean;
  }[];
  critic: 'not judged' | JudgeVerdict;
  clean: boolean;
}
export interface StatusReport {
  scope: Scope;
  cells: CellCompletion[];
  l2: {
    id: string;
    coherent: boolean;
  }[];
  l1: {
    id: string;
    unlocked: boolean;
  }[];
  l0Clean: boolean;
  storyline: StorylineReport;
  findings: CoherenceFinding[];
  counts: {
    active: number;
    fresh: number;
    total: number;
    coherentL2: number;
    unlockedL1: number;
  };
  nextUnlock?: string;
}
export interface CompletionReport extends StatusReport {
  mvs: boolean;
  complete: boolean;
  core: StatusReport;
}
export function blocks(finding: CheckFinding): boolean {
  return finding.severity === 'hard' || finding.verdict === 'fail';
}
export function cellJudgeId(rule: string, cell: Pick<Cell, 'id' | 'version'>): string {
  return `${rule}:${cell.id}@${cell.version}`;
}
