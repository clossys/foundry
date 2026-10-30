import { expect, it } from 'vitest';
import { applyLibraryChange, libraryHash, loadCatalog, loadComponentCompositionRules, loadComponentRegistry, resolve, planSurfaceDefaults, DEFAULT_COMPONENT_PREFERENCE, type CompositeCatalogData, type CompositeLibraryData } from '@clossys/designer/catalog';
import { loadCatalogBundles } from '@clossys/designer/catalog-bundles';
import { agentModule } from './cells.js';
import { prepareStudioSelection } from './selection-defaults.js';

const WRITER = 'sections.specimen-copy-in-context';

it('honors an explicit native Writer specimen and uses normal package adoption without injecting other specimen sources', async () => {
  const surfaceApi = await agentModule('designer', 'library-cli/surface-catalog.js');
  const evidenceApi = await agentModule('designer', 'library-cli/surface-package-evidence.js');
  const valuesCatalog = loadCatalog();
  let values = { source: { id: 'writer-scope-example', kind: 'consumer' as const, author: 'consumer' as const, license: 'MIT' }, adoptedAt: '2026-10-30', fills: [] as CompositeLibraryData['values']['fills'] };
  values = applyLibraryChange(valuesCatalog, values, { baseHash: libraryHash(values), changes: valuesCatalog.fills.filter(document => { const metadata = document.$extensions['com.clossys.fill']; return metadata.source === 'foundry' && metadata.slot.startsWith('tokens.'); }).map(document => ({ op: 'adopt' as const, slot: document.$extensions['com.clossys.fill'].slot, source: 'foundry' })) });
  values = applyLibraryChange(valuesCatalog, values, { baseHash: libraryHash(values), changes: [{ op: 'author', slot: 'tokens.breakpoint', tokens: { mobile: { $type: 'dimension', $value: { value: 520, unit: 'px' } } } }] });
  const { source, adoptedAt, ...portion } = values;
  const catalog: CompositeCatalogData = { values: valuesCatalog, components: { slots: loadComponentRegistry().slots, fills: loadCatalogBundles().componentFills, rules: loadComponentCompositionRules() }, surfaces: surfaceApi.foundrySurfaceCatalog() };
  const blank: CompositeLibraryData = { source, adoptedAt, values: portion, components: { fills: [], files: [] }, surfaces: { version: 1, fills: [], files: [] } };
  const surfaceOptions = { packages: await evidenceApi.readSurfacePackageEvidence(catalog.surfaces!.fills), measurements: [] };
  const chosen = ['frames.app-shell', 'sections.section-header', 'sections.content', 'sections.empty-state', WRITER] as const;
  const library = applyLibraryChange(catalog, blank, { baseHash: libraryHash(blank), changes: chosen.map(slot => ({ portion: 'surfaces' as const, change: { op: 'adopt' as const, slot, source: 'foundry' } })) }, { surfaceOptions });
  const prepared = await prepareStudioSelection({ catalog, library, activeIds: [...chosen] });
  expect(prepared.leaves.filter(leaf => /^sections\.specimen-/.test(leaf.leaf)).map(leaf => leaf.leaf)).toEqual([WRITER]);
  expect(prepared.leaves.find(leaf => leaf.leaf === WRITER)).toMatchObject({ source: 'consumer', fill: `foundry/${WRITER}` });
  expect(prepared.input.library.surfaces!.fills.filter(document => /^sections\.specimen-/.test(document.$extensions['com.clossys.fill'].slot)).map(document => document.$extensions['com.clossys.fill'].slot)).toEqual([WRITER]);
  expect(prepared.leaves.map(leaf => leaf.leaf)).toEqual(expect.arrayContaining(['frames.app-shell', 'sections.section-header', 'sections.cards', 'components.button', 'components.table']));
  const profile = resolve(prepared.input);
  expect(profile.surfaces!.check.findings.filter(finding => finding.severity === 'error')).toEqual([]);
  expect(profile.values.members['tokens.breakpoint.mobile']!.origin).toMatchObject({ kind: 'authored' });
  expect(profile.values.members['tokens.breakpoint.mobile']!.value.light).toEqual({ value: 520, unit: 'px' });
  expect(profile.values.members['tokens.breakpoint.tablet']!.origin).toMatchObject({ kind: 'adopted', source: 'tailwind-default' });
  expect(prepared.input.library.surfaces!.files).toEqual([]);
}, 60_000);

it('keeps the native default inventory and refuses absent source bundles when no explicit specimen scope exists', async () => {
  const surfaceApi = await agentModule('designer', 'library-cli/surface-catalog.js');
  const catalog = surfaceApi.foundrySurfaceCatalog();
  const registered = catalog.slots.filter((slot: { id: string }) => /^sections\.specimen-/.test(slot.id)).map((slot: { id: string }) => slot.id).sort();
  const planned = planSurfaceDefaults({ catalog, slots: catalog.slots.map((slot: { id: string }) => slot.id), preference: DEFAULT_COMPONENT_PREFERENCE });
  expect(planned.rows.filter(row => /^sections\.specimen-/.test(row.slot)).map(row => row.slot).sort()).toEqual(registered);
  await expect(prepareStudioSelection()).rejects.toThrow('S2 unique bundle required');
}, 60_000);
