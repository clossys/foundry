'use client';

import { Fragment, useCallback, useEffect, useState, type ComponentType, type ReactNode } from 'react';
import * as DesignerStudio from '@clossys/designer/studio';
import type { SectionHeaderProps } from '@clossys/designer/blocks';
import * as StudioMap from '../generated/studio-map';
import type { AgentCells, CellSummary } from '../lib/cells-client';
import type { AgentSpecimenCoverage, SpecimenCardSpan } from '../lib/agent-specimen-coverage';
import { projectStudioAgentIA, studioIAAnchor, studioIAHref } from '../lib/studio-agent-ia';
import { studioIABands, studioSelectedSurface, studioUsedByCount } from '../lib/studio-ia-body';
import { checkStudioSpecimenCoverage, type StudioCoverageEvidence, type StudioCoverageResult } from '../lib/studio-specimen-coverage';
import { cellContentTarget } from '../lib/cell-content';
import { AgentL3Specimen, useAgentSpecimenCoverage } from './AgentL3Specimen';
import { ContentSection } from './director-specimen-ds';
import { useStudioSelection, useStudioUI } from './StudioSelection';

type DomEvidence = { issues: readonly string[]; cases: readonly { item: string; section: string; issues: readonly string[] }[] };
type DomCollector = (input: { cell: { agent: 'director'; id: string; kind: 'passage'; items: unknown[] }; root: Element; surface: 'row' }) => DomEvidence;
interface DirectorCard { id: string; title: ReactNode; body: ReactNode; span?: SpecimenCardSpan; badge?: { label: string; variant: 'success' | 'warning' | 'neutral' }; meta: ReactNode }
interface DirectorCardsProps { records: readonly DirectorCard[]; layout: 'grid'; headingLevel: 4; selectedId?: string; onSelect(id: string): void; 'aria-label': string; id: string }

/** Registration is a prerequisite; only the mounted native leaf can establish rendered coverage. */
export function directorMountedCoverage(model: AgentSpecimenCoverage, evidence?: DomEvidence): StudioCoverageEvidence {
  const issues = [...model.issues, ...(evidence?.issues ?? [])];
  if (!evidence) issues.push('The registered Director specimen has no mounted native DOM evidence.');
  if (evidence?.cases.some(item => !model.expectedVariantIds.includes(item.item) || item.section !== model.boundSectionId)) issues.push('The mounted Director specimen contains an unexpected passage or section.');
  const variants = model.variants.map(variant => {
    const cases = evidence?.cases.filter(item => item.item === variant.id && item.section === model.boundSectionId) ?? [];
    const renderable = variant.renderable && cases.length === 1 && cases[0]!.issues.length === 0;
    return { ...variant, renderable, ...(!renderable ? { reason: 'The complete native Director passage has not rendered exactly once.' } : {}) };
  });
  if (variants.some(variant => !variant.renderable)) issues.push('One or more Director passages lack complete mounted native evidence.');
  return { ...model, ready: model.ready && issues.length === 0 && variants.length > 0, variants, issues };
}

function DirectorPassage({ index, cell, model, report }: { index: AgentCells; cell: CellSummary; model: AgentSpecimenCoverage; report(value: StudioCoverageEvidence): void }) {
  const scopeId = `director-specimen-${cell.id}`;
  const signature = JSON.stringify(model);
  useEffect(() => {
    const root = document.getElementById(scopeId);
    const collect = (DesignerStudio as unknown as Record<string, unknown>).collectSpecimenDomEvidence;
    let frame = 0;
    const measure = () => {
      const evidence = root && typeof collect === 'function' ? (collect as DomCollector)({ cell: { agent: 'director', id: cell.id, kind: 'passage', items: [] }, root, surface: 'row' }) : undefined;
      report(directorMountedCoverage(model, evidence));
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    measure();
    const observer = new MutationObserver(schedule);
    if (root) observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true });
    window.addEventListener('resize', schedule);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); window.removeEventListener('resize', schedule); };
  }, [scopeId, cell.id, signature, report]);
  return <ContentSection id={scopeId} data-director-specimen-cell={cell.id}><AgentL3Specimen index={index} selectedId={cell.id} expanded /></ContentSection>;
}

function DirectorCollection(props: { index: AgentCells; indexes: readonly AgentCells[]; cells: readonly (CellSummary & { span?: SpecimenCardSpan })[]; id: string; label: string; selectedId?: string; onSelect(id: string): void; report(value: StudioCoverageEvidence): void; Cards: ComponentType<DirectorCardsProps>; Subheader: ComponentType<SectionHeaderProps> }) {
  const { index, indexes, cells, id, label, selectedId, onSelect, report, Cards, Subheader } = props;
  const { Link, Icon } = useStudioUI();
  return <><Subheader id={studioIAAnchor(id)} data-studio-ia-node={id} title={label} level={4} /><Cards id={`${studioIAAnchor(id)}-cards`} aria-label={label} layout="grid" headingLevel={4} selectedId={selectedId} onSelect={onSelect} records={cells.map(cell => ({
    id: cell.id,
    title: <><Link id={studioIAAnchor(cell.id)} data-studio-ia-node={cell.id} href={studioIAHref(cell.id)} buttonVariant={selectedId === cell.id ? 'secondary' : 'ghost'} onPress={() => onSelect(cell.id)} aria-current={selectedId === cell.id ? 'true' : undefined}>{cell.title}</Link><Link {...cellContentTarget('director', cell.id)} buttonVariant="ghost" aria-label={`Open ${cell.title} content`}><Icon asset="assets.icon-external-link" decorative /></Link></>,
    body: <DirectorRow index={index} cell={cell} report={report} />,
    // The row component reports the native span; no page-level width inference is permitted.
    ...(cell.span ? { span: cell.span } : {}),
    ...(cell.status ? { badge: { label: cell.status, variant: cell.status === 'active' ? 'success' as const : cell.status === 'draft' ? 'warning' as const : 'neutral' as const } } : {}),
    meta: `${cell.version === undefined ? 'Version unavailable' : `v${cell.version}`} · ${(() => { const usage = studioUsedByCount(indexes, 'director', cell); return usage.complete ? `used by ${usage.count}` : `used by at least ${usage.count} (inventory incomplete)`; })()}`,
  }))} /></>;
}
function DirectorRow({ index, cell, report }: { index: AgentCells; cell: CellSummary; report(value: StudioCoverageEvidence): void }) {
  const bound = useAgentSpecimenCoverage(index, cell);
  let model = bound;
  try {
    const project = (StudioMap as unknown as Record<string, unknown>).studioPageBody;
    if (typeof project !== 'function' || !bound.boundSectionId) throw new Error('The native Director page body cannot bind this specimen.');
    const body = project('director', bound.boundSectionId);
    if (body.row?.specimen !== bound.boundSectionId) throw new Error('The native Director page body disagrees with the selected specimen.');
  } catch (error) {
    model = { ...bound, ready: false, issues: [...bound.issues, error instanceof Error ? error.message : 'The native Director page body is unavailable.'] };
  }
  return <DirectorPassage {...{ index, cell, model, report }} />;
}

/** Director consumes the authored native Cards bands and binds one whole native specimen per L3. */
export function DirectorAgentIA({ index, indexes, selectedId, onSelect, onCoverage }: { index: AgentCells; indexes: readonly AgentCells[]; selectedId?: string; onSelect(id: string): void; onCoverage?(coverage: StudioCoverageResult): void }) {
  const { selection, runtime } = useStudioSelection();
  const { EmptyState } = useStudioUI();
  const ia = projectStudioAgentIA(index);
  const body = studioIABands(StudioMap, 'director');
  const [evidence, setEvidence] = useState<{ index: AgentCells; rows: Record<string, StudioCoverageEvidence> }>({ index, rows: {} });
  const report = useCallback((value: StudioCoverageEvidence) => setEvidence(current => current.index === index && JSON.stringify(current.rows[value.cellId]) === JSON.stringify(value) ? current : { index, rows: { ...(current.index === index ? current.rows : {}), [value.cellId]: value } }), [index]);
  const measured = checkStudioSpecimenCoverage(index, Object.values(evidence.index === index ? evidence.rows : {}));
  const signature = JSON.stringify(measured);
  useEffect(() => onCoverage?.(measured), [signature, onCoverage]);
  if (ia.state !== 'ready') return <EmptyState title="Authored Director hierarchy unavailable" description={ia.error ?? 'The native tree must supply its groups and collections.'} />;
  if (!body.bands) return <EmptyState title={body.need} />;
  const Header = studioSelectedSurface(body.bands.L0, selection.leaves, runtime.surfaces) as ComponentType<SectionHeaderProps> | undefined;
  const Subheader = studioSelectedSurface(body.bands.L1, selection.leaves, runtime.surfaces) as ComponentType<SectionHeaderProps> | undefined;
  const Cards = studioSelectedSurface(body.bands.L2, selection.leaves, runtime.surfaces) as ComponentType<DirectorCardsProps> | undefined;
  if (!Header || !Subheader || !Cards) return <EmptyState title="NEED: selected Director IA bands" />;
  const rows = evidence.index === index ? evidence.rows : {};
  return <ContentSection data-director-coverage={measured.state}
    data-director-cells={`${measured.cells.covered}/${measured.cells.total}`}
    data-director-variants={`${measured.variants.covered}/${measured.variants.total}`}>
    <Header id={studioIAAnchor(ia.id)} data-studio-ia-node={ia.id} title={ia.label} level={2} />
    {ia.groups.map(group => <Fragment key={group.id}>
      <Subheader id={studioIAAnchor(group.id)} data-studio-ia-node={group.id} title={group.label} level={3} />
      {group.collections.map(collection => <DirectorCollection key={collection.id}
        index={index} indexes={indexes} id={collection.id} label={collection.label}
        cells={collection.cells.map(cell => ({ ...cell, ...(rows[cell.id]?.span ? { span: rows[cell.id]!.span } : {}) }))}
        selectedId={selectedId} onSelect={onSelect} report={report} Cards={Cards} Subheader={Subheader} />)}
    </Fragment>)}
  </ContentSection>;
}
