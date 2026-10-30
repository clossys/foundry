import { expect, it } from 'vitest';
import { parsePublicationResponse, publicationNavigation, publicationStatus, selectedPublicationId, selectedPublishedPage } from '../../studio/lib/publisher-preview.js';
import type { AgentCells } from '../../studio/lib/cells-client.js';

const response = () => ({ state: 'ready', publication: 'example', publications: ['example'], manifest: { schemaVersion: 1, publication: 'example', sourceApp: 'apps/web', format: 'web.page.responsive', routes: [{ id: 'home', path: '/', source: { file: 'site/app/page.tsx', export: 'default' } }], contentMap: { version: 1, publicationId: 'example', entries: [{ id: 'pages', title: 'Pages', kind: 'group' }, { id: 'home', title: 'Home', parentId: 'pages', kind: 'page', path: '/' }] } }, pages: [{ id: 'home', cellId: 'page.home', route: '/', title: 'Home', previewUrl: '/preview/example/pages/home.html', emitted: true }] });

it('keeps iframe destinations inside the guarded publication route', () => {
  expect(parsePublicationResponse(response()).state).toBe('ready');
  for (const url of ['https://example.test/', '/api/config', '/preview/example/pages/../home.html', '/preview/example/pages/%2fhome.html', 'javascript:alert(1)']) {
    const value = response(); value.pages[0]!.previewUrl = url;
    expect(() => parsePublicationResponse(value)).toThrow('published page');
  }
});
it('joins actual emitted cell identity when generic fields omit a path, without fabricating missing status fields', () => {
  const index: AgentCells = { agent: 'publisher', state: 'ready', cells: [{ id: 'page.home', title: 'Home', fields: { id: 'page.home' } }], tree: { meta: { publications: [{ id: 'example', entryIds: { 'page.home': 'home' } }] } } };
  const value = parsePublicationResponse(response());
  expect(selectedPublicationId(index, 'page.home')).toBe('example');
  if (value.state !== 'ready') throw new Error('Expected real publication metadata');
  expect(selectedPublishedPage(index, 'page.home', value.pages)?.id).toBe('home');
  expect(publicationStatus(value.pages[0]!)).toEqual({ route: '/', indexing: 'Not provided', sitemap: 'Not provided', published: 'Not provided' });
});
it('renders navigation from the actual content-map hierarchy and rejects invalid parent cycles', () => {
  const value = parsePublicationResponse(response());
  if (value.state !== 'ready') throw new Error('Expected real publication metadata');
  const tree = publicationNavigation(value.manifest.contentMap.entries, value.pages);
  expect(tree[0]).toMatchObject({ id: 'pages', children: [{ id: 'home', page: { route: '/' } }] });
  value.manifest.contentMap.entries[0]!.parentId = 'home';
  expect(() => publicationNavigation(value.manifest.contentMap.entries, value.pages)).toThrow('hierarchy');
});
