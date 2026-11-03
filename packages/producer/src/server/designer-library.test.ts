import { cpSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrateFixtureLibrary } from '../specimen/__fixtures__/canonical-library.js';
import { listSlots } from '../records/slots.js';
import { pinFile } from '../records/slot-model/index.js';
import { designerDefaultTheme, designerGallery, designerLeaf } from './designer-library.js';

const fixture = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__/designer-workspace');
let workspace: string;

/** The legacy fixture, converted once by the migration (the one legacy reader), then read as a slot model. */
async function slotWorkspace(): Promise<string> {
  const copy = realpathSync(mkdtempSync(join(tmpdir(), 'designer-workspace-')));
  cpSync(fixture, copy, { recursive: true });
  await migrateFixtureLibrary(copy);
  for (const legacy of ['library', 'releases', 'selection.json']) rmSync(join(copy, legacy), { recursive: true, force: true });
  return copy;
}

beforeAll(async () => { workspace = await slotWorkspace(); });
afterAll(() => rmSync(workspace, { recursive: true, force: true }));

describe('PROOF-2 Designer library projection over the Designer slot model', () => {
  it('groups pinned leaves into IA sections with one status each', () => {
    const gallery = designerGallery(workspace);
    const cards = gallery.sections.flatMap(section => section.cards).filter(card => card.pinned);
    expect(cards.map(card => `${card.slug}@${card.version}:${card.status}`).sort())
      .toEqual(['components.button@1:pinned', 'components.card@1:pinned', 'sections.hero@2:pinned', 'themes.preset@1:pinned']);
    expect(gallery.count).toBe(gallery.sections.reduce((n, section) => n + section.cards.length, 0));
  });

  it('details one leaf with its catalog contract, lineage and candidates', () => {
    const leaf = designerLeaf(workspace, 'sections.hero')!;
    expect(leaf.card).toMatchObject({ slot: 'sections.hero', version: 2, status: 'pinned', specimen: 'sections.hero/hero', candidate: 'hero-v2.json' });
    expect(leaf.contract.dependencies).toEqual(['components.button/sample-button@v1']);
    expect(leaf.lineage).toEqual([{ version: 1, mode: 'original' }, { version: 2, mode: 'original' }]);
    expect(leaf.versions.map(row => [row.version, row.pinned, row.released, row.verified])).toEqual([[2, true, false, true], [1, false, false, true]]);
    expect(leaf.record).toMatchObject({ reason: expect.stringContaining('second action'), hash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/) });
    expect(designerLeaf(workspace, 'no-such-leaf')).toBeUndefined();
  });

  it('marks an unpinned slot with candidates pending approval, never missing', async () => {
    const copy = await slotWorkspace();
    try {
      rmSync(pinFile(listSlots(copy, 'designer').find(entry => entry.id === 'sections.hero')!.dir));
      const leaf = designerLeaf(copy, 'sections.hero')!;
      expect(leaf.card).toMatchObject({ status: 'pending', pinned: false, version: 2, options: [1, 2] });
      expect(leaf.statusDetail).toEqual(['Nothing is pinned yet; 2 candidates wait for approval.']);
    } finally { rmSync(copy, { recursive: true, force: true }); }
  });

  it('names the pinned theme as the specimen default', () => {
    expect(designerDefaultTheme(workspace)).toBe('themes.preset/neutral');
  });

  it('has no gallery without a Designer slot model', () => {
    expect(designerGallery(fixture)).toEqual({ sections: [], count: 0 });
  });
});
