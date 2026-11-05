/**
 * `clossys compile`: deterministic plumbing from decision files to rendered Studio output.
 *
 * Compile resolves packages/producer/decision-inputs.json against the consumer's clossys/ folder,
 * stages exactly those files into a private root and runs the Studio generators (the pinned page
 * projection, assembly bindings, Writer copy and Publisher's installed Next routes) over that
 * staged root. Nothing outside the decision list can reach the output, because nothing outside it
 * is in the root the generators read. No model, agent binary, network or child process is used.
 *
 * Output (in place, or under `out`): generated/ (studio-map.json, studio-map.ts,
 * assembly-bindings.ts, studio-copy.json), app/** installed route files, and compile.lock.json
 * with the sha256 of every input and every output.
 */
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateStudioMap } from './generate-studio-map.mjs';

const producerDir = fileURLToPath(new URL('../', import.meta.url));
export const DECISION_INPUTS = join(producerDir, 'decision-inputs.json');
export const STUDIO_DIR = join(producerDir, 'studio');
export const LOCK_FILE = 'compile.lock.json';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const portable = path => path.split(sep).join('/');
const SEGMENT = /^(?:\*|[a-z0-9][a-z0-9._-]*)$/;

function fail(message) { throw new Error(`compile: ${message}`); }

/** The decision list, validated. */
export async function readDecisionInputs(path = DECISION_INPUTS) {
  let spec;
  try { spec = JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { fail(`cannot read decision-inputs.json (${error.code ?? error.message})`); }
  if (spec?.schema !== 'clossys.decision-inputs/1' || !Array.isArray(spec.inputs) || !spec.inputs.length) fail('decision-inputs.json needs schema clossys.decision-inputs/1 and inputs');
  for (const row of spec.inputs) {
    const pattern = row?.glob ?? row?.pinned;
    if (typeof row?.id !== 'string' || typeof pattern !== 'string' || (row.glob !== undefined) === (row.pinned !== undefined)) fail(`decision input ${row?.id ?? '?'} needs exactly one of glob or pinned`);
    if (!pattern.split('/').every(part => SEGMENT.test(part))) fail(`decision input ${row.id} has an invalid pattern ${pattern}`);
    if (row.pinned !== undefined && !pattern.endsWith('/pin.json')) fail(`decision input ${row.id} pinned pattern must name pin.json files`);
  }
  return spec;
}

/** Files matching a segment glob under `root`, relative and sorted. */
async function match(root, pattern) {
  let rows = [''];
  const parts = pattern.split('/');
  for (const [index, part] of parts.entries()) {
    const last = index === parts.length - 1, next = [];
    for (const row of rows) {
      let entries;
      try { entries = await readdir(join(root, row), { withFileTypes: true }); }
      catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') continue; throw error; }
      for (const entry of entries) {
        if (part !== '*' && entry.name !== part) continue;
        if (part === '*' && entry.name.startsWith('.')) continue;
        if (last ? entry.isFile() : entry.isDirectory()) next.push(row ? `${row}/${entry.name}` : entry.name);
      }
    }
    rows = next;
  }
  return rows.sort();
}

/** Every decision file of a consumer's clossys/ folder, relative to that folder and sorted. */
export async function resolveDecisionInputs(clossysRoot, spec) {
  const files = new Set();
  for (const row of spec.inputs) {
    for (const path of await match(clossysRoot, row.glob ?? row.pinned)) {
      if (row.glob !== undefined) { files.add(path); continue; }
      let pin;
      try { pin = JSON.parse(await readFile(join(clossysRoot, path), 'utf8')); }
      catch { fail(`${path} is not a readable pin`); }
      if (typeof pin?.candidate !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/.test(pin.candidate)) fail(`${path} names no candidate`);
      files.add(`${dirname(path)}/candidates/${pin.candidate}`);
    }
  }
  return [...files].sort();
}

async function walk(dir, prefix = '') {
  const out = [];
  let entries;
  try { entries = await readdir(join(dir, prefix), { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return out; throw error; }
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...await walk(dir, rel));
    else out.push(rel);
  }
  return out;
}

/**
 * Compile one consumer root. `root` holds clossys/; `out` (optional) is a directory that receives
 * generated/, app/ and compile.lock.json; without it the package's own Studio is written in place.
 */
export async function compileStudio({ root, out, decisionInputs = DECISION_INPUTS } = {}) {
  if (typeof root !== 'string') fail('needs a consumer root');
  const clossysRoot = join(resolve(root), 'clossys');
  const spec = await readDecisionInputs(decisionInputs);
  const inputs = await resolveDecisionInputs(clossysRoot, spec);
  if (!inputs.length) fail(`no decision files under ${portable(clossysRoot)}`);
  const target = out === undefined ? STUDIO_DIR : resolve(out);
  const outputDir = join(target, 'generated');
  const appDir = join(target, 'app');
  // Real path: the slot-model readers refuse any symbolic link on the way (macOS /var is one).
  const stage = await realpath(await mkdtemp(join(tmpdir(), 'clossys-compile-')));
  try {
    const lockInputs = [];
    for (const path of inputs) {
      const bytes = await readFile(join(clossysRoot, path));
      const staged = join(stage, 'clossys', path);
      await mkdir(dirname(staged), { recursive: true });
      await writeFile(staged, bytes);
      lockInputs.push({ path: `clossys/${path}`, sha256: sha256(bytes) });
    }
    await mkdir(appDir, { recursive: true });
    const projection = await generateStudioMap({ clossysRoot: join(stage, 'clossys'), outputDir, appDir, installOut: join(stage, '.install') });
    const routeFiles = projection.routes.flatMap(route => [route.entry.file, ...(route.leaf ? [route.leaf.entry.file] : [])])
      .map(file => file.replace(/^studio\//, ''));
    const outputs = [...(await walk(outputDir)).map(rel => `generated/${rel}`), ...routeFiles].sort();
    const lockOutputs = [];
    for (const rel of outputs) lockOutputs.push({ path: rel, sha256: sha256(await readFile(join(target, rel))) });
    const lock = { schema: 'clossys.compile-lock/1', decisionInputs: spec.inputs.map(row => row.id), inputs: lockInputs, outputs: lockOutputs };
    await writeFile(join(target, LOCK_FILE), `${JSON.stringify(lock, null, 2)}\n`);
    return { target, inputs: lockInputs.length, outputs: lockOutputs.length, lock: join(target, LOCK_FILE) };
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}
