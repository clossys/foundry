/**
 * Studio reports: Producer facts that used to replace the page now render as
 * a non-blocking list. The session token in /api/config is never read here.
 */
export type StudioReportSeverity = 'info' | 'warning' | 'error';
export interface StudioReport { id: string; area: 'selection' | 'theme' | 'compile'; severity: StudioReportSeverity; title: string; detail: string; agent?: string }

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** Remove gate prefixes and local filesystem paths from a Producer message. */
export function reportText(message: string): string {
  return message
    .replace(/\bNEED:\s*/g, '')
    .replace(/(?:\/[^\s/:]+)+\/cells\/([^\s/:]+)\/v(\d+)\.md:?/g, (_, cell: string, version: string) => `${cell} v${version}:`)
    .replace(/(?:\/[^\s/:]+){2,}/g, 'a local path')
    .replace(/\s*\(sha256:[a-f0-9]{64}\)/g, '')
    .replace(/\b(assets|components|frames|sections|tokens)\.([a-z][a-z0-9-]*)/g, (_, layer: string, name: string) => layerLabel(layer, name))
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function layerLabel(layer: string, name: string): string {
  return `${name.charAt(0).toUpperCase()}${name.slice(1).replace(/-/g, ' ')} ${layer.replace(/s$/, '')}`;
}

function slotLabel(message: string): string | undefined {
  const slot = /slot ([a-z][a-z0-9-]*)\.([a-z][a-z0-9-]*)/.exec(message);
  return slot ? layerLabel(slot[1]!, slot[2]!) : undefined;
}

export function studioReports(config: unknown): StudioReport[] {
  if (!object(config)) return [{ id: 'config', area: 'selection', severity: 'error', title: 'Producer configuration unavailable', detail: 'Studio could not read the Producer configuration.' }];
  const reports: StudioReport[] = [];
  const selection = object(config.selection) ? config.selection : undefined;
  if (!selection) reports.push({ id: 'selection', area: 'selection', severity: 'warning', title: 'Designer selection unavailable', detail: 'Producer supplied no Designer selection. Studio renders with the stock component layer.' });
  else if (typeof selection.runtimeUrl !== 'string') {
    const message = typeof selection.message === 'string' ? selection.message : 'The Designer selection is not compiled.';
    const slot = slotLabel(message);
    const reason = reportText(message).split(': ').at(-1)!.replace(/\s+for slot .*$/, '').replace(/\.$/, '');
    reports.push({ id: 'selection', area: 'selection', severity: 'warning', title: slot ? `Designer selection not qualified: ${slot}` : 'Designer selection not qualified', detail: `${reason.charAt(0).toUpperCase()}${reason.slice(1)}. Studio renders with the stock component layer until the selection qualifies.` });
  }
  const theme = object(config.theme) ? config.theme : undefined;
  if (theme?.source === 'foundry') reports.push({ id: 'theme', area: 'theme', severity: 'info', title: 'Consumer theme not compiled', detail: typeof theme.message === 'string' ? reportText(theme.message) : 'Producer is using the Foundry theme.' });
  if (Array.isArray(config.compilation)) for (const row of config.compilation) {
    if (!object(row) || typeof row.agent !== 'string' || row.state !== 'error') continue;
    reports.push({ id: `compile:${row.agent}`, area: 'compile', severity: 'error', agent: row.agent, title: `${row.agent.charAt(0).toUpperCase()}${row.agent.slice(1)} cells did not compile`, detail: typeof row.message === 'string' ? reportText(row.message) : 'Producer could not compile these cells.' });
  }
  return reports;
}
