'use client';

import { useEffect } from 'react';
import type { AgentCells, CellDetail } from '../lib/cells-client';
import { directorDocument, directorSections, directorVersions, evidenceHref, evidenceReferences, specimenTitle, type DirectorChapter } from '../lib/director-specimen';
import { useSpecimenCells } from '../lib/director-specimen-resource';
import { Badge, ContentSection, DetailView, EmptyState, Link, SectionHeader } from './director-specimen-ds';
import { RichTextSpecimen } from './RichTextSpecimen';

export const directorPassageId = (id: string, version?: number) => `director-passage-${id}-v${version ?? 'latest'}`;

function Passage({ cell, selected, level }: { cell: CellDetail; selected: boolean; level: 2 | 3 | 4 | 5 | 6 }) {
  const sections = directorSections(cell.content);
  const refs = evidenceReferences(cell);
  const fields = [
    ...(cell.status ? [{ label: 'Status', value: <Badge variant={cell.status === 'active' ? 'success' : 'warning'}>{cell.status}</Badge> }] : []),
    ...(cell.version !== undefined ? [{ label: 'Version', value: <Badge>v{cell.version}</Badge> }] : []),
    ...(typeof cell.fields?.confidence === 'string' || typeof cell.fields?.confidence === 'number' ? [{ label: 'Confidence', value: <Badge>{String(cell.fields.confidence)}</Badge> }] : []),
    ...(refs.length ? [{ label: 'Evidence', value: refs.map((ref, i) => <ContentSection key={`${ref}-${i}`}>
      {evidenceHref(ref) ? <Link href={evidenceHref(ref)}>{ref}</Link> : <Badge>{ref}</Badge>}
    </ContentSection>) }] : []),
  ];
  return <ContentSection id={directorPassageId(cell.id, cell.version)} aria-current={selected ? 'location' : undefined} data-specimen-cell={cell.id} data-specimen-status={cell.status} data-specimen-version={cell.version}
    ground={cell.status === 'draft' ? 'sunken' : 'base'} className={[cell.status === 'draft' ? 'bg-surface-sunken' : '', selected ? 'outline outline-solid' : ''].filter(Boolean).join(' ')} style={selected ? { outlineColor: 'var(--color-focus-ring)', outlineOffset: 'var(--ui-focus-offset)' } : undefined}>
    <SectionHeader title={specimenTitle(cell)} level={level} description={cell.status === 'draft' ? 'Draft passage' : undefined} />
    <ContentSection layout="split-end" media={<DetailView aria-label="Passage metadata" fields={fields} />}>
      <ContentSection>{sections.length ? sections.map(section => <ContentSection key={section.title}>
        <SectionHeader title={section.title} level={Math.min(level + 1, 6) as 2 | 3 | 4 | 5 | 6} />
        <RichTextSpecimen value={section.value} readOnly />
      </ContentSection>) : <EmptyState title="Strategy passage unavailable" description="This cell has no canonical Direction, Because, or Watch content." />}</ContentSection>
    </ContentSection>
  </ContentSection>;
}

function Chapter({ chapter, cells, selectedId }: { chapter: DirectorChapter; cells: CellDetail[]; selectedId?: string }) {
  const level = Math.min(chapter.depth + 2, 6) as 2 | 3 | 4 | 5 | 6;
  const versions = directorVersions(cells, chapter.id);
  const latest = versions.at(-1);
  return <ContentSection>
    {chapter.cell ? versions.length ? versions.map(cell => <Passage key={`${cell.id}@${cell.version}`} cell={cell} selected={selectedId === cell.id && cell.version === latest?.version} level={level} />) : <EmptyState title="Strategy passage unavailable" description={chapter.title} /> : <SectionHeader title={chapter.title} level={level} density={chapter.depth === 0 ? 'standard' : 'compact'} />}
    {chapter.children.map(child => <Chapter key={child.id} chapter={child} cells={cells} selectedId={selectedId} />)}
  </ContentSection>;
}

export function DirectorSpecimen({ index, selectedId }: { index: AgentCells; selectedId?: string }) {
  const resource = useSpecimenCells(index);
  useEffect(() => {
    if (resource.state === 'ready' && selectedId) {
      const latest = directorVersions(resource.cells, selectedId).at(-1);
      if (latest) document.getElementById(directorPassageId(selectedId, latest.version))?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  }, [selectedId, resource]);
  let chapters: DirectorChapter[];
  try { chapters = directorDocument(index); } catch { return <EmptyState role="alert" title="Strategy outline unavailable" description="The supplied tree cannot be projected into a strategy document." />; }
  if (index.state !== 'ready') return <EmptyState title="Strategy unavailable" description={index.error ?? 'Director cells are not initialized.'} />;
  if (!chapters.length) return <EmptyState title="No strategy passages" description="Active or draft Director cells will appear here in outline order." />;
  if (resource.state === 'loading') return <EmptyState role="status" title="Loading strategy document…" />;
  if (resource.state === 'error') return <EmptyState role="alert" title="Strategy unavailable" description={resource.message} />;
  const cells = resource.cells;
  return <ContentSection aria-label="Director strategy specimen">{chapters.map(chapter => <Chapter key={chapter.id} chapter={chapter} cells={cells} selectedId={selectedId} />)}</ContentSection>;
}
