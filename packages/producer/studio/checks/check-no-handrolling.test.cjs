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

function auditSelection(markup, source = 'consumer', stylesheet = {}) {
  const { JSDOM } = require('jsdom');
  const { inspectStudioSelection } = require('./check-no-handrolling.cjs');
  const dom = new JSDOM(`<html data-selection-hash="sha256:fixture" data-selection-css-hash="sha256:css-fixture"><body>${markup}</body></html>`);
  const prior = global.document;
  global.document = dom.window.document;
  try {
    return inspectStudioSelection({ hash: 'sha256:fixture', ...stylesheet, leaves: [{ leaf: 'frames.app-shell', source, fill: 'consumer/frames.app-shell' }, { leaf: 'components.button', source, fill: 'consumer/components.button' }] }, true);
  } finally { global.document = prior; dom.window.close(); }
}

test('selection audit accepts actual selected fill provenance and component-owned RAC descendants', () => {
  assert.deepEqual(auditSelection('<main data-ds-leaf="frames.app-shell" data-ds-fill="consumer/frames.app-shell"><button data-ds-leaf="components.button" data-ds-fill="consumer/components.button" data-rac><span data-rac></span></button></main>').findings, []);
});

test('selection audit rejects stale fill bytes and RAC primitives hidden under a frame', () => {
  const result = auditSelection('<main data-ds-leaf="frames.app-shell" data-ds-fill="consumer/frames.app-shell"><button data-ds-leaf="components.button" data-ds-fill="foundry/components.button"></button><button data-rac></button></main>');
  assert.deepEqual(result.findings.map(row => row.rule), ['selected-fill-mismatch', 'rac-without-selected-component']);
});

test('fallback evidence requires a visible per-leaf NEED on the Designer page', () => {
  const markup = '<main data-ds-leaf="frames.app-shell" data-ds-fill="consumer/frames.app-shell"></main>';
  assert.deepEqual(auditSelection(markup, 'foundry').findings.map(row => row.rule), ['fallback-without-need']);
  assert.deepEqual(auditSelection(markup + 'NEED: frames.app-shell', 'foundry').findings, []);
});


test('selected stylesheet mutations fail despite an unchanged declared hash', () => {
  const markup = '<style id="studio-selection-style">.selected { display: block; }</style><main data-ds-leaf="frames.app-shell" data-ds-fill="consumer/frames.app-shell"></main>';
  assert.deepEqual(auditSelection(markup, 'consumer', { css: '.selected { display: block; }', cssHash: 'sha256:css-fixture' }).findings, []);
  assert.deepEqual(auditSelection(markup, 'consumer', { css: '.selected { display: none; }', cssHash: 'sha256:css-fixture' }).findings.map(row => row.rule), ['selection-stylesheet-mismatch']);
});

test('profile context preserves optional legacy responses and rejects stale or foreign profile bindings', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const Module = require('node:module');
  const { transformSync } = require('esbuild');
  const file = path.join(__dirname, '../lib/selection-client.ts');
  const compiled = new Module(file, module);
  compiled.filename = file;
  compiled.paths = Module._nodeModulePaths(path.dirname(file));
  compiled._compile(transformSync(fs.readFileSync(file, 'utf8'), { loader: 'ts', format: 'cjs' }).code, file);
  const { parseSelectionResponse, loadSelectionProfile, STUDIO_NEEDED_LEAVES } = compiled.exports;
  const hash = `sha256:${'1'.repeat(64)}`;
  const selection = {
    hash, runtimeUrl: `/api/selection/runtime.js?hash=${encodeURIComponent(hash)}`,
    css: ':root {}', cssHash: hash,
    leaves: STUDIO_NEEDED_LEAVES.map(leaf => ({ leaf, source: 'consumer' })),
  };
  const controller = new AbortController();
  assert.equal(await loadSelectionProfile(parseSelectionResponse({ selection }), controller.signal), undefined);
  const profileUrl = `/api/selection/profile?hash=${encodeURIComponent(hash)}`;
  const current = parseSelectionResponse({ selection: { ...selection, profileUrl } });
  for (const foreign of ['https://example.test/profile', '//example.test/profile', '/api/selection/profile?hash=stale']) {
    assert.throws(() => parseSelectionResponse({ selection: { ...selection, profileUrl: foreign } }), /invalid Designer profile URL/);
  }
  const priorFetch = global.fetch;
  try {
    const profile = { selectionHash: hash, values: {}, components: {} };
    global.fetch = async url => {
      assert.equal(url, profileUrl);
      return { ok: true, json: async () => profile };
    };
    assert.deepEqual(await loadSelectionProfile(current, controller.signal), profile);
    profile.selectionHash = `sha256:${'2'.repeat(64)}`;
    await assert.rejects(loadSelectionProfile(current, controller.signal), /stale or invalid Designer profile/);
  } finally { global.fetch = priorFetch; }
});
