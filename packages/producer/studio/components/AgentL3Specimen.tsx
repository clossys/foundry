'use client';

import { createContext, useContext, type ComponentType, type ReactNode } from 'react';
import type { AgentCells, CellDetail, CellSummary } from '../lib/cells-client';
import { directorNativePlan } from '../lib/director-native-inventory';
import { agentSpecimenPlan, type AgentSpecimenPlan } from '../lib/agent-specimen-data';
import { agentSpecimenCoverage, type AgentSpecimenCoverage, type ResolvedSpecimenEvidence } from '../lib/agent-specimen-coverage';
import { selectedPublicationId, type PublicationResponse } from '../lib/publisher-preview';
import { useStudioUI } from './StudioSelection';
import { RoleToolsProvider, latestSpecimenCell, useRoleSpecimenResource } from './AgentSpecimenProvider';

export interface BoundSpecimenLeaf {
  sourcePlan?: AgentSpecimenPlan;
  evidence: ResolvedSpecimenEvidence;
  Component?: ComponentType<Record<string, unknown>>;
  props: Record<string, unknown> & { items: unknown[] };
}
export interface SpecimenLeafRequest { index: AgentCells; cell: CellDetail; plan: AgentSpecimenPlan; publication?: PublicationResponse; expanded: boolean }
/** The host supplies the actual publication binding and selected registered leaf adapter. */
export type ResolveSpecimenLeaf = (request: SpecimenLeafRequest) => BoundSpecimenLeaf | undefined;
const BindingContext = createContext<ResolveSpecimenLeaf | undefined>(undefined);
export function SpecimenLeafProvider({ resolve, children }: { resolve: ResolveSpecimenLeaf; children: ReactNode }) {
  return <BindingContext.Provider value={resolve}>{children}</BindingContext.Provider>;
}

function useBoundSpecimen(index: AgentCells, selectedId: string | undefined, expanded: boolean) {
  const resource = useRoleSpecimenResource(index);
  const resolve = useContext(BindingContext);
  const cell = resource && selectedId ? latestSpecimenCell(resource.cells, index, selectedId) : undefined;
  const publicationId = selectedPublicationId(index, selectedId);
  const publicationResource = publicationId ? resource?.publications?.[publicationId] : resource?.publication;
  const publication = publicationResource?.state === 'ready' ? publicationResource.value : undefined;
  const plan = cell ? index.agent === 'director' && resource?.cells.state === 'ready' ? directorNativePlan(index, resource.cells.cells, cell.id) : { ...agentSpecimenPlan(index, cell, publication), ...(index.contentScope ? { scope: index.contentScope } : {}) } : { cellId: selectedId ?? '', items: [], expectedVariantIds: [], issues: [resource?.cells.state === 'error' ? resource.cells.message : 'The specimen source has not loaded.'] };
  const binding = cell ? resolve?.({ index, cell, plan, publication, expanded }) : undefined;
  // Cardinality evidence is measured from the props actually passed to the bound leaf.
  const evidence = binding ? { ...binding.evidence, registered: binding.evidence.registered && !!binding.Component, items: binding.props.items } : undefined;
  return { binding, coverage: agentSpecimenCoverage(binding?.sourcePlan ?? plan, evidence) };
}

export function useAgentSpecimenCoverage(index: AgentCells, cell: CellSummary): AgentSpecimenCoverage {
  return useBoundSpecimen(index, cell.id, false).coverage;
}
function BoundAgentSpecimen({ index, selectedId, expanded = false }: { index: AgentCells; selectedId?: string; expanded?: boolean }) {
  const { EmptyState } = useStudioUI();
  const { binding, coverage } = useBoundSpecimen(index, selectedId, expanded);
  if (!binding?.Component || !coverage.ready) return <EmptyState role="status" title="NEED: registered specimen" description={coverage.issues.join(' ')} />;
  const Leaf = binding.Component;
  return <Leaf {...binding.props} />;
}
/** Exactly one selected registered leaf owns the complete items array and its layout. */
export function AgentL3Specimen(props: { index: AgentCells; selectedId?: string; expanded?: boolean }) {
  const resource = useRoleSpecimenResource(props.index);
  return resource ? <BoundAgentSpecimen {...props} /> : <RoleToolsProvider index={props.index} selectedId={props.selectedId}><BoundAgentSpecimen {...props} /></RoleToolsProvider>;
}
