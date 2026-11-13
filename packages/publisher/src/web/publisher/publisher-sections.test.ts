import { expect, it } from 'vitest';
import { acceptedExampleStore } from './__fixtures__/example-plan.js';
import { PublisherPlanStore } from '../../planning/change-set.js';
import { syntheticPlan, syntheticRoute, SYNTHETIC_ROUTE_REGISTRIES } from '../../core/__fixtures__/registered-route.js';
import { projectRouteRegistry } from '../../core/route-registry.js';
import { instanceFixture } from '../../core/__fixtures__/instance-binding/fixtures.js';
import { projectPublisherChannels } from './publisher-channels.js';
import { projectPublisherSections, type PublisherSectionsInput, type PublisherSectionData } from './publisher-sections.js';
import { derivePackPipeline } from './pipeline.js';
import { productionSettingsFromBinding } from './production-settings.js';

const table = (sections: readonly PublisherSectionData[], id: string) => {
  const section = sections.find(section => section.id === id);
  if (section?.section !== 'sections.data-table') throw new Error(`Missing table ${id}`);
  return section;
};
async function registeredInput(): Promise<PublisherSectionsInput> {
  const route = syntheticRoute(), store = new PublisherPlanStore(SYNTHETIC_ROUTE_REGISTRIES);
  const plan = await store.apply(store.propose(syntheticPlan([route])), () => true);
  const projection = projectRouteRegistry({ version: 1, consumer: 'example', routes: [route] }, plan, SYNTHETIC_ROUTE_REGISTRIES);
  return { plan, channels: projectPublisherChannels(plan, {}, projection), activeChannelId: 'admin', selectedItemId: route.planItemId,
    configurations: {}, settings: {}, webItems: [], appItems: [], routes: [], registries: SYNTHETIC_ROUTE_REGISTRIES, versions: store.snapshot(), historyOpen: false, formatOpen: false, notices: [], commerceOnly: false };
}
it('projects registered identity, ownership, canonical navigation and pending evidence without legacy inventory', async () => {
  const input = await registeredInput(), row = input.channels[0]!.items[0]!, before = JSON.stringify(input);
  const sections = projectPublisherSections(input), detail = sections.find(section => section.id === 'P3')!;
  expect(detail.section).toBe('sections.record-detail');
  expect(detail.label).toBe('Tools · item details');
  expect(JSON.stringify(detail)).toContain(row.route!.registration.path);
  expect(JSON.stringify(detail)).toContain('pack.app');
  expect(JSON.stringify(detail)).toContain('Exact selected consumer runtime assembly pending');
  if (detail.section !== 'sections.record-detail') throw new Error('Missing detail');
  expect(detail.actions).toContainEqual({ kind: 'link', label: 'Open item', href: row.route!.registration.path });
  const form = sections.find(section => section.id === 'P4')!;
  if (form.section !== 'sections.form' || form.fields.kind !== 'production') throw new Error('Missing registered production binding');
  expect(form.itemId).toBe(row.item.id);
  expect(form.fields.initial).toEqual(productionSettingsFromBinding(row.route!.registration.composition.binding as never));
  expect(form.fields.configured).toBe(false);
  expect(form.fields.answerIds).toEqual(row.item.answerIds);
  expect(JSON.stringify(table(sections, 'P6'))).toContain('Exact selected consumer runtime assembly pending');
  expect(JSON.parse(JSON.stringify(sections))).toEqual(sections);
  expect(JSON.stringify(input)).toBe(before);
});
it('retains host navigation and refuses to borrow another registered route binding', async () => {
  const input = await registeredInput(), row = input.channels[0]!.items[0]!, fixture = instanceFixture();
  fixture.binding.instanceId = row.route!.registration.composition.binding.instanceId;
  const foreign = derivePackPipeline([fixture.binding], fixture.library, fixture.registries, undefined, { [fixture.binding.instanceId]: productionSettingsFromBinding(fixture.binding) }).items;
  const sections = projectPublisherSections({ ...input, webItems: foreign, itemHrefs: { [row.item.id]: '/host/exact-route' } });
  const detail = sections.find(section => section.id === 'P3')!;
  if (detail.section !== 'sections.record-detail') throw new Error('Missing detail');
  expect(detail.actions).toContainEqual({ kind: 'link', label: 'Open item', href: '/host/exact-route' });
  expect(JSON.stringify(table(sections, 'P7'))).toContain('tools.data');
  expect(JSON.stringify(table(sections, 'P7'))).not.toContain('copy.title');
  expect(JSON.stringify(table(sections, 'P6'))).not.toContain('LK11');
});
it('shows each actual slot/content reference and required missing content without promoting Ready', async () => {
  const fixture = instanceFixture(), store = await acceptedExampleStore();
  fixture.binding.instanceId = 'standard.home';
  fixture.binding.fills.body![0]!.content = {};
  const pipeline = derivePackPipeline([fixture.binding], fixture.library, fixture.registries, undefined, { [fixture.binding.instanceId]: productionSettingsFromBinding(fixture.binding) }).items;
  const sections = projectPublisherSections({ channels: projectPublisherChannels(store.current), activeChannelId: 'site',
    plan: store.current, selectedItemId: fixture.binding.instanceId, configurations: {}, settings: {}, webItems: pipeline, appItems: [], routes: [], registries: fixture.registries,
    versions: [], historyOpen: false, formatOpen: false, notices: [], commerceOnly: false });
  const assembly = table(sections, 'P7');
  expect(assembly.rows.find(row => row.id === 'binding/fills.lead.0.content.title')?.cells['depends-on']).toEqual({ kind: 'text', text: 'copy · copy.title' });
  const missing = assembly.rows.find(row => row.id === 'binding/fills.body.0.content.title')!;
  expect(missing.cells['depends-on']).toEqual({ kind: 'text', text: 'Needs input · content reference missing' });
  expect(missing.cells.stage).toEqual({ kind: 'text', text: 'failed' });
  expect(JSON.stringify(missing)).toContain('LK10');
  expect(JSON.stringify(table(sections, 'P6'))).toContain('LK12');
  expect(JSON.stringify(assembly)).not.toContain('"text":"ready"');
});
it('retains valid registered rows when another registration is invalid and never borrows its owner', async () => {
  const input = await registeredInput(), valid = input.channels[0]!.items[0]!.route!.registration;
  const invalid = { ...syntheticRoute('example.invalid'), channel: 'unknown' as never };
  const draft = syntheticPlan([valid, invalid]);
  const projection = projectRouteRegistry({ version: 1, consumer: 'example', routes: [valid, invalid] }, draft, SYNTHETIC_ROUTE_REGISTRIES);
  const channels = projectPublisherChannels(draft, { [invalid.routeId]: 'admin' }, projection);
  const sections = projectPublisherSections({ ...input, plan: draft, channels });
  expect(table(sections, 'P2').rows.map(row => row.id)).toEqual([valid.planItemId]);
  expect(JSON.stringify(sections)).not.toContain(invalid.path);
  expect(table(sections, 'P2').rows[0]!.cells.item).toEqual({ kind: 'action', label: valid.title, command: { kind: 'select-item', itemId: valid.planItemId } });
});
it('keeps nested App selection separate from its original plan owner and production command', async () => {
  const { appBindingFixture } = await import('./app/__fixtures__/binding.js');
  const { deriveAppPipeline } = await import('./app/pipeline.js');
  const { createAppExampleDraft } = await import('./__fixtures__/example-plan.js');
  const fixture = appBindingFixture(), store = new PublisherPlanStore(fixture.registries);
  const plan = await store.apply(store.propose(createAppExampleDraft(fixture.inventory)), () => true);
  const channels = projectPublisherChannels(plan), owner = channels.find(channel => channel.id === 'app')!.items.find(row => row.item.appRouteId === 'sample.record')!;
  const appItems = deriveAppPipeline({ ...fixture, registries: fixture.registries }).items;
  const input: PublisherSectionsInput = { plan, channels, activeChannelId: 'app', selectedItemId: `${owner.item.id}/route/sample.child`, configurations: {}, settings: fixture.settings, webItems: [], appItems, routes: fixture.inventory.routes, registries: fixture.registries,
    versions: [], historyOpen: false, formatOpen: false, notices: [], commerceOnly: false };
  const sections = projectPublisherSections({ ...input, itemHrefs: { [owner.item.id]: '/parent-only', [input.selectedItemId!]: '/host/details' } }), rows = table(sections, 'P2').rows;
  expect(rows.find(row => row.id === input.selectedItemId)?.cells.item).toEqual({ kind: 'action', label: 'Details', command: { kind: 'select-item', itemId: input.selectedItemId } });
  const detail = sections.find(section => section.id === 'P3')!;
  expect(detail.label).toBe('Details · item details');
  expect(JSON.stringify(detail)).toContain('panel=details');
  if (detail.section !== 'sections.record-detail') throw new Error('Missing selected child');
  expect(detail.fields.find(field => field.id === 'route')?.value).toBe('sample.child');
  expect(detail.actions).toContainEqual({ kind: 'link', label: 'Open item', href: '/host/details' });
  const canonical = projectPublisherSections(input).find(section => section.id === 'P3');
  expect(canonical?.section === 'sections.record-detail' && canonical.actions).toContainEqual({ kind: 'link', label: 'Open item', href: fixture.inventory.routes.find(route => route.id === 'sample.child')!.path });
  expect(JSON.stringify(detail)).toContain(owner.item.id);
  const form = sections.find(section => section.id === 'P4');
  expect(form?.section === 'sections.form' && form.itemId).toBe(owner.item.id);
});
it('projects registered canvas bindings without manufacturing a flow Layout or production clearance', async () => {
  const source = syntheticRoute(), { layout: _layout, ...binding } = source.composition.binding;
  const route = { ...source, composition: { ...source.composition, binding: { ...binding, body: { kind: 'canvas' as const, source: { kind: 'static' as const }, boards: [{ id: 'tools', section: { slot: 'body', index: 0 } }], arrangement: { kind: 'grid' as const, columns: 1, gap: { x: 0, y: 0 } }, collapseBelow: 'tokens.breakpoint.tablet' as const } } } };
  const registries = { ...SYNTHETIC_ROUTE_REGISTRIES, sections: SYNTHETIC_ROUTE_REGISTRIES.sections.map(section => ({ ...section, contract: { ...section.contract, substrates: ['flow', 'canvas'] as const, substrateTests: [{ substrate: 'flow' as const, file: 'SYNTHETIC.tsx', name: 'flow control' }, { substrate: 'canvas' as const, file: 'SYNTHETIC.tsx', name: 'canvas control' }] } })) };
  const store = new PublisherPlanStore(registries), plan = await store.apply(store.propose(syntheticPlan([route])), () => true);
  const projection = projectRouteRegistry({ version: 1, consumer: 'example', routes: [route] }, plan, registries);
  expect(projection.findings).toEqual([]);
  const input = await registeredInput();
  const sections = projectPublisherSections({ ...input, plan, registries, channels: projectPublisherChannels(plan, {}, projection) });
  const assembly = table(sections, 'P7');
  expect(JSON.stringify(assembly)).toContain('canvas');
  expect(JSON.stringify(assembly)).toContain('grid');
  expect(JSON.stringify(assembly)).not.toContain('layouts.stack');
  const form = sections.find(section => section.id === 'P4');
  expect(form?.section === 'sections.form' && form.fields.kind).toBe('planning');
  expect(JSON.stringify(table(sections, 'P6'))).toContain('pending');
});

it.each(['route', 'plan', 'binding', 'owner'])('refuses a directly supplied %s ownership mismatch without dropping a valid row', async mutation => {
  const input = await registeredInput(), valid = input.channels[0]!.items[0]!;
  const registration = structuredClone(valid.route!.registration);
  if (mutation === 'route') Object.assign(registration, { routeId: 'foreign.route' });
  if (mutation === 'plan') Object.assign(registration, { planItemId: 'foreign.item' });
  if (mutation === 'binding') Object.assign(registration.composition.binding, { path: '/foreign-binding' });
  const invalid = { ...valid, route: { ...valid.route!, registration, ...(mutation === 'owner' ? { owner: { packId: 'foreign.pack', milestone: 'M4', answerIds: [] } } : {}) } };
  const sections = projectPublisherSections({ ...input, channels: [{ ...input.channels[0]!, items: [valid, invalid] }] });
  expect(table(sections, 'P2').rows.map(row => row.id)).toEqual([valid.item.id]);
  expect(JSON.stringify(sections)).not.toContain('foreign.');
  expect(JSON.stringify(sections)).not.toContain('/foreign-binding');
  expect(JSON.stringify(sections.find(section => section.id === 'P0'))).toContain('ownership or composition is invalid');
});
