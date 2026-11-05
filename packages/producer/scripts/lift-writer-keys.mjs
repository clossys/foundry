#!/usr/bin/env node
/**
 * SEEN-COPY Writer lift: every string Studio showed without a Writer key becomes a Writer record,
 * and every Publisher title becomes that key. Deterministic: the text of each new record is the
 * text a base Studio displayed (`dc2399c`), derived by the base display rule, never written by hand:
 *
 *   strings.names        `<agent>.item.<slot>`: the base fallback (`slotIdLabel`, verbatim below);
 *                        `<agent>.ia.<id>`: the ia.json label the base gallery and tabs showed
 *                        (an L0 without an IA node: its `slotIdLabel`).
 *   strings.page-titles  `studio.page.<page>`: the pinned page record's title;
 *                        `studio.nav.<node>`: the pinned publication tree's node name.
 *   strings.errors       the base server literals a person could see (plain-text failure pages).
 *   strings.common       the base flow literals: React Flow's built-in words (its defaults,
 *                        byte for byte), the step count labels and the team initials (the base
 *                        concatenation and `slice(0, 1)` of the Writer lane name).
 *
 * Each Writer candidate is a strict superset of its pin: the pinned bytes unchanged, records
 * appended. Each Publisher candidate changes only `title` (page) or tree `name` (publication), to
 * the key whose text is byte-identical. Prints the plan; `--write` writes the candidates (the
 * Producer API numbers and validates them) and pins each with `clossys pin --by planner:SEEN-COPY`.
 *
 * Usage: node scripts/lift-writer-keys.mjs [--root <repo>] [--write]
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseWriterSlotBody } from '@clossys/writer/slot-body';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const at = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
const repo = resolve(at('--root') ?? join(here, '../../..'));
const write = args.includes('--write');
const consumer = join(repo, 'clossys');
const { listSlots, readCandidate, readPin, writeCandidate } = await import('../dist/records/index.js');
const { parseFrontmatter } = await import('../dist/records/slot-model/index.js');

/** Base display rule, verbatim from base `src/records/slot-labels.ts` (dc2399c). */
function slotIdLabel(id) {
  const rest = id.includes('.') ? id.slice(id.indexOf('.') + 1) : id;
  const words = rest.replace(/[.-]+/g, ' ').trim();
  return words ? words.replace(/^\w/, c => c.toUpperCase()) : id;
}

/** The pinned Writer candidate of one slot: name, bytes, and its source-locale records. */
function pinnedWriter(slot) {
  const pin = readPin(consumer, 'writer', slot);
  const candidate = readCandidate(consumer, 'writer', slot, pin.candidate);
  if (candidate.sha256 !== pin.sha256) throw new Error(`writer/${slot}: candidate drifted from its pin`);
  const parsed = parseFrontmatter(candidate.bytes);
  if (!parsed.ok) throw new Error(`writer/${slot}: no frontmatter`);
  const locales = parsed.value.fields.locales;
  const records = parseWriterSlotBody(parsed.value.body, locales).filter(row => row.locale === locales[0]).map(row => row.record);
  return { pin, bytes: candidate.bytes, records };
}

const plans = [];
/** Every `studio.` key the pinned Writer copy already holds, across all strings slots: id -> text. */
const held = new Map();
for (const entry of listSlots(consumer, 'writer')) {
  if (!entry.pin || !/^strings\.[a-z0-9-]+$/.test(entry.id)) continue;
  for (const record of pinnedWriter(entry.id).records) if (record.id.startsWith('studio.')) held.set(record.id, { slot: entry.id, text: record.text.trim() });
}
/** One Writer superset candidate: records appended, the pinned bytes kept. */
function writerPlan(slot, rows) {
  const base = pinnedWriter(slot);
  const ids = new Set(base.records.map(record => record.id)), contexts = new Set(base.records.map(record => record.context));
  // A key another strings slot already holds with the same text is reused, never recorded twice.
  for (const row of rows) {
    const other = held.get(row.id);
    if (other && other.slot !== slot && other.text !== row.text) throw new Error(`${row.id} is ${JSON.stringify(other.text)} in writer/${other.slot}, base showed ${JSON.stringify(row.text)}`);
  }
  const added = rows.filter(row => !contexts.has(row.context) && !(held.get(row.id) && held.get(row.id).slot !== slot));
  for (const row of added) if (ids.has(row.id)) throw new Error(`writer/${slot}: id ${row.id} already recorded`);
  if (new Set(added.map(row => row.id)).size !== added.length) throw new Error(`writer/${slot}: duplicate new ids`);
  // A record already there must say what the base displayed: a superset never changes a string.
  for (const row of rows) {
    const had = base.records.find(record => record.context === row.context);
    if (had && had.text.trim() !== row.text) throw new Error(`writer/${slot}: ${row.context} reads ${JSON.stringify(had.text)}, base showed ${JSON.stringify(row.text)}`);
  }
  if (!added.length) return;
  const tail = added.map(row => `\n### ${row.context}\n<!-- ${JSON.stringify({ id: row.id, bindings: row.bindings ?? [] })} -->\n${row.text}\n`).join('');
  const name = base.pin.candidate.replace(/-v\d+\.md$/, '');
  plans.push({ agent: 'writer', slot, name, from: base.pin.candidate, content: base.bytes + tail, added: added.length });
}

/* strings.names: every slot and IA id a Studio gallery, tab or trail names. */
const nameId = context => `st.${BigInt(`0x${createHash('sha256').update(context).digest('hex').slice(0, 16)}`).toString(36).padStart(13, '0').slice(-10)}`;
const names = new Map();
const name = (context, text) => {
  const had = names.get(context);
  if (had !== undefined && had !== text) throw new Error(`names: ${context} is both ${JSON.stringify(had)} and ${JSON.stringify(text)}`);
  names.set(context, text);
};
const existing = new Map(pinnedWriter('strings.names').records.map(record => [record.context, record.text.trim()]));
for (const agent of ['director', 'designer', 'writer', 'publisher', 'producer']) {
  const ia = JSON.parse(readFileSync(join(consumer, 'agents', agent, 'ia.json'), 'utf8'));
  for (const node of ia.nodes) { name(`${agent}.ia.${node.id}`, node.label); for (const child of node.children) name(`${agent}.ia.${child.id}`, child.label); }
  for (const layer of ia.layers ?? []) name(`${agent}.ia.${layer.id}`, layer.label);
  for (const entry of listSlots(consumer, agent)) {
    const context = `${agent}.item.${entry.id}`;
    name(context, existing.get(context) ?? slotIdLabel(entry.id));
    if (!ia.layers) { const l0 = entry.position.l0 ?? agent; if (!names.has(`${agent}.ia.${l0}`)) name(`${agent}.ia.${l0}`, slotIdLabel(l0)); }
  }
}
const nameRows = [...names].map(([context, text]) => ({ context, id: nameId(context), text }));
const usedIds = new Set(pinnedWriter('strings.names').records.map(record => record.id));
for (const row of nameRows) if (!existing.has(row.context) && usedIds.has(row.id)) throw new Error(`names: id collision ${row.id}`);
writerPlan('strings.names', nameRows);

/* Publisher: page titles and tree names become keys; their text goes to strings.page-titles. */
const json = (agent, slot) => {
  const pin = readPin(consumer, agent, slot);
  const candidate = readCandidate(consumer, agent, slot, pin.candidate);
  if (candidate.sha256 !== pin.sha256) throw new Error(`${agent}/${slot}: candidate drifted from its pin`);
  return { pin, doc: JSON.parse(candidate.bytes) };
};
const key = /^studio\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const titleRows = [];
/** A slot's candidates, newest first, parsed. The lift is re-runnable: a key's text is the newest literal one. */
const history = (agent, slot) => listSlots(consumer, agent).find(entry => entry.id === slot).candidates
  .map(name => ({ name, version: Number(/-v(\d+)\./.exec(name)?.[1] ?? 0) })).sort((a, b) => b.version - a.version)
  .map(({ name }) => JSON.parse(readCandidate(consumer, agent, slot, name).bytes));
const literalTitle = slot => history('publisher', slot).map(doc => doc.title).find(title => typeof title === 'string' && !key.test(title));
const literalNames = () => {
  const out = new Map();
  const visit = node => { if (typeof node.name === 'string' && !key.test(node.name) && !out.has(node.id)) out.set(node.id, node.name); (node.children ?? []).forEach(visit); };
  for (const doc of history('publisher', 'publication.studio')) if (doc.meta?.tree) visit(doc.meta.tree);
  return out;
};
for (const entry of listSlots(consumer, 'publisher')) {
  if (!entry.id.startsWith('page.') || !entry.pin) continue;
  const { pin, doc } = json('publisher', entry.id);
  const id = `studio.page.${entry.id.slice('page.'.length)}`;
  if (key.test(doc.title)) {
    if (doc.title !== id) throw new Error(`publisher/${entry.id}: title is ${doc.title}, not ${id}`);
    titleRows.push({ context: id, id, text: literalTitle(entry.id) });
    continue;
  }
  titleRows.push({ context: id, id, text: doc.title });
  plans.push({ agent: 'publisher', slot: entry.id, name: pin.candidate.replace(/-v\d+\.json$/, ''), from: pin.candidate, content: { ...doc, title: id }, change: `title ${JSON.stringify(doc.title)} -> ${id}` });
}
{
  const { pin, doc } = json('publisher', 'publication.studio');
  const changes = [];
  const lifted = literalNames();
  const keep = node => { if (typeof node.name === 'string' && key.test(node.name)) titleRows.push({ context: node.name, id: node.name, text: lifted.get(node.id) }); (node.children ?? []).forEach(keep); };
  keep(doc.meta.tree);
  const walk = node => {
    if (typeof node.name === 'string' && !key.test(node.name)) {
      const id = `studio.nav.${node.id}`;
      titleRows.push({ context: id, id, text: node.name });
      changes.push(`${node.id}: ${JSON.stringify(node.name)} -> ${id}`);
      node = { ...node, name: id };
    }
    return Array.isArray(node.children) ? { ...node, children: node.children.map(walk) } : node;
  };
  const tree = walk(doc.meta.tree);
  if (changes.length) plans.push({ agent: 'publisher', slot: 'publication.studio', name: pin.candidate.replace(/-v\d+\.json$/, ''), from: pin.candidate, content: { ...doc, meta: { ...doc.meta, tree } }, change: changes.join('; ') });
}
writerPlan('strings.page-titles', titleRows);

/* strings.errors: the base server literals a person could see (src/server/index.ts, publication.ts). */
writerPlan('strings.errors', [
  ['studio.error.request-failed', 'Request could not be completed', 'src/server/index.ts'],
  ['studio.error.studio-not-ready', 'Studio child is not ready', 'src/server/index.ts'],
  ['studio.error.studio-unavailable', 'Studio child is unavailable', 'src/server/index.ts'],
  ['studio.error.preview-read-only', 'Publication preview is read-only', 'src/server/publication.ts'],
  ['studio.error.preview-unavailable', 'Publication preview is unavailable', 'src/server/publication.ts'],
  ['studio.error.preview-page-unavailable', 'Publication page is unavailable', 'src/server/publication.ts'],
  ['studio.error.preview-content-type', 'Unsupported preview content type', 'src/server/publication.ts'],
  ['studio.error.preview-not-rendered', 'Publication preview could not be rendered', 'src/server/publication.ts'],
  ['studio.error.preview-asset-unavailable', 'Publication asset is unavailable', 'src/server/publication.ts'],
].map(([id, text, file]) => ({ context: id, id, text, bindings: [file] })));

/* strings.common: the base flow and preview literals. */
const common = pinnedWriter('strings.common').records;
const commonText = id => { const row = common.find(record => record.id === id); if (!row) throw new Error(`strings.common has no ${id}`); return row.text.trim(); };
const flow = 'sections/producer-pipeline-flow/index.tsx', loader = 'lib/pipeline-flow.ts';
const { defaultAriaLabelConfig } = await import('@xyflow/system').catch(() => ({}));
// React Flow's own defaults (@xyflow/system), byte for byte; the live-message template is its template literal.
const rf = defaultAriaLabelConfig ?? {};
const builtIn = id => { const value = rf[id]; if (typeof value !== 'string') throw new Error(`React Flow has no default ${id}`); return value; };
const lanes = common.filter(record => /^studio\.pipeline\.lane\.[a-z-]+$/.test(record.id)).map(record => [record.id.slice('studio.pipeline.lane.'.length), record.text.trim()]);
writerPlan('strings.common', [
  ['studio.preview.frame-title', '{page} page preview', 'src/server/publication.ts'],
  ['studio.pipeline.step.inputs-count', `${commonText('studio.pipeline.step.inputs')} {count}`, loader],
  ['studio.pipeline.step.outputs-count', `${commonText('studio.pipeline.step.outputs')} {count}`, loader],
  ['studio.flow.node-description', builtIn('node.a11yDescription.default'), loader],
  ['studio.flow.node-description-keyboard', builtIn('node.a11yDescription.keyboardDisabled'), loader],
  ['studio.flow.node-moved', 'Moved selected node {direction}. New position, x: {x}, y: {y}', loader],
  ['studio.flow.edge-description', builtIn('edge.a11yDescription.default'), loader],
  ['studio.flow.controls', builtIn('controls.ariaLabel'), loader],
  ['studio.flow.zoom-in', builtIn('controls.zoomIn.ariaLabel'), loader],
  ['studio.flow.zoom-out', builtIn('controls.zoomOut.ariaLabel'), loader],
  ['studio.flow.fit-view', builtIn('controls.fitView.ariaLabel'), loader],
  ['studio.flow.interactive', builtIn('controls.interactive.ariaLabel'), loader],
  ['studio.flow.minimap', builtIn('minimap.ariaLabel'), loader],
  ['studio.flow.handle', builtIn('handle.ariaLabel'), loader],
  ['studio.flow.node-role', 'node', flow],
  ['studio.flow.edge-role', 'edge', flow],
  ['studio.flow.edge-label', 'Edge from {source} to {target}', loader],
  ['studio.flow.attribution', 'React Flow', flow],
  ['studio.flow.attribution-label', 'React Flow attribution', flow],
  ...lanes.map(([lane, text]) => [`studio.team.initials.${lane}`, text.slice(0, 1).toUpperCase(), loader]),
].map(([id, text, file]) => ({ context: id, id, text, bindings: [file] })));

for (const plan of plans) console.log(`${plan.agent}/${plan.slot}: ${plan.from} -> ${plan.name}-v(N+1)${plan.added ? ` (+${plan.added} records)` : ''}${plan.change ? ` [${plan.change}]` : ''}`);
if (!write) process.exit(0);
const cli = join(here, '../dist/cli/index.js');
for (const plan of plans) {
  const written = writeCandidate(consumer, plan.agent, plan.slot, plan.name, plan.content);
  execFileSync(process.execPath, [cli, 'pin', `${plan.agent}/${plan.slot}`, written.name, '--by', 'planner:SEEN-COPY', '--root', repo], { stdio: 'inherit' });
  console.log(`PIN ${plan.agent}/${plan.slot} ${plan.from} -> ${written.name} ${written.sha256}`);
}
