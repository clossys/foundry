import { createHash } from 'node:crypto';
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { serializeFrontmatter } from './slot-model/index.js';
import { writerKeysUnapproved } from '../pipeline/status.js';
import { contractCopyKeys, writerCopy, writerCopyDuplicates, writerKeyFold, writerRowKey } from './writer-copy.js';
import { installCopy } from '../publish/install.js';
import { resolvePublicationTitles } from '../publish/pinned-publication.js';
import { writeTargetPin } from './pin-map.js';
import { writeCandidate } from './slot-write.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

/** A synthetic consumer with one pinned Writer strings slot. */
function consumer(basis: 'picked' | 'bulk' | 'planner' | 'agent' = 'planner') {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'writer-copy-'))); roots.push(root);
  const writer = join(root, 'clossys/agents/writer');
  const dir = join(writer, 'strings.probe');
  mkdirSync(join(dir, 'candidates'), { recursive: true });
  writeFileSync(join(writer, 'ia.json'), JSON.stringify({ schema: 'clossys.ia/1', source: 'synthetic-test-only#writer-copy', extensions: [],
    nodes: [{ id: 'strings.test', label: 'Strings', children: [{ id: 'probe', label: 'Probe', slots: ['strings.probe'] }] }] }));
  const bytes = serializeFrontmatter({ slot: 'strings.probe', locales: ['en'], source: { kind: 'original', ref: [] } },
    '## en\n\n### studio.probe.held\n<!-- {"id":"studio.probe.held","bindings":[]} -->\nHeld\n');
  writeFileSync(join(dir, 'candidates/studio-v1.md'), bytes);
  writeFileSync(join(dir, 'pin.json'), JSON.stringify({ candidate: 'studio-v1.md', sha256: createHash('sha256').update(bytes).digest('hex'), decidedBy: basis === 'agent' ? 'agent:writer' : basis === 'planner' ? 'planner:synthetic-test-only' : 'owner:synthetic-test-only', basis, at: '2026-01-01T00:00:00Z' }));
  return { clossys: join(root, 'clossys'), candidate: join(dir, 'candidates/studio-v1.md') };
}

describe('pinned Writer copy', () => {
  it('stops serving its cached copy when a pinned candidate drifts after a first read (same pin, same consumer)', () => {
    const { clossys, candidate } = consumer();
    const copy = writerCopy(clossys);
    expect(copy.text('studio.probe.held')).toBe('Held');
    expect(writerCopy(clossys)).toBe(copy);
    appendFileSync(candidate, '\n');
    expect(() => writerCopy(clossys)).toThrow(/drifted from its pin/);
  });

  // Pin = approval (owner Producer round 2): an owner pin is the editorial approval; a planner or agent pick stays a confirm item.
  it.each(['picked', 'bulk'] as const)('reports a key under an owner %s pin as approved, in agreement with pipeline status', basis => {
    const { clossys } = consumer(basis);
    const copy = writerCopy(clossys);
    expect(copy.approved('studio.probe.held')).toBe(true);
    expect(copy.text('studio.probe.held')).toBe('Held');
    expect(writerKeysUnapproved(join(clossys, '..')).has('strings.probe')).toBe(false);
  });
  it.each(['agent', 'planner'] as const)('keeps a key under a %s pin unapproved until the owner pins', basis => {
    const copy = writerCopy(consumer(basis).clossys);
    expect(copy.approved('studio.probe.held')).toBe(false);
    expect(copy.text('studio.probe.held')).toBe('Held');
  });
});

/** A synthetic consumer whose Writer IA places and pins one candidate per slot: slot id to its `### <row>` texts. */
function metaConsumer(slots: Record<string, Record<string, string>>) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'writer-copy-meta-'))); roots.push(root);
  const writer = join(root, 'clossys/agents/writer');
  mkdirSync(writer, { recursive: true });
  writeFileSync(join(writer, 'ia.json'), JSON.stringify({ schema: 'clossys.ia/1', source: 'synthetic-test-only#writer-copy-meta', extensions: [],
    nodes: [{ id: 'pages', label: 'Pages', children: [{ id: 'meta', label: 'Meta', slots: Object.keys(slots) }] }] }));
  for (const [slot, rows] of Object.entries(slots)) {
    const dir = join(writer, slot);
    mkdirSync(join(dir, 'candidates'), { recursive: true });
    const body = Object.entries(rows).map(([id, text]) => `### ${id}\n<!-- {"id":${JSON.stringify(id)},"bindings":[]} -->\n${text}\n`).join('\n');
    const bytes = serializeFrontmatter({ slot, locales: ['en'], source: { kind: 'original', ref: [] } }, `## en\n\n${body}`);
    writeFileSync(join(dir, 'candidates/meta-v1.md'), bytes);
    writeFileSync(join(dir, 'pin.json'), JSON.stringify({ candidate: 'meta-v1.md', sha256: createHash('sha256').update(bytes).digest('hex'), decidedBy: 'planner:synthetic-test-only', basis: 'planner', at: '2026-01-01T00:00:00Z' }));
  }
  return join(root, 'clossys');
}

describe('pinned Writer copy row keys (BR-E2E5 option A)', () => {
  it('registers two pinned meta slots\' same-named rows as <slot>.<row>: both resolve, with no collision', () => {
    const clossys = metaConsumer({
      'page.home.meta': { title: 'Home title', description: 'Home description' },
      'page.about.meta': { title: 'About title', description: 'About description' },
    });
    expect(writerCopyDuplicates(clossys)).toEqual([]);
    const copy = writerCopy(clossys);
    expect(copy.text('page.home.meta.title')).toBe('Home title');
    expect(copy.text('page.about.meta.title')).toBe('About title');
    expect(copy.text('page.about.meta.description')).toBe('About description');
    expect(copy.has('title')).toBe(false);
  });

  it('keeps a dotted row id as its own key', () => {
    const copy = writerCopy(metaConsumer({ 'strings.probe': { 'studio.probe.held': 'Held' } }));
    expect(copy.text('studio.probe.held')).toBe('Held');
    expect(copy.has('strings.probe.studio.probe.held')).toBe(false);
  });
});

const FIXTURE = fileURLToPath(new URL('../../test-fixtures/consumer/', import.meta.url));
const AT = '2026-11-26T00:00:00Z';

/** A mktemp copy of the fixture consumer, every pin included: its `clossys/` folder. */
function fixtureConsumer(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'writer-copy-key-'))); roots.push(root);
  cpSync(FIXTURE, root, { recursive: true });
  return join(root, 'clossys');
}

/**
 * Submit and pin a Writer copy candidate for `slot` through the record writers (writeCandidate, writeTargetPin):
 * the header's own candidate head with `slot` in place of the header, and the given `### <row>` texts.
 */
function pinCopy(clossys: string, slot: string, rows: Record<string, string>): string {
  const header = readFileSync(join(clossys, 'agents/writer/frames.site-header.copy/candidates/copy-v1.md'), 'utf8');
  const head = header.slice(0, header.indexOf('## en')).replaceAll('frames.site-header.copy', slot);
  const body = Object.entries(rows).map(([id, text]) => `### ${id}\n<!-- {"id":${JSON.stringify(id)},"bindings":[]} -->\n${text}\n`).join('\n');
  const { name } = writeCandidate(clossys, 'writer', slot, 'copy', `${head}## en\n\n${body}`);
  writeTargetPin(join(clossys, '..'), { agent: 'writer', slotId: slot, record: 'copy', candidate: name, decidedBy: 'planner', basis: 'planner', at: AT, createdBy: { actor: 'code', cli: 'clossys pin', version: '0.1.0' } });
  return name;
}
const pinFooter = (clossys: string, rows: Record<string, string>): string => pinCopy(clossys, 'frames.site-footer.copy', rows);

describe('a contract key is its own slot\'s key (CP1-COPYKEY)', () => {
  it('loads one contract key from two pinned copy slots under each slot\'s id', () => {
    const clossys = fixtureConsumer();
    pinFooter(clossys, { 'navigation.label': 'Footer navigation', 'legal.notice': 'All rights reserved' });
    const copy = writerCopy(clossys);
    expect(copy.text('frames.site-header.copy.navigation.label')).toBe('Main navigation');
    expect(copy.text('frames.site-footer.copy.navigation.label')).toBe('Footer navigation');
    expect(copy.text('frames.site-footer.copy.legal.notice')).toBe('All rights reserved');
    expect(copy.has('navigation.label')).toBe(false);
    expect(writerCopyDuplicates(clossys)).toEqual([]);
  });

  it('a dotted id no contract declares stays global', () => {
    const declared = new Set(['navigation.label']);
    expect(writerRowKey('frames.site-footer.copy', 'navigation.label', declared)).toBe('frames.site-footer.copy.navigation.label');
    expect(writerRowKey('frames.site-footer.copy', 'site.footer.credit', declared)).toBe('site.footer.credit');
    expect(writerRowKey('frames.site-footer.copy', 'credit', declared)).toBe('frames.site-footer.copy.credit');
    const clossys = fixtureConsumer();
    pinFooter(clossys, { 'navigation.label': 'Footer navigation', 'site.footer.credit': 'Made here' });
    const copy = writerCopy(clossys);
    expect(copy.text('site.footer.credit')).toBe('Made here');
    expect(copy.has('frames.site-footer.copy.site.footer.credit')).toBe(false);
    // The same authored global id in a second slot is still one key recorded twice.
    const twice = fixtureConsumer();
    const header = join(twice, 'agents/writer/frames.site-header.copy/candidates/copy-v1.md');
    pinFooter(twice, { 'navigation.label': 'Footer navigation', 'navigation.home': 'Home' });
    expect(writerCopyDuplicates(twice)).toEqual([]);
    expect(writerCopyDuplicates(twice, { slot: 'frames.site-header.copy', record: 'copy', candidate: headerWith(twice, header, 'navigation.home') }))
      .toEqual([{ id: 'navigation.home', slots: ['frames.site-footer.copy', 'frames.site-header.copy'] }]);
  });

  it('`<slot>#navigation.label` resolves to that slot\'s row', () => {
    const clossys = fixtureConsumer();
    pinFooter(clossys, { 'navigation.label': 'Footer navigation' });
    const copy = writerCopy(clossys);
    const writer = Object.fromEntries(copy.ids.map(id => [id, copy.text(id)]));
    // install.ts writerKeyOf: the ref's bare key is not registered, so it binds `<slot>.<key>`.
    expect(installCopy({ copy: { footer: 'frames.site-footer.copy#navigation.label', header: 'frames.site-header.copy#navigation.label' } }, writer).copy)
      .toEqual({ footer: 'frames.site-footer.copy.navigation.label', header: 'frames.site-header.copy.navigation.label' });
    // pinned-publication.ts keyOf: a title ref resolves the same way, to that slot's text.
    const titled = resolvePublicationTitles(clossys, { map: { publicationId: 'copy-key-probe', entries: [
      { id: 'footer', title: 'frames.site-footer.copy#navigation.label' }, { id: 'header', title: 'frames.site-header.copy#navigation.label' },
    ] } } as never);
    expect(titled.map.entries.map(entry => entry.title)).toEqual(['Footer navigation', 'Main navigation']);
  });

  it('publication meta camelCase key is stored kebab-case and resolves', () => {
    expect(writerKeyFold('siteName')).toBe('site-name');
    expect(writerKeyFold('share.title')).toBe('share.title');
    // The fixture pins publication.site.meta, whose contract declares `siteName`: its bytes keep the key as written.
    const clossys = fixtureConsumer();
    expect(readFileSync(join(clossys, 'agents/writer/publication.site.meta/candidates/meta-v1.md'), 'utf8')).toContain('### siteName');
    const copy = writerCopy(clossys);
    expect(copy.has('publication.site.meta.site-name')).toBe(true);
    expect(copy.has('publication.site.meta.siteName')).toBe(false);
    expect(copy.text('publication.site.meta.site-name')).toBe('Fixture Works');
    const writer = Object.fromEntries(copy.ids.map(id => [id, copy.text(id)]));
    expect(installCopy({ copy: { camel: 'publication.site.meta#siteName', kebab: 'publication.site.meta#site-name' } }, writer).copy)
      .toEqual({ camel: 'publication.site.meta.site-name', kebab: 'publication.site.meta.site-name' });
    const titled = resolvePublicationTitles(clossys, { map: { publicationId: 'copy-key-probe', entries: [
      { id: 'camel', title: 'publication.site.meta#siteName' }, { id: 'kebab', title: 'publication.site.meta#site-name' },
    ] } } as never);
    expect(titled.map.entries.map(entry => entry.title)).toEqual(['Fixture Works', 'Fixture Works']);
  });

  it('the product\'s copy set resolves a text', () => {
    // The product's pinned copy state, in the fixture: every fixture pin (publication.site.meta's `siteName` too) and
    // the four frame copy slots pinned with their own contract keys, `navigation.label` and `skip.label` held twice.
    const clossys = fixtureConsumer();
    for (const slot of ['frames.site-footer.copy', 'frames.app-header.copy', 'frames.app-sidebar.copy']) {
      const keys = [...contractCopyKeys(join(clossys, 'agents/writer', slot))];
      pinCopy(clossys, slot, Object.fromEntries(keys.map(key => [key, `${slot} ${key}`])));
    }
    expect(writerCopyDuplicates(clossys)).toEqual([]);
    const copy = writerCopy(clossys);
    expect(copy.ids.length).toBeGreaterThan(0);
    for (const id of copy.ids) expect(typeof copy.text(id)).toBe('string');
    expect(copy.text('frames.app-sidebar.copy.navigation.label')).toBe('frames.app-sidebar.copy navigation.label');
    expect(copy.text('frames.app-header.copy.skip.label')).toBe('frames.app-header.copy skip.label');
    expect(copy.text('frames.site-header.copy.skip.label')).toBe('Skip to content');
    expect(copy.text('publication.site.meta.site-name')).toBe('Fixture Works');
  });
});

/** A new header candidate `copy-v2.md` (submitted, not pinned): the pinned header's rows plus one `<id>` row; its file name. */
function headerWith(clossys: string, pinnedHeader: string, id: string): string {
  const bytes = readFileSync(pinnedHeader, 'utf8');
  const head = bytes.slice(0, bytes.indexOf('## en')).replace('frames.site-header.copy/copy-v1.md', 'frames.site-header.copy/copy-v2.md');
  return writeCandidate(clossys, 'writer', 'frames.site-header.copy', 'copy', `${head}${bytes.slice(bytes.indexOf('## en')).trimEnd()}\n\n### ${id}\n<!-- {"id":${JSON.stringify(id)},"bindings":[]} -->\nHome\n`).name;
}
