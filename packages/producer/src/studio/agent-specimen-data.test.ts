import { describe, expect, it } from 'vitest';
import { serializeWriterCell } from '../../../writer/src/cells/parse';
import type { AgentCells, CellDetail } from '../../studio/lib/cells-client';
import { agentSpecimenPlan } from '../../studio/lib/agent-specimen-data';
import { agentSpecimenCoverage } from '../../studio/lib/agent-specimen-coverage';
import type { PublicationResponse } from '../../studio/lib/publisher-preview';

const cell = (agent: CellDetail['agent'], content: string, fields: Record<string, unknown> = {}): CellDetail => ({ agent, id: 'example.page', title: 'Page', version: 2, status: 'draft', fields, content });
const index = (detail: CellDetail): AgentCells => ({ agent: detail.agent, state: 'ready', cells: [{ id: detail.id, title: detail.title, version: detail.version, status: detail.status }] });
const writer = (records: { locale: string; record: Record<string, unknown> }[]): CellDetail => cell('writer', serializeWriterCell({ id: 'example.page', version: 2, status: 'draft', updated: '2026-10-29', links: [], locales: ['en', 'ar'], records: records.map(record => ({ ...record, bindings: [] })) }), { locales: ['en', 'ar'] });
const publication = (): PublicationResponse => ({ state: 'ready', publication: 'example', publications: ['example'], manifest: { schemaVersion: 1, publication: 'example', sourceApp: 'web', format: 'web.page.responsive', routes: [{ id: 'home', path: '/', source: { file: 'pages/home.tsx', export: 'default' } }], contentMap: { version: 1, publicationId: 'example', entries: [{ id: 'home', title: 'Home', kind: 'page', path: '/' }] } }, pages: [{ id: 'home', route: '/', emitted: true, previewUrl: '/preview/example/pages/home.html' }] });

describe('full semantic agent specimen source plans', () => {
  it('retains complete selected Director passages without source metadata or other sections', () => {
    const detail = cell('director', '---\nid: example.page\n---\n## Direction\n- Full first line\n- Full second line\n\n## Because\n- Evidence passage\n\n## Watch\n- Risk passage\n\n## Rationale\n- Never a specimen\n');
    const plan = agentSpecimenPlan(index(detail), detail);
    expect(plan.items).toHaveLength(3);
    expect(plan.items[0]).toMatchObject({ kind: 'director', title: 'Direction', value: '- Full first line\n- Full second line' });
    expect(plan.expectedVariantIds).toEqual(plan.items.map(item => item.id));
    expect(plan.issues).toEqual([]);
    expect(JSON.stringify(plan.items)).not.toMatch(/Never a specimen|id: example/);
  });
  it('reports empty declared Director content instead of quietly counting it rendered', () => {
    const detail = cell('director', '## Direction\n- Actual direction\n## Because\n\n## Watch\n- Actual risk\n');
    expect(agentSpecimenPlan(index(detail), detail).issues).toContain('A declared Director passage has no supported semantic content.');
  });
  it('keeps all native English strings with full multiline copy and actual context roles', () => {
    const full = 'First paragraph.\n\nSecond paragraph without a summary.';
    const detail = writer([
      { locale: 'en', record: { id: 'copy.1', context: 'page.hero.body', text: full } },
      { locale: 'en', record: { id: 'copy.2', context: 'page.hero.cta', text: 'Continue' } },
      { locale: 'ar', record: { id: 'copy.2', context: 'page.hero.cta', text: 'متابعة' } },
    ]);
    const plan = agentSpecimenPlan(index(detail), detail);
    expect(plan.items.map(item => [item.role, item.locale, item.value])).toEqual([['body', 'en', full], ['cta', 'en', 'Continue']]);
    expect(plan.expectedVariantIds).toHaveLength(2);
    expect(plan.issues).toEqual([]);
  });
  it('passes only actual native string and context identities as sparse Writer matrix coordinates', () => {
    const detail = writer([
      { locale: 'en', record: { id: 'copy.1', context: 'page.form.headline', text: 'Your profile' } },
      { locale: 'en', record: { id: 'copy.2', context: 'page.form.description', text: 'Enter your display name.' } },
      { locale: 'en', record: { id: 'copy.3', context: 'page.form.error', text: 'A name is required.' } },
    ]);
    const plan = agentSpecimenPlan(index(detail), detail);
    expect(plan.issues).toEqual([]); expect(plan.items).toHaveLength(3);
    expect(plan.axes?.map(axis => [axis.id, axis.values.length])).toEqual([['string', 3], ['context', 3]]);
    expect(plan.items.map(item => item.coordinates)).toEqual(plan.items.map((item, i) => ({ string: item.id, context: ['page.form.headline', 'page.form.description', 'page.form.error'][i] })));
    expect(plan.expectedVariantIds).toEqual(plan.items.map(item => item.id));
    expect(agentSpecimenPlan(index(writer([{ locale: 'en', record: { id: 'copy.1', context: 'page.hero.cta', text: 'Continue' } }])), writer([{ locale: 'en', record: { id: 'copy.1', context: 'page.hero.cta', text: 'Continue' } }])).axes).toBeUndefined();
  });
  it('fails a missing source context instead of silently shrinking Writer coverage', () => {
    const detail = cell('writer', '## Fill\n```json\n' + JSON.stringify({ locale: 'en', records: [{ id: 'copy.1', text: 'Missing context' }, { id: 'copy.2', context: 'page.hero.cta', text: 'Continue' }] }) + '\n```', { locales: ['en'] });
    expect(agentSpecimenPlan(index(detail), detail).issues).toContain('Writer record identity or context unavailable.');
  });
  it('counts every English record, including hidden-scale inventories and unsupported textless records', () => {
    const detail = writer(Array.from({ length: 15 }, (_, i) => ({ locale: 'en', record: { id: `copy.${i}`, context: i === 14 ? 'page.unrecognized' : 'page.hero.headline', ...(i === 14 ? { value: 'Unknown source shape' } : { text: `Complete headline ${i}` }) } })));
    const plan = agentSpecimenPlan(index(detail), detail);
    expect(plan.items).toHaveLength(15);
    expect(new Set(plan.expectedVariantIds).size).toBe(15);
    expect(plan.items[14]).toMatchObject({ role: 'unknown' });
    expect(plan.items[14]).not.toHaveProperty('value');
    expect(plan.issues).toContain('Writer context has no supported specimen role: page.unrecognized');
    expect(plan.issues).toContain('Writer context has no produced copy: page.unrecognized');
  });
  it('keeps known VoiceRules and glossary records in Inspector rather than copy variant coverage', () => {
    const detail = writer([
      { locale: 'en', record: { id: 'voice.1', context: 'page.voice', rules: { tone: ['clear'] } } },
      { locale: 'en', record: { id: 'glossary.1', context: 'page.glossary', glossary: [{ term: 'effortless', status: 'forbidden' }] } },
      { locale: 'en', record: { id: 'copy.1', context: 'page.hero.cta', text: 'Continue' } },
    ]);
    const plan = agentSpecimenPlan(index(detail), detail);
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0]).toMatchObject({ role: 'cta', value: 'Continue' });
    expect(plan.expectedVariantIds).toHaveLength(1);
    expect(plan.issues).toEqual([]);
  });
  it('does not report an empty English scope as a successful specimen', () => {
    const detail = writer([{ locale: 'ar', record: { id: 'copy.1', context: 'page.hero.cta', text: 'متابعة' } }]);
    expect(agentSpecimenPlan(index(detail), detail)).toMatchObject({ items: [], expectedVariantIds: [], issues: ['No English Writer records are available.'] });
  });
  it('uses actual emitted page linkage from detail and preserves all three device source variants', () => {
    const detail = cell('publisher', '', { path: '/' });
    const plan = agentSpecimenPlan(index(detail), detail, publication());
    expect(plan.items.map(item => item.viewport)).toEqual([{ id: 'desktop', width: 1440, height: 900 }, { id: 'tablet', width: 768, height: 1024 }, { id: 'mobile', width: 390, height: 844 }]);
    expect(plan.expectedVariantIds).toEqual(['example.page:desktop', 'example.page:tablet', 'example.page:mobile']);
    expect(plan.items[0]).toMatchObject({ kind: 'publisher', page: { previewUrl: '/preview/example/pages/home.html', emitted: true } });
    expect(plan.issues).toEqual([]);
  });
  it.each(['missing', 'not-emitted', 'unsafe'] as const)('keeps all expected page variants when publication is %s', failure => {
    const detail = cell('publisher', '', { path: '/' });
    const emitted = publication();
    if (emitted.state !== 'ready') throw new Error('Invalid fixture');
    if (failure === 'not-emitted') emitted.pages[0]!.emitted = false;
    if (failure === 'unsafe') emitted.pages[0]!.previewUrl = 'https://example.invalid/page';
    const plan = agentSpecimenPlan(index(detail), detail, failure === 'missing' ? { state: 'missing', message: 'Not published yet', command: 'clossys publish --target preview' } : emitted);
    expect(plan.items).toEqual([]);
    expect(plan.expectedVariantIds).toEqual(['example.page:desktop', 'example.page:tablet', 'example.page:mobile']);
    expect(plan.issues.length).toBeGreaterThan(0);
    const coverage = agentSpecimenCoverage(plan);
    expect(coverage).toMatchObject({ ready: false, inventoryComplete: false, itemCount: 0 });
    expect(coverage.variants).toHaveLength(3);
    expect(coverage.variants.every(variant => !variant.renderable)).toBe(true);
  });
  it('reports pending Designer capability and rejects a foreign agent cell', () => {
    const detail = cell('designer', 'Actual designer source');
    expect(agentSpecimenPlan(index(detail), detail)).toMatchObject({ items: [], expectedVariantIds: [], issues: ['The Designer specimen source capability is not available.'] });
    expect(agentSpecimenPlan({ ...index(detail), agent: 'writer' }, detail).issues).toEqual(['The specimen cell does not belong to this agent index.']);
  });
});
