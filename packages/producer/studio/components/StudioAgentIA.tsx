'use client';

import { Fragment, useCallback, useEffect, useState, type ComponentType } from 'react';
import type { RecordCardsProps, SectionHeaderProps } from '@clossys/designer/blocks';
import * as StudioMap from '../generated/studio-map';
import type { AgentCells, CellSummary } from '../lib/cells-client';
import { projectStudioAgentIA, studioIAAnchor, studioIAHref } from '../lib/studio-agent-ia';
import { studioIABands, studioSelectedSurface, studioUsedByCount } from '../lib/studio-ia-body';
import { checkStudioSpecimenCoverage, type StudioCoverageEvidence, type StudioCoverageResult } from '../lib/studio-specimen-coverage';
import { cellContentTarget } from '../lib/cell-content';
import { useAgentSpecimenCoverage } from './AgentL3Specimen';
import { useStudioSelection, useStudioUI } from './StudioSelection';

function usedByLabel(indexes: readonly AgentCells[], agent: string, cell: CellSummary) { const usage = studioUsedByCount(indexes, agent, cell); return usage.complete ? `used by ${usage.count}` : `used by at least ${usage.count} (inventory incomplete)`; }
const BODY_NEED = 'NEED: sections.cards full specimen-body, selection and declared-span ports';
function CellEvidence({ index, cell, report }: { index: AgentCells; cell: CellSummary; report: (evidence: StudioCoverageEvidence) => void }) {
  const evidence = useAgentSpecimenCoverage(index, cell);
  const signature = JSON.stringify(evidence);
  useEffect(() => {
    // A registered specimen model alone cannot pass when this card cannot render its body.
    report({ ...evidence, ready: false, variants: evidence.variants.map(variant => ({ ...variant, renderable: false, reason: BODY_NEED })), issues: [...evidence.issues, BODY_NEED] });
  }, [signature, report]);
  return null;
}

/** One authored vertical IA. The selected Cards section owns every grid and placeholder card. */
export function StudioAgentIA({ index, indexes, selectedId, onSelect, onCoverage }: {
  index: AgentCells; indexes: readonly AgentCells[]; selectedId?: string; onSelect: (id: string) => void; onCoverage?: (coverage: StudioCoverageResult) => void;
}) {
  const { selection, runtime } = useStudioSelection();
  const { EmptyState, Link, Icon } = useStudioUI();
  const ia = projectStudioAgentIA(index);
  const body = studioIABands(StudioMap, index.agent);
  const [evidence, setEvidence] = useState<{ index: AgentCells; rows: Record<string, StudioCoverageEvidence> }>({ index, rows: {} });
  const report = useCallback((value: StudioCoverageEvidence) => setEvidence(current => current.index === index && JSON.stringify(current.rows[value.cellId]) === JSON.stringify(value) ? current : { index, rows: { ...(current.index === index ? current.rows : {}), [value.cellId]: value } }), [index]);
  const measured = checkStudioSpecimenCoverage(index, Object.values(evidence.index === index ? evidence.rows : {}));
  const coverageSignature = JSON.stringify(measured);
  useEffect(() => onCoverage?.(measured), [coverageSignature, onCoverage]);
  if (ia.state !== 'ready') return <EmptyState title="Authored cell hierarchy unavailable" description={ia.error ?? 'NEED: the agent tree must supply its L1 and L2 groups.'} />;
  if (!body.bands) return <EmptyState title={body.need} description="The native Publisher body projection must be present in this composition." />;
  const Header = studioSelectedSurface(body.bands.L0, selection.leaves, runtime.surfaces) as ComponentType<SectionHeaderProps> | undefined;
  const Subheader = studioSelectedSurface(body.bands.L1, selection.leaves, runtime.surfaces) as ComponentType<SectionHeaderProps> | undefined;
  const Cards = studioSelectedSurface(body.bands.L2, selection.leaves, runtime.surfaces) as ComponentType<RecordCardsProps> | undefined;
  if (!Header || !Subheader) return <EmptyState title="NEED: selected IA heading bands" />;
  return <>
    <Header id={studioIAAnchor(ia.id)} data-studio-ia-node={ia.id} title={ia.label} level={2} />
    {ia.groups.length ? ia.groups.map(group => <Fragment key={group.id}>
      <Subheader id={studioIAAnchor(group.id)} data-studio-ia-node={group.id} title={group.label} level={3} />
      {group.collections.length ? group.collections.map(collection => <Fragment key={collection.id}>
        <EmptyState title={collection.label} description={Cards ? BODY_NEED : `NEED: selected ${body.bands!.L2}`} />
        {collection.cells.map(cell => <CellEvidence key={`${cell.id}@${cell.version}`} index={index} cell={cell} report={report} />)}
        {!collection.cells.length ? <EmptyState title={collection.label} description="This authored collection has no cells." /> : Cards ? <Cards
          id={studioIAAnchor(collection.id)} data-studio-ia-node={collection.id} aria-label={collection.label} layout="grid"
          records={collection.cells.map(cell => ({
            id: cell.id,
            title: <><Link id={studioIAAnchor(cell.id)} data-studio-ia-node={cell.id} href={studioIAHref(cell.id)} buttonVariant={selectedId === cell.id ? 'secondary' : 'ghost'} onPress={() => onSelect(cell.id)} aria-current={selectedId === cell.id ? 'true' : undefined}>{cell.title}</Link><Link {...cellContentTarget(index.agent, cell.id, { version: cell.version })} buttonVariant="ghost" aria-label={`Open ${cell.title} content`}><Icon asset="assets.icon-external-link" decorative /></Link></>,
            ...(cell.status ? { badge: { label: cell.status, variant: cell.status === 'draft' ? 'warning' : cell.status === 'active' ? 'success' : 'neutral' } } : {}),
            meta: `${cell.version === undefined ? 'Version unavailable' : `v${cell.version}`} · ${usedByLabel(indexes, index.agent, cell)}`,
            description: BODY_NEED,
          }))}
        /> : null}
      </Fragment>) : <EmptyState title={group.label} description="This authored group has no collections." />}
    </Fragment>) : <EmptyState title={ia.label} description="The agent tree has no groups." />}
  </>;
}
