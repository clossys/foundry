import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { ROUTE_MARKER, PAGE_HEADER, PAGE_TABS, checkAssembleOnly } from './check-assemble-only.mjs';

const ROUTE = `${ROUTE_MARKER}
import { createElement } from "react";
import { PublishedPage } from "../../components/StudioInstalledPage";

export default function Page() {
  return createElement(PublishedPage, { page: "designer-themes" });
}
`;
const SECTION = `export default function TabsSection({ tabs }: { tabs: { id: string }[] }) {
  if (!tabs.length) return null;
  return <nav data-studio-section="page-tabs">{tabs.map(tab => <a key={tab.id}>{tab.id}</a>)}</nav>;
}
`;
const RENDERER = `export function StudioPage({ spec }) { return <Frame>{spec.sectionIds.map(slot => <Placed key={slot} slot={slot} />)}</Frame>; }
const loader = sources[spec.data.source];
`;
const record = sections => JSON.stringify({ schema: 'clossys.page/1', path: '/designer/themes', frame: 'frames.studio-shell', sections });
const MAP = {
  map: {
    entries: [
      { id: 'home', kind: 'page', path: '/', parentId: null },
      { id: 'designer', kind: 'group', path: '/designer', parentId: null },
      { id: 'designer-themes', kind: 'page', path: '/designer/themes', parentId: 'designer', source: { sectionIds: [PAGE_HEADER, PAGE_TABS] } },
      { id: 'designer-themes.colors', kind: 'page', path: '/designer/themes/colors', parentId: 'designer-themes' },
    ],
  },
};

function fixture(overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'assemble-only-'));
  const files = {
    'packages/producer/studio/app/designer/themes/page.tsx': ROUTE,
    'packages/producer/studio/sections/page-tabs/index.tsx': SECTION,
    'packages/producer/studio/components/StudioPage.tsx': RENDERER,
    'packages/producer/studio/generated/studio-map.json': JSON.stringify(MAP),
    'clossys/agents/publisher/page.designer-themes/pin.json': JSON.stringify({ candidate: 'page-v1.json' }),
    'clossys/agents/publisher/page.designer-themes/candidates/page-v1.json': record([PAGE_HEADER, PAGE_TABS]),
    ...overrides,
  };
  for (const [file, content] of Object.entries(files)) {
    if (content === null) continue;
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), content);
  }
  const findings = checkAssembleOnly({ producerRoot: join(root, 'packages/producer'), repositoryRoot: root });
  rmSync(root, { recursive: true, force: true });
  return findings;
}
const rules = findings => [...new Set(findings.map(row => row.rule))].sort();

test('a fully assembled Studio passes', () => {
  assert.deepEqual(fixture(), []);
});

test('mutation: an app page that renders JSX or fetches fails app-route', () => {
  const findings = fixture({ 'packages/producer/studio/app/designer/themes/page.tsx': 'export default async function Page() { await fetch("/x"); return <main />; }\n' });
  assert.deepEqual(rules(findings), ['app-route']);
  assert.ok(findings.some(row => /renders JSX/.test(row.detail)));
  assert.ok(findings.some(row => /fetches/.test(row.detail)));
});

test('mutation: an agent-name branch or agent-keyed map fails agent-branch', () => {
  assert.deepEqual(rules(fixture({ 'packages/producer/studio/lib/load.ts': "export const load = agent => agent === 'designer' ? 1 : 2;\n" })), ['agent-branch']);
  assert.deepEqual(rules(fixture({ 'packages/producer/studio/lib/copy.ts': "const PURPOSE = {\n  writer: 'copy',\n};\n" })), ['agent-branch']);
  assert.deepEqual(rules(fixture({ 'packages/producer/studio/lib/slots.ts': "if (record.kind === 'slot') run();\n" })), ['agent-branch']);
});

test('mutation: a section root without provenance, or renderer DOM, fails provenance', () => {
  assert.deepEqual(rules(fixture({ 'packages/producer/studio/sections/page-tabs/index.tsx': SECTION.replace(' data-studio-section="page-tabs"', '') })), ['provenance']);
  assert.deepEqual(rules(fixture({ 'packages/producer/studio/components/StudioPage.tsx': RENDERER.replace('<Frame>', '<Frame><h1>Title</h1>') })), ['provenance']);
});

test('mutation: an explorer anywhere fails explorer', () => {
  assert.deepEqual(rules(fixture({ 'clossys/agents/publisher/page.designer-themes/candidates/page-v1.json': record([PAGE_HEADER, PAGE_TABS, 'sections.module.explorer']) })), ['explorer']);
  assert.deepEqual(rules(fixture({ 'packages/producer/studio/sections/module-explorer/index.tsx': SECTION })), ['explorer']);
});

test('mutation: hard-coded agent routes fail hard-coded-route', () => {
  assert.deepEqual(rules(fixture({ 'packages/producer/studio/frames/nav.ts': "export const href = '/designer/themes';\n" })), ['hard-coded-route']);
  assert.deepEqual(rules(fixture({ 'packages/producer/studio/lib/api.ts': 'fetch(`/api/designer/library`);\n' })), ['hard-coded-route']);
});

test('mutation: a record without the page header first fails page-header', () => {
  assert.deepEqual(rules(fixture({ 'clossys/agents/publisher/page.designer-themes/candidates/page-v1.json': record([PAGE_TABS]) })), ['page-header']);
});

test('mutation: a record page without projected tab routes fails tabs-projected', () => {
  const map = { map: { entries: MAP.map.entries.filter(entry => entry.id !== 'designer-themes.colors') } };
  assert.deepEqual(rules(fixture({ 'packages/producer/studio/generated/studio-map.json': JSON.stringify(map) })), ['tabs-projected']);
  const flat = { map: { entries: [...MAP.map.entries, { id: 'agents', kind: 'group', parentId: null }, { id: 'writer', kind: 'page', parentId: 'agents', source: { sectionIds: [PAGE_HEADER, PAGE_TABS] } }] } };
  assert.ok(fixture({ 'packages/producer/studio/generated/studio-map.json': JSON.stringify(flat) }).some(row => /agent accordions/.test(row.detail)));
});
