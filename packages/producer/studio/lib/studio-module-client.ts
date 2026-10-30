import { isAgent } from './agents';
import type { StudioChecks } from './studio-module-data';
import type { Agent } from './agents';

export async function loadStudioChecks(signal: AbortSignal, agent?: Agent): Promise<StudioChecks> {
  const response = await fetch(`/api/checks${agent ? `?agent=${agent}` : ''}`, { signal, cache: 'no-store', headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Producer checks are unavailable (${response.status}).`);
  const value: unknown = await response.json();
  if (!value || typeof value !== 'object' || !('state' in value) || value.state !== 'ready' || !('results' in value) || !Array.isArray(value.results)
    || value.results.some(result => !result || typeof result !== 'object' || !isAgent(result.agent) || !['unavailable', 'error'].includes(result.state) || !Number.isInteger(result.exitCode) || typeof result.message !== 'string' || typeof result.verb !== 'string')) throw new Error('Producer returned an invalid checks resource.');
  return value as StudioChecks;
}
