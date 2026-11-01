'use strict';
const assert = require('node:assert/strict');
const { test, after } = require('node:test');
const path = require('node:path');
const Module = require('node:module');
const { buildSync } = require('esbuild');
const { JSDOM } = require('jsdom');

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
for (const key of ['window', 'document', 'navigator', 'Window', 'Document', 'HTMLElement', 'Element', 'Node', 'NodeFilter', 'SVGElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLButtonElement', 'HTMLAnchorElement', 'Event', 'KeyboardEvent', 'MouseEvent', 'MutationObserver', 'DocumentFragment', 'CustomEvent', 'FocusEvent', 'DOMRect', 'DOMRectReadOnly']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key], writable: true });
}
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
globalThis.requestAnimationFrame = callback => setTimeout(callback, 0);
globalThis.cancelAnimationFrame = clearTimeout;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.CSS = { supports: () => false, escape: value => String(value).replace(/[^a-z0-9_-]/gi, char => `\\${char}`) };
window.CSS = globalThis.CSS;
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
window.ResizeObserver = globalThis.ResizeObserver;
window.matchMedia = query => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} });

const output = buildSync({
  stdin: { contents: `
    export {StudioAppFrame, StudioPageFrame} from './src/foundry/studio-frames';
    export {Sidebar, SidebarTrigger} from './src/foundry/sidebar';
  `, resolveDir: __dirname, loader: 'tsx' },
  tsconfig: path.join(__dirname, 'tsconfig.json'), bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic',
  external: ['react', 'react-dom', 'react/*', 'react-dom/*'], write: false, logLevel: 'silent',
}).outputFiles[0].text;
const compiled = new Module(__filename, module);
compiled.filename = __filename;
compiled.paths = Module._nodeModulePaths(__dirname);
compiled._compile(output, __filename);
const { StudioAppFrame, StudioPageFrame, Sidebar, SidebarTrigger } = compiled.exports;
const React = require('react');
const { act, createElement: e } = React;
const { createRoot } = require('react-dom/client');
const { renderToStaticMarkup } = require('react-dom/server');

test('app frame renders only navigation and leaves page regions to its child', () => {
  const root = document.createElement('div');
  root.innerHTML = renderToStaticMarkup(e(StudioAppFrame, {
    navigation: e(Sidebar, { 'aria-label': 'Navigation' }, 'Navigation'), open: true, onOpenChange() {},
  }, e('section', { id: 'page-slot' }, 'Page slot')));
  assert.equal(root.querySelectorAll('[data-slot="sidebar-wrapper"]').length, 1);
  assert.ok(root.querySelector('[aria-label="Navigation"]'));
  assert.ok(root.querySelector('#page-slot'));
  assert.equal(root.querySelector('header, main, #studio-chat, [data-slot="resizable-panel-group"]'), null);
});

test('composed page owns its header, body and chat without a competing provider or inset', async () => {
  let navigationChanges = 0;
  function Composition() {
    const [open, setOpen] = React.useState(true);
    const [chatOpen, setChatOpen] = React.useState(true);
    return e(StudioAppFrame, {
      open, onOpenChange(value) { navigationChanges++; setOpen(value); },
      navigation: e(Sidebar, { 'aria-label': 'Navigation' }, 'Navigation'),
    }, e(StudioPageFrame, {
      header: e(React.Fragment, null, e(SidebarTrigger), e('span', null, 'Page breadcrumb'), e('button', { onClick: () => setChatOpen(value => !value) }, 'Toggle chat')),
      head: e('h1', null, 'Page heading'), body: 'detail', chatOpen, chatResizeLabel: 'Resize chat',
      chat: e(Sidebar, { collapsible: 'none', 'aria-label': 'Chat' }, 'Page chat'),
    }, e('section', { id: 'page-body' }, 'Page body')));
  }
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(e(Composition)));
    assert.equal(container.querySelectorAll('[data-slot="sidebar-wrapper"]').length, 1);
    assert.equal(container.querySelectorAll('[data-slot="sidebar-inset"]').length, 1);
    assert.equal(container.querySelectorAll('header').length, 1);
    assert.equal(container.querySelectorAll('main').length, 1);
    const page = container.querySelector('#studio-page');
    assert.ok(page.querySelector('header [data-sidebar="trigger"]'));
    assert.ok(page.querySelector('#studio-main[data-body="detail"] #page-body'));
    assert.equal(page.querySelector('#studio-main').firstElementChild.textContent, 'Page heading');
    assert.ok(container.querySelector('#studio-chat [aria-label="Chat"]'));
    assert.equal(page.querySelector('[aria-label="Chat"]'), null);
    await act(async () => container.querySelector('[data-sidebar="trigger"]').click());
    assert.equal(navigationChanges, 1, 'page header controls the app navigation provider exactly once');
    assert.ok(container.querySelector('#studio-chat'));
    await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === 'Toggle chat').click());
    assert.equal(container.querySelector('#studio-chat'), null);
    assert.equal(container.querySelector('[data-slot="resizable-handle"]'), null);
    assert.ok(container.querySelector('[aria-label="Navigation"]'));
    assert.ok(container.querySelector('#page-body'));
    assert.equal(navigationChanges, 1, 'chat changes belong to the page');
  } finally {
    await act(async () => root.unmount()); container.remove();
  }
});

after(() => dom.window.close());
