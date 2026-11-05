import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Files a candidate carries beside the code Studio runs: provenance, not payload. */
const RECORD_ONLY = new Set(['registry-item.json', 'LICENCE.md']);
const TEST_FILE = /\.(?:test|spec)\.(?:[jt]sx?|[cm]js)$/;

function fail(message) { throw new Error(`Studio assembly: ${message}`); }

/** The Studio folder must hold the pinned payload's code; unlisted colocated tests are development files. */
export async function checkPayload(item) {
  const code = item.payload.filter(file => !RECORD_ONLY.has(file)).sort();
  const present = existsSync(item.studioDir) ? (await readdir(item.studioDir, { withFileTypes: true }))
    .filter(entry => !entry.name.startsWith('.'))
    .filter(entry => !(entry.isFile() && !item.payload.includes(entry.name) && TEST_FILE.test(entry.name)))
    .map(entry => entry.name).sort() : [];
  if (JSON.stringify(code) !== JSON.stringify(present)) fail(`${item.slot}: studio folder files [${present}] differ from the pinned payload [${code}]`);
  for (const file of code) {
    // Pinned and Draft-bound candidates carry their files inline; a version directory is the legacy shape.
    const [stored, running] = await Promise.all([item.files ? item.files.get(file) : readFile(join(item.versionDir, file)), readFile(join(item.studioDir, file))]);
    if (!stored.equals(running)) fail(`${item.slot}: ${file} differs from ${item.element} v${item.version} ${item.files ? (item.bound ? 'as bound' : 'as pinned') : 'in the library'}`);
  }
}

/**
 * Install the pinned payload into its Studio folder: the candidate's code files byte-for-byte, and no
 * file a previous pin left behind (colocated tests stay). A re-pin then reaches every consuming route
 * through the build alone; nobody copies candidate code by hand. Only inline (pinned) payloads install.
 */
export async function installPayload(item) {
  if (!item.files) fail(`${item.slot}: only an inline pinned payload installs`);
  const code = item.payload.filter(file => !RECORD_ONLY.has(file));
  if (code.some(file => file !== file.split('/').pop() || file.startsWith('.'))) fail(`${item.slot}: payload files must be flat names in the element folder`);
  await mkdir(item.studioDir, { recursive: true });
  for (const entry of await readdir(item.studioDir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || code.includes(entry.name) || (entry.isFile() && TEST_FILE.test(entry.name))) continue;
    if (!entry.isFile()) fail(`${item.slot}: ${entry.name} in the Studio folder is not a payload file`);
    await rm(join(item.studioDir, entry.name));
  }
  const written = [];
  for (const file of code) {
    const path = join(item.studioDir, file);
    let running;
    try { running = await readFile(path); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (running && running.equals(item.files.get(file))) continue;
    await writeFile(path, item.files.get(file));
    written.push(file);
  }
  return written;
}

/**
 * A component-layer pin (its slot contract names `install`) lands in the consumer's component layer,
 * not a Studio folder: the shadcn `components.json` alias it names, resolved through the layer's
 * tsconfig `paths`, exactly where `shadcn add` would write it. One code file per pin.
 */
export function componentTarget(layerDir, install, slot) {
  const read = file => { try { return JSON.parse(readFileSync(join(layerDir, file), 'utf8')); } catch (error) { fail(`${slot}: ${install.layer} has no readable ${file} (${error.message})`); } };
  const alias = read('components.json').aliases?.[install.alias];
  if (typeof alias !== 'string') fail(`${slot}: ${install.layer} components.json has no "${install.alias}" alias`);
  const paths = read('tsconfig.json').compilerOptions?.paths ?? {};
  const pattern = Object.keys(paths).find(key => key.endsWith('/*') && alias.startsWith(key.slice(0, -1)));
  const into = pattern && paths[pattern]?.[0];
  if (!into?.endsWith('/*')) fail(`${slot}: alias ${alias} does not resolve through ${install.layer} tsconfig paths`);
  if (typeof install.file !== 'string' || install.file !== install.file.split('/').pop() || install.file.startsWith('.')) fail(`${slot}: install.file must be one flat file name`);
  return join(layerDir, into.slice(0, -1), alias.slice(pattern.length - 1), install.file);
}

/** The component pin's one code file (LICENCE.md is a record), checked against its install contract. */
function componentBytes(item) {
  const code = item.payload.filter(file => !RECORD_ONLY.has(file));
  if (code.length !== 1 || code[0] !== item.install.file) fail(`${item.slot}: a component-layer pin carries exactly its install file ${item.install.file}, not [${code}]`);
  return item.files.get(code[0]);
}

/** Install the pinned component file byte-for-byte into its layer; returns whether it changed. */
export async function installComponent(item) {
  const bytes = componentBytes(item);
  let running;
  try { running = await readFile(item.target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (running?.equals(bytes)) return false;
  await mkdir(dirname(item.target), { recursive: true });
  await writeFile(item.target, bytes);
  return true;
}

/** The installed component file must equal the pinned candidate's bytes. */
export async function checkComponent(item) {
  const bytes = componentBytes(item);
  let running;
  try { running = await readFile(item.target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!running) fail(`${item.slot}: ${item.install.file} is not installed in ${item.install.layer}`);
  if (!running.equals(bytes)) fail(`${item.slot}: installed ${item.install.file} differs from ${item.element} v${item.version} as pinned`);
}
