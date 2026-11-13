import { studioCopy } from './studio-copy';
import { studioGroups } from './studio-route-map';
/**
 * Studio reports: Producer facts that used to replace the page now render as
 * a non-blocking list. The session token in /api/config is never read here.
 */
export type StudioReportSeverity = 'info' | 'warning' | 'error';
export interface StudioReport { id: string; area: 'selection' | 'theme' | 'compile'; severity: StudioReportSeverity; title: string; detail: string; agent?: string }

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * A selection is qualified when Producer compiled a legacy runtime for it, or when it is the
 * Designer slot model's pinned selection: one or more consumer leaves, each naming its pinned
 * candidate version and that candidate's content hash. Anything else reports not qualified.
 */
const pinnedLeaf = (leaf: unknown) => object(leaf) && typeof leaf.leaf === 'string' && leaf.source === 'consumer'
  && typeof leaf.fill === 'string' && /@v[1-9][0-9]*$/.test(leaf.fill) && typeof leaf.hash === 'string' && /^sha256:[0-9a-f]{64}$/.test(leaf.hash);
const qualified = (selection: Record<string, unknown>) => typeof selection.runtimeUrl === 'string'
  || (Array.isArray(selection.leaves) && selection.leaves.length > 0 && selection.leaves.every(pinnedLeaf));

/** An agent by its content-map group title (Writer name); an agent the map does not hold keeps its id, which is data. */
const agentTitle = (agent: string) => studioGroups().find(group => group.id === agent)?.label ?? agent;

/**
 * Producer reports become Writer-worded rows. A Producer `message` is a diagnostic for the
 * terminal (the server logs it); Studio never shows one, so no report reads it.
 */
export function studioReports(config: unknown): StudioReport[] {
  if (!object(config)) return [{ id: 'config', area: 'selection', severity: 'error', title: studioCopy("studio.producer-configuration-unavailable"), detail: studioCopy("studio.studio-could-not-read-the-producer-configuration") }];
  const reports: StudioReport[] = [];
  const selection = object(config.selection) ? config.selection : undefined;
  if (!selection) reports.push({ id: 'selection', area: 'selection', severity: 'warning', title: studioCopy("studio.designer-selection-unavailable"), detail: studioCopy("studio.producer-supplied-no-designer-selection-studio-renders") });
  else if (!qualified(selection)) {
    const reason = studioCopy("studio.the-designer-selection-is-not-compiled").replace(/\.$/, '');
    reports.push({ id: 'selection', area: 'selection', severity: 'warning', title: studioCopy("studio.designer-selection-not-qualified"), detail: studioCopy("studio.selection-fallback-detail", { reason }) });
  }
  const theme = object(config.theme) ? config.theme : undefined;
  if (theme?.source === 'foundry' || theme?.source === 'error') reports.push({ id: 'theme', area: 'theme', severity: theme.source === 'error' ? 'error' : 'info', title: studioCopy("studio.consumer-theme-not-compiled"), detail: studioCopy("studio.producer-is-using-the-foundry-theme") });
  if (Array.isArray(config.compilation)) for (const row of config.compilation) {
    if (!object(row) || typeof row.agent !== 'string' || row.state !== 'error') continue;
    reports.push({ id: `compile:${row.agent}`, area: 'compile', severity: 'error', agent: row.agent, title: studioCopy("studio.agent-compile-failed", { agent: agentTitle(row.agent) }), detail: studioCopy("studio.producer-could-not-compile-these-cells") });
  }
  return reports;
}
