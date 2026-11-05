import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

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
