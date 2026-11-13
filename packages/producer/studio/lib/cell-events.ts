import { isAgent } from './agents';

/** Whether a Producer event-stream message asks Studio to reload its cell data. */
export function studioCellChange(value: unknown): boolean {
  if (!value || typeof value !== 'object' || !('reload' in value) || value.reload !== true) return false;
  const row = value as Record<string, unknown>;
  return (row.agent === null || typeof row.agent === 'string' && isAgent(row.agent)) && (row.id === null || typeof row.id === 'string');
}
