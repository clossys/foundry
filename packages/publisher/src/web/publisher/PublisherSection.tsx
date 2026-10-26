'use client';
import { useState } from 'react';
import { Banner, Button, Card, Link, Select } from '@clossys/designer/components';
import { DataTable, DetailView, EmptyState, Form, SectionHeader, Toolbar } from '@clossys/designer/blocks';
import type { InstanceRegistries } from '../../core/instance-binding.js';
import type { PublisherConfiguration } from '../../planning/configuration.js';
import type { PublisherCell, PublisherSectionCommand, PublisherSectionData } from './publisher-sections.js';
import { DeliverySettingsFields, InputQuestions, ProductionSettingsFields, useProductionDraft, type ProductionSettingsFormMessages } from './ProductionSettingsForm.js';
export interface PublisherSectionProps {
  readonly data: PublisherSectionData;
  readonly registries: InstanceRegistries;
  readonly onCommand: (command: PublisherSectionCommand) => void;
  readonly productionMessages?: Partial<ProductionSettingsFormMessages>;
  readonly deploymentSurfaceIds?: readonly string[];
}
/** Closed Section adapters: controllers keep the sole plan, history, settings and source bindings. */
export function PublisherSection(props: PublisherSectionProps) {
  const { data, onCommand } = props;
  const cell = (value: PublisherCell) => value.kind === 'text' ? value.text : value.kind === 'link' ? <Link href={value.href}>{value.label}</Link> : <Button onPress={() => onCommand(value.command)}>{value.label}</Button>;
  if (data.section === 'sections.form') return <PublisherFormSection {...props} data={data} />;
  if (data.section === 'sections.empty-state' || data.section === 'sections.error-state') return <section aria-label={data.label} data-publisher-section={data.id}><div role={data.section === 'sections.error-state' ? 'alert' : undefined}><EmptyState title={data.label} description={data.message} /></div></section>;
  if (data.section === 'sections.notices') return <section aria-label={data.label} data-publisher-section={data.id}>{data.notices.map(notice => <Banner key={notice.id} variant={notice.tone}>{notice.message}</Banner>)}</section>;
  if (data.section === 'sections.record-detail') {
    if (data.actions.length > 2) throw new TypeError('Record detail actions exceed the existing Section bound');
    return <section aria-label={data.label} data-publisher-section={data.id}><Card><DetailView title={data.label} fields={data.fields.map(field => ({ label: field.label, value: field.value }))} actions={<>{data.actions.map((value,index) => <span key={index}>{cell(value)}</span>)}</>} /></Card></section>;
  }
  if (data.section !== 'sections.data-table') throw new TypeError('Unsupported Publisher Section');
  const table = (rows: typeof data.rows, label: string) => <DataTable aria-label={label} columns={data.columns.map((column,index) => ({ id: column.id, header: column.label, isRowHeader: index === 0, cell: (row: typeof data.rows[number]) => cell(row.cells[column.id] ?? { kind: 'text', text: '—' }) }))} rows={rows} rowKey={row => row.id}
    selectionMode={data.selectedId === undefined ? 'none' : 'single'} selectedKeys={data.selectedId ? [data.selectedId] : []} onSelectionChange={keys => {
      if (keys === 'all') return;
      const row = rows.find(row => keys.has(row.id)), action = row && Object.values(row.cells).find(value => value.kind === 'action');
      if (action?.kind === 'action') onCommand(action.command);
    }} />;
  const groups = data.grouping ? [...new Set(data.rows.map(row => { const value = row.cells[data.grouping!]; return value?.kind === 'text' ? value.text : ''; }))] : undefined;
  return <section aria-label={data.label} data-publisher-section={data.id}>
    <SectionHeader title={data.label} />
    {data.toolbar?.length ? <Toolbar aria-label={data.label} leading={<>{data.toolbar.map((value,index) => <span key={index}>{cell(value)}</span>)}</>} /> : null}
    {groups?.length ? groups.map(group => <div key={group} role="group" aria-label={`${data.grouping}: ${group}`}><SectionHeader level={3} title={group} />{table(data.rows.filter(row => { const value = row.cells[data.grouping!]; return value?.kind === 'text' && value.text === group; }), `${data.label} · ${group}`)}</div>) : table(data.rows, data.label)}
  </section>;
}
function PublisherFormSection(props: PublisherSectionProps & { data: Extract<PublisherSectionData, { section: 'sections.form' }> }) {
  return props.data.fields.kind === 'production' ? <ProductionSectionForm key={`${props.data.itemId}-${JSON.stringify(props.data.fields.initial)}`} {...props} fields={props.data.fields} /> : <PlanningSectionForm key={props.data.itemId} {...props} fields={props.data.fields} />;
}
function ProductionSectionForm({ data, fields, registries, onCommand, productionMessages, deploymentSurfaceIds }: PublisherSectionProps & { data: Extract<PublisherSectionData, { section: 'sections.form' }>; fields: Extract<Extract<PublisherSectionData, { section: 'sections.form' }>['fields'], { kind: 'production' }> }) {
  const state = useProductionDraft(fields.initial, undefined, () => onCommand({ kind: 'reset-configuration', itemId: data.itemId }));
  return <section aria-label={data.label} data-publisher-section={data.id}><Form aria-label={productionMessages?.label ?? 'Production settings'} onSubmit={event => { event.preventDefault(); onCommand({ kind: 'configure', itemId: data.itemId, settings: state.draft }); }}>
    <ProductionSettingsFields draft={state.draft} setDraft={state.setDraft} configured={fields.configured} registries={registries} onReset={state.reset} recommendationAnswerIds={fields.answerIds} formatIds={['web.page.responsive']} messages={productionMessages} deploymentSurfaceIds={deploymentSurfaceIds} />
    <InputQuestions requests={data.requests} />
  </Form></section>;
}
function PlanningSectionForm({ data, fields, onCommand, productionMessages }: PublisherSectionProps & { data: Extract<PublisherSectionData, { section: 'sections.form' }>; fields: Extract<Extract<PublisherSectionData, { section: 'sections.form' }>['fields'], { kind: 'planning' }> }) {
  const [configuration, setConfiguration] = useState(fields.configuration);
  const format = fields.formats.find(format => configuration && 'format' in configuration && format.id === configuration.format);
  const update = (next: PublisherConfiguration) => { setConfiguration(next); onCommand({ kind: 'plan-configuration', itemId: data.itemId, configuration: next }); };
  return <section aria-label={data.label} data-publisher-section={data.id}><Form aria-label={data.label} onSubmit={event => event.preventDefault()}>
    <SectionHeader title={data.label} />
    <p>Planned configuration only · no renderer or adopted binding is supplied.</p>
    {configuration?.kind === 'concept-only' ? <><Select label="Output format" selectedKey={configuration.format} options={fields.formats.map(format => ({ id: format.id, label: format.label }))} onSelectionChange={key => { if (key) update({ kind: 'concept-only', format: String(key) as typeof configuration.format, deliveries: [] }); }} />
      <DeliverySettingsFields format={format} choices={configuration.deliveries} onChange={deliveries => update({ ...configuration, deliveries })} messages={productionMessages} />
    </> : null}
    <InputQuestions requests={data.requests} />
  </Form></section>;
}
