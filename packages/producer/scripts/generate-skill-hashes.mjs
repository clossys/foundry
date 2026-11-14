#!/usr/bin/env node
/**
 * generate-skill-hashes: `src/constitution/skill-hashes.json`, the sha256 of every byte state an
 * action skill (`packages/<pkg>/actions/<step>/skill.md`) has had: its current file and every
 * version in git history. Constitution R14.2 accepts a ledger event whose `skill.sha256` is the
 * current file's or is listed here, so an event recorded under an older skill stays traceable.
 *
 * Append-only: a sha once listed is never dropped (a skill's history does not shrink when a branch
 * or a file goes away). Output is sorted by path, then sha, so the file is stable.
 *
 *   node scripts/generate-skill-hashes.mjs           write the file (adds what is missing)
 *   node scripts/generate-skill-hashes.mjs --check   exit 1 when the file is missing a sha or is not canonical
 *   --repo <dir>  the git work tree to read (default: this repository); --out <file> the file to write
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SKILL_HASHES_SCHEMA = 'clossys.skill-hashes/1';
const SKILL_FILE = /^packages\/[a-z][a-z0-9-]*\/actions\/[a-z0-9][a-z0-9.-]*\/skill\.md$/;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** The current action skills of the work tree at `repo`: path -> sha256. */
export function currentSkills(repo) {
  const found = new Map();
  const packages = join(repo, 'packages');
  if (!existsSync(packages)) return found;
  for (const pkg of readdirSync(packages, { withFileTypes: true })) {
    if (!pkg.isDirectory()) continue;
    const actions = join(packages, pkg.name, 'actions');
    if (!existsSync(actions)) continue;
    for (const step of readdirSync(actions, { withFileTypes: true })) {
      const path = `packages/${pkg.name}/actions/${step.name}/skill.md`;
      if (!step.isDirectory() || !SKILL_FILE.test(path) || !existsSync(join(repo, path))) continue;
      found.set(path, sha256(readFileSync(join(repo, path))));
    }
  }
  return found;
}

/**
 * Every byte state each action skill had in the history of HEAD: path -> sha256s. Reads the blob
 * ids from `git log --raw` (every commit on every parent line, so side-branch versions are seen)
 * and hashes each blob's bytes once.
 */
export function historySkills(repo) {
  const found = new Map();
  let log;
  try {
    log = execFileSync('git', ['-C', repo, 'log', '--format=%x00', '--raw', '--no-abbrev', '--no-renames', 'HEAD', '--', 'packages/*/actions/*/skill.md'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  } catch { return found; }
  const blobs = new Map(); // blob -> paths
  for (const line of log.split('\n')) {
    const match = /^:\d+ \d+ [0-9a-f]+ ([0-9a-f]+) [A-Z]\d*\t(.+)$/.exec(line);
    if (!match || /^0+$/.test(match[1]) || !SKILL_FILE.test(match[2])) continue;
    if (!blobs.has(match[1])) blobs.set(match[1], new Set());
    blobs.get(match[1]).add(match[2]);
  }
  for (const [blob, paths] of blobs) {
    const bytes = execFileSync('git', ['-C', repo, 'cat-file', 'blob', blob], { maxBuffer: 64 * 1024 * 1024 });
    const digest = sha256(bytes);
    for (const path of paths) {
      if (!found.has(path)) found.set(path, new Set());
      found.get(path).add(digest);
    }
  }
  return found;
}

/** The skill-hashes document: `existing` plus the current and historical shas, sorted. */
export function skillHashes(repo, existing) {
  const merged = new Map();
  const add = (path, digest) => { if (!merged.has(path)) merged.set(path, new Set()); merged.get(path).add(digest); };
  for (const [path, list] of Object.entries(existing?.skills ?? {})) for (const digest of list) add(path, digest);
  for (const [path, digests] of historySkills(repo)) for (const digest of digests) add(path, digest);
  for (const [path, digest] of currentSkills(repo)) add(path, digest);
  const skills = {};
  for (const path of [...merged.keys()].sort(cmp)) skills[path] = [...merged.get(path)].sort(cmp);
  return { schema: SKILL_HASHES_SCHEMA, skills };
}

const json = value => `${JSON.stringify(value, null, 2)}\n`;

function main(argv) {
  const at = flag => { const i = argv.indexOf(flag); return i < 0 ? undefined : argv[i + 1]; };
  const here = fileURLToPath(new URL('..', import.meta.url));
  const repo = resolve(at('--repo') ?? join(here, '..', '..'));
  const out = resolve(at('--out') ?? join(here, 'src', 'constitution', 'skill-hashes.json'));
  const text = existsSync(out) ? readFileSync(out, 'utf8') : undefined;
  let existing;
  if (text !== undefined) {
    try { existing = JSON.parse(text); } catch { console.error(`generate-skill-hashes: ${out} is not JSON`); return 1; }
    if (existing?.schema !== SKILL_HASHES_SCHEMA) { console.error(`generate-skill-hashes: ${out} is not ${SKILL_HASHES_SCHEMA}`); return 1; }
  }
  const next = json(skillHashes(repo, existing));
  const count = Object.values(JSON.parse(next).skills).reduce((sum, list) => sum + list.length, 0);
  if (argv.includes('--check')) {
    if (text === next) { console.log(`generate-skill-hashes: ok (${count} skill states)`); return 0; }
    console.error(`generate-skill-hashes: ${out} is stale or not canonical; run node packages/producer/scripts/generate-skill-hashes.mjs`);
    return 1;
  }
  if (text !== next) writeFileSync(out, next);
  console.log(`generate-skill-hashes: ${text === next ? 'current' : 'wrote'} ${out} (${count} skill states)`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
