/** @vitest-environment node */
import { expect, it } from 'vitest';
import { loadSectionRegistry } from '../catalog-core/index.js';
import { surfaceOf } from '../catalog-core/surface-library.js';
import { surfaceConsumptionFindings } from '../catalog-core/surface-defaults.js';
import { specimenSectionSourceCatalog } from '../importers/specimen-sections.js';
import { SPECIMEN_RENDER_PARTS } from './specimen-render-part-identities.js';

it('registers callable parts on their five existing section identities without adding leaves', () => {
  const registry = loadSectionRegistry();
  const candidates = specimenSectionSourceCatalog();
  expect(Object.keys(SPECIMEN_RENDER_PARTS)).toHaveLength(5);
  expect(Object.values(SPECIMEN_RENDER_PARTS).flat()).toHaveLength(7);
  for (const [section, parts] of Object.entries(SPECIMEN_RENDER_PARTS)) {
    const slot = registry.slots.find(slot => slot.id === section)!;
    const fill = surfaceOf(candidates.fills.find(document => document.$extensions['com.clossys.fill'].slot === section)!);
    expect(slot.contract.parts).toEqual(parts);
    expect(fill.parts).toEqual(parts);
    expect(slot.contract.slots).toContainEqual({ name: 'renderParts', type: 'region', required: false });
    expect(fill.slotMap.renderParts).toEqual({ export: fill.impl.export, path: ['renderParts'] });
    expect(parts.some(part => /^(?:components|sections|frames)\./.test(part))).toBe(false);
    expect(parts.some(part => registry.slots.some(slot => slot.id === part))).toBe(false);
  }
});

it('the unchanged native S5 contract rejects a removed part registration', () => {
  const slot = structuredClone(loadSectionRegistry().slots.find(slot => slot.id === 'sections.specimen-section-viewports')!);
  const fill = surfaceOf(specimenSectionSourceCatalog().fills.find(document => document.$extensions['com.clossys.fill'].slot === slot.id)!);
  const actual = { scanStatus: 'lower-bound' as const, sourceFiles: [{ path: fill.impl.entry, sha256: fill.pin.files[0]!.sha256 }], scannedReads: { themes: [], assets: [], components: [] }, scannedComposes: [] };
  expect(surfaceConsumptionFindings(slot, fill, actual)).toEqual([]);
  slot.contract.parts = slot.contract.parts.filter(part => part !== 'renderViewport');
  expect(surfaceConsumptionFindings(slot, fill, actual)).toContain('S5 unsupported composes: renderViewport');
});
