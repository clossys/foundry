'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import type { SemanticContentProps } from '@clossys/designer/components';
import type { AgentCells, CellDetail, CellSummary } from '../lib/cells-client';
import { directorNativePlan } from '../lib/director-native-inventory';
import { agentSpecimenPlan, type AgentSpecimenPlan } from '../lib/agent-specimen-data';
import { agentSpecimenCoverage, type AgentSpecimenCoverage, type ResolvedSpecimenEvidence } from '../lib/agent-specimen-coverage';
import { selectedPublicationId, type PublicationResponse } from '../lib/publisher-preview';
import { useStudioSelection, useStudioUI } from './StudioSelection';
import type { NativeDomEvidence, RegisteredRenderMeasurement } from '../lib/registered-specimen-coverage';
import { RoleToolsProvider, latestSpecimenCell, useRoleSpecimenResource } from './AgentSpecimenProvider';

export interface BoundSpecimenLeaf {
  measure?: (root: Element, surface: NativeDomEvidence['surface']) => RegisteredRenderMeasurement;
  sourcePlan?: AgentSpecimenPlan;
  evidence: ResolvedSpecimenEvidence;
  Component?: ComponentType<Record<string, unknown>>;
  props: Record<string, unknown> & { items: unknown[] };
}
export interface SpecimenLeafRequest { index: AgentCells; cell: CellDetail; plan: AgentSpecimenPlan; publication?: PublicationResponse; expanded: boolean }
/** The host supplies the actual publication binding and selected registered leaf adapter. */
export type ResolveSpecimenLeaf = (request: SpecimenLeafRequest) => BoundSpecimenLeaf | undefined;
const BindingContext = createContext<ResolveSpecimenLeaf | undefined>(undefined);
interface MountedMeasurement { index: AgentCells; cell: CellDetail; cellId: string; root: Element; resolve: ResolveSpecimenLeaf; value: RegisteredRenderMeasurement }
const MeasurementContext = createContext<{ rows: readonly MountedMeasurement[]; report?: (record: MountedMeasurement) => () => void }>({ rows: [] });
export function SpecimenLeafProvider({ resolve, children }: { resolve: ResolveSpecimenLeaf; children: ReactNode }) {
  const [rows, setRows] = useState<MountedMeasurement[]>([]);
  const report = useCallback((record: MountedMeasurement) => {
    setRows(current => [...current.filter(row => row.root !== record.root), record]);
    return () => setRows(current => current.filter(row => row !== record));
  }, []);
  return <BindingContext.Provider value={resolve}><MeasurementContext.Provider value={{ rows, report }}>{children}</MeasurementContext.Provider></BindingContext.Provider>;
}

function useBoundSpecimen(index: AgentCells, selectedId: string | undefined, expanded: boolean) {
  const resource = useRoleSpecimenResource(index);
  const resolve = useContext(BindingContext);
  const mounted = useContext(MeasurementContext);
  const cell = resource && selectedId ? latestSpecimenCell(resource.cells, index, selectedId) : undefined;
  const publicationId = selectedPublicationId(index, selectedId);
  const publicationResource = publicationId ? resource?.publications?.[publicationId] : resource?.publication;
  const publication = publicationResource?.state === 'ready' ? publicationResource.value : undefined;
  const plan = useMemo(() => cell ? index.agent === 'director' && resource?.cells.state === 'ready' ? directorNativePlan(index, resource.cells.cells, cell.id) : { ...agentSpecimenPlan(index, cell, publication), ...(index.contentScope ? { scope: index.contentScope } : {}) } : { cellId: selectedId ?? '', items: [], expectedVariantIds: [], issues: [resource?.cells.state === 'error' ? resource.cells.message : 'The specimen source has not loaded.'] }, [cell, index, resource?.cells, publication, selectedId]);
  const binding = useMemo(() => cell ? resolve?.({ index, cell, plan, publication, expanded }) : undefined, [cell, resolve, index, plan, publication, expanded]);
  // Cardinality evidence is measured from the props actually passed to the bound leaf.
  const evidence = binding ? { ...binding.evidence, registered: binding.evidence.registered && !!binding.Component, items: binding.props.items } : undefined;
  const measurements = mounted.rows.filter(row => row.index === index && row.cell === cell && row.cellId === selectedId && row.resolve === resolve);
  const rendered = measurements.length === 1 ? measurements[0]!.value : undefined;
  return { binding, cell, resolve, report: mounted.report, coverage: { ...agentSpecimenCoverage(binding?.sourcePlan ?? plan, evidence), ...(rendered ? { rendered } : {}) } };
}

export function useAgentSpecimenCoverage(index: AgentCells, cell: CellSummary): AgentSpecimenCoverage {
  return useBoundSpecimen(index, cell.id, false).coverage;
}
function BoundAgentSpecimen({ index, selectedId, expanded = false }: { index: AgentCells; selectedId?: string; expanded?: boolean }) {
  const { EmptyState } = useStudioUI();
  const { runtime } = useStudioSelection();
  const { binding, cell, coverage, resolve, report } = useBoundSpecimen(index, selectedId, expanded);
  const root = useRef<HTMLDivElement>(null);
  const Root = runtime.components.SemanticContent as ComponentType<SemanticContentProps<'div'>> | undefined;
  useEffect(() => {
    const element = root.current;
    if (!element || !binding?.measure || !cell || !resolve || !report || !selectedId || !coverage.ready) return;
    let dispose: (() => void) | undefined;
    let signature: string | undefined;
    const measure = () => {
      const value = binding.measure!(element, expanded ? 'linkout' : 'row');
      const next = JSON.stringify(value);
      if (signature === next) return;
      signature = next; dispose?.(); dispose = report({ index, cell, cellId: selectedId, root: element, resolve, value });
    };
    measure();
    const observer = new MutationObserver(measure);
    observer.observe(element, { subtree: true, childList: true, characterData: true, attributes: true });
    for (let parent = element.parentElement; parent; parent = parent.parentElement) observer.observe(parent, { attributes: true });
    element.addEventListener('load', measure, true);
    window.addEventListener('resize', measure);
    return () => { observer.disconnect(); element.removeEventListener('load', measure, true); window.removeEventListener('resize', measure); dispose?.(); };
  }, [binding, cell, resolve, report, index, selectedId, expanded, coverage.ready, Root]);
  if (!binding?.Component || !coverage.ready) return <EmptyState role="status" title="NEED: registered specimen" description={coverage.issues.join(' ')} />;
  const Leaf = binding.Component;
  // Measurement uses the selected native semantic host; it adds no card or layout implementation.
  return Root ? <Root as="div" ref={root}><Leaf {...binding.props} /></Root> : <Leaf {...binding.props} />;
}
/** Exactly one selected registered leaf owns the complete items array and its layout. */
export function AgentL3Specimen(props: { index: AgentCells; selectedId?: string; expanded?: boolean }) {
  const resource = useRoleSpecimenResource(props.index);
  return resource ? <BoundAgentSpecimen {...props} /> : <RoleToolsProvider index={props.index} selectedId={props.selectedId}><BoundAgentSpecimen {...props} /></RoleToolsProvider>;
}
