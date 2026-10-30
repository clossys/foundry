'use client';

import type { AgentCells } from '../lib/cells-client';
import type { WriterCopy } from '../lib/writer-specimen';
import { Badge, Button, ContentSection, DetailView, EmptyState, NavigationTree, NavigationTreeItem, NavigationTreeItemContent, SectionHeader } from './director-specimen-ds';
import { RichTextSpecimen } from './RichTextSpecimen';
import { RoleToolsProvider, useWriterRoleTools } from './RoleToolsProvider';

function CopySpecimen({ copy }: { copy: WriterCopy }) {
  if (!copy.text?.trim()) return <EmptyState title="Copy value unavailable" description={`${copy.context}: this record has no produced text.`} />;
  switch (copy.role) {
    case 'headline': return <SectionHeader title={copy.text} level={3} />;
    case 'body': return <RichTextSpecimen value={copy.text} readOnly />;
    case 'cta': return <Button>{copy.text}</Button>;
    case 'nav': return <NavigationTree aria-label="Navigation label specimen"><NavigationTreeItem id={copy.id} textValue={copy.text}><NavigationTreeItemContent>{copy.text}</NavigationTreeItemContent></NavigationTreeItem></NavigationTree>;
    case 'error': return <EmptyState title={copy.text} role="alert" />;
    case 'empty': return <EmptyState title={copy.text} />;
    default: return <EmptyState title="NEED: Writer context role" description={`No specimen mapping is available for ${copy.context} (${String(copy.record.leaf ?? 'unassigned leaf')}).`} />;
  }
}

function WriterCopyStage() {
  const role = useWriterRoleTools();
  if (!role) return null;
  const { resource, cell, projection } = role;
  if (resource.state === 'loading') return <EmptyState role="status" title="Loading Writer specimens…" />;
  if (resource.state === 'error') return <EmptyState role="alert" title="Writer specimens unavailable" description={resource.message} />;
  if (!cell || !projection) return <EmptyState title="Writer cell unavailable" description="The selected cell has no active or draft specimen." />;
  const contexts = [...new Set(projection.records.map(record => record.context))];
  return <ContentSection lang={role.selectedLocale} dir={role.selectedDirection} aria-label="Writer copy specimen">
        {contexts.length ? contexts.map(context => <ContentSection key={context}>
          <SectionHeader title={context} level={3} />
          <DetailView aria-label={context} fields={role.comparisonLocales.map(locale => ({
            label: <Badge>{locale.id}</Badge>,
            value: <ContentSection lang={locale.id} dir={locale.id === role.selectedLocale ? role.selectedDirection : locale.direction}>
              {projection.records.filter(record => record.context === context && record.locale === locale.id).map(copy => <CopySpecimen key={copy.id} copy={copy} />)}
              {!projection.records.some(record => record.context === context && record.locale === locale.id) ? <EmptyState title="Locale copy missing" description={`No produced ${locale.id} copy for this context.`} /> : null}
            </ContentSection>,
          }))} />
        </ContentSection>) : <EmptyState title="No produced copy" description="This cell has no supported Writer copy records." />}
  </ContentSection>;
}

export function WriterSpecimen({ index, selectedId }: { index: AgentCells; selectedId?: string }) {
  const role = useWriterRoleTools();
  return role ? <WriterCopyStage /> : <RoleToolsProvider index={index} selectedId={selectedId}><WriterCopyStage /></RoleToolsProvider>;
}
