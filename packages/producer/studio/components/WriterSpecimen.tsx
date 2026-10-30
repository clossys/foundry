'use client';
import type { AgentCells } from '../lib/cells-client';
import { AgentL3Specimen } from './AgentL3Specimen';
export function WriterSpecimen({ index, selectedId }: { index: AgentCells; selectedId?: string }) {
  return <AgentL3Specimen index={index} selectedId={selectedId} />;
}
