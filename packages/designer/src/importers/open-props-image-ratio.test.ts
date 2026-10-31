/** @vitest-environment node */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { loadCatalog } from '../catalog-core/index.js';
import { flatten, metaOf } from '../catalog-core/model.js';
import { applyLibraryChange, generateSelection, tokenContent } from '../catalog-core/library.js';
import { libraryHash, resolve } from '../catalog-core/resolve.js';
import { stableStringify } from '../catalog-core/stable.js';
import { emit } from '../catalog-core/emit.js';
import { authorImageRatios } from '../catalog-assets/check.js';
import { assetNotices, emitGlyphModule } from '../catalog-assets/emit.js';
import { withAssetCatalog } from '../catalog-assets/catalog.js';
import type { LibraryData } from '../catalog-core/types.js';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const prefix = 'assets.image-ratio.';
const expected = {
  square: { width: 1, height: 1 }, landscape: { width: 4, height: 3 },
  portrait: { width: 3, height: 4 }, widescreen: { width: 16, height: 9 },
  ultrawide: { width: 18, height: 5 }, golden: { width: 1.618, height: 1 },
};
const commit = 'fcb77853851109cc45a801fc18b36293eb1f5be7';
const sourceHash = 'fcdbb315c25f081d3c5a2da83c4cab23f773f16cdd20ee56bfa933272744f6e2';
const empty = (): LibraryData => ({ source: { id: 'example', kind: 'consumer', author: 'consumer', license: 'MIT' }, fills: [], adoptedAt: '2026-10-24' });
const adopt = () => { const library = empty(); return applyLibraryChange(loadCatalog(), library, { baseHash: libraryHash(library), changes: [{ op: 'adopt', slot: 'assets.image-ratio', source: 'open-props' }] }); };

describe('optional Open Props image ratios', () => {
  it('offers exactly six pinned native ratio rules', async () => {
    const catalog = loadCatalog();
    const fills = catalog.fills.filter(fill => metaOf(fill).id === 'open-props/assets.image-ratio');
    expect(fills).toHaveLength(1);
    const css = read('./vendor/open-props/props.aspects.css');
    expect(Buffer.byteLength(css)).toBe(172); expect(hash(css)).toBe(sourceHash);
    // Independent literal source lines, not the production roster or generated descriptor.
    expect(css.split('\n').slice(1, 7)).toEqual([
      '  --ratio-square: 1;', '  --ratio-landscape: 4/3;', '  --ratio-portrait: 3/4;',
      '  --ratio-widescreen: 16/9;', '  --ratio-ultrawide: 18/5;', '  --ratio-golden: 1.6180/1;',
    ]);
    const roster = JSON.parse(read('./open-props-image-ratio-roster.json'));
    expect(roster).toEqual(Object.entries(expected).map(([member, value], index) => ({
      member, property: `--ratio-${member}`, scalar: ['1', '4/3', '3/4', '16/9', '18/5', '1.6180/1'][index], line: index + 2, ...value,
    })));
    const fill = fills[0]!; const metadata = metaOf(fill);
    expect(metadata).toMatchObject({ slot: 'assets.image-ratio', source: 'open-props', mode: 'implementation', relation: 'subset', author: 'third-party', trust: 'pinned-upstream', license: 'MIT', status: 'draft', reads: { themes: [], assets: [] }, builtOn: [], conforms: [], evidence: [] });
    expect(metadata.pin).toEqual({ package: 'open-props', version: '1.7.23', commit, file: 'src/props.aspects.css', url: `https://raw.githubusercontent.com/argyleink/open-props/${commit}/src/props.aspects.css`, sha256: sourceHash });
    expect(catalog.sources.find(source => source.id === 'open-props')).toMatchObject({ kind: 'external', author: 'third-party', license: 'MIT', pin: metadata.pin });
    expect(Object.fromEntries(Object.entries(flatten(fill)).map(([id, token]) => [id.slice(prefix.length), token]))).toEqual(Object.fromEntries(Object.entries(expected).map(([member, value]) => [member, { $type: 'rules', $value: value }])));
    const { importOpenPropsImageRatio } = await import('./open-props-image-ratio.js');
    expect(importOpenPropsImageRatio()).toEqual([fill]);
    expect(read('../catalog/fills/open-props/assets.image-ratio.json')).toBe(stableStringify(fill));
    const provenance = JSON.parse(read('./vendor/open-props/provenance.json'));
    expect(provenance.source.sha256).toBe(sourceHash);
    expect(provenance.rosterSha256).toBe(hash(read('./open-props-image-ratio-roster.json')));
    expect(provenance.license.sha256).toBe(hash(read('./vendor/open-props/LICENSE')));
  });

  it('explicit adoption does not alter the open leaf or another library', () => {
    const catalog = loadCatalog(), untouched = empty(), library = adopt();
    const profile = resolve({ catalog, library });
    expect(Object.keys(profile.members).sort()).toEqual(Object.keys(expected).map(member => prefix + member).sort());
    for (const [member, value] of Object.entries(expected)) {
      const id = prefix + member, resolved = profile.members[id]!;
      expect(resolved.value).toEqual({ light: value });
      const token = flatten(library.fills[0]!)[id]!;
      expect(resolved.origin).toMatchObject({ kind: 'adopted', source: 'open-props', fill: 'open-props/assets.image-ratio', member: id, license: 'MIT', sha256: hash(stableStringify(tokenContent(token))), pin: metaOf(catalog.fills.find(fill => metaOf(fill).source === 'open-props')!).pin });
    }
    expect(library.selection).toEqual(generateSelection(library));
    expect(resolve({ catalog, library: untouched }).members).toEqual({});
    expect(untouched.fills).toEqual([]);
    const authored = authorImageRatios(catalog, empty(), { ratios: { landscape: { width: 3, height: 2 } }, source: 'Consumer editorial brief', rationale: 'Landscape crop for editorial media' });
    const before = structuredClone(authored);
    loadCatalog(); adopt();
    expect(authored).toEqual(before);
    expect(resolve({ catalog, library: authored }).members[prefix + 'landscape']!.value.light).toEqual({ width: 3, height: 2 });
    expect(authored.rationale).toEqual(before.rationale);
    expect(resolve({ catalog, library: authored }).members[prefix + 'landscape']!.origin).toMatchObject({ kind: 'authored', note: 'Consumer editorial brief: Landscape crop for editorial media' });
    expect(catalog.slots.find(slot => slot.id === 'assets.image-ratio')!.contract.members).not.toHaveProperty('required');
  });

  it('emits complete notices only when this source is adopted', () => {
    const catalog = loadCatalog(), library = adopt();
    const license = read('./vendor/open-props/LICENSE');
    expect(Buffer.byteLength(license)).toBe(1068);
    expect(hash(license)).toBe('fed3aa342094f6bb33701d09133c159a4c124e509ede255a889dd2c28ec3ab6e');
    expect(assetNotices(resolve({ catalog, library }))).toContain(license);
    expect(assetNotices(resolve({ catalog, library: empty() }))).not.toContain(license);
    expect(assetNotices(resolve({ catalog, library }))).not.toContain('Phosphor Icons');
  });

  it('keeps leaf identities and existing authoring semantics', () => {
    const catalog = loadCatalog();
    expect(catalog.slots.filter(slot => slot.layer === 'assets')).toHaveLength(49);
    for (const [source, count] of [['foundry', 7], ['lucide', 41], ['phosphor', 40], ['open-props', 1]] as const)
      expect(catalog.fills.filter(fill => fill.assets && metaOf(fill).source === source)).toHaveLength(count);
    expect(catalog.fills.filter(fill => fill.assets)).toHaveLength(89);
    expect(catalog.fills.some(fill => metaOf(fill).id === 'foundry/assets.image-ratio')).toBe(false);
  });

  it('retains existing invalid-ratio, invalid-name and stale-CAS rejection controls', () => {
    const catalog = loadCatalog(), library = empty();
    for (const ratios of [{ landscape: { width: 0, height: 3 } }, { landscape: { width: Number.NaN, height: 3 } }, { 'Invalid Name': { width: 4, height: 3 } }])
      expect(() => authorImageRatios(catalog, library, { ratios, source: 'Example', rationale: 'Test input' })).toThrow('invalid image ratio');
    expect(() => applyLibraryChange(catalog, library, { baseHash: 'stale', changes: [{ op: 'adopt', slot: 'assets.image-ratio', source: 'open-props' }] })).toThrow();
  });

  it('remains pure and emits no ratio CSS or runtime package import', async () => {
    const catalog = loadCatalog(), library = adopt(), profile = resolve({ catalog, library });
    expect(withAssetCatalog(withAssetCatalog(catalog))).toEqual(withAssetCatalog(catalog));
    expect(catalog.sources.filter(source => source.id === 'open-props')).toHaveLength(1);
    expect(emit(profile, ['css-brand', 'css-scales', 'css-fonts', 'tailwind-theme'], { header: false }).map(file => file.contents).join('')).not.toContain('ratio');
    expect(emitGlyphModule(profile)).not.toContain('image-ratio');
    const { importOpenPropsImageRatio } = await import('./open-props-image-ratio.js');
    const first = importOpenPropsImageRatio(); metaOf(first[0]!).license = 'changed';
    expect(metaOf(importOpenPropsImageRatio()[0]!).license).toBe('MIT');
    const manifest = JSON.parse(read('../../package.json'));
    for (const group of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'])
      expect(manifest[group] ?? {}).not.toHaveProperty('open-props');
  });
});
