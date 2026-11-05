/** Explicit Studio preview evidence; this module never writes candidates, pins or approvals.
 * Bound candidates must already exist in the Designer slot model (a slot's `candidates/`).
 * Native create still requires guardDesignerFlow's
 * genuine preexisting ownerRequest decision; preview grants no authoring permission.
 */
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
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
async function listFiles(dir, prefix = '') {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const name = prefix + entry.name;
    if (!relativeFile(name)) fail('unsafe native or current-UI file path');
    if (entry.isSymbolicLink()) fail('symbolic link in native payload');
    if (entry.isDirectory()) out.push(...await listFiles(join(dir, entry.name), `${name}/`));
    else if (entry.isFile()) out.push(name);
    else fail('non-regular native payload');
  }
  return out.sort();
}
/** Metadata carries source evidence, never actor identities or host paths. */
function portable(value) {
  if (typeof value === 'string' && (/^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(value))) fail('absolute path in source evidence');
  if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
    if (/^(?:actor|owner|creator|by|pinnedBy|decidedBy)$/i.test(key)) fail('identity field in source evidence');
    portable(child);
  }
  return value;
}

/** The bound candidate file name: the slot model names element versions `<element>-v<N>.json`. */
export const candidateName = row => `${row.element}-v${row.version}.json`;

/**
 * Explicit bindings naming what the Designer slot model pins today, one row per slot:
 * a way to write a bindings file, never an inference inside a Draft build.
 */
export async function pinnedBindings(clossysRoot, slots) {
  const { listSlots, readCandidate } = await import('../dist/records/slots.js');
  const entries = new Map(listSlots(clossysRoot, 'designer').map(entry => [entry.id, entry]));
  return bindings(slots.map(slot => {
    const pin = entries.get(slot)?.pin, match = /^([a-z0-9][a-z0-9-]*)-v([1-9][0-9]*)\.json$/.exec(pin?.candidate ?? '');
    if (!pin || !match) fail(`${slot} has no pinned element candidate`);
    if (readCandidate(clossysRoot, 'designer', slot, pin.candidate).sha256 !== pin.sha256) fail(`${slot} pin hash does not match its candidate`);
    return { slot, element: match[1], version: Number(match[2]), hash: `sha256:${pin.sha256}` };
  }));
}

export async function draftStudioItems(clossysRoot, studioRoot, input, required) {
  const chosen = bindings(input);
  if (JSON.stringify(chosen.map(row => row.slot).sort()) !== JSON.stringify([...required].sort())) fail('bindings must cover every required Studio slot exactly');
  // These are the genuine compiled slot-model APIs. The normal build compiles them first.
  const { listSlots, readSlot } = await import('../dist/records/slots.js');
  const { validateCandidate } = await import('../dist/records/slot-model/index.js');
  const entries = new Map(listSlots(clossysRoot, 'designer').map(entry => [entry.id, entry]));
  const items = [];
  for (const row of chosen) {
    const entry = entries.get(row.slot);
    if (!entry) fail(`${row.slot} is not a Designer slot`);
    const name = candidateName(row);
    if (!entry.candidates.includes(name)) fail(`${row.slot} has no candidate ${name}`);
    const path = join(entry.dir, 'candidates', name), versionRef = relative(clossysRoot, path).split(sep).join('/');
    if (!relativeFile(versionRef)) fail('candidate outside the consumer root');
    const raw = await bytes(path), candidate = parse(raw);
    if (`sha256:${hash(raw)}` !== row.hash) fail('native candidate hash differs from explicit binding');
    if (validateCandidate(readSlot(clossysRoot, 'designer', row.slot).kind, row.slot, name, raw.toString('utf8')).length) fail(`${row.slot} candidate ${name} is invalid`);
    if (candidate.name !== row.element || candidate.meta?.slot !== row.slot) fail('candidate name or slot differs from explicit binding');
    if (!Array.isArray(candidate.files) || !candidate.files.length || candidate.files.some(file => !relativeFile(file?.path) || typeof file.content !== 'string')
      || new Set(candidate.files.map(file => file.path)).size !== candidate.files.length) fail('unsafe or missing native payload list');
    const preview = candidate.meta?.preview;
    if (!preview || typeof preview !== 'object' || Array.isArray(preview)) fail('candidate carries no preview');
    const element = candidate.meta?.element ?? {};
    const files = new Map(candidate.files.map(file => [file.path, Buffer.from(file.content, 'utf8')]));
    const folder = row.slot.startsWith('frames.') ? 'frames' : 'sections';
    const item = { ...row, candidate: name, sha256: row.hash.replace(/^sha256:/, ''), bound: true, files, payload: [...files.keys()], studioDir: join(studioRoot, folder, row.element), module: `../${folder}/${row.element}` };
    await safe(item.studioDir);
    const running = await listFiles(item.studioDir);
    for (const file of running) await bytes(join(item.studioDir, file));
    await checkPayload(item);
    const payload = [], provenance = [];
    for (const [file, content] of files) {
      const ref = `${versionRef}#${file}`;
      payload.push({ ref, sha256: hash(content) });
      if (file.endsWith('.provenance.json')) provenance.push({ ref, sha256: hash(content), evidence: portable(parse(content)) });
    }
    const pin = entry.pin;
    const pinClaim = pin ? { candidate: pin.candidate, hash: `sha256:${pin.sha256}`, at: pin.at } : null;
    item.previewEvidence = { ...previewDescriptor(chosen), versionRef, record: { ref: versionRef, sha256: hash(raw) },
      preview: { ref: `${versionRef}#meta.preview`, sha256: hash(JSON.stringify(preview)) }, payload,
      lineage: portable(candidate.meta?.source ?? null), license: portable(element.license ?? null), provenance, pinClaim,
      matchesPin: !!pin && pin.candidate === name && pinClaim.hash === row.hash,
      pinGranted: false, recordedChecks: portable(element.checks ?? []), remainingNeeds: [
        'Strict reference qualification was not executed or granted by this Draft projection.',
        ...provenance.flatMap(row => row.evidence.remainingNeeds ?? []),
      ] };
    portable(item.previewEvidence);
    items.push(item);
  }
  return items;
}
