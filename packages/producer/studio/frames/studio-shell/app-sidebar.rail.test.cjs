'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { JSDOM } = require('jsdom');
const { buildSync } = require('esbuild');

const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const studio = path.resolve(__dirname, '../..');
const designer = path.resolve(studio, '../../designer/ui/src/index.ts');
const source = fs.readFileSync(path.join(__dirname, 'app-sidebar.tsx'), 'utf8')
  + '\nexport { SidebarProvider as TestSidebarProvider } from "@clossys/designer-ui";';
// Bundle the actual sidebar and native Designer components; it is pure, so only its data is a fixture.
const output = buildSync({ stdin: { contents: source, resolveDir: __dirname, loader: 'tsx' },
  tsconfig: path.join(studio, 'tsconfig.json'), bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic',
  alias: { '@clossys/designer-ui': designer }, external: ['react', 'react-dom', 'react/*', 'react-dom/*'],
  loader: { '.css': 'empty' }, write: false, logLevel: 'silent' }).outputFiles[0].text;
const compiled = new Module(path.join(studio, 'app-sidebar-rail-test.cjs'), module);
compiled.filename = path.join(studio, 'app-sidebar-rail-test.cjs');
compiled.paths = Module._nodeModulePaths(studio);
compiled._compile(output, compiled.filename);
const { AppSidebar, TestSidebarProvider } = compiled.exports;
// The resolved navigation the renderer (components/StudioShell.tsx) hands the frame.
const navigation = {
  pages: [{ id: 'home', title: 'Home', url: '/', isActive: true }], systems: [],
  team: { name: 'Clossys Studio', plan: 'Studio', logo: React.createElement('img', { src: '/api/brand/mark.svg?ground=light', alt: '' }) },
  user: { name: 'Local workspace', email: 'Producer on this machine', avatar: '/avatars/shadcn.jpg', initials: 'LW' },
};

for (const mode of ['none', 'default', 'offcanvas']) {
  test(`native AppSidebar ${mode} preserves content and exposes only an applicable rail`, () => {
    const props = mode === 'default' ? { navigation } : { navigation, collapsible: mode };
    const html = renderToStaticMarkup(React.createElement(TestSidebarProvider, null,
      React.createElement(AppSidebar, props)));
    const dom = new JSDOM(html);
    try {
      const container = dom.window.document;
      const header = container.querySelector('[data-sidebar="header"]');
      const content = container.querySelector('[data-sidebar="content"]');
      const footer = container.querySelector('[data-sidebar="footer"]');
      assert.match(header.textContent, /Clossys Studio/);
      assert.equal(header.querySelector('img').getAttribute('src'), '/api/brand/mark.svg?ground=light');
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
