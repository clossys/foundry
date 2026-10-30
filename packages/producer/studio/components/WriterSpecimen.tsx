'use client';

import type { AgentCells } from '../lib/cells-client';
import { specimenTitle } from '../lib/director-specimen';
import { useSpecimenCells } from '../lib/director-specimen-resource';
import { localeDirection, writerProjection, type WriterCopy } from '../lib/writer-specimen';
import { Badge, Button, ContentSection, DetailView, EmptyState, NavigationTree, NavigationTreeItem, NavigationTreeItemContent, SectionHeader, SpecimenSelectionNeeds } from './director-specimen-ds';
import { RichTextSpecimen } from './RichTextSpecimen';

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

export function WriterSpecimen({ index, selectedId }: { index: AgentCells; selectedId?: string }) {
  const resource = useSpecimenCells(index);
  if (index.state !== 'ready') return <EmptyState title="Writer specimens unavailable" description={index.error ?? 'Writer cells are not initialized.'} />;
  if (!selectedId) return <EmptyState title="Choose a Writer cell" description="Select copy from the outline to see it in context." />;
  if (resource.state === 'loading') return <EmptyState role="status" title="Loading Writer specimens…" />;
  if (resource.state === 'error') return <EmptyState role="alert" title="Writer specimens unavailable" description={resource.message} />;
  const cell = resource.cells.find(cell => cell.id === selectedId);
  if (!cell) return <EmptyState title="Writer cell unavailable" description="The selected cell has no active or draft specimen." />;
  const projection = writerProjection(cell);
  const allVoice = resource.cells.map(writerProjection);
  const tone = [...new Set(allVoice.flatMap(item => item.tone))];
  const banned = [...new Set(allVoice.flatMap(item => item.banned))];
  const contexts = [...new Set(projection.records.map(record => record.context))];
  const specimens = <ContentSection>
        {contexts.length ? contexts.map(context => <ContentSection key={context}>
          <SectionHeader title={context} level={3} />
          <DetailView aria-label={`${context} locales`} fields={projection.locales.map(locale => ({
            label: <Badge>{locale}</Badge>,
            value: <ContentSection lang={locale} dir={localeDirection(locale)}>
              {projection.records.filter(record => record.context === context && record.locale === locale).map(copy => <CopySpecimen key={copy.id} copy={copy} />)}
              {!projection.records.some(record => record.context === context && record.locale === locale) ? <EmptyState title="Locale copy missing" description={`No produced ${locale} copy for this context.`} /> : null}
            </ContentSection>,
          }))} />
        </ContentSection>) : <EmptyState title="No produced copy" description="This cell has no supported Writer copy records." />}
        {projection.gaps.map(gap => <EmptyState key={gap} title="Writer data gap" description={gap} />)}
      </ContentSection>;
  const voice = <ContentSection>
    <SectionHeader title="Voice rules" level={3} />
    <DetailView aria-label="Voice rule card" fields={[
      ...(tone.length ? [{ label: 'Tone', value: tone.join(', ') }] : []),
      ...(banned.length ? [{ label: 'Banned words', value: banned.join(', ') }] : []),
    ]} />
  </ContentSection>;
  return <ContentSection aria-label="Writer copy specimen">
    <SpecimenSelectionNeeds />
    <SectionHeader title={specimenTitle(cell)} stats={<>{cell.status ? <Badge variant={cell.status === 'active' ? 'success' : 'warning'}>{cell.status}</Badge> : null}{cell.version !== undefined ? <Badge>v{cell.version}</Badge> : null}</>} />
    {tone.length || banned.length ? <ContentSection layout="split-start" media={specimens}>{voice}</ContentSection> : <>
      {specimens}
      <EmptyState title="Voice rules unavailable" description="No tone or banned-word rules were found in the available Writer cells." />
    </>}
  </ContentSection>;
}
