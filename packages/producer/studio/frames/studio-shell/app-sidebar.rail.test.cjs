'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { JSDOM } = require('jsdom');
const { buildSync } = require('esbuild');

const studio = path.resolve(__dirname, '../..');
const designer = path.resolve(studio, '../../designer/ui/src/index.ts');
const provider = JSON.stringify(`data:text/javascript,${encodeURIComponent('export const useStudioData=()=>({brand:{state:"ready",value:{name:"Consumer"}}});export const useThemeMode=()=>({resolved:"light"});')}`);
const source = fs.readFileSync(path.join(__dirname, 'app-sidebar.tsx'), 'utf8')
  .replace('from "../../components/StudioProviders"', `from ${provider}`)
  + '\nexport { SidebarProvider as TestSidebarProvider } from "@clossys/designer-ui";';
// Bundle the actual sidebar and native Designer components; only the data/theme host is a fixture.
const output = buildSync({ stdin: { contents: source, resolveDir: __dirname, loader: 'tsx' },
  tsconfig: path.join(studio, 'tsconfig.json'), bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic',
  alias: { '@clossys/designer-ui': designer }, external: ['react', 'react-dom', 'react/*', 'react-dom/*'],
  loader: { '.css': 'empty' }, write: false, logLevel: 'silent' }).outputFiles[0].text;
const compiled = new Module(path.join(studio, 'app-sidebar-rail-test.cjs'), module);
compiled.filename = path.join(studio, 'app-sidebar-rail-test.cjs');
compiled.paths = Module._nodeModulePaths(studio);
compiled._compile(output, compiled.filename);
const { AppSidebar, TestSidebarProvider } = compiled.exports;
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const navigation = { tree: [{ id: 'home', label: 'Home', href: '/', icon: 'home' }], activeId: 'home' };

for (const mode of ['none', 'default', 'offcanvas']) {
  test(`native AppSidebar ${mode} preserves content and exposes only an applicable rail`, () => {
    const copy = { team: 'Clossys Studio', plan: 'Studio', localPlan: 'Local workspace', user: { name: 'Local workspace', email: 'Producer on this machine', initials: 'LW' } };
    const props = mode === 'default' ? { navigation, copy } : { navigation, copy, collapsible: mode };
    const html = renderToStaticMarkup(React.createElement(TestSidebarProvider, null,
      React.createElement(AppSidebar, props)));
    const dom = new JSDOM(html);
    try {
      const container = dom.window.document;
      const header = container.querySelector('[data-sidebar="header"]');
      const content = container.querySelector('[data-sidebar="content"]');
      const footer = container.querySelector('[data-sidebar="footer"]');
      assert.match(header.textContent, /Clossys Studio/);
      assert.equal(header.querySelector('img').getAttribute('src'), '/api/brand/mark.svg?ground=dark');
      assert.equal(content.querySelector('a[href="/"]').textContent, 'Home');
      assert.match(footer.textContent, /Local workspace/);
      const rails = container.querySelectorAll('[data-sidebar="rail"]');
      if (mode === 'none') {
        assert.equal(rails.length, 0, 'a non-collapsible sidebar must omit the rail control');
      } else {
        assert.equal(rails.length, 1);
        assert.equal(rails[0].tagName, 'BUTTON');
        assert.equal(rails[0].getAttribute('aria-label'), 'Toggle Sidebar');
      }
    } finally { dom.window.close(); }
  });
}
