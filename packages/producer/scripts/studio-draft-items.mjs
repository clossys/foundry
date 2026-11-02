/** Explicit Studio preview evidence; this module never writes records, selections or approvals.
 * Versions must already exist. Native create still requires guardDesignerFlow's
 * genuine preexisting ownerRequest decision; preview grants no authoring permission.
 */
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { checkPayload } from './studio-payload.mjs';

export const PREVIEW_BINDINGS_ENV = 'FOUNDRY_STUDIO_PREVIEW_BINDINGS';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw new Error(`Studio Draft preview: ${message}`); };
const segment = value => typeof value === 'string' && /^[a-z0-9][a-z0-9.-]*$/.test(value) && !value.includes('..');
const relativeFile = value => typeof value === 'string' && !!value && !isAbsolute(value) && !/[\\:\0]/.test(value) && value.split('/').every(part => part && part !== '.' && part !== '..');

async function safe(path) {
  for (let cursor = resolve(path);;) {
    try { if ((await lstat(cursor)).isSymbolicLink()) fail('symbolic link in input path'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const parent = dirname(cursor);
    if (parent === cursor) return;
    cursor = parent;
  }
}
async function bytes(path) {
  await safe(path);
  if (!(await lstat(path)).isFile()) fail('expected a regular input file');
  return readFile(path);
}
function parse(raw) {
  if (!raw.equals(Buffer.from(raw.toString('utf8')))) fail('input is not valid UTF-8');
  return JSON.parse(raw.toString('utf8'));
}
function bindings(items) {
  if (!Array.isArray(items) || !items.length) fail('explicit native bindings are required');
  const seen = new Set();
  return items.map(row => {
    if (!row || Object.keys(row).sort().join(',') !== 'element,hash,slot,version' || !segment(row.slot) || !/^(frames|sections)\./.test(row.slot)
      || !segment(row.element) || !Number.isSafeInteger(row.version) || row.version < 1 || !/^sha256:[a-f0-9]{64}$/.test(row.hash ?? '') || seen.has(row.slot)) fail('invalid or duplicate native binding');
    seen.add(row.slot);
    return { slot: row.slot, element: row.element, version: row.version, hash: row.hash };
  }).sort((a, b) => a.slot < b.slot ? -1 : a.slot > b.slot ? 1 : 0);
}
export function previewDescriptor(items) {
  return { target: 'preview', status: 'DRAFT', approved: false, referenceQualified: false, releaseQualified: false, bindingDigest: hash(JSON.stringify(bindings(items))) };
}
export function assertPreviewContext(actual, expected) {
  if (actual !== undefined && expected === undefined) fail('Draft output requires an explicit preview context');
  if (expected !== undefined && JSON.stringify(actual) !== JSON.stringify(expected)) fail('binding digest differs from the built projection');
}
export async function previewOptions(path) {
  if (typeof path !== 'string' || !path.trim()) fail('a binding file path is required');
  const previewItems = bindings(parse(await bytes(resolve(path))));
  return { target: 'preview', previewItems };
}
export async function previewOptionsFromEnvironment() {
  const path = process.env[PREVIEW_BINDINGS_ENV];
  return path === undefined ? {} : previewOptions(path);
}
/** Remove only this public option; a default invocation explicitly clears its child mode. */
export async function previewArguments(input) {
  const args = [...input], index = args.indexOf('--preview-bindings');
  let path;
  if (index !== -1) {
    path = args[index + 1];
    if (!path || path.startsWith('--') || args.lastIndexOf('--preview-bindings') !== index) fail('--preview-bindings requires one file');
    args.splice(index, 2);
  }
  const options = path === undefined ? {} : await previewOptions(path);
  const env = { ...process.env };
  delete env[PREVIEW_BINDINGS_ENV];
  if (path !== undefined) env[PREVIEW_BINDINGS_ENV] = resolve(path);
  return { args, env, options, bindingsPath: path === undefined ? undefined : resolve(path), descriptor: path === undefined ? undefined : previewDescriptor(options.previewItems) };
}
async function files(dir, prefix = '') {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const name = prefix + entry.name;
    if (!relativeFile(name)) fail('unsafe native or current-UI file path');
    if (entry.isSymbolicLink()) fail('symbolic link in native payload');
    if (entry.isDirectory()) out.push(...await files(join(dir, entry.name), `${name}/`));
    else if (entry.isFile()) out.push(name);
    else fail('non-regular native payload');
  }
  return out.sort();
}
/** Metadata carries source evidence, never actor identities or host paths. */
function portable(value) {
  if (typeof value === 'string' && (/^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(value))) fail('absolute path in source evidence');
  if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
    if (/^(?:actor|owner|creator|by|pinnedBy)$/i.test(key)) fail('identity field in source evidence');
    portable(child);
  }
  return value;
}

export async function draftStudioItems(clossysRoot, studioRoot, input, required) {
  const chosen = bindings(input);
  if (JSON.stringify(chosen.map(row => row.slot).sort()) !== JSON.stringify([...required].sort())) fail('bindings must cover every required Studio slot exactly');
  // These are the genuine compiled native record APIs. The normal build compiles them first.
  const { readElementVersion, verifyElementVersion } = await import('../dist/records/library.js');
  const { loadSelection } = await import('../dist/records/validate.js');
  const selectionPath = join(clossysRoot, 'selection.json');
  let selection = { pins: {} };
  try { parse(await bytes(selectionPath)); selection = loadSelection(selectionPath); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const items = [];
  for (const row of chosen) {
    const versionRef = `library/${row.slot}/${row.element}/v${row.version}`, versionDir = join(clossysRoot, versionRef);
    const rawRecord = await bytes(join(versionDir, 'element.json')), preliminary = parse(rawRecord);
    if (!Array.isArray(preliminary.payload) || !preliminary.payload.length || preliminary.payload.some(path => !relativeFile(path))
      || new Set(preliminary.payload).size !== preliminary.payload.length) fail('unsafe or missing native payload list');
    parse(await bytes(join(versionDir, 'preview.json')));
    if (JSON.stringify(await files(versionDir)) !== JSON.stringify([...preliminary.payload, 'element.json', 'preview.json'].sort())) fail('native version has unrecorded files');
    for (const path of preliminary.payload) await bytes(join(versionDir, path));
    const { element } = readElementVersion(join(clossysRoot, 'library'), row.slot, row.element, row.version);
    if (verifyElementVersion(join(clossysRoot, 'library'), row.slot, row.element, row.version).length || element.hash !== row.hash) fail('native payload hash differs from record or explicit binding');
    const folder = row.slot.startsWith('frames.') ? 'frames' : 'sections';
    const item = { ...row, versionDir, payload: element.payload, studioDir: join(studioRoot, folder, row.element), module: `../${folder}/${row.element}` };
    await safe(item.studioDir);
    const running = await files(item.studioDir);
    for (const path of running) await bytes(join(item.studioDir, path));
    await checkPayload(item);
    const payload = [], provenance = [];
    for (const path of element.payload) {
      const raw = await bytes(join(versionDir, path)), ref = `${versionRef}/${path}`;
      payload.push({ ref, sha256: hash(raw) });
      if (path.endsWith('.provenance.json')) provenance.push({ ref, sha256: hash(raw), evidence: portable(parse(raw)) });
    }
    const claim = selection.pins[row.slot] ?? null;
    const selectionClaim = claim ? { element: claim.element, version: claim.version, hash: claim.hash, event: claim.event } : null;
    item.previewEvidence = { ...previewDescriptor(chosen), versionRef, record: { ref: `${versionRef}/element.json`, sha256: hash(rawRecord) },
      preview: { ref: `${versionRef}/preview.json`, sha256: hash(await bytes(join(versionDir, 'preview.json'))) }, payload,
      lineage: portable(element.lineage), license: portable(element.license), provenance, selectionClaim,
      matchesBinding: !!claim && claim.element === row.element && claim.version === row.version && claim.hash === row.hash,
      selectionGranted: false, recordedChecks: portable(element.checks), remainingNeeds: [
        'Strict reference qualification was not executed or granted by this Draft projection.',
        ...provenance.flatMap(row => row.evidence.remainingNeeds ?? []),
      ] };
    portable(item.previewEvidence);
    items.push(item);
  }
  return items;
}
