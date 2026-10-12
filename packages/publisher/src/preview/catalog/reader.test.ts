import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { resolveSectionedViewDocument, validateSectionedViewDocument } from '../../core/index.js';
import { READER_SAMPLES, READER_COMPOSITION, readerCopyResolver, readerPage, deriveCatalogFunction } from './reader-data.js';
import { readerConfigCells } from './reader-renderer.js';
import { buildContentCatalogHtml, buildCatalogFunctionPages } from '../render-content-catalog.js';

const sheets = { designerTokens: 'tokens.css', utilities: 'preview.css', brand: 'brand.css' };
const pages = ['overview', 'introduce', 'show', 'explain', 'index', 'sequence', 'compare', 'frame', 'parts'];
const kinds = { hero: 'introduce', 'feature-grid': 'explain', faq: 'index', 'status-list': 'index', 'ordered-step-sequence': 'sequence', pricing: 'compare', 'stat-grid': 'show', stat: 'show', testimonial: 'show' };
describe('reader function catalog', () => {
  it('offers six reader jobs with overview and shared references', () => {
    const root = new JSDOM(buildContentCatalogHtml(sheets)).window.document;
    expect([...root.querySelectorAll('[data-catalog-function]')].map(n => n.getAttribute('data-catalog-function'))).toEqual(pages);
    expect(root.body.textContent).toContain('The information is');
    expect(root.body.textContent).not.toContain('Other kinds');
  });
  it('renders exactly 31 retained samples with reader-job captions and distinct headings', () => {
    const rendered = buildCatalogFunctionPages(sheets);
    expect(rendered.map(p => p.file)).toEqual(pages.map(id => `catalog/${id}.html`));
    const samples = rendered.flatMap(p => [...new JSDOM(p.content).window.document.querySelectorAll('[data-catalog-fixture]')]);
    expect(samples).toHaveLength(31);
    expect(Object.fromEntries(['Overview','Introduce','Show','Explain','Index','Sequence','Compare','Frame','Parts'].map(fn => [fn, READER_SAMPLES.filter(f => readerPage(f) === fn).length]))).toEqual({Overview:1,Introduce:5,Show:7,Explain:5,Index:5,Sequence:3,Compare:2,Frame:1,Parts:2});
    expect(new Set(samples.map(n => n.id)).size).toBe(31);
    for (const sample of samples) expect(sample.querySelector('[data-catalog-caption]')?.textContent).toMatch(/(?:Introduce|Show|Explain|Index|Sequence|Compare|Overview|Frame|Parts) › /);
    const headings = samples.map(n => n.querySelector('[data-catalog-native] h1, [data-catalog-native] h2')?.textContent);
    expect(headings.every(Boolean)).toBe(true);
    expect(new Set(headings).size).toBe(31);
  });
  it('files all nine unchanged published kinds under their actual reader jobs', () => {
    const rendered = buildCatalogFunctionPages(sheets);
    const found: Record<string, string> = {};
    for (const page of rendered) for (const node of new JSDOM(page.content).window.document.querySelectorAll('[data-published-kind]')) {
      found[node.getAttribute('data-published-kind')!] = page.file.split('/')[1]!.replace('.html', '');
      expect(node.querySelector('a')?.getAttribute('href')).toMatch(/^\.\.\/gallery\.html#published-kind-/);
    }
    expect(found).toEqual(kinds);
  });
  it('keeps current-contract coverage in real rendered config cells rather than adding full samples', () => {
    const rendered = buildCatalogFunctionPages(sheets);
    const counts = {introduce:5,show:5,explain:6,index:4,sequence:3,compare:3};
    for (const [id,count] of Object.entries(counts)) {
      const root = new JSDOM(rendered.find(p => p.file === `catalog/${id}.html`)!.content).window.document;
      expect(root.querySelectorAll('[data-catalog-config-cell] [data-config-native]').length, id).toBe(count);
      for(const cell of root.querySelectorAll('[data-catalog-config-cell]')) {
        expect(cell.querySelector('[data-config-native] [data-content-section], [data-config-native] [data-landing-view], [data-config-native] section'), `${id}: ${cell.getAttribute('data-catalog-config-cell')}`).not.toBeNull();
        expect(cell.querySelector('[data-config-caption]')?.textContent?.trim()).toBeTruthy();
      }
      const ids = [...root.querySelectorAll('[id]')].map(n => n.id);
      expect(new Set(ids).size, id).toBe(ids.length);
    }
    const frame = new JSDOM(rendered.find(p => p.file === 'catalog/frame.html')!.content).window.document;
    for (const ground of ['base', 'sunken', 'inverse']) {
      const native=frame.querySelector(`[data-config-ground="${ground}"] [data-content-section]`)!;
      expect(native).not.toBeNull();
      expect(native.classList.contains('bg-surface-sunken')).toBe(ground==='sunken');
      expect(native.classList.contains('bg-surface-inverse')).toBe(ground==='inverse');
    }
    for(const layout of ['stacked','split-start','split-end'])expect([...frame.querySelectorAll('[data-config-caption]')].some(n=>n.textContent?.includes(`${layout} frame`)),layout).toBe(true);
    for (const size of ['standard', 'display']) expect(frame.querySelector(`[data-config-size="${size}"] [data-content-section]`)).not.toBeNull();
    expect(frame.querySelectorAll('[data-catalog-fixture]')).toHaveLength(1);
    for (const page of rendered) {
      const root = new JSDOM(page.content).window.document;
      expect(root.querySelectorAll('main')).toHaveLength(1);
      const ids=[...root.querySelectorAll('[id]')].map(n=>n.id);expect(new Set(ids).size,page.file).toBe(ids.length);
      expect([...root.querySelectorAll('link[rel=stylesheet]')].map(n => n.getAttribute('href'))).toEqual(['../tokens.css', '../preview.css', '../brand.css']);
    }
  });
  it('shows the native distinctions behind each configuration caption', () => {
    const rendered=buildCatalogFunctionPages(sheets);
    const cell=(page:string,id:string)=>{const node=new JSDOM(rendered.find(p=>p.file===`catalog/${page}.html`)!.content).window.document.querySelector(`[data-catalog-config-cell="${id}"]`);expect(node,`${page}: ${id}`).not.toBeNull();return node!;};
    expect(cell('introduce','say-hero-compact')?.querySelector('[data-hero-size="compact"]')).not.toBeNull();
    expect(cell('show','media-record-one')?.querySelector('[data-record-ledger][data-columns="1"]')).not.toBeNull();
    expect(cell('show','media-record-three')?.querySelector('[data-record-ledger][data-columns="3"]')).not.toBeNull();
    expect(cell('show','media-converge')?.querySelector('[data-template="converge"]')).not.toBeNull();
    expect(cell('show','show-companion')?.querySelector('[data-specimen]')).not.toBeNull();
    expect(cell('show','show-companion')?.querySelector('[data-items]')).not.toBeNull();
    const keyed=readerConfigCells('Show').find(c=>c.id==='media-key')!;expect(validateSectionedViewDocument({id:'reader-keyed-companion',sections:[keyed.fixture.section]})).toEqual([]);
    expect(cell('show','media-key').querySelector('[data-specimen]')).not.toBeNull();expect(cell('show','media-key').querySelector('[data-anatomy-callouts]')).not.toBeNull();expect(cell('show','media-key').querySelector('[data-items][data-arrangement="stacked"]')).not.toBeNull();
    expect(cell('explain','items-rule')?.querySelector('[data-items][data-columns="2"][data-treatment="rule"]')).not.toBeNull();
    expect(cell('explain','features-plate')?.querySelector('[data-items][data-treatment="plate"]')).not.toBeNull();
    expect(cell('index','items-rows')?.querySelector('[data-items][data-arrangement="rows"][data-columns="2"]')).not.toBeNull();
    expect(cell('index','items-icon-groups')?.querySelectorAll('[role="group"]').length).toBe(4);
    expect(cell('index','items-disclose')?.querySelectorAll('details').length).toBe(4);
    expect(cell('sequence','items-numbered')?.querySelector('ol[data-items]')).not.toBeNull();
    expect(cell('sequence','items-connected')?.querySelector('[data-item-end="ends"]')).not.toBeNull();
    expect(new Set([...cell('sequence','items-flow-five').querySelectorAll('li[data-lane]')].map(n=>n.getAttribute('data-lane')))).toEqual(new Set(['sender','reviewer']));
    expect(cell('compare','matrix-points')?.querySelectorAll('[data-featured="true"]').length).toBe(1);
    expect(cell('compare','comparison-unfeatured')?.querySelectorAll('[data-featured="true"]').length).toBe(0);
    expect(cell('compare','matrix-visuals')?.querySelectorAll('[data-matrix-visual]').length).toBe(2);
    const parts=new JSDOM(rendered.find(p=>p.file==='catalog/parts.html')!.content).window.document;
    expect(new Set([...parts.querySelectorAll('[data-config-native] [data-specimen-part]')].map(n=>n.getAttribute('data-specimen-part')))).toEqual(new Set(['fields','status-rows','meter','table','schedule','shares','files']));
    expect(new Set([...parts.querySelectorAll('[data-config-native] [data-template]')].map(n=>n.getAttribute('data-template')))).toEqual(new Set(['converge','evidence-trail','approval-chain']));
    expect(parts.querySelector('[data-config-native] [data-part="previous"]')).not.toBeNull();
    for(const p of rendered){const root=new JSDOM(p.content).window.document;expect(root.querySelector('table[data-catalog-rules] th[scope="col"]')).not.toBeNull();
      for(const fragment of root.querySelectorAll('[data-catalog-native],[data-config-native]'))for(const node of fragment.querySelectorAll('[aria-labelledby],[aria-describedby],[aria-controls]'))for(const name of ['aria-labelledby','aria-describedby','aria-controls'])for(const id of node.getAttribute(name)?.split(/\s+/)??[])expect([...fragment.querySelectorAll('[id]')].some(n=>n.id===id),`${p.file}: ${name}=${id}`).toBe(true);
    }
  });
  it('derives reader jobs from effective content with sequence and comparison precedence', () => {
    const companion = structuredClone(READER_SAMPLES.find(f => f.id === 'frame-split-end')!.section);
    if(companion.kind !== 'content-section') throw new Error('Expected companion');
    const show=READER_SAMPLES.find(f=>f.id==='frame-split-start')!.section;
    if(show.kind!=='content-section'||show.media===undefined)throw new Error('Expected media');
    companion.media=structuredClone(show.media);
    expect(validateSectionedViewDocument({id:'reader-companion',sections:[companion]})).toEqual([]);
    expect(deriveCatalogFunction(companion)).toBe('Show');
    const parallel=structuredClone(READER_SAMPLES.find(f=>f.id==='items-plain')!.section);if(parallel.kind!=='content-section')throw new Error('Expected ideas');parallel.layout='split-start';parallel.media=structuredClone(show.media);expect(validateSectionedViewDocument({id:'reader-parallel-visual',sections:[parallel]})).toEqual([]);expect(deriveCatalogFunction(parallel)).toBe('Explain');
    for(const id of ['items-numbered','items-connected','items-flow-five']) expect(deriveCatalogFunction(READER_SAMPLES.find(f=>f.id===id)!.section)).toBe('Sequence');
    expect(deriveCatalogFunction(READER_SAMPLES.find(f=>f.id==='matrix-points')!.section)).toBe('Compare');
    expect(deriveCatalogFunction(READER_SAMPLES.find(f=>f.id==='items-disclose')!.section)).toBe('Index');
  });
  it('validates current sample shapes and approved copy without proposed retired authoring fields', () => {
    const documents=[...READER_SAMPLES.filter(f=>f.id!=='recipes-nav-composition').map(f=>({id:`reader-test-${f.id}`,sections:[f.section]})), READER_COMPOSITION];
    const before=JSON.stringify(documents);
    const words=(text:string|undefined)=>text?.trim().split(/\s+/).length??0;
    for(const authored of documents) {
      expect(validateSectionedViewDocument(authored), authored.id).toEqual([]);
      const resolved=resolveSectionedViewDocument(authored,readerCopyResolver);
      expect(resolved.resolutions.length).toBeGreaterThan(0);
      for(const section of authored.sections) if(section.kind==='content-section') {
        expect(Object.hasOwn(section,'align')).toBe(false); expect(section.size).not.toBe('compact');
        if(section.media?.type==='specimen'&&section.media.key)expect(Object.hasOwn(section.media.key,'side')).toBe(false);
        if(section.block?.type==='items') {expect(Object.hasOwn(section.block,'emphasis')).toBe(false);expect(Reflect.get(section.block,'recipe')).not.toBe('flow');for(const item of section.block.items)expect(Object.hasOwn(item,'featured')).toBe(false);}
      }
      for(const section of resolved.sections) {
        if(section.kind==='hero'){expect(words(section.heading)).toBeLessThanOrEqual(10);expect(words(section.description)).toBeLessThanOrEqual(35);continue;}
        if(section.kind!=='content-section')throw new Error('Expected canonical band');
        expect(words(section.heading),section.id).toBeLessThanOrEqual(section.layout==='stacked'?10:8);
        expect(words(section.description),section.id).toBeLessThanOrEqual(30);
        if(section.block?.type==='items')for(const item of section.block.items){const b=section.block;expect(words(item.heading),section.id).toBeLessThanOrEqual(b.order==='connected'?2:b.scale==='statement'?3:b.reveal==='disclose'?12:5);expect(words(item.meta),section.id).toBeLessThanOrEqual(b.order==='connected'?2:5);expect(words(item.description),section.id).toBeLessThanOrEqual(b.reveal==='disclose'?45:b.scale==='statement'?12:25);if(b.reveal==='disclose')expect(words(item.description),section.id).toBeGreaterThanOrEqual(15);}
        if(section.block?.type==='matrix')expect(new Set(section.block.sides.flatMap(s=>s.points??[])).size).toBe(section.block.sides.flatMap(s=>s.points??[]).length);
      }
    }
    expect(JSON.stringify(documents)).toBe(before);
  });
});
