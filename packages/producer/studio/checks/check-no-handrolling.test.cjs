'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { findHostCellTree } = require('./check-no-handrolling.cjs');

test('Designer cell navigation composition passes the focused source rule', () => {
  assert.deepEqual(findHostCellTree('const view = <ContentSection><NavigationTree nodes={nodes} /></ContentSection>;'), []);
});

test('mutating Designer composition to raw nav/list markup fails, including self-closing tags', () => {
  const mutation = 'const view = <ContentSection><nav><ul>{nodes.map(node => <li key={node.id} />)}</ul></nav></ContentSection>;';
  assert.deepEqual(findHostCellTree(mutation).map(item => item.tag), ['nav', 'ul', 'li']);
});

test('raw tag words in strings or comments do not masquerade as JSX findings', () => {
  assert.deepEqual(findHostCellTree('const copy = "<nav><ul><li>"; /* <nav /> */ const view = <NavigationTree />;'), []);
});

const H1 = `sha256:${'1'.repeat(64)}`;
const H2 = `sha256:${'2'.repeat(64)}`;
const frame = (inner = '', candidate = 'app-shell-v3.json', hash = H1) => `<main data-clossys-slot="frames.app-shell" data-clossys-candidate="${candidate}" data-clossys-hash="${hash}">${inner}</main>`;

function auditSelection(markup, source = 'consumer', stylesheet = {}) {
  const { JSDOM } = require('jsdom');
  const { inspectStudioSelection } = require('./check-no-handrolling.cjs');
  const dom = new JSDOM(`<html><body>${markup}</body></html>`);
  const prior = global.document;
  global.document = dom.window.document;
  try {
    return inspectStudioSelection({ hash: 'sha256:fixture', ...stylesheet, leaves: [{ leaf: 'frames.app-shell', source, fill: 'app-shell@v3', hash: H1 }, { leaf: 'sections.hero', source, fill: 'hero@v1', hash: H2 }] }, true);
  } finally { global.document = prior; dom.window.close(); }
}

test('selection audit accepts pinned provenance markers and stock RAC parts inside selected roots', () => {
  const hero = `<section data-clossys-slot="sections.hero" data-clossys-candidate="hero-v1.json" data-clossys-hash="${H2}"><button data-slot="button" data-rac><span data-slot="icon" data-rac-hovered></span></button></section>`;
  const result = auditSelection(frame(hero));
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.rendered.map(row => row.leaf), ['frames.app-shell', 'sections.hero']);
});

test('selection audit rejects altered hashes, non-pinned candidate versions and unselected leaves', () => {
  assert.deepEqual(auditSelection(frame('', 'app-shell-v3.json', H2)).findings.map(row => row.rule), ['selected-fill-mismatch']);
  assert.deepEqual(auditSelection(frame('', 'app-shell-v2.json')).findings.map(row => row.rule), ['selected-fill-mismatch']);
  assert.deepEqual(auditSelection(frame('', 'app-shell.json')).findings.map(row => row.rule), ['selected-fill-mismatch']);
  assert.deepEqual(auditSelection(frame(`<div data-clossys-slot="sections.unpinned" data-clossys-candidate="x-v1.json" data-clossys-hash="${H2}"></div>`)).findings.map(row => row.rule), ['unregistered-rendered-leaf']);
});

test('RAC primitives without their own stock part slot, or outside a selected root, fail', () => {
  assert.deepEqual(auditSelection(frame('<button data-rac></button>')).findings.map(row => row.rule), ['rac-without-selected-component']);
  assert.deepEqual(auditSelection(frame() + '<button data-slot="button" data-rac></button>').findings.map(row => row.rule), ['rac-without-selected-component']);
});

test('fallback evidence requires a visible per-leaf NEED on the Designer page', () => {
  assert.deepEqual(auditSelection(frame(), 'foundry').findings.map(row => row.rule), ['fallback-without-need']);
  assert.deepEqual(auditSelection(frame() + 'NEED: frames.app-shell', 'foundry').findings, []);
  assert.deepEqual(auditSelection(frame(), 'unavailable').findings.map(row => row.rule), ['unavailable-leaf-rendered']);
});

test('selected stylesheet mutations fail despite an unchanged declared hash, when a stylesheet is compiled', () => {
  const { JSDOM } = require('jsdom');
  const markup = '<style id="studio-selection-style">.selected { display: block; }</style>' + frame();
  const html = `<html data-selection-css-hash="sha256:css-fixture"><body>${markup}</body></html>`;
  const { inspectStudioSelection } = require('./check-no-handrolling.cjs');
  const run = css => {
    const dom = new JSDOM(html);
    const prior = global.document;
    global.document = dom.window.document;
    try { return inspectStudioSelection({ hash: 'sha256:fixture', css, cssHash: 'sha256:css-fixture', leaves: [{ leaf: 'frames.app-shell', source: 'consumer', fill: 'app-shell@v3', hash: H1 }] }, true); }
    finally { global.document = prior; dom.window.close(); }
  };
  assert.deepEqual(run('.selected { display: block; }').findings, []);
  assert.deepEqual(run('.selected { display: none; }').findings.map(row => row.rule), ['selection-stylesheet-mismatch']);
});

test('a usable selection names pinned leaves and its hash is recomputed from them', () => {
  const { createHash } = require('node:crypto');
  const { assertUsableSelection } = require('./check-no-handrolling.cjs');
  const leaves = [{ leaf: 'frames.app-shell', source: 'consumer', fill: 'app-shell@v3', hash: H1 }];
  const hash = `sha256:${createHash('sha256').update(JSON.stringify(leaves)).digest('hex')}`;
  assert.doesNotThrow(() => assertUsableSelection({ hash, leaves, gateReports: [] }));
  assert.throws(() => assertUsableSelection({ hash, leaves: [] }), /usable Designer selection/);
  assert.throws(() => assertUsableSelection({ hash: H2, leaves }), /independent selection hash/);
  assert.throws(() => assertUsableSelection({ hash, leaves: [{ ...leaves[0], hash: 'sha256:short' }] }), /pinned content hash/);
  assert.throws(() => assertUsableSelection({ runtimeUrl: '/x.js', css: '', cssHash: 'sha256:x', leaves: [] }), /usable Designer selection/);
});

function inspectBody(markup) {
  const { JSDOM } = require('jsdom');
  const { inspectStudioBody } = require('./check-no-handrolling.cjs');
  const dom = new JSDOM(`<html><body>${markup}</body></html>`, { url: 'http://127.0.0.1:4503/' });
  const names = ['document', 'Node', 'ShadowRoot', 'location'];
  const prior = names.map(name => global[name]);
  names.forEach(name => { global[name] = dom.window[name]; });
  try { return inspectStudioBody(); } finally { names.forEach((name, i) => { global[name] = prior[i]; }); dom.window.close(); }
}

test("React's streaming reveal runtime is framework scaffolding; any other inline script is not", () => {
  const runtime = '<script>requestAnimationFrame(function(){$RT=performance.now()});</script><script>$RB=[];$RV=function(a){$RT=performance.now();}</script><script>$RS=function(a,b){a=document.getElementById(a);b=document.getElementById(b);}</script><script>$RC("B:0","S:0")</script>';
  const clean = inspectBody(frame() + runtime);
  assert.deepEqual(clean.violations, []);
  assert.equal(clean.framework['react-fizz-runtime'], 4);
  for (const script of ['<script>$RC("B:0","S:0");alert(1)</script>', '<script id="x">$RC("B:0","S:0")</script>', '<script>requestAnimationFrame(function(){$RT=1});</script>', '<script>window.$RB=[];</script>'])
    assert.equal(inspectBody(frame() + script).violations.length, 1, script);
});

// Row 6/7 of the fake-gates audit: the frame root's marker covered everything placed in its content outlet, so a
// hand-rolled page body under `#studio-main` passed. The outlet is a boundary: content placed there carries its own.
const H3 = `sha256:${'3'.repeat(64)}`;
const section = (inner = '') => `<section data-clossys-slot="sections.hero" data-clossys-candidate="hero-v1.json" data-clossys-hash="${H3}">${inner}</section>`;

test('unmarked content placed in the frame content outlet fails although the frame root is its ancestor', () => {
  const bad = inspectBody(frame('<div id="studio-main"><div id="notice" data-slot="card">Loading</div></div>'));
  assert.deepEqual(bad.violations.map(row => [row.id, row.rule]), [['notice', 'outlet-content-without-provenance']]);
  const popover = inspectBody(frame('<div data-popover-body><p id="hand">Hand-rolled</p></div>'));
  assert.deepEqual(popover.violations.map(row => row.rule), ['outlet-content-without-provenance']);
});

test('marked sections placed in the outlet, and the frame own markup around it, stay covered', () => {
  assert.deepEqual(inspectBody(frame(`<nav><span>Rail</span></nav><div id="studio-main">${section('<div><span>Copy</span></div>')}</div>`)).violations, []);
  assert.deepEqual(inspectBody(frame('<div id="studio-main"></div>')).violations, []);
});

test('the audited routes are derived from the Studio map: every published route and each leaf assembly once', () => {
  const { studioRoutes, mappedRoutes } = require('./check-no-handrolling.cjs');
  const leaf = { sectionIds: ['sections.detail'], body: 'detail', data: { loader: 'slot', agent: 'designer' } };
  const map = {
    routes: [{ path: '/' }, { path: '/designer/components' }],
    pages: [{ id: 'a', frameId: 'frames.studio-shell', leaf }, { id: 'b', frameId: 'frames.studio-shell', leaf }, { id: 'c', frameId: 'frames.studio-shell', leaf: { ...leaf, body: 'other' } }, { id: 'd', frameId: 'frames.studio-shell' }],
    leaves: [{ page: 'a', path: '/designer/a/x' }, { page: 'b', path: '/designer/b/y' }, { page: 'c', path: '/designer/c/z' }, { page: 'd', path: '/designer/d/w' }],
  };
  assert.deepEqual(studioRoutes(map), ['/', '/designer/components', '/designer/a/x', '/designer/c/z']);
  const fs = require('node:fs');
  const path = require('node:path');
  const live = JSON.parse(fs.readFileSync(path.join(__dirname, '../generated/studio-map.json'), 'utf8'));
  const routes = mappedRoutes();
  for (const route of live.routes) assert.ok(routes.includes(route.path), route.path);
  const os = require('node:os');
  const empty = path.join(fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'nhr-')), 'map.json');
  fs.writeFileSync(empty, JSON.stringify({ routes: [], pages: [], leaves: [] }));
  try { assert.throws(() => mappedRoutes(empty), /no Studio routes/); } finally { fs.rmSync(empty); fs.rmdirSync(path.dirname(empty)); }
});

test('rendered provenance treats the content outlet as a boundary and refuses a run over zero routes', async () => {
  const { JSDOM } = require('jsdom');
  const { inspectProvenance, assertRoutesChecked } = await import('./check-rendered-provenance.mjs');
  const run = markup => {
    const dom = new JSDOM(`<html><body>${markup}</body></html>`, { url: 'http://127.0.0.1:4503/' });
    const names = ['document', 'Node', 'ShadowRoot', 'location', 'Element', 'getComputedStyle'];
    const prior = names.map(name => global[name]);
    names.forEach(name => { global[name] = typeof dom.window[name] === 'function' && name === 'getComputedStyle' ? dom.window[name].bind(dom.window) : dom.window[name]; });
    try { return inspectProvenance(); } finally { names.forEach((name, i) => { global[name] = prior[i]; }); dom.window.close(); }
  };
  const bad = run(frame('<div id="studio-main"><div id="notice">Loading</div></div>'));
  assert.ok(bad.findings.some(row => row.rule === 'outlet-content-without-provenance'), JSON.stringify(bad.findings));
  const clean = run(frame(`<div id="studio-main">${section('<p>Copy</p>')}</div>`));
  assert.deepEqual(clean.findings.filter(row => row.rule === 'outlet-content-without-provenance'), []);
  assert.throws(() => assertRoutesChecked([], { pages: [] }), /0 routes checked/);
  assert.doesNotThrow(() => assertRoutesChecked(['/'], { pages: [] }));
});
