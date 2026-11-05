// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { useState } from 'react';
import userEvent from '@testing-library/user-event';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PublisherSection } from './PublisherSection.js';
import { projectPublisherSections, type PublisherSectionData, type PublisherSectionsInput } from './publisher-sections.js';
import { acceptedExampleStore, createDeliveryExampleDraft } from './__fixtures__/example-plan.js';
import { STANDARD_PACK_INSTANCES, STANDARD_PACK_REGISTRIES, createStandardPackLibrary } from './__fixtures__/standard-website.js';
import { projectPublisherChannels } from './publisher-channels.js';
import { derivePackPipeline } from './pipeline.js';
import { type ProductionSettings, productionSettingsFromBinding } from './production-settings.js';
afterEach(cleanup);
async function input(configured = false): Promise<PublisherSectionsInput> {
  const store = await acceptedExampleStore(), binding = STANDARD_PACK_INSTANCES[0]!;
  const settings = configured ? { [binding.instanceId]: productionSettingsFromBinding(binding) } : {};
  return { plan: store.current, channels: projectPublisherChannels(store.current), activeChannelId: 'site', selectedItemId: binding.instanceId, configurations: {}, settings,
    webItems: derivePackPipeline(STANDARD_PACK_INSTANCES, createStandardPackLibrary({}), STANDARD_PACK_REGISTRIES, undefined, settings).items, appItems: [], routes: [], registries: STANDARD_PACK_REGISTRIES,
    versions: store.snapshot(), historyOpen: true, formatOpen: true, notices: [{ id: 'history-error', message: 'History restore failed', tone: 'danger' }], commerceOnly: false };
}
const mount = (data: PublisherSectionData, onCommand = vi.fn()) => render(<PublisherSection data={data} registries={STANDARD_PACK_REGISTRIES} onCommand={onCommand} />);
it('renders typed Publisher notices in flow', () => { mount({ id: 'P0', section: 'sections.notices', label: 'Notices', notices: [{ id: 'restore', message: 'History restore failed', tone: 'danger' }] }); expect(screen.getByRole('alert')).toHaveTextContent('History restore failed'); });
it('renders typed Publisher data-table in flow', async () => { const data = projectPublisherSections(await input()).find(item => item.id === 'P2')!; const command = vi.fn(); mount(data, command); fireEvent.click(screen.getByRole('button', { name: 'Home' })); expect(command).toHaveBeenCalledWith({ kind: 'select-item', itemId: 'standard.home' }); expect(screen.getAllByRole('grid').some(grid => grid.textContent?.includes('standard.home'))).toBe(true); });
it('renders typed Publisher record-detail in flow', async () => { const data = projectPublisherSections(await input()).find(item => item.id === 'P3')!; const command = vi.fn(); mount(data, command); expect(screen.getByRole('region')).toHaveTextContent('example.first-impression'); fireEvent.click(screen.getByRole('button', { name: 'Close item details' })); expect(command).toHaveBeenCalledWith({ kind: 'close-item' }); });
it('renders typed Publisher form in flow', async () => { const data = projectPublisherSections(await input()).find(item => item.id === 'P4')!; const command = vi.fn(); const view = mount(data, command); expect(view.container.querySelectorAll('form')).toHaveLength(1); expect(screen.getByRole('form', { name: 'Production settings' })).toHaveTextContent('Recommended because of answers:'); expect(screen.getByRole('form', { name: 'Production settings' })).not.toHaveTextContent('example.first-impression'); fireEvent.click(screen.getByRole('button', { name: 'Apply configuration' })); expect(command).toHaveBeenCalledWith(expect.objectContaining({ kind: 'configure', itemId: 'standard.home', settings: expect.objectContaining({ format: 'web.page.responsive' }) })); fireEvent.click(screen.getByRole('button', { name: 'Reset configuration' })); expect(command).toHaveBeenCalledWith({ kind: 'reset-configuration', itemId: 'standard.home' }); });
it('renders typed Publisher empty-state in flow', () => { mount({ id: 'empty', section: 'sections.empty-state', label: 'No items', message: 'No aligned delivery items' }); expect(screen.getByRole('heading', { name: 'No items' })).toBeInTheDocument(); });
it('renders typed Publisher error-state in flow', () => { mount({ id: 'error', section: 'sections.error-state', label: 'Plan unavailable', message: 'Source failure' }); expect(screen.getByRole('region')).toHaveTextContent('Source failure'); });
it('maps actual P0 through P9 without upgrading unconfigured evidence or inventing plan history', async () => {
  const value = await input(); const sections = projectPublisherSections(value);
  expect(sections.map(section => section.id)).toEqual(['P0','P1','P2','P3','P4','P5','P6','P8','P9']);
  const evidence = sections.find(section => section.id === 'P6')!; expect(JSON.stringify(evidence)).toContain('waiting');
  const configured = projectPublisherSections(await input(true)); expect(configured.map(section => section.id)).toContain('P7');
  const history = configured.find(section => section.id === 'P9'); expect(JSON.stringify(history)).toContain('example.publisher/1'); expect(JSON.stringify(history)).not.toContain('/2');
  expect(value.versions).toHaveLength(1);
});
it('keeps concept planning local with no Configure or assembly clearance', async () => {
  const value = await input(), draft = createDeliveryExampleDraft(), channels = projectPublisherChannels(draft), active = channels.find(channel => channel.id === 'messages')!;
  const sections = projectPublisherSections({ ...value, plan: draft, channels, activeChannelId: active.id, selectedItemId: active.items[0]!.item.id, webItems: [], versions: [], historyOpen: false });
  const form = sections.find(section => section.id === 'P4')!; const command = vi.fn(); mount(form, command);
  expect(screen.queryByRole('button', { name: 'Apply configuration' })).toBeNull(); expect(sections.some(section => section.id === 'P7')).toBe(false);
  expect(screen.getByRole('form')).toHaveTextContent('Planned configuration only');
});
it('has no hardcoded Admin frame and retains typed detail action bound', () => {
  expect(() => mount({ id: 'P3', section: 'sections.record-detail', label: 'Details', fields: [], actions: Array.from({ length: 3 }, () => ({ kind: 'text' as const, text: 'extra' })) })).toThrow(/bound/);
});

it('restores current host initial settings after Reset without retaining the prior applied draft', async () => {
  const value = await input(false), source = projectPublisherSections(value).find(item => item.id === 'P4')!;
  if (source.section !== 'sections.form' || source.fields.kind !== 'production') throw new Error('Real aligned production fixture required');
  const initial = source.fields.initial, otherFrame = value.registries.frames.find(frame => frame.id !== initial.frame.leaf)!;
  expect(otherFrame).toBeDefined();
  const applied: ProductionSettings = { ...initial, frame: { leaf: otherFrame.id as ProductionSettings['frame']['leaf'] } }, command = vi.fn();
  function Host() {
    const [settings, setSettings] = useState<ProductionSettings | undefined>(applied);
    const data = projectPublisherSections({ ...value, settings: { 'standard.home': settings } }).find(item => item.id === 'P4')!;
    return <PublisherSection data={data} registries={value.registries} onCommand={event => { command(event); if (event.kind === 'reset-configuration') setSettings(undefined); else if (event.kind === 'configure') setSettings(event.settings); }} />;
  }
  render(<Host />);
  await userEvent.click(screen.getByRole('button', { name: 'Apply configuration' }));
  expect(command).toHaveBeenLastCalledWith({ kind: 'configure', itemId: 'standard.home', settings: applied });
  await userEvent.click(screen.getByRole('button', { name: 'Reset configuration' }));
  expect(command).toHaveBeenLastCalledWith({ kind: 'reset-configuration', itemId: 'standard.home' });
  await userEvent.click(screen.getByRole('button', { name: 'Apply configuration' }));
  expect(command).toHaveBeenLastCalledWith({ kind: 'configure', itemId: 'standard.home', settings: initial });
});
