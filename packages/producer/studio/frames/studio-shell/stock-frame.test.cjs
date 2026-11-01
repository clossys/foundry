'use strict';
const assert = require('node:assert/strict');
const { test, after } = require('node:test');
const path = require('node:path');
const fs = require('node:fs');
const Module = require('node:module');
const { JSDOM } = require('jsdom');
const { buildSync } = require('esbuild');

// A component test environment only: no Studio server, records, approvals or preview.
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
HTMLElement.prototype.scrollTo = function () {};
window.matchMedia = query => ({ matches: query.includes('min-width') ? window.innerWidth >= Number(query.match(/\d+/)[0]) : window.innerWidth <= Number(query.match(/\d+/)[0]), media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });

const studio = path.resolve(__dirname, '../..');
const output = buildSync({
  stdin: { contents: `
    export {TeamSwitcher} from './team-switcher';
    export {NavUser} from './nav-user';
    export {StockChatSidebar, StockChatSheet} from './stock-chat-sidebar';
    export {HeaderPopover} from './stock-header-controls';
    export {SidebarProvider, SidebarTrigger, SidebarRail, Sidebar, SidebarMenuButton, useSidebar} from '@clossys/designer-ui';
  `, resolveDir: __dirname, loader: 'tsx' },
  tsconfig: path.join(studio, 'tsconfig.json'), bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic',
  external: ['react', 'react-dom', 'react/*', 'react-dom/*'], loader: { '.css': 'empty' }, write: false, logLevel: 'silent',
  plugins: undefined,
}).outputFiles[0].text;
// Compile the actual native UI; no trigger, overlay or sidebar behavior is mocked.
function load(source) {
  const compiled = new Module(path.join(studio, 'stock-frame-test.cjs'), module);
  compiled.filename = path.join(studio, 'stock-frame-test.cjs'); compiled.paths = Module._nodeModulePaths(studio);
  compiled._compile(source, compiled.filename); return compiled.exports;
}
const api = load(output);
const React = require('react');
const { act } = React;
const { createRoot } = require('react-dom/client');
const { renderToStaticMarkup } = require('react-dom/server');
const e = React.createElement;
async function mounted(element, width = 1440) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
  await act(async () => { root.render(element); });
  return { container, async close() { await act(async () => root.unmount()); container.remove(); } };
}
async function click(element) { assert.ok(element); await act(async () => element.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }))); }

// Pure component inputs exercise static adoption without a fabricated account or menu.
test('workspace and profile keep stock row presentation with no switch menu or inactive button', () => {
  const html = renderToStaticMarkup(e(api.SidebarProvider, null,
    e(api.TeamSwitcher, { teams: [{ name: 'Workspace', logo: e('span', null, 'Mark'), itemLogo: null, plan: 'Studio' }] }),
    e(api.NavUser, { user: { name: 'Local workspace', email: 'Producer on this machine', initials: 'LW' } })));
  assert.match(html, /data-sidebar="menu-button"/);
  const stock = renderToStaticMarkup(e(api.SidebarProvider, null, e(api.SidebarMenuButton, {size: 'lg', className: 'aria-expanded:bg-muted'}, 'Profile')));
  const profile = html.match(/<div[^>]+class="([^"]*aria-expanded:bg-muted[^"]*)"/)[1];
  const native = stock.match(/data-sidebar="menu-button"[^>]+class="([^"]+)"/)[1];
  assert.equal(profile, native, 'static profile keeps every stock presentation class');
  assert.match(html, /Workspace/); assert.match(html, /Local workspace/);
  assert.doesNotMatch(html, /<button\b|role="button"|aria-haspopup|ChevronsUpDown|Add team|Upgrade|Billing/);
});

test('native context guard remains enforced for trigger and chat sidebar', () => {
  assert.throws(() => renderToStaticMarkup(e(api.SidebarTrigger)), /within a SidebarProvider/);
  assert.throws(() => renderToStaticMarkup(e(api.StockChatSidebar)), /within a SidebarProvider/);
  assert.throws(() => renderToStaticMarkup(e(api.TeamSwitcher, { teams: [{ name: 'Workspace', logo: null, itemLogo: null, plan: 'Studio' }] })), /within a SidebarProvider/);
});

test('native Trigger calls onPress then toggles only its nearest provider once; Rail toggles once', async () => {
  const calls = [];
  const view = await mounted(e(api.SidebarProvider, { onOpenChange: () => calls.push('outer') },
    e(api.SidebarProvider, { onOpenChange: () => calls.push('inner') }, e(api.SidebarTrigger, { onPress: () => calls.push('press') }), e(api.SidebarRail))));
  try {
    await click(view.container.querySelector('[data-sidebar="trigger"]'));
    assert.deepEqual(calls, ['press', 'inner']);
    await click(view.container.querySelector('[data-sidebar="rail"]'));
    assert.deepEqual(calls, ['press', 'inner', 'inner']);
  } finally { await view.close(); }
});

test('375px navigation and chat use native sheets with the same 18rem geometry', async () => {
  const view = await mounted(e(api.SidebarProvider, null, e(api.SidebarTrigger), e(api.Sidebar, null, e('a', { href: '/' }, 'Home'))), 375);
  let leftWidth;
  try {
    await click(view.container.querySelector('[data-sidebar="trigger"]'));
    const sheet = document.querySelector('[data-mobile="true"]'); assert.ok(sheet);
    leftWidth = sheet.style.getPropertyValue('--sidebar-width'); assert.equal(leftWidth, '18rem');
    assert.match(sheet.textContent, /Home/);
  } finally { await view.close(); }
  const chat = await mounted(e(api.SidebarProvider, null, e(api.StockChatSheet, { isOpen: true, onOpenChange() {} })), 375);
  try {
    const sheet = document.querySelector('[data-panel="chat"][data-mobile="true"]'); assert.ok(sheet);
    assert.equal(sheet.style.getPropertyValue('--sidebar-width'), leftWidth);
    assert.match(sheet.textContent, /No conversation yet/);
  } finally { await chat.close(); }
});

test('1280px module Popover keeps its body outside the page layout and shares one actual icon button', async () => {
  let open = false;
  function Harness() {
    const [value, setValue] = React.useState(false);
    return e(api.HeaderPopover, { label: 'Outline', 'data-popover-trigger': 'outline', open: value, onOpenChange(value) { open = value; setValue(value); }, content: e('p', null, 'Outline content') }, e('svg'));
  }
  const view = await mounted(e(Harness), 1280);
  try {
    assert.equal(view.container.querySelectorAll('button').length, 1);
    const button = view.container.querySelector('button'); assert.equal(button.getAttribute('aria-label'), 'Outline');
    assert.equal(button.getAttribute('aria-haspopup'), 'dialog');
    await click(button); assert.equal(open, true);
    const content = document.querySelector('[data-popover="outline"]'); assert.ok(content); assert.match(content.textContent, /Outline content/);
    assert.equal(view.container.contains(content), false, 'opening a module portals its body outside the page layout');
    assert.equal(view.container.children.length, 1, 'the module adds no column beside its header trigger');
    assert.equal(button.querySelectorAll('button').length, 0);
  } finally { await view.close(); }
});

function shellComponent() {
  const port = code => JSON.stringify(`data:text/javascript,${encodeURIComponent(code)}`);
  const source = fs.readFileSync(path.join(__dirname, 'index.tsx'), 'utf8')
    .replace("from 'next/navigation'", `from ${port("export const usePathname=()=>'/';export const useRouter=()=>({push(){}});")}`)
    .replace("from '../../components/StudioProviders'", `from ${port("export const useThemeMode=()=>globalThis.__stockFrameTheme;")}`);
  const bundled = buildSync({ stdin: { contents: source, resolveDir: __dirname, loader: 'tsx' },
    tsconfig: path.join(studio, 'tsconfig.json'), bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic',
    external: ['react', 'react-dom', 'react/*', 'react-dom/*'], loader: { '.css': 'empty' }, write: false, logLevel: 'silent' }).outputFiles[0].text;
  return load(bundled).default;
}

test('actual shell binds native resizing, shared dividers, container ancestry and the existing theme setter', async () => {
  const Frame = shellComponent();
  const themeCalls = [];
  globalThis.__stockFrameTheme = { resolved: 'light', setMode: value => themeCalls.push(value) };
  document.cookie = 'chat_state=true';
  const navigation = { tree: [{ id: 'home', label: 'Home', href: '/', icon: 'home' }], activeId: 'home' };
  const view = await mounted(e(Frame, { homeHref: '/', navigation, commands: [], breadcrumbs: [{ id: 'home', label: 'Home' }] }, e('section', { id: 'body' }, 'Body')));
  try {
    const header = view.container.querySelector('header'); assert.ok(header);
    const separators = [...header.querySelectorAll('[data-slot="separator"]')]; assert.equal(separators.length, 2);
    assert.equal(separators[0].className.replace('mr-2 ', ''), separators[1].className);
    assert.ok(view.container.querySelector('#body').closest('[class*="@container/main"]'));
    assert.ok(view.container.querySelector('[data-slot="resizable-panel-group"]'));
    const handle = view.container.querySelector('[data-slot="resizable-handle"]'); assert.ok(handle);
    assert.equal(handle.getAttribute('role'), 'separator'); assert.equal(handle.getAttribute('aria-label'), 'Resize chat');
    assert.ok(view.container.querySelector('#studio-chat [data-panel="chat"]'));
    assert.ok(header.classList.contains('h-14'));
    assert.ok(view.container.querySelector('#studio-chat [data-sidebar="header"]').classList.contains('h-14'), 'page and chat header heights share the qualified native h-14 binding');
    await click(header.querySelector('[data-theme-toggle]')); assert.deepEqual(themeCalls, ['dark']);
    await click(header.querySelector('[data-panel-toggle="chat"]'));
    assert.equal(view.container.querySelector('#studio-chat'), null);
    assert.equal(view.container.querySelector('[data-slot="resizable-handle"]'), null);
  } finally { await view.close(); delete globalThis.__stockFrameTheme; document.cookie = 'chat_state=false'; }
});


test('prompt action forwards text, substitutes every URL, handles clipboard failure/success and cleans its timer', async () => {
  const Frame = shellComponent();
  globalThis.__stockFrameTheme = { resolved: 'light', setMode() {} };
  window.history.replaceState(null, '', '/?keep=1&p=request-change#body');
  const writes = []; let reject = true;
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { async writeText(text) { writes.push(text); if (reject) throw new Error('clipboard unavailable'); } } });
  const nativeSet = globalThis.setTimeout, nativeClear = globalThis.clearTimeout;
  const timers = new Set(), cleared = new Set();
  globalThis.setTimeout = (fn, delay, ...args) => { const handle = nativeSet(fn, delay, ...args); if (delay === 1600) timers.add(handle); return handle; };
  globalThis.clearTimeout = handle => { if (timers.has(handle)) cleared.add(handle); return nativeClear(handle); };
  const view = await mounted(e(Frame, { homeHref: '/', navigation: { tree: [], activeId: 'home' }, commands: [], breadcrumbs: [],
    popovers: [{ id: 'request-change', label: 'Request change', icon: 'pencil', copy: { kind: 'prompt', prompt: 'Review {url} and {url}' } }] }, 'Body'));
  try {
    const content = document.querySelector('[data-popover="request-change"]'); assert.ok(content);
    const expected = 'Review http://localhost/?keep=1#body and http://localhost/?keep=1#body';
    assert.equal(content.querySelector('[data-popover-text]').textContent, expected);
    const button = content.querySelector('[data-popover-copy]'); assert.equal(button.textContent, 'Copy prompt');
    await click(button); assert.deepEqual(writes, [expected]); assert.equal(button.textContent, 'Copy prompt'); assert.equal(timers.size, 0);
    reject = false; await click(button); assert.deepEqual(writes, [expected, expected]); assert.equal(button.textContent, 'Copied'); assert.equal(timers.size, 1);
    await click(button); assert.equal(timers.size, 2); assert.equal(cleared.size, 1, 'repeat success clears the prior reset timer');
  } finally {
    await view.close(); assert.equal(cleared.size, timers.size, 'unmount clears the outstanding copied-state timer');
    globalThis.setTimeout = nativeSet; globalThis.clearTimeout = nativeClear;
    delete globalThis.__stockFrameTheme; window.history.replaceState(null, '', '/');
  }
});

test('legacy link actions cannot activate the shell clipboard fallback and current StudioPage excludes them', async () => {
  const Frame = shellComponent();
  globalThis.__stockFrameTheme = { resolved: 'light', setMode() {} };
  window.history.replaceState(null, '', '/?p=legacy');
  let writes = 0;
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { async writeText() { writes++; } } });
  const view = await mounted(e(Frame, { homeHref: '/', navigation: { tree: [], activeId: 'home' }, commands: [], breadcrumbs: [],
    popovers: [{ id: 'legacy', label: 'Legacy', icon: 'link', copy: { kind: 'link' } }] }, 'Body'));
  try {
    const content = document.querySelector('[data-popover="legacy"]'); assert.ok(content);
    assert.equal(content.querySelector('[data-popover-copy]'), null);
    assert.equal(content.querySelector('[data-popover-text]'), null); assert.equal(writes, 0);
    const source = fs.readFileSync(path.join(studio, 'components/StudioPage.tsx'), 'utf8');
    assert.match(source, /if \(action\.handler\.kind !== 'copy-prompt'\) return \[\];/);
    assert.doesNotMatch(source, /copy:\s*\{\s*kind:\s*'link'/);
  } finally { await view.close(); delete globalThis.__stockFrameTheme; window.history.replaceState(null, '', '/'); }
});

after(() => { dom.window.close(); });
