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
