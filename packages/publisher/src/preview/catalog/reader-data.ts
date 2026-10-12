import { createCopyResolver, type CopyRef, type CopyRegistryEntry } from '@clossys/writer';
import { READER_COPY } from './reader-copy.js';
import { desugarRecipe } from '../../core/content-contract.js';
import type { SectionedViewSection } from '../../core/sectioned-view.js';
import { CATALOG_FIXTURES, CATALOG_COPY_REGISTRY, CATALOG_COMPOSITIONS, catalogCopyResolver, type CatalogFixture } from './index.js';
export const READER_FUNCTIONS = ['Introduce', 'Show', 'Explain', 'Index', 'Sequence', 'Compare'] as const;
export type ReaderFunction = typeof READER_FUNCTIONS[number];
export type ReaderPage = ReaderFunction | 'Overview' | 'Frame' | 'Parts';
export function deriveCatalogFunction(section: SectionedViewSection): ReaderFunction {
    if (section.kind === 'hero')
        return 'Introduce';
    if (section.kind !== 'content-section')
        throw new Error('Reader samples require a canonical band.');
    const block = section.block;
    if (block?.type === 'matrix')
        return 'Compare';
    if (block?.type === 'items') {
        const effective = desugarRecipe(block);
        if (effective.order !== 'none')
            return 'Sequence';
        if (section.media !== undefined && section.layout !== 'stacked' && effective.reveal !== 'disclose' && (effective.arrangement === 'rows' || effective.arrangement === 'stacked'))
            return 'Show';
        if (effective.reveal === 'disclose' || effective.arrangement === 'rows' || block.recipe === 'link-index')
            return 'Index';
        return 'Explain';
    }
    return section.media === undefined ? 'Introduce' : 'Show';
}
export const READER_PRUNED = ['media-specimen', 'items-eyebrow', 'items-visual', 'items-link', 'items-parallel-columns', 'items-two-lane-list', 'matrix-featured-points', 'frame-ground-base', 'frame-ground-sunken', 'frame-ground-inverse', 'frame-size-standard', 'frame-stacked'] as const;
const entries: CopyRegistryEntry[] = [];
let serial = 0;
function ref(sample: string, text: string): CopyRef {
    const id = `catalog.reader.${sample}.copy-${++serial}`;
    entries.push({ id, text, context: 'Reader catalog example', status: 'approved' });
    return { id };
}
function rewrite(value: unknown, sample: string, path = ''): void {
    if (value === null || typeof value !== 'object')
        return;
    if (Array.isArray(value)) {
        value.forEach((item, index) => rewrite(item, sample, `${path}.${index}`));
        return;
    }
    for (const [key, item] of Object.entries(value)) {
        if (item !== null && typeof item === 'object' && !Array.isArray(item) && Object.keys(item).length === 1 && 'id' in item && typeof item.id === 'string') {
            const previous = catalogCopyResolver({ id: item.id });
            if (previous === undefined)
                throw new Error('Missing approved source copy for a reader example.');
            {
                const slot = `${path}.${key}`;
                const text = READER_COPY[sample]?.[slot];
                if (text === undefined)
                    throw new Error(`Missing reader copy for ${sample}${slot}.`);
                const target = value as Record<string, unknown>;
                target[key] = ref(sample, text);
            }
        }
        else if (key === 'href' && typeof item === 'string' && item.startsWith('/sample')) {
            const slot = `${path}.${key}`;
            const destinations = ['index-function.html#example-items-icon-groups', 'show.html#example-say-media-stacked', 'sequence.html#example-items-numbered'];
            (value as Record<string, unknown>)[key] = '/catalog/' + (slot.startsWith('.block.items.') ? destinations[Number(path.split('.').at(-1)) % destinations.length]! : sample === 'frame-split-start' ? 'sequence.html#example-items-connected' : slot.includes('.footnote.') ? 'index-function.html#example-items-disclose' : slot.includes('.actions.1.') || sample === 'say-header-split' || sample === 'frame-split-end' ? destinations[0]! : destinations[1]!);
        }
        else
            rewrite(item, sample, `${path}.${key}`);
    }
}
function applyCopyOverrides(section: SectionedViewSection, sample: string): void {
    for (const [slot, text] of Object.entries(READER_COPY[sample] ?? {})) {
        const keys = slot.slice(1).split('.');
        const last = keys.pop()!;
        let node: unknown = section;
        for (const key of keys) {
            if (node === null || typeof node !== 'object' || !(key in node))
                throw new Error(`Missing catalog copy slot ${sample}${slot}.`);
            node = (node as Record<string, unknown>)[key];
        }
        if (node === null || typeof node !== 'object' || !(last in node))
            throw new Error(`Missing catalog copy slot ${sample}${slot}.`);
        const record = node as Record<string, unknown>;
        const previous = record[last];
        if (previous !== null && typeof previous === 'object' && 'id' in previous)
            record[last] = ref(sample, text);
        else if (last === 'icon' && typeof previous === 'string')
            record[last] = text;
        else
            throw new Error(`Catalog copy slot ${sample}${slot} is not copy or an icon.`);
    }
}
const grounds: Record<string, 'base' | 'sunken' | 'inverse'> = {
    "say-hero-display": "base",
    "say-hero-compact": "base",
    "say-intro": "base",
    "say-close": "inverse",
    "say-media-stacked": "base",
    "say-header-split": "sunken",
    "items-columns": "inverse",
    "items-rows": "base",
    "items-bento": "base",
    "items-stacked": "sunken",
    "items-numbered": "base",
    "items-connected": "sunken",
    "items-flow-five": "base",
    "items-disclose": "sunken",
    "items-plain": "base",
    "items-rule": "sunken",
    "items-plate": "base",
    "items-icon-groups": "sunken",
    "items-badge-meta": "base",
    "matrix-points": "base",
    "matrix-visuals": "sunken",
    "frame-split-start": "base",
    "frame-split-end": "base",
    "frame-actions": "base",
    "media-key": "sunken",
    "media-record-one": "sunken",
    "media-record-three": "base",
    "media-converge": "sunken",
    "media-evidence": "base",
    "media-meter-previous": "base"
};
function prepare(fixture: CatalogFixture): CatalogFixture {
    const section = structuredClone(fixture.section);
    rewrite(section, fixture.id);
    if (section.kind === 'content-section') {
        section.size = ['say-media-stacked', 'media-converge', 'items-connected'].includes(fixture.id) ? 'display' : 'standard';
        section.ground = grounds[fixture.id] ?? 'base';
        if (section.media?.type === 'scene' && section.media.input.template === 'evidence-trail' && section.media.input.result.person !== undefined)
            section.media.input.result.person.initials = 'RT';
        if (fixture.id === 'items-badge-meta')
            section.layout = 'split-start';
        if (fixture.id === 'media-record-one')
            section.layout = 'split-start';
        if (section.block?.type === 'items') {
            const block = section.block;
            if (block.recipe === 'cards')
                delete block.treatment;
            if (fixture.id === 'items-rule')
                block.items.forEach((item, index) => { item.eyebrow = ref(fixture.id, index ? 'Work' : 'People'); });
        }
        if (section.block?.type === 'matrix') {
            section.block.sides.forEach((side, sideIndex) => {
                side.label = ref(fixture.id, sideIndex ? 'After' : 'Before');
                side.heading = ref(fixture.id, sideIndex ? 'One shared record' : 'Scattered notes');
            });
            if (fixture.id === 'matrix-points')
                section.block.featured = section.block.sides[1]!.id;
        }
    }
    else if (section.kind === 'hero')
        section.ground = fixture.id === 'say-hero-display' ? 'inverse' : 'base';
    applyCopyOverrides(section, fixture.id);
    return { ...fixture, section };
}
export function readerPage(fixture: CatalogFixture): ReaderPage {
    if (fixture.id === 'recipes-nav-composition')
        return 'Overview';
    if (fixture.id === 'frame-actions')
        return 'Frame';
    return deriveCatalogFunction(fixture.section);
}
export const READER_COMPOSITION = structuredClone(CATALOG_COMPOSITIONS['recipes-nav-composition']!);
READER_COMPOSITION.sections.forEach((section, index) => {
    rewrite(section, `overview-${index}`);
    if (section.kind === 'content-section' && section.media?.type === 'scene' && section.media.input.template === 'approval-chain')
        section.media.input.decision.person.initials = 'RT';
});
export const READER_SAMPLES = CATALOG_FIXTURES.filter(f => !READER_PRUNED.some(id => id === f.id)).map(f => f.id === 'recipes-nav-composition' ? { ...f, section: READER_COMPOSITION.sections[0]! } : prepare(f));
export const READER_COPY_REGISTRY = { ...CATALOG_COPY_REGISTRY, id: 'reader-catalog', entries };
export const readerCopyResolver = createCopyResolver(READER_COPY_REGISTRY);
