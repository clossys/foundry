'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useStudioSelection } from './StudioSelection';
import { useRoleToolPayloads } from './AgentSpecimenProvider';
import { StudioModulesProvider } from './StudioModuleHost';
import { studioModulePayloads, type StudioChecks, type StudioModulePayload, type StudioModulePayloads } from '../lib/studio-module-data';
import { loadStudioChecks } from '../lib/studio-module-client';
import type { Agent } from '../lib/agents';
import type { StudioCoverageResult } from '../lib/studio-specimen-coverage';
import type { AgentCells, CellDetail } from '../lib/cells-client';

/** Shared semantic data. Section components and the selected frame own all module UI. */
export function StudioCommonModules({ pageId, indexes, agent, selectedId, detail, revision, rolePayloads = {}, activeNodeId, onSelectNode, coverage, children }: {
  pageId: string; indexes: readonly AgentCells[]; agent?: Agent; selectedId?: string; detail?: CellDetail; revision: number; rolePayloads?: StudioModulePayloads; activeNodeId?: string; onSelectNode?: (id: string) => void; coverage?: StudioCoverageResult; children: ReactNode;
}) {
  const providedRoles = useRoleToolPayloads();
  const { selection } = useStudioSelection();
  const [checks, setChecks] = useState<StudioChecks>({ state: 'loading', results: [] });
  useEffect(() => {
    if (!agent) { setChecks({ state: 'ready', results: [] }); return; }
    const controller = new AbortController();
    setChecks({ state: 'loading', results: [] });
    loadStudioChecks(controller.signal, agent).then(setChecks, error => {
      if (!controller.signal.aborted) setChecks({ state: 'error', results: [], error: error instanceof Error ? error.message : String(error) });
    });
    return () => controller.abort();
  }, [agent, revision]);
  const common = studioModulePayloads({ indexes, agent, selectedId, detail, selection, checks });
  const payloads: Record<string, StudioModulePayload> = { ...common, 'sections.explorer': { ...common['sections.explorer'], selectedId: activeNodeId ?? selectedId, onSelect: onSelectNode }, 'sections.status-list': { ...common['sections.status-list'], ...(coverage ? { specimenCoverage: coverage } : {}) } };
  if (coverage?.state === 'fail') {
    const key = `${agent ?? 'home'}.open-requests`;
    payloads[key] = { ...common[key], coverageIssues: coverage.issues };
  }
  for (const [key, role] of Object.entries({ ...providedRoles, ...rolePayloads })) {
    const target = key === 'sections.record-detail' && agent ? `${agent}.inspector` : key;
    payloads[target] = { ...common[target], ...role };
  }
  return <StudioModulesProvider pageId={pageId} payloads={payloads}>{children}</StudioModulesProvider>;
}
