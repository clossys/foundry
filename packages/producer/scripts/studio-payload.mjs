import { readFile, readdir } from 'node:fs/promises';
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
