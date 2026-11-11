import type { ModuleCheckGroup, ModuleCheckRow, ModuleChecksInput } from '../sections/module-checks';
import type { PageHeaderInput } from '../sections/studio-page-header';
import { pipelineInputs, type PipelineInputs, type PipelineWiringFile } from './pipeline-flow';
import { studioCopy } from './studio-copy';
import type { StudioReport } from './studio-report';

/**
 * The checks rows every Studio page derives from the open needs Studio loads (Producer reports),
 * and Home's own sections: the decisions waiting for the owner, then the pipeline the agents run.
 */

const SEVERITY_TONE: Record<string, ModuleCheckRow['tone']> = { error: 'destructive', warning: 'outline', info: 'secondary' };
/** A report's severity as shown (Writer copy). */
const SEVERITY_LABEL: Record<string, string> = { error: studioCopy('studio.severity-error'), warning: studioCopy('studio.severity-warning'), info: studioCopy('studio.severity-info') };

export const needRow = (report: StudioReport): ModuleCheckRow => ({ id: report.id, badge: SEVERITY_LABEL[report.severity] ?? report.severity, tone: SEVERITY_TONE[report.severity] ?? 'outline', title: report.title, detail: report.detail });
/** The reports that wait on the owner: not information, not an agent's own compile run. */
export const openNeeds = (reports: readonly StudioReport[], keep: (report: StudioReport) => boolean = () => true) => reports.filter(report => report.severity !== 'info' && report.area !== 'compile' && keep(report));

export function checksInput(failing: readonly ModuleCheckRow[], options: readonly ModuleCheckRow[], needs: readonly ModuleCheckRow[]): ModuleChecksInput {
  const total = failing.length + options.length + needs.length;
  return {
    summary: total ? studioCopy('studio.page-attention-count', { count: total }) : studioCopy('studio.nothing-needs-attention-on-this-page'),
    groups: [
      { id: 'failing', label: studioCopy('studio.failing-checks'), empty: studioCopy('studio.no-check-reports-a-finding'), rows: failing },
      { id: 'options', label: studioCopy('studio.pending-options'), empty: studioCopy('studio.no-option-waits-for-approval'), rows: options },
      { id: 'needs', label: studioCopy('studio.open-needs'), empty: studioCopy('studio.nothing-is-waiting-on-you'), rows: needs },
    ] satisfies ModuleCheckGroup[],
  };
}

/**
 * Home's lead section: the decisions waiting for the owner, read from the open needs Studio loads
 * and nothing else. Errors first, then the rest; with none open it says nothing is waiting.
 */
export function homeDecisions(reports: readonly StudioReport[]): ModuleChecksInput {
  const rows = openNeeds(reports).map(needRow);
  const failing = rows.filter(row => row.tone === 'destructive');
  const needs = rows.filter(row => row.tone !== 'destructive');
  return {
    summary: rows.length ? studioCopy('studio.page-attention-count', { count: rows.length }) : studioCopy('studio.nothing-is-waiting-on-you'),
    groups: [
      { id: 'failing', label: studioCopy('studio.failing-checks'), empty: studioCopy('studio.no-check-reports-a-finding'), rows: failing },
      { id: 'needs', label: studioCopy('studio.open-needs'), empty: studioCopy('studio.nothing-is-waiting-on-you'), rows: needs },
    ],
  };
}

/** Home's pipeline sections, from the Producer wiring (GET /api/pipeline/wiring); none until it loads. */
export function homePipeline(wiring: PipelineWiringFile | undefined, head: PageHeaderInput, path: string, seat: string | null = null): Partial<Pick<PipelineInputs, 'team' | 'legend' | 'flow'>> {
  if (!wiring) return {};
  const { team, legend, flow } = pipelineInputs(wiring, head, path, seat);
  return { team, legend, flow };
}
