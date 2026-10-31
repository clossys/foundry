import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { designerDefaultTheme, designerGallery, designerLeaf } from './designer-library.js';

const workspace = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__/designer-workspace');

describe('PROOF-2 Designer library projection over the record store', () => {
  it('groups pinned fixture leaves into L0-L2 sections with one status each', () => {
    const gallery = designerGallery(workspace);
    expect(gallery.count).toBe(4);
    const cards = gallery.sections.flatMap(section => section.cards.map(card => `${section.level}:${card.slug}@${card.version}:${card.status}`));
    expect(cards).toEqual(expect.arrayContaining(['1:preset@1:pinned', '2:button@1:pinned', '2:card@1:pinned', '2:hero@2:unreleased']));
    expect(gallery.sections.filter(section => section.level === 0).map(section => section.id)).toEqual(['themes', 'components', 'sections']);
    const hero = gallery.sections.findIndex(section => section.cards.some(card => card.slug === 'hero'));
    expect(gallery.sections[hero - 1]).toMatchObject({ level: 1, cards: [] });
  });

  it('details one leaf with its catalog contract, lineage and versions', () => {
    const leaf = designerLeaf(workspace, 'hero')!;
    expect(leaf.card).toMatchObject({ slot: 'sections.hero', version: 2, status: 'unreleased', specimen: 'sections.hero/hero' });
    expect(leaf.contract.kind).toBe('section');
    expect(leaf.contract.dependencies).toEqual(['components.button/sample-button@v1']);
    expect(leaf.lineage).toEqual([{ version: 1, mode: 'original' }, { version: 2, mode: 'original', parent: 1 }]);
    expect(leaf.versions.map(row => [row.version, row.pinned, row.released])).toEqual([[2, true, false], [1, false, true]]);
    expect(designerLeaf(workspace, 'no-such-leaf')).toBeUndefined();
  });

  it('names the pinned theme as the specimen default', () => {
    expect(designerDefaultTheme(workspace)).toBe('themes.preset/neutral');
  });
});
