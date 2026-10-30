import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { producerPagePreview, type ProducerSpecimenUnpublishedPage } from '../../studio/lib/producer-page-preview';
import type { PublicationResponse } from '../../studio/lib/publisher-preview';

const origin = 'http://127.0.0.1:4300';
const viewport = { id: 'desktop', label: 'Desktop', width: 1440, height: 900 };
const publication = (): PublicationResponse => ({ state: 'ready', publication: 'example', publications: ['example'], manifest: { schemaVersion: 1, publication: 'example', sourceApp: 'web', format: 'web.page.responsive', routes: [{ id: 'home', path: '/', source: { file: 'pages/home.tsx', export: 'default' } }], contentMap: { version: 1, publicationId: 'example', entries: [{ id: 'home', title: 'Home', kind: 'page', path: '/' }] } }, pages: [{ id: 'home', route: '/', emitted: true, previewUrl: '/preview/example/pages/home.html' }] });
const unpublishedPage = (): ProducerSpecimenUnpublishedPage => ({ publication: 'unpublished', emitted: false, id: 'home', route: '/', emptyState: { title: 'Not published yet', description: 'Publish this page to preview it.', command: 'clossys publish --target preview', context: 'Home' } });

describe('native Producer emitted-page specimen port', () => {
  it('renders the actual guarded descriptor as one sandboxed noninteractive native-size iframe', () => {
    const port = producerPagePreview(publication(), origin)!;
    expect(port.engine).toBe('producer-emitted-page@1');
    expect(port.pages).toEqual([{ id: 'home', route: '/', emitted: true, stage: 'emitted', previewUrl: '/preview/example/pages/home.html' }]);
    const html = renderToStaticMarkup(port.renderViewport({ page: port.pages[0]!, viewport, interactive: false, fullSize: false }));
    expect(html).toMatch(/^<iframe /);
    expect(html).toContain('src="http://127.0.0.1:4300/preview/example/pages/home.html"');
    expect(html).toContain('sandbox=""');
    expect(html).toContain('referrerPolicy="no-referrer"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain('width="1440" height="900"');
    expect(html).toContain('pointer-events:none'); expect(html).not.toContain('aria-hidden');
    expect(html).not.toMatch(/allow-scripts|allow-same-origin|token|<div|<section/);
  });
  it('retains actual viewport dimensions and removes scaling for standalone content', () => {
    const port = producerPagePreview(publication(), origin)!;
    const html = renderToStaticMarkup(port.renderViewport({ page: port.pages[0]!, viewport, interactive: false, fullSize: true }));
    expect(html).toContain('width="1440" height="900"');
    expect(html).toContain('zoom:1');
    const mobile = renderToStaticMarkup(port.renderViewport({ page: port.pages[0]!, viewport: { id: 'mobile', label: 'Mobile', width: 390, height: 844 }, interactive: false, fullSize: false }));
    expect(mobile).toContain('width="390" height="844"');
    expect(mobile).toContain('zoom:1');
    const tablet = renderToStaticMarkup(port.renderViewport({ page: port.pages[0]!, viewport: { id: 'tablet', label: 'Tablet', width: 768, height: 1024 }, interactive: false, fullSize: false }));
    expect(tablet).toContain('width="768" height="1024"');
    expect(tablet).toContain('sandbox=""');
  });
  it.each(['https://127.0.0.1:4300', 'http://localhost:4300', 'http://example.invalid:4300', 'http://127.0.0.1:4300/', 'http://127.0.0.1:4300?token=value', 'http://127.0.0.1:65536', 'http://127.0.0.1:04300'])('rejects noncanonical or remote origin %s', badOrigin => {
    expect(producerPagePreview(publication(), badOrigin)).toBeUndefined();
  });
  it('fails closed for unavailable or unsafe publication descriptors', () => {
    expect(producerPagePreview({ state: 'missing', message: 'Not published yet', command: 'clossys publish --target preview' }, origin)).toBeUndefined();
    for (const previewUrl of ['https://example.invalid/page', '/preview/example/pages/../home.html', '/preview/example/pages/home.html?token=value', '/api/config']) {
      const descriptor = publication();
      if (descriptor.state !== 'ready') throw new Error('Invalid fixture');
      descriptor.pages[0]!.previewUrl = previewUrl;
      expect(producerPagePreview(descriptor, origin)).toBeUndefined();
    }
  });
  it('refuses unknown pages, replaced URLs, interactive requests and invalid dimensions', () => {
    const port = producerPagePreview(publication(), origin)!;
    const input = { page: port.pages[0]!, viewport, interactive: false as const, fullSize: false };
    expect(port.renderViewport({ ...input, page: { ...input.page, id: 'missing' } })).toBeNull();
    expect(port.renderViewport({ ...input, page: { ...input.page, previewUrl: '/preview/example/pages/other.html' } })).toBeNull();
    expect(port.renderViewport({ ...input, interactive: true as unknown as false })).toBeNull();
    expect(port.renderViewport({ ...input, viewport: { ...viewport, width: -1 } })).toBeNull();
    expect(port.renderViewport({ ...input, viewport: { ...viewport, height: Number.NaN } })).toBeNull();
  });
  it('reports descriptor availability honestly without rendering a not-emitted page', () => {
    const descriptor = publication();
    if (descriptor.state !== 'ready') throw new Error('Invalid fixture');
    descriptor.pages[0]!.emitted = false;
    const port = producerPagePreview(descriptor, origin)!;
    expect(port.pages[0]!.stage).toBe('not-emitted');
    expect(port.renderViewport({ page: port.pages[0]!, viewport, interactive: false, fullSize: false })).toBeNull();
  });
  it('carries confirmed unpublished content to the bound leaf once without inventing an iframe', () => {
    const missing: PublicationResponse = { state: 'missing', message: 'Not published yet', command: 'clossys publish --target preview' };
    const page = unpublishedPage();
    const port = producerPagePreview(missing, origin, [page, page, page])!;
    expect(port.pages).toEqual([page]);
    expect(port.pages[0]).not.toHaveProperty('previewUrl');
    expect(port.pages[0]).not.toHaveProperty('stage');
    const published = producerPagePreview(publication(), origin)!;
    expect(port.renderViewport({ page: published.pages[0]!, viewport, interactive: false, fullSize: false })).toBeNull();
  });
  it('permits confirmed absent or not-emitted inventory but refuses conflicting or failed publication evidence', () => {
    const descriptor = publication();
    if (descriptor.state !== 'ready') throw new Error('Invalid fixture');
    descriptor.pages[0]!.emitted = false;
    const page = unpublishedPage();
    expect(producerPagePreview(descriptor, origin, [page])?.pages).toEqual([page]);
    expect(producerPagePreview(publication(), origin, [page])).toBeUndefined();
    const absent = { ...page, id: 'new-page', route: '/new-page' };
    expect(producerPagePreview(descriptor, origin, [absent])?.pages.at(-1)).toEqual(absent);
    expect(producerPagePreview(descriptor, origin, [{ ...page, route: '/other' }])).toBeUndefined();
    expect(producerPagePreview({ state: 'error', message: 'Unreadable', command: 'clossys publish --target preview' }, origin, [page])).toBeUndefined();
    const missing: PublicationResponse = { state: 'missing', message: 'Not published yet', command: 'clossys publish --target preview' };
    expect(producerPagePreview(missing, origin, [page, { ...page, route: '/other' }])).toBeUndefined();
    expect(producerPagePreview(missing, origin, [{ ...page, route: '//example.invalid' }])).toBeUndefined();
    expect(producerPagePreview(missing, origin, [{ ...page, emptyState: { ...page.emptyState, command: 'other command' } }])).toBeUndefined();
  });
});
