import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { resolveSectionedViewDocument, validateSectionedViewDocument } from '../../core/index.js';
import { READER_SAMPLES, READER_COMPOSITION, readerCopyResolver, readerPage, deriveCatalogFunction, resolveReaderSampleDocument } from './reader-data.js';
import { readerConfigCells, READER_PAGES, renderReaderSample } from './reader-renderer.js';
import { CATALOG_FIXTURES, CATALOG_COMPOSITIONS } from './index.js';
import { buildContentCatalogHtml, buildCatalogFunctionPages } from '../render-content-catalog.js';
const catalogDom = (html: string) => new JSDOM(html, { url: 'https://example.test/' });
const sheets = { designerTokens: 'tokens.css', utilities: 'preview.css', brand: 'brand.css' };
const pages = ['overview', 'introduce', 'show', 'explain', 'index-function', 'sequence', 'compare', 'frame', 'parts'];
const kinds = { hero: 'introduce', 'feature-grid': 'explain', faq: 'index-function', 'status-list': 'index-function', 'ordered-step-sequence': 'sequence', pricing: 'compare', 'stat-grid': 'show', stat: 'show', testimonial: 'show' };
// Copy and instance identity do not make a configuration a different example.
function nativeShape(value: unknown): unknown {
    if (Array.isArray(value))
        return value.map(nativeShape);
    if (value === null || typeof value !== 'object')
        return value;
    const record = value as Record<string, unknown>;
    if (Object.keys(record).length === 1 && typeof record.id === 'string')
        return '[copy]';
    return Object.fromEntries(Object.entries(record).filter(([key]) => !['id', 'heading', 'description', 'label', 'title', 'meta', 'caption', 'eyebrow', 'href'].includes(key)).map(([key, item]) => [key, nativeShape(item)]));
}
// Compare rendered structure independently of authored descriptors and instance copy.
function renderedShape(fragment: Element): string {
    const clone = fragment.cloneNode(true) as Element;
    const identity = new Set(['id', 'href', 'xlink:href', 'aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-owns', 'aria-details', 'headers', 'for', 'list', 'form', 'aria-label', 'alt', 'title', 'data-matrix-side']);
    for (const node of [clone, ...clone.querySelectorAll('*')]) {
        for (const attribute of [...node.attributes]) {
            if (identity.has(attribute.name) || attribute.name.endsWith('-id'))
                node.removeAttribute(attribute.name);
            else if (attribute.value.includes('url(#'))
                node.setAttribute(attribute.name, attribute.value.replace(/url\(#[^)]+\)/g, 'url(#target)'));
        }
        for (const child of [...node.childNodes])
            if (child.nodeType === 3)
                child.remove();
    }
    clone.removeAttribute('data-catalog-native');
    clone.removeAttribute('data-config-native');
    return clone.innerHTML;
}
const expectedAxes: Record<string, Record<string, string[]>> = {
    introduce: { role: ['hero', 'intro', 'close'], 'hero-size': ['display', 'compact'], 'intro-layout': ['stacked', 'split'] },
    show: { visual: ['specimen', 'specimen-key', 'record', 'scene'], companion: ['none', 'index-rows', 'explain-stack'], layout: ['stacked', 'split-start', 'split-end'] },
    explain: { shape: ['grid-2', 'grid-3', 'bento', 'stack'], treatment: ['plain', 'rule', 'plate'], scale: ['item', 'statement'] },
    'index-function': { shape: ['rows-1', 'rows-2', 'tiles'], reveal: ['all', 'disclose'], groups: ['off', 'on'] },
    sequence: { shape: ['list', 'line', 'lanes'], end: ['ends', 'continues'] },
    compare: { form: ['points', 'visual'], featured: ['none', 'one-side'] },
    frame: { layout: ['stacked', 'split-start', 'split-end'], size: ['standard', 'display'], ground: ['base', 'sunken', 'inverse'] },
    overview: {}, parts: {},
};
const expectedCells: Record<string, string[]> = { Show: ['keyed-stack'], Explain: ['features-plate'], Index: ['status-list'], Compare: ['comparison-unfeatured'] };
describe('reader function catalog', () => {
    it('offers six reader jobs with overview and shared references', () => {
        const root = catalogDom(buildContentCatalogHtml(sheets)).window.document;
        expect([...root.querySelectorAll('[data-catalog-function]')].map(n => n.getAttribute('data-catalog-function'))).toEqual(pages);
        expect(root.body.textContent).toContain('What does the reader need to do with this information?');
        const link = root.querySelector('[data-catalog-function] > a')!;
        expect(root.defaultView!.getComputedStyle(link).textDecorationLine).toBe('underline');
        expect(root.body.textContent).not.toContain('Other kinds');
        const chooser = root.querySelector('nav[aria-label="Catalog functions"] ul')!;
        expect(root.defaultView!.getComputedStyle(chooser).display).toBe('grid');
        expect(chooser.classList.contains('catalog-function-grid')).toBe(true);
    });
    it('renders exactly 32 retained samples with reader-job captions and distinct headings', () => {
        const rendered = buildCatalogFunctionPages(sheets);
        expect(rendered.map(p => p.file)).toEqual(pages.map(id => `catalog/${id}.html`));
        const samples = rendered.flatMap(p => [...catalogDom(p.content).window.document.querySelectorAll('[data-catalog-fixture]')]);
        expect(samples).toHaveLength(32);
        expect(Object.fromEntries(['Overview', 'Introduce', 'Show', 'Explain', 'Index', 'Sequence', 'Compare', 'Frame', 'Parts'].map(fn => [fn, READER_SAMPLES.filter(f => readerPage(f) === fn).length]))).toEqual({ Overview: 1, Introduce: 5, Show: 9, Explain: 6, Index: 5, Sequence: 3, Compare: 2, Frame: 1, Parts: 0 });
        expect(new Set(samples.map(n => n.id)).size).toBe(32);
        for (const sample of samples)
            expect(sample.querySelector('[data-catalog-caption]')?.textContent).toMatch(/(?:Introduce|Show|Explain|Index|Sequence|Compare|Overview|Frame|Parts) › /);
        const headings = samples.map(n => n.querySelector('[data-catalog-native] h1, [data-catalog-native] h2')?.textContent);
        expect(headings.every(Boolean)).toBe(true);
        expect(new Set(headings).size).toBe(32);
    });
    it('shows prose as a sample without adding axis or configuration values', () => {
        const rendered = buildCatalogFunctionPages(sheets);
        const root = catalogDom(rendered.find(page => page.file === 'catalog/explain.html')!.content).window.document;
        const sample = root.querySelector('[data-catalog-fixture="recipes-prose"]');
        expect(sample).not.toBeNull();
        expect(sample?.querySelectorAll('p[data-prose-paragraph]')).toHaveLength(2);
        expect(sample?.querySelectorAll('[data-catalog-axis-witness]')).toHaveLength(0);
        const documents = rendered.map(page => catalogDom(page.content).window.document);
        expect(documents.reduce((count, page) => count + page.querySelectorAll('[data-catalog-fixture]').length, 0)).toBe(32);
        expect(documents.reduce((count, page) => count + page.querySelectorAll('[data-catalog-config-cell]').length, 0)).toBe(4);
        const overview = documents[0]!;
        expect(overview.querySelector('[data-catalog-recipe="prose"] a')?.getAttribute('href')).toBe('explain.html#example-recipes-prose');
    });
    it('files all nine unchanged published kinds under their actual reader jobs', () => {
        const rendered = buildCatalogFunctionPages(sheets);
        const found: Record<string, string> = {};
        for (const page of rendered)
            for (const node of catalogDom(page.content).window.document.querySelectorAll('[data-published-kind]')) {
                found[node.getAttribute('data-published-kind')!] = page.file.split('/')[1]!.replace('.html', '');
                expect(node.querySelector('a')?.getAttribute('href')).toMatch(/^\.\.\/gallery\.html#published-kind-/);
            }
        expect(found).toEqual(kinds);
    });
    it('renders each native sample once and keeps the complete catalog below forty examples', () => {
        const rendered = buildCatalogFunctionPages(sheets);
        let count = 0;
        for (const page of rendered) {
            const root = catalogDom(page.content).window.document;
            count += root.querySelectorAll('[data-catalog-native], [data-config-native]').length;
            const native = [...root.querySelectorAll('[data-catalog-native], [data-config-native]')];
            const fingerprints = native.map(renderedShape);
            expect(new Set(fingerprints).size, page.file).toBe(fingerprints.length);
            const captions = [...root.querySelectorAll('[data-catalog-caption], [data-config-caption]')].map(node => node.textContent?.trim());
            expect(new Set(captions).size, page.file).toBe(captions.length);
            const samples = READER_SAMPLES.filter(sample => readerPage(sample) === READER_PAGES.find(definition => `catalog/${definition.id}.html` === page.file)?.label);
            for (const cell of readerConfigCells(READER_PAGES.find(definition => `catalog/${definition.id}.html` === page.file)!.label)) {
                expect(samples.some(sample => JSON.stringify(nativeShape(sample.section)) === JSON.stringify(nativeShape(cell.fixture.section))), `${page.file}: ${cell.id}`).toBe(false);
                expect(validateSectionedViewDocument({ id: `reader-cell-${cell.id}`, sections: [cell.fixture.section] }), cell.id).toEqual([]);
            }
            expect(root.querySelectorAll('h1'), page.file).toHaveLength(1);
            expect(root.querySelectorAll('main')).toHaveLength(1);
            const ids = [...root.querySelectorAll('[id]')].map(node => node.id);
            expect(new Set(ids).size, page.file).toBe(ids.length);
            for (const fragment of root.querySelectorAll('[data-catalog-native], [data-config-native]')) {
                for (const node of fragment.querySelectorAll('[aria-labelledby], [aria-describedby], [aria-controls]')) {
                    for (const attribute of ['aria-labelledby', 'aria-describedby', 'aria-controls']) {
                        for (const id of node.getAttribute(attribute)?.split(/\s+/) ?? []) {
                            expect([...fragment.querySelectorAll('[id]')].some(target => target.id === id), `${page.file}: ${attribute}=${id}`).toBe(true);
                        }
                    }
                }
            }
        }
        expect(count).toBe(36);
        expect(count).toBeLessThanOrEqual(40);
        const parts = catalogDom(rendered.find(page => page.file === 'catalog/parts.html')!.content).window.document;
        expect(parts.querySelectorAll('[data-config-native], [data-catalog-native]')).toHaveLength(0);
        expect(parts.querySelector('a[href="show.html#example-media-key"]')).not.toBeNull();
    });
    it('renders the distinct variants and retained native semantics on their actual pages', () => {
        const byFile = new Map(buildCatalogFunctionPages(sheets).map(page => [page.file, catalogDom(page.content).window.document]));
        const cell = (page: string, id: string) => {
            const node = byFile.get(`catalog/${page}.html`)!.querySelector(`[data-catalog-config-cell="${id}"]`);
            expect(node, id).not.toBeNull();
            return node!;
        };
        expect(byFile.get('catalog/show.html')!.querySelector('[data-catalog-config-cell="show-companion"]')).toBeNull();
        const rows = byFile.get('catalog/show.html')!.querySelector('#example-items-badge-meta')!;
        expect(rows.querySelector('[data-specimen-panel]')).not.toBeNull();
        expect(rows.querySelector('[data-items][data-arrangement="rows"]')).not.toBeNull();
        const stack = cell('show', 'keyed-stack');
        expect(stack.querySelector('[data-specimen-panel]')).not.toBeNull();
        expect(stack.querySelector('[data-anatomy-callouts]')).not.toBeNull();
        expect(stack.querySelector('[data-items][data-arrangement="stacked"]')).not.toBeNull();
        expect(cell('explain', 'features-plate').querySelector('[data-items][data-treatment="plate"]')).not.toBeNull();
        const unfeatured = cell('compare', 'comparison-unfeatured');
        expect(unfeatured.querySelector('[data-matrix]')).not.toBeNull();
        expect(unfeatured.querySelectorAll('[data-matrix-side]')).toHaveLength(2);
        expect(unfeatured.querySelectorAll('[data-featured="true"]')).toHaveLength(0);
        const index = byFile.get('catalog/index-function.html')!;
        expect(index.querySelectorAll('#example-items-disclose details')).toHaveLength(4);
        expect(index.querySelectorAll('#example-items-icon-groups [role="group"]')).toHaveLength(4);
        const sequence = byFile.get('catalog/sequence.html')!;
        expect(sequence.querySelector('#example-items-numbered ol')).not.toBeNull();
        expect(new Set([...sequence.querySelectorAll('#example-items-flow-five li[data-lane]')].map(node => node.getAttribute('data-lane')))).toEqual(new Set(['sender', 'reviewer']));
        expect(sequence.querySelector('#example-items-flow-five [data-item-end-label]')?.textContent).toContain('Returns to review');
        const show = byFile.get('catalog/show.html')!;
        expect(show.querySelector('#example-media-meter-previous [data-part="previous"]')).not.toBeNull();
        expect(show.querySelector('#example-media-meter-previous')?.textContent).toContain('Previously 30 GB');
        expect(show.querySelectorAll('#example-items-badge-meta [data-item-meta]')).toHaveLength(6);
        expect(show.querySelector('[data-catalog-rules]')?.textContent).toContain('final group may contain an owner instead');
        for (const page of byFile.values()) {
            const wrappers = [...page.querySelectorAll('[data-catalog-native], [data-config-native]')];
            for (const node of page.querySelectorAll('[data-content-section], [data-ds-leaf="sections.hero"]')) {
                expect(wrappers.filter(wrapper => wrapper.contains(node))).toHaveLength(1);
            }
            for (const wrapper of wrappers) {
                const boundaries = [...wrapper.querySelectorAll('[data-content-section], [data-ds-leaf="sections.hero"]')];
                const top = boundaries.filter(node => !boundaries.some(parent => parent !== node && parent.contains(node)));
                expect(top, wrapper.parentElement?.id).toHaveLength(wrapper.hasAttribute('data-catalog-composition') ? 6 : 1);
            }
        }
    });
    it('declares bounded real axes and documents their effect and choice as text', () => {
        const rendered = buildCatalogFunctionPages(sheets);
        for (const definition of READER_PAGES) {
            const axes = Reflect.get(definition, 'axes') as Array<{
                name: string;
                values: string[];
                effect: string;
                when: string;
            }> | undefined;
            expect(axes, definition.id).toBeDefined();
            expect(Object.fromEntries(axes!.map(axis => [axis.name, axis.values])), definition.id).toEqual(expectedAxes[definition.id]);
            expect(new Set(axes!.map(axis => axis.name)).size).toBe(axes!.length);
            expect(axes!.length, definition.id).toBeLessThanOrEqual(3);
            for (const axis of axes!) {
                expect(axis.name).not.toBe(definition.id);
                expect(axis.values.length, axis.name).toBeLessThanOrEqual(4);
                expect(axis.values.length, axis.name).toBeGreaterThan(0);
                expect(new Set(axis.values).size).toBe(axis.values.length);
                expect(axis.effect.trim()).toBeTruthy();
                expect(axis.when.trim()).toBeTruthy();
            }
            const root = catalogDom(rendered.find(page => page.file === `catalog/${definition.id}.html`)!.content).window.document;
            const table = root.querySelector('table[data-catalog-axes]');
            if (axes!.length === 0) {
                expect(table, definition.id).toBeNull();
                continue;
            }
            expect(table, definition.id).not.toBeNull();
            const region = table!.closest('[role="region"]');
            expect(region, definition.id).not.toBeNull();
            expect(region?.getAttribute('aria-label')).toBe(`${definition.label} configuration reference`);
            expect(region?.getAttribute('tabindex')).toBe('0');
            expect(table!.classList.contains('catalog-table')).toBe(true);
            expect([...table!.querySelectorAll('thead th')].map(node => node.textContent)).toEqual(['Axis', 'Values', 'Effect', 'When']);
            for (const axis of axes!) {
                const row = table!.querySelector(`[data-catalog-axis="${axis.name}"]`);
                expect(row, axis.name).not.toBeNull();
                expect(row!.querySelector('th')?.textContent).toBe(axis.name.replaceAll('-', ' '));
                const cells = [...row!.querySelectorAll('td')];
                expect(cells).toHaveLength(3);
                for (const value of axis.values)
                    expect(cells[0]!.textContent).toContain(value);
                expect(cells[1]!.textContent).toBe(axis.effect);
                expect(cells[2]!.textContent).toBe(axis.when);
            }
        }
        const chooser = catalogDom(buildContentCatalogHtml(sheets)).window.document;
        expect(chooser.title).toBe('Content catalog');
        expect(chooser.querySelectorAll('h1')).toHaveLength(1);
        for (const definition of READER_PAGES)
            expect([...chooser.querySelectorAll(`[data-catalog-function="${definition.id}"] [data-catalog-axis]`)].map(node => node.getAttribute('data-catalog-axis'))).toEqual(Object.keys(expectedAxes[definition.id]!));
        expect(chooser.querySelector('ul[role="list"]')).not.toBeNull();
        expect(chooser.querySelector('[data-catalog-function="explain"]')?.textContent).toMatch(/Index/);
        expect(chooser.querySelector('[data-catalog-function="show"]')?.textContent).toMatch(/Introduce/);
        expect(chooser.querySelector('[data-catalog-function="sequence"]')?.textContent).toMatch(/Compare/);
        expect(chooser.querySelector('[data-catalog-axis="overview"]')).toBeNull();
    });
    it('uses concrete sample copy and keeps raw authored retired-field assertions independent of preparation', () => {
        const routes: string[] = [];
        const collectRoutes = (value: unknown): void => {
            if (value === null || typeof value !== 'object')
                return;
            if (Array.isArray(value)) {
                value.forEach(collectRoutes);
                return;
            }
            for (const [key, item] of Object.entries(value)) {
                if (key === 'href' && typeof item === 'string')
                    routes.push(item);
                else
                    collectRoutes(item);
            }
        };
        READER_SAMPLES.forEach(sample => collectRoutes(sample.section));
        collectRoutes(READER_COMPOSITION);
        expect(routes.length).toBeGreaterThan(0);
        for (const route of routes)
            expect(route).toMatch(/^\/catalog\/[a-z-]+\.html#example-[a-z-]+$/);
        for (const page of buildCatalogFunctionPages(sheets)) {
            const root = catalogDom(page.content).window.document;
            const copyRoot = root.body.cloneNode(true) as HTMLElement;
            const captions = [...copyRoot.querySelectorAll('#example-items-connected [data-item-caption]')];
            expect(captions, page.file).toHaveLength(page.file === 'catalog/sequence.html' ? 1 : 0);
            for (const caption of captions) {
                expect(caption.textContent).toBe('Sample data. Each step leaves context for the next person.');
                caption.remove();
            }
            const ruleCells = [...copyRoot.querySelectorAll('[data-catalog-rules] td')].filter(cell => cell.textContent?.includes('Visual steps need a Sample data caption.'));
            expect(ruleCells, page.file).toHaveLength(page.file === 'catalog/sequence.html' ? 1 : 0);
            for (const cell of ruleCells)
                cell.textContent = cell.textContent!.replace('Visual steps need a Sample data caption.', '');
            const copy = copyRoot.textContent!;
            expect(copy, page.file).not.toMatch(/\bSample\b|Project detail \d|Project note|Project heading|Project value|Project field/);
            for (const link of root.querySelectorAll('[data-catalog-native] a[href], [data-config-native] a[href]')) {
                expect(link.getAttribute('href'), page.file).not.toMatch(/^\/sample/);
                expect(link.getAttribute('href'), page.file).not.toMatch(/^\/catalog\//);
            }
        }
        const authored = [...CATALOG_FIXTURES.map(fixture => fixture.section), ...Object.values(CATALOG_COMPOSITIONS).flatMap(document => document.sections)];
        expect(authored.some(section => section.kind === 'hero' && section.size === 'compact')).toBe(true);
        expect(authored.some(section => section.kind === 'content-section' && section.block?.type === 'matrix' && section.block.featured !== undefined)).toBe(true);
        expect(authored.filter(section => section.kind === 'content-section')).not.toHaveLength(0);
        expect(authored.some(section => section.kind === 'content-section' && section.media?.type === 'specimen' && section.media.key)).toBe(true);
        expect(authored.some(section => section.kind === 'content-section' && section.block?.type === 'items')).toBe(true);
        for (const section of authored)
            if (section.kind === 'content-section') {
                expect(Object.hasOwn(section, 'align')).toBe(false);
                expect(Object.hasOwn(section, 'compact')).toBe(false);
                expect(section.size).not.toBe('compact');
                if (section.media?.type === 'specimen' && section.media.key)
                    expect(Object.hasOwn(section.media.key, 'side')).toBe(false);
                if (section.block?.type === 'items') {
                    expect(Object.hasOwn(section.block, 'emphasis')).toBe(false);
                    expect(Reflect.get(section.block, 'recipe')).not.toBe('flow');
                    for (const item of section.block.items)
                        expect(Object.hasOwn(item, 'featured')).toBe(false);
                }
            }
    });
    it('gives every declared axis value a genuine rendered witness with matching caption vocabulary', () => {
        const rendered = new Map(buildCatalogFunctionPages(sheets).map(page => [page.file, catalogDom(page.content).window.document]));
        // Independently derive the existing model's effective axes, without trusting caption attributes.
        const values = (fixture: typeof READER_SAMPLES[number], label: string): Record<string, string> => {
            const section = resolveReaderSampleDocument(fixture).sections[0]!;
            if (section.kind === 'hero') return label === 'Introduce' ? { role: 'hero', 'hero-size': section.size ?? 'display' } : {};
            if (section.kind !== 'content-section') throw new Error('Expected canonical witness');
            if (label === 'Frame') return { layout: section.layout, size: section.size, ground: section.ground };
            const block = section.block;
            if (label === 'Introduce') return { role: fixture.id === 'say-close' ? 'close' : 'intro', ...(fixture.id === 'say-close' ? {} : { 'intro-layout': section.layout === 'stacked' ? 'stacked' : 'split' }) };
            if (label === 'Show') return { visual: section.media?.type === 'specimen' ? (section.media.key ? 'specimen-key' : 'specimen') : section.media!.type, companion: block?.type === 'items' ? (block.arrangement === 'stacked' ? 'explain-stack' : 'index-rows') : 'none', layout: section.layout };
            if (block?.type === 'matrix') return { form: block.sides[0]!.visual ? 'visual' : 'points', featured: block.featured ? 'one-side' : 'none' };
            if (block?.type === 'prose') return {};
            if (block?.type !== 'items') throw new Error('Expected items witness');
            if (label === 'Sequence') return { shape: block.lanes ? 'lanes' : block.order === 'numbered' ? 'list' : 'line', ...(block.order === 'connected' ? { end: block.end ?? 'ends' } : {}) };
            if (label === 'Index') return { shape: fixture.section.kind === 'content-section' && fixture.section.block?.type === 'items' && fixture.section.block.recipe === 'link-index' ? 'tiles' : `rows-${block.columns}`, reveal: block.reveal, groups: block.groups ? 'on' : 'off' };
            return { shape: block.arrangement === 'columns' ? `grid-${block.columns}` : block.arrangement === 'stacked' ? 'stack' : block.arrangement, treatment: block.treatment, scale: block.scale };
        };
        const observeNative = (wrapper: Element, label: string): Record<string, string> => {
            const required = (selector: string, scope: Element = wrapper): Element => {
                const element = scope.querySelector(selector);
                expect(element, `native witness ${label}: ${selector}`).not.toBeNull();
                return element!;
            };
            if (label === 'Introduce' && wrapper.querySelector('[data-ds-leaf="sections.hero"]')) {
                const intro = required('[data-ds-leaf="sections.hero"] [data-section-intro]');
                return { role: 'hero', 'hero-size': intro.getAttribute('data-section-intro') === 'section' ? 'compact' : 'display' };
            }
            const section = required('[data-content-section]');
            const layout = section.getAttribute('data-layout') ?? 'stacked';
            if (layout === 'stacked') expect(section.classList.contains('flex-col')).toBe(true);
            if (label === 'Frame') {
                const size = section.classList.contains('desktop:py-frame-display') ? 'display' : 'standard';
                expect(section.classList.contains(size === 'display' ? 'py-5xl' : 'py-4xl')).toBe(true);
                const ground = section.classList.contains('bg-surface-inverse') ? 'inverse' : section.classList.contains('bg-surface-sunken') ? 'sunken' : 'base';
                expect(required('h2', section).className).toContain(ground === 'inverse' ? 'text-ink-on-inverse' : 'text-ink-primary');
                return { layout, size, ground };
            }
            if (label === 'Introduce') {
                if (section.classList.contains('desktop:py-frame-display') && section.classList.contains('bg-surface-inverse') && section.querySelector('a[href]') && !section.querySelector('[data-items], [data-content-section-media]')) return { role: 'close' };
                return { role: 'intro', 'intro-layout': layout === 'stacked' ? 'stacked' : 'split' };
            }
            if (label === 'Show') {
                const media = required('[data-content-section-media]', section);
                const visual = media.querySelector('[data-anatomy-callouts]') ? 'specimen-key' : media.querySelector('[data-specimen-panel]') ? 'specimen' : media.querySelector('[data-record-ledger]') ? 'record' : media.querySelector('figure.scene-root[data-template]') ? 'scene' : undefined;
                expect(visual).toBeDefined();
                const companions = [...section.querySelectorAll('[data-items]')].filter(node => !media.contains(node));
                expect(companions.length).toBeLessThanOrEqual(1);
                return { visual: visual!, companion: companions.length === 0 ? 'none' : companions[0]!.getAttribute('data-arrangement') === 'stacked' ? 'explain-stack' : 'index-rows', layout };
            }
            if (label === 'Compare') {
                const matrix = required('[data-matrix]');
                const sides = [...matrix.querySelectorAll('[data-matrix-side]')];
                expect(sides).toHaveLength(2);
                const visual = sides.every(side => side.querySelector('[data-matrix-visual]'));
                if (!visual) for (const side of sides) expect(side.querySelectorAll('ul > li').length).toBeGreaterThanOrEqual(2);
                const featured = matrix.querySelectorAll('[data-featured="true"]');
                expect(featured.length).toBeLessThanOrEqual(1);
                return { form: visual ? 'visual' : 'points', featured: featured.length ? 'one-side' : 'none' };
            }
            if (label === 'Explain' && section.querySelector('p[data-prose-paragraph]')) {
                expect(section.querySelectorAll('p[data-prose-paragraph]').length).toBeGreaterThan(0);
                return {};
            }
            const items = required('[data-items]');
            const details = items.querySelectorAll('details');
            const headings = [...items.querySelectorAll(details.length ? 'summary [data-item-heading]' : '[data-item-heading]')];
            expect(headings.length).toBeGreaterThan(0);
            if (details.length) for (const detail of details) { required('summary [data-item-heading]', detail); expect(detail.textContent!.trim().length).toBeGreaterThan(detail.querySelector('summary')!.textContent!.trim().length); }
            const arrangement = items.getAttribute('data-arrangement');
            const columns = items.getAttribute('data-columns');
            if (label === 'Sequence') {
                expect(items.tagName).toBe('OL');
                expect(items.querySelectorAll('[data-item-ordinal]').length).toBeGreaterThan(0);
                const end = items.querySelector('[data-item-end]');
                const lanes = items.querySelectorAll('li[data-lane]');
                if (lanes.length) expect(new Set([...lanes].map(node => node.getAttribute('data-lane')))).toEqual(new Set(['sender', 'reviewer']));
                return { shape: lanes.length ? 'lanes' : end ? 'line' : 'list', ...(end ? { end: end.getAttribute('data-item-end')! } : {}) };
            }
            if (label === 'Index') {
                if (details.length) expect(details.length).toBe(headings.length);
                expect(arrangement).toBe('rows');
                const tiles = columns === '3';
                if (tiles) {
                    expect(items.getAttribute('data-treatment')).toBe('plate');
                    expect(details.length).toBe(0);
                    const plates = [...items.querySelectorAll(':scope > li > [data-item][data-variant="plate"]')];
                    expect(plates.length).toBe(headings.length);
                    for (const heading of headings) {
                        expect(plates.includes(heading.closest('[data-item][data-variant="plate"]')!)).toBe(true);
                        expect(heading.querySelectorAll('a[href]')).toHaveLength(1);
                    }
                } else expect(['1', '2']).toContain(columns);
                return { shape: tiles ? 'tiles' : `rows-${columns}`, reveal: details.length ? 'disclose' : 'all', groups: items.querySelector('[role="group"]') ? 'on' : 'off' };
            }
            const treatment = items.getAttribute('data-treatment');
            expect(treatment).not.toBeNull();
            const statement = headings.every(heading => heading.classList.contains('text-h0'));
            const headingScale = statement ? 'text-h0' : section.classList.contains('desktop:py-frame-display') ? 'text-h1' : 'text-h2';
            for (const heading of headings) {
                expect(heading.classList.contains(headingScale)).toBe(true);
                for (const otherScale of ['text-h0', 'text-h1', 'text-h2', 'text-h3', 'text-body-l'])
                    if (otherScale !== headingScale) expect(heading.classList.contains(otherScale)).toBe(false);
            }
            return { shape: arrangement === 'columns' ? `grid-${columns}` : arrangement === 'stacked' ? 'stack' : arrangement!, treatment: treatment!, scale: statement ? 'statement' : 'item' };
        };
        for (const definition of READER_PAGES) {
            const page = rendered.get(`catalog/${definition.id}.html`)!;
            const fixtures = [...READER_SAMPLES.filter(sample => readerPage(sample) === definition.label), ...readerConfigCells(definition.label).map(cell => cell.fixture)];
            if (definition.axes.length) for (const wrapper of page.querySelectorAll('[data-catalog-fixture], [data-catalog-config-cell]')) {
                const sampleId = wrapper.getAttribute('data-catalog-fixture');
                const cellId = wrapper.getAttribute('data-catalog-config-cell');
                const fixture = sampleId ? READER_SAMPLES.find(sample => sample.id === sampleId)! : readerConfigCells(definition.label).find(cell => cell.id === cellId)!.fixture;
                const expected = values(fixture, definition.label);
                const native = observeNative(wrapper, definition.label);
                expect(native, `${definition.label}: ${sampleId ?? cellId}`).toEqual(expected);
                const claims = [...wrapper.querySelectorAll('[data-catalog-axis-witness]')];
                expect(claims.length).toBe(Object.keys(expected).length);
                expect(Object.fromEntries(claims.map(claim => { const pair = claim.getAttribute('data-catalog-axis-witness')!.split(':'); expect(claim.closest('[data-catalog-caption], [data-config-caption]')).not.toBeNull(); expect(claim.textContent).toBe(`${pair[0]}: ${pair[1]}`); return pair; }))).toEqual(expected);
                for (const [name, value] of Object.entries(expected)) expect(definition.axes.find(axis => axis.name === name)?.values, `${name}: ${value}`).toContain(value);
            }
            for (const axis of definition.axes) for (const value of axis.values) {
                if (definition.label === 'Frame') {
                    const reference = page.querySelector(`[data-catalog-axis-reference="${axis.name}:${value}"]`);
                    expect(reference, `Frame ${axis.name}:${value}`).not.toBeNull();
                    expect(page.defaultView!.getComputedStyle(reference!).textDecorationLine, `Frame ${axis.name}:${value} link affordance`).toBe('underline');
                    const [file, id] = reference!.getAttribute('href')!.split('#');
                    const example = rendered.get(`catalog/${file}`)!.querySelector(`#${id}`);
                    expect(example, reference!.getAttribute('href')!).not.toBeNull();
                    const fixture = READER_SAMPLES.find(sample => `example-${sample.id}` === id)!;
                    expect(values(fixture, 'Frame')[axis.name]).toBe(value);
                    expect(observeNative(example!, 'Frame')[axis.name]).toBe(value);
                    expect(reference!.textContent).toBe(`${axis.name}: ${value}`);
                    expect(example!.querySelector('[data-content-section]')).not.toBeNull();
                } else {
                    const witnesses = fixtures.filter(fixture => values(fixture, definition.label)[axis.name] === value);
                    expect(witnesses.length, `${definition.label} ${axis.name}:${value}`).toBeGreaterThan(0);
                    const nodes = [...page.querySelectorAll(`[data-catalog-axis-witness="${axis.name}:${value}"]`)];
                    expect(nodes.length, `${definition.label} ${axis.name}:${value}`).toBeGreaterThan(0);
                    for (const node of nodes) {
                        expect(node.textContent).toBe(`${axis.name}: ${value}`);
                        const wrapper = node.closest('[data-catalog-fixture], [data-catalog-config-cell]')!;
                        expect(wrapper.querySelector('[data-catalog-native], [data-config-native]')).not.toBeNull();
                        const sampleId = wrapper.getAttribute('data-catalog-fixture');
                        const cellId = wrapper.getAttribute('data-catalog-config-cell');
                        const fixture = sampleId ? READER_SAMPLES.find(sample => sample.id === sampleId)! : readerConfigCells(definition.label).find(cell => cell.id === cellId)!.fixture;
                        expect(values(fixture, definition.label)[axis.name]).toBe(value);
                        expect(observeNative(wrapper, definition.label)[axis.name]).toBe(value);
                    }
                }
            }
        }
    });
    it('insets native SectionedView bands and configuration cells exactly once', () => {
        for (const page of buildCatalogFunctionPages(sheets)) {
            const root = catalogDom(page.content).window.document;
            const rules = [...root.styleSheets[0]!.cssRules].filter(rule => 'selectorText' in rule) as CSSStyleRule[];
            const insetRule = rules.find(rule => rule.selectorText === ':is([data-catalog-native],[data-config-native])>div:not([data-landing-view])>[data-content-section]');
            expect(insetRule, page.file).toBeDefined();
            expect(insetRule!.style.getPropertyValue('padding-inline')).toBe('var(--ui-width-page-padding-x, clamp(16px, 4vw, 48px))');
            expect(root.querySelector('style')!.textContent, page.file).not.toMatch(/var\(--[a-z0-9-]+\)/);
            expect(rules.find(rule => rule.selectorText === '.catalog-example>div')!.style.getPropertyValue('padding-inline')).toBe('');
            for (const wrapper of root.querySelectorAll('[data-catalog-native], [data-config-native]')) {
                // Inspect the same direct-child relationship without the selector engine's
                // unsupported nested :is/:not combination; the CSS selector stays pinned above.
                const band = [...wrapper.children].some(child => child.tagName === 'DIV' && !child.hasAttribute('data-landing-view') && [...child.children].some(node => node.hasAttribute('data-content-section')));
                expect(band, wrapper.parentElement?.id).toBe(Boolean(wrapper.querySelector('[data-content-section]')));
            }
            expect(rules.find(rule => rule.selectorText === '.catalog-note')?.style.getPropertyValue('overflow-wrap')).toBe('break-word');
        }
    });
    it('uses distinct library-health and storage-history panel copy on Show', () => {
        const show = catalogDom(buildCatalogFunctionPages(sheets).find(page => page.file === 'catalog/show.html')!.content).window.document;
        const health = show.querySelector('#example-items-badge-meta')!;
        const history = show.querySelector('#example-media-meter-previous')!;
        expect(health.textContent).toContain('Library health');
        expect(health.textContent).toContain('Index owner');
        expect(history.textContent).toContain('Document storage');
        expect(history.textContent).toContain('Previously 30 GB');
        expect(health.textContent).not.toContain('Review capacity');
        expect(history.textContent).not.toContain('Workspace health');
        expect(history.querySelector('[data-part="previous"]')).not.toBeNull();
    });
    it('derives reader jobs from effective content with sequence and comparison precedence', () => {
        const companion = structuredClone(READER_SAMPLES.find(f => f.id === 'frame-split-end')!.section);
        if (companion.kind !== 'content-section')
            throw new Error('Expected companion');
        const show = READER_SAMPLES.find(f => f.id === 'frame-split-start')!.section;
        if (show.kind !== 'content-section' || show.media === undefined)
            throw new Error('Expected media');
        companion.media = structuredClone(show.media);
        expect(validateSectionedViewDocument({ id: 'reader-companion', sections: [companion] })).toEqual([]);
        expect(deriveCatalogFunction(companion)).toBe('Show');
        const parallel = structuredClone(READER_SAMPLES.find(f => f.id === 'items-plain')!.section);
        if (parallel.kind !== 'content-section')
            throw new Error('Expected ideas');
        parallel.layout = 'split-start';
        parallel.media = structuredClone(show.media);
        expect(validateSectionedViewDocument({ id: 'reader-parallel-visual', sections: [parallel] })).toEqual([]);
        expect(deriveCatalogFunction(parallel)).toBe('Explain');
        for (const id of ['items-numbered', 'items-connected', 'items-flow-five'])
            expect(deriveCatalogFunction(READER_SAMPLES.find(f => f.id === id)!.section)).toBe('Sequence');
        expect(deriveCatalogFunction(READER_SAMPLES.find(f => f.id === 'matrix-points')!.section)).toBe('Compare');
        expect(deriveCatalogFunction(READER_SAMPLES.find(f => f.id === 'items-disclose')!.section)).toBe('Index');
    });
    it('validates current sample shapes and approved copy without proposed retired authoring fields', () => {
        const cells = READER_PAGES.flatMap(page => readerConfigCells(page.label));
        expect(cells.map(cell => cell.id).sort()).toEqual(Object.values(expectedCells).flat().sort());
        const documents = [...cells.map(cell => ({ id: `reader-cell-${cell.id}`, sections: [cell.fixture.section] })), ...READER_SAMPLES.filter(f => f.id !== 'recipes-nav-composition').map(f => ({ id: `reader-test-${f.id}`, sections: [f.section] })), READER_COMPOSITION];
        const before = JSON.stringify(documents);
        const words = (text: string | undefined) => text?.trim().split(/\s+/).length ?? 0;
        for (const authored of documents) {
            expect(validateSectionedViewDocument(authored), authored.id).toEqual([]);
            const resolved = resolveSectionedViewDocument(authored, readerCopyResolver);
            expect(resolved.resolutions.length).toBeGreaterThan(0);
            for (const section of authored.sections)
                if (section.kind === 'content-section') {
                    expect(Object.hasOwn(section, 'align')).toBe(false);
                    expect(section.size).not.toBe('compact');
                    if (section.media?.type === 'specimen' && section.media.key)
                        expect(Object.hasOwn(section.media.key, 'side')).toBe(false);
                    if (section.block?.type === 'items') {
                        expect(Object.hasOwn(section.block, 'emphasis')).toBe(false);
                        expect(Reflect.get(section.block, 'recipe')).not.toBe('flow');
                        for (const item of section.block.items)
                            expect(Object.hasOwn(item, 'featured')).toBe(false);
                    }
                }
            for (const section of resolved.sections) {
                if (section.kind === 'hero') {
                    expect(words(section.heading)).toBeLessThanOrEqual(10);
                    expect(words(section.description)).toBeLessThanOrEqual(35);
                    continue;
                }
                if (section.kind !== 'content-section')
                    throw new Error('Expected canonical band');
                expect(words(section.heading), section.id).toBeLessThanOrEqual(section.layout === 'stacked' ? 10 : 8);
                expect(words(section.description), section.id).toBeLessThanOrEqual(30);
                if (section.block?.type === 'items')
                    for (const item of section.block.items) {
                        const b = section.block;
                        expect(words(item.heading), section.id).toBeLessThanOrEqual(b.order === 'connected' ? 2 : b.scale === 'statement' ? 3 : b.reveal === 'disclose' ? 12 : 5);
                        expect(words(item.meta), section.id).toBeLessThanOrEqual(b.order === 'connected' ? 2 : 5);
                        expect(words(item.description), section.id).toBeLessThanOrEqual(b.reveal === 'disclose' ? 45 : b.scale === 'statement' ? 12 : 25);
                        if (b.reveal === 'disclose')
                            expect(words(item.description), section.id).toBeGreaterThanOrEqual(15);
                    }
                if (section.block?.type === 'matrix')
                    expect(new Set(section.block.sides.flatMap(s => s.points ?? [])).size).toBe(section.block.sides.flatMap(s => s.points ?? []).length);
            }
        }
        expect(JSON.stringify(documents)).toBe(before);
        const sequence = catalogDom(buildCatalogFunctionPages(sheets).find(page => page.file === 'catalog/sequence.html')!.content).window.document;
        expect(sequence.querySelector('[data-item-caption]')?.textContent).toBe('Sample data. Each step leaves context for the next person.');
        expect(sequence.querySelector('[data-catalog-rules]')?.textContent).toContain('stacked frame with a columns or stacked arrangement');
    });
});

describe('reader automatic authored grounds and existing presentation', () => {
    it('refuses invalid retained originals before reader preparation can delete their ground', async () => {
        vi.resetModules();
        try {
            vi.doMock('./index.js', async () => {
                const actual = await vi.importActual<typeof import('./index.js')>('./index.js');
                return {
                    ...actual,
                    CATALOG_FIXTURES: actual.CATALOG_FIXTURES.map(fixture => fixture.id === 'items-disclose'
                        ? { ...fixture, section: { ...fixture.section, ground: 'base' as never } }
                        : fixture),
                };
            });
            await expect(import('./reader-data.js')).rejects.toThrow(/ground must be inverse or omitted/);
        } finally {
            vi.doUnmock('./index.js');
            vi.resetModules();
        }
    });

    it('refuses invalid supplied composition input before selecting the full composition', () => {
        const fixture = READER_SAMPLES.find(entry => entry.id === 'recipes-nav-composition')!;
        const before = JSON.stringify(READER_COMPOSITION);
        const invalid = { ...fixture, section: { ...fixture.section, ground: 'invalid' as never } };
        expect(() => resolveReaderSampleDocument(invalid)).toThrow(/ground must be one of base, sunken, inverse/);
        expect(JSON.stringify(READER_COMPOSITION)).toBe(before);
    });

    it('shares the existing Frame presentation model between its caption and native band', async () => {
        vi.resetModules();
        try {
            vi.doMock('./reader-data.js', async () => {
                const actual = await vi.importActual<typeof import('./reader-data.js')>('./reader-data.js');
                return {
                    ...actual,
                    resolveReaderSampleDocument: (fixture: Parameters<typeof actual.resolveReaderSampleDocument>[0]) => {
                        const resolved = actual.resolveReaderSampleDocument(fixture);
                        if (fixture.id !== 'frame-actions') return resolved;
                        // Instrument an existing sample's resolved presentation, never its authored input.
                        return {
                            ...resolved,
                            sections: resolved.sections.map(section => section.id === fixture.section.id
                                ? { ...section, ground: 'sunken' as const } : section),
                            ...(resolved.viewGrounds === undefined ? {} : {
                                viewGrounds: resolved.viewGrounds.filter(id => id !== fixture.section.id),
                            }),
                        };
                    },
                };
            });
            const fresh = await import('./reader-renderer.js');
            const rendered = fresh.buildCatalogFunctionPages(sheets);
            const documents = rendered.map(page => catalogDom(page.content).window.document);
            expect(documents.reduce((count, document) => count + document.querySelectorAll('[data-catalog-fixture]').length, 0)).toBe(32);
            expect(documents.reduce((count, document) => count + document.querySelectorAll('[data-catalog-config-cell]').length, 0)).toBe(4);
            expect(CATALOG_FIXTURES).toHaveLength(44);
            const frame = catalogDom(rendered.find(page => page.file === 'catalog/frame.html')!.content).window.document;
            const sample = frame.querySelector('[data-catalog-fixture="frame-actions"]')!;
            expect(sample).not.toBeNull();
            const groundClaims = [...sample.querySelectorAll('[data-catalog-caption] [data-catalog-axis-witness^="ground:"]')];
            expect(groundClaims).toHaveLength(1);
            expect(groundClaims[0]!.getAttribute('data-catalog-axis-witness')).toBe('ground:sunken');
            expect(groundClaims[0]!.textContent).toBe('ground: sunken');
            const native = sample.querySelector('[data-catalog-native] [data-content-section]')!;
            expect(native).not.toBeNull();
            expect(native.classList.contains('bg-surface-sunken')).toBe(true);
            expect(native.classList.contains('bg-surface-inverse')).toBe(false);
        } finally {
            vi.doUnmock('./reader-data.js');
            vi.resetModules();
        }
    });

    it('authors only inverse or omission on canonical reader samples', () => {
        for (const fixture of READER_SAMPLES) {
            if (fixture.section.kind !== 'content-section') continue;
            if (Object.hasOwn(fixture.section, 'ground')) expect(fixture.section.ground, fixture.id).toBe('inverse');
        }
    });
    it('keeps an existing sunken reader sample through the real singleton planner', () => {
        const fixture = READER_SAMPLES.find(entry => entry.id === 'items-disclose')!;
        const original = resolveSectionedViewDocument({ id: 'reader-automatic-ground', sections: [fixture.section] }, readerCopyResolver);
        expect(original.sections[0]!.ground).toBe('base');
        expect(original.viewGrounds).toContain(fixture.section.id);
        const presented = resolveReaderSampleDocument(fixture);
        expect(presented.sections[0]!.ground).toBe('sunken');
        expect(presented.viewGrounds ?? []).not.toContain(fixture.section.id);
        const native = catalogDom(renderReaderSample(fixture)).window.document.querySelector('[data-content-section]')!;
        expect(native).not.toBeNull();
        expect(native.classList.contains('bg-surface-sunken')).toBe(true);
    });
    it('does not repair invalid original reader data with its presentation map', () => {
        const fixture = READER_SAMPLES.find(entry => entry.id === 'items-disclose')!;
        const invalid = { ...fixture, section: { ...fixture.section, ground: 'base' } } as unknown as typeof fixture;
        expect(() => resolveReaderSampleDocument(invalid)).toThrow(/ground must be inverse or omitted/);
    });
});
