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
    export {ChatContent} from './stock-chat-sidebar';
    export {HeaderPopover} from './stock-header-controls';
    export {SidebarProvider, SidebarTrigger, SidebarRail, Sidebar, SidebarMenuButton, useSidebar, Item} from '@clossys/designer-ui';
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
// The shell's words, as Studio resolves them from Writer keys (lib/shell-copy.ts).
const sidebarCopy = { team: 'Clossys Studio', plan: 'Studio', localPlan: 'Local workspace', user: { name: 'Local workspace', email: 'Producer on this machine', initials: 'LW' } };
const chatCopy = { title: 'Chat', emptyTitle: 'No conversation yet', emptyDescription: 'Chat with Director, Designer, Writer and Publisher will open here. Agents work through the CLI for now.',
  sheets: { left: { title: 'Sidebar', description: 'Displays the mobile sidebar.' }, chat: { title: 'Chat', description: 'Ask an agent about the open page.' } } };
const shellCopy = { copied: 'Copied', copyPrompt: 'Copy prompt', resizeChat: 'Resize chat', toggleSidebar: 'Toggle Sidebar', toggleTheme: 'Toggle theme', toggleChat: 'Toggle chat',
  search: { title: 'Find a page', description: "Search Studio pages and this page's commands", placeholder: 'Search pages and commands', label: 'Pages', empty: 'No matching pages', page: 'This page' },
  chat: chatCopy, sidebar: sidebarCopy };
async function mounted(element, width = 1440) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
  await act(async () => { root.render(element); });
  return { container, async close() { await act(async () => root.unmount()); container.remove(); } };
}
async function click(element) { assert.ok(element); await act(async () => element.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }))); }

test('actual sidebar keeps static workspace and profile rows with Clossys Studio and the consumer mark', () => {
  const provider = JSON.stringify(`data:text/javascript,${encodeURIComponent('export const useStudioData=()=>globalThis.__staticNavData;export const useThemeMode=()=>globalThis.__staticNavTheme;')}`);
  const source = fs.readFileSync(path.join(__dirname, 'app-sidebar.tsx'), 'utf8')
    .replace('from "../../components/StudioProviders"', `from ${provider}`)
    + '\nexport { SidebarProvider as TestSidebarProvider } from "@clossys/designer-ui";';
  const bundled = buildSync({ stdin: { contents: source, resolveDir: __dirname, loader: 'tsx' },
    tsconfig: path.join(studio, 'tsconfig.json'), bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic',
    external: ['react', 'react-dom', 'react/*', 'react-dom/*'], loader: { '.css': 'empty' }, write: false, logLevel: 'silent' }).outputFiles[0].text;
  const { AppSidebar, TestSidebarProvider } = load(bundled);
  try {
    for (const resolved of ['light', 'dark']) {
      for (const brand of [{ state: 'ready', value: { name: 'Consumer' } }, { state: 'unavailable' }]) {
        globalThis.__staticNavData = { brand };
        globalThis.__staticNavTheme = { resolved };
        const html = renderToStaticMarkup(e(TestSidebarProvider, null, e(AppSidebar, { navigation: { tree: [], activeId: 'home' }, copy: sidebarCopy })));
        const container = document.createElement('div'); container.innerHTML = html;
        const header = container.querySelector('[data-sidebar="header"]');
        const footer = container.querySelector('[data-sidebar="footer"]');
        assert.match(header.textContent, /Clossys Studio/);
        const mark = header.querySelector('img'); assert.ok(mark);
        assert.equal(mark.getAttribute('src'), `/api/brand/mark.svg?ground=${resolved === 'dark' ? 'light' : 'dark'}`);
        assert.match(footer.textContent, /Local workspace/);
        for (const row of [header, footer]) {
          // R2F-03: the static row is components.studio.sidebar-static-row, a stock Item (size sm).
          assert.equal(row.querySelectorAll('[data-slot="item"][data-size="sm"]').length, 1);
          assert.equal(row.querySelector('button, [role="button"], [aria-haspopup], [data-slot="dropdown-menu-trigger"], [data-slot="popover-trigger"]'), null);
        }
      }
    }
  } finally { delete globalThis.__staticNavData; delete globalThis.__staticNavTheme; }
});

// Pure component inputs exercise static adoption without a fabricated account or menu.
test('workspace and profile keep stock row presentation with no switch menu or inactive button', () => {
  const html = renderToStaticMarkup(e(api.SidebarProvider, null,
    e(api.TeamSwitcher, { teams: [{ name: 'Workspace', logo: e('span', null, 'Mark'), itemLogo: null, plan: 'Studio' }] }),
    e(api.NavUser, { user: { name: 'Local workspace', email: 'Producer on this machine', initials: 'LW' } })));
  // R2F-03: each static row is the stock Item (size sm) with exactly its stock classes and none added.
  const stock = renderToStaticMarkup(e(api.Item, { size: 'sm' }, 'Profile'));
  const classOf = markup => markup.match(/<div[^>]+class="([^"]+)"/)[1];
  const rows = [...html.matchAll(/<div[^>]*data-slot="item"[^>]*>/g)].map(m => classOf(m[0]));
  assert.equal(rows.length, 2);
  for (const row of rows) assert.equal(row, classOf(stock), 'static rows keep every stock presentation class and add none');
  assert.match(html, /Workspace/); assert.match(html, /Local workspace/);
  assert.doesNotMatch(html, /<button\b|role="button"|aria-haspopup|ChevronsUpDown|Add team|Upgrade|Billing/);
});

test('native context guard remains enforced for trigger and chat sidebar', () => {
  assert.throws(() => renderToStaticMarkup(e(api.SidebarTrigger)), /within a SidebarProvider/);
  assert.throws(() => renderToStaticMarkup(e(api.Sidebar, { collapsible: 'none' }, e(api.ChatContent, { copy: chatCopy }))), /within a SidebarProvider/);
  // R2F-03: the static workspace row is a stock Item that reads no sidebar context, so it renders anywhere without a button.
  assert.doesNotMatch(renderToStaticMarkup(e(api.TeamSwitcher, { teams: [{ name: 'Workspace', logo: null, itemLogo: null, plan: 'Studio' }] })), /<button\b|role="button"/);
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

test('375px shell shares the stock Sidebar mobile sheet, stock geometry, close CTA and dismissal for navigation/chat', async () => {
  const Frame = shellComponent();
  globalThis.__stockFrameTheme = { resolved: 'light', setMode() {} };
  const navigation = { tree: [{ id: 'home', label: 'Home', href: '/', icon: 'home' }], activeId: 'home' };
  const view = await mounted(e(Frame, { copy: shellCopy, homeHref: '/', navigation, commands: [], breadcrumbs: [] }, 'Body'), 375);
  const sheets = () => [...document.querySelectorAll('[data-mobile="true"]')];
  async function escape() {
    await act(async () => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    assert.equal(sheets().length, 0);
    assert.equal(document.querySelectorAll('[role="dialog"]').length, 0);
  }
  try {
    await click(view.container.querySelector('[data-panel-toggle="left"]'));
    const nav = sheets()[0]; assert.ok(nav); assert.equal(sheets().length, 1);
    assert.equal(nav.style.getPropertyValue('--sidebar-width'), '18rem');
    assert.match(nav.textContent, /Home/);
    assert.equal(nav.querySelector('[data-mobile]'), null, 'navigation content cannot create a nested mobile sheet');
    const geometry = nav.querySelector('[data-slot="sheet-content"]').className;
    const styling = nav.className;
    const close = nav.querySelector('[data-slot="sheet-close"]').outerHTML.replace(/ id="[^"]*"/, '');
    await escape();
    await click(view.container.querySelector('[data-panel-toggle="chat"]'));
    const chat = sheets()[0]; assert.ok(chat); assert.equal(sheets().length, 1);
    assert.equal(document.querySelectorAll('[role="dialog"]').length, 1);
    assert.equal(chat.style.getPropertyValue('--sidebar-width'), '18rem');
    assert.equal(chat.className, styling);
    assert.equal(chat.querySelector('[data-slot="sheet-content"]').className, geometry);
    assert.equal(chat.querySelector('[data-slot="sheet-close"]').outerHTML.replace(/ id="[^"]*"/, ''), close);
    assert.match(chat.textContent, /No conversation yet/);
    await escape();
    await click(view.container.querySelector('[data-panel-toggle="left"]'));
    // Invoke the other bound trigger while the modal is open to verify the shared state.
    await click(view.container.querySelector('[data-panel-toggle="chat"]'));
    assert.equal(sheets().length, 1);
    assert.equal(sheets()[0].getAttribute('data-panel'), 'chat');
    assert.equal(document.querySelectorAll('[role="dialog"]').length, 1);
    await click(view.container.querySelector('[data-panel-toggle="left"]'));
    assert.equal(sheets().length, 1, 'native left trigger switches from chat with one toggle');
    assert.equal(sheets()[0].getAttribute('data-panel'), 'left');
    assert.equal(document.querySelectorAll('[role="dialog"]').length, 1);
    await escape();
  } finally { await view.close(); delete globalThis.__stockFrameTheme; }
});

test('375px mobile sheets take their title and description from the Writer chat.sheets keys, not the stock English literal', async () => {
  const Frame = shellComponent();
  globalThis.__stockFrameTheme = { resolved: 'light', setMode() {} };
  const sheets = { left: { title: 'Writer left title', description: 'Writer left description.' }, chat: { title: 'Writer chat title', description: 'Writer chat description.' } };
  const copy = { ...shellCopy, chat: { ...chatCopy, sheets } };
  const navigation = { tree: [{ id: 'home', label: 'Home', href: '/', icon: 'home' }], activeId: 'home' };
  const view = await mounted(e(Frame, { copy, homeHref: '/', navigation, commands: [], breadcrumbs: [] }, 'Body'), 375);
  const words = () => { const dialog = document.querySelector('[role="dialog"]'); return [dialog.querySelector('[data-slot="sheet-title"]').textContent, dialog.querySelector('[data-slot="sheet-description"]').textContent]; };
  try {
    for (const panel of ['left', 'chat']) {
      await click(view.container.querySelector(`[data-panel-toggle="${panel}"]`));
      assert.deepEqual(words(), [sheets[panel].title, sheets[panel].description]);
      await act(async () => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    }
  } finally { await view.close(); delete globalThis.__stockFrameTheme; }
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

for (const width of [768, 1280]) test(`shell at ${width}px is the sidebar-15 page: desktop sidebars, the block's trigger/Separator pair at both header edges, the right Sidebar chat and the existing theme setter`, async () => {
  const Frame = shellComponent();
  const themeCalls = [];
  globalThis.__stockFrameTheme = { resolved: 'light', setMode: value => themeCalls.push(value) };
  document.cookie = 'chat_state=true';
  const navigation = { tree: [{ id: 'home', label: 'Home', href: '/', icon: 'home' }], activeId: 'home' };
  const view = await mounted(e(Frame, { copy: shellCopy, homeHref: '/', navigation, commands: [], breadcrumbs: [{ id: 'home', label: 'Home' }] }, e('section', { id: 'body' }, 'Body')), width);
  try {
    assert.equal(document.querySelector('[data-mobile="true"]'), null, 'both sidebars use desktop behavior at the native md boundary');
    const header = view.container.querySelector('[data-slot="sidebar-inset"] > header'); assert.ok(header);
    assert.ok(header.classList.contains('sticky') && header.classList.contains('h-14'));
    const separators = [...header.querySelectorAll('[data-slot="separator"]')]; assert.equal(separators.length, 2);
    assert.equal(separators[0].className, separators[1].className, 'both header edges carry the same block divider');
    for (const separator of separators) {
      assert.equal(separator.getAttribute('aria-orientation'), 'vertical');
      assert.ok(separator.classList.contains('mr-2') && separator.classList.contains('data-[orientation=vertical]:h-4'));
    }
    assert.equal(separators[0].previousElementSibling.getAttribute('data-panel-toggle'), 'left');
    assert.equal(separators[1].nextElementSibling.getAttribute('data-panel-toggle'), 'chat');
    assert.equal(view.container.querySelector('#studio-main').className, 'flex flex-1 flex-col gap-4 p-4');
    assert.ok(view.container.querySelector('#studio-main #body'));
    assert.equal(view.container.querySelector('[data-slot="resizable-panel-group"]'), null, 'no resizable panel group: the chat is the block right Sidebar');
    const chat = view.container.querySelector('[data-panel="chat"]'); assert.ok(chat);
    assert.equal(chat.getAttribute('data-slot'), 'sidebar');
    for (const name of ['sticky', 'top-0', 'hidden', 'h-svh', 'border-l', 'lg:flex']) assert.ok(chat.classList.contains(name), name);
    assert.equal(chat.parentElement, view.container.querySelector('[data-slot="sidebar-wrapper"]'), 'the chat sits beside the inset in the one provider');
    await click(header.querySelector('[data-theme-toggle]')); assert.deepEqual(themeCalls, ['dark']);
    await click(header.querySelector('[data-panel-toggle="chat"]'));
    assert.equal(view.container.querySelector('[data-panel="chat"]'), null);
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
  const view = await mounted(e(Frame, { copy: shellCopy, homeHref: '/', navigation: { tree: [], activeId: 'home' }, commands: [], breadcrumbs: [],
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
  const view = await mounted(e(Frame, { copy: shellCopy, homeHref: '/', navigation: { tree: [], activeId: 'home' }, commands: [], breadcrumbs: [],
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
