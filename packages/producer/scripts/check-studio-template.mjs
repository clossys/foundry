#!/usr/bin/env node
/**
 * check-studio-template: the class checks behind the Studio page template, a sibling of
 * check-assemble-only. Each rule covers a whole class, for every agent and layer, not one page:
 *
 *   specimen  every slot card draws its pin through the one specimen path the detail page uses
 *             (`slotSpecimen`), and the card always renders it: a frame, the record, or the
 *             explicit empty badge, never nothing.
 *   label     every slot label shown comes from one resolver, the content-map projection: each
 *             leaf carries a title, the Writer's name where the Writer has one, and the cards and
 *             the detail header read it from the map, never from the id.
 *   group     every slot-groups page record heads its route with its own description, a Writer
 *             key the Studio copy resolves, not one shared by the whole agent.
 *   avatar    every frame avatar is the stock shadcn AvatarImage on a `/avatars/*` path, which
 *             Producer serves as the pinned `assets.image` placeholder; initials are the fallback.
 *   inset     the frame body owns the content inset; no section root adds its own inline padding.
 *
 * Usage: node packages/producer/scripts/check-studio-template.mjs [--rev <git rev>]
 * With --rev the files are read from that commit (to prove the check fails before a fix).
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const revAt = process.argv.indexOf('--rev');
const rev = revAt > 0 ? process.argv[revAt + 1] : undefined;

const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
const read = path => {
  if (rev) { try { return git('show', `${rev}:${path}`); } catch { return undefined; } }
  const file = join(repo, path);
  return existsSync(file) ? readFileSync(file, 'utf8') : undefined;
};
const list = dir => rev
  ? [...new Set(git('ls-tree', '--name-only', `${rev}:${dir}`).split('\n').filter(Boolean))]
  : (existsSync(join(repo, dir)) ? readdirSync(join(repo, dir)) : []);

const STUDIO = 'packages/producer/studio';
const findings = [];
const fail = (rule, where, message) => findings.push({ rule, where, message });
const notes = [];

/* specimen */
{
  const section = read(`${STUDIO}/sections/studio-slot-groups/index.tsx`) ?? '';
  if (!/import\s*\{[^}]*\bSpecimenContent\b[^}]*\}\s*from\s*'\.\.\/studio-specimen'/.test(section)) fail('specimen', 'sections/studio-slot-groups', 'the slot card does not use the specimen section renderer (SpecimenContent)');
  if (!/\bspecimen:\s*SpecimenInput;/.test(section)) fail('specimen', 'sections/studio-slot-groups', 'SlotCard.specimen is not a required SpecimenInput, so a card can render no specimen and no empty state');
  if (/\{card\.specimen\s*\?/.test(section) || !/<SpecimenContent specimen=\{card\.specimen\}\s*\/>/.test(section)) fail('specimen', 'sections/studio-slot-groups', 'the card does not always render its specimen (a frame, the record or the explicit empty badge)');
  const lib = read(`${STUDIO}/lib/slot-detail.ts`) ?? '';
  const body = name => { const at = lib.indexOf(`export function ${name}(`); return at < 0 ? '' : lib.slice(at, lib.indexOf('\n}\n', at)); };
  if (!lib.includes('export function slotSpecimen(')) fail('specimen', 'lib/slot-detail', 'there is no one specimen path (slotSpecimen) shared by the detail page and the cards');
  else {
    if (!/slotSpecimen\(/.test(body('slotDetailInputs'))) fail('specimen', 'lib/slot-detail', 'the detail page does not draw through slotSpecimen');
    if (!/slotSpecimen\(/.test(body('slotCardSpecimen'))) fail('specimen', 'lib/slot-detail', 'the cards do not draw through slotSpecimen');
  }
  const page = read(`${STUDIO}/components/StudioPage.tsx`) ?? '';
  if (!/specimen:\s*slotCardSpecimen\(/.test(page)) fail('specimen', 'components/StudioPage', 'the slot-groups loader does not give every card its slotCardSpecimen');
}

/* label */
{
  const studio = JSON.parse(read(`${STUDIO}/generated/studio-map.json`) ?? '{}');
  const pages = new Map((studio.pages ?? []).map(page => [page.id, page]));
  const names = writerNames();
  let named = 0, fallback = 0;
  for (const leaf of studio.leaves ?? []) {
    const agent = pages.get(leaf.page)?.leaf?.data?.agent;
    const where = `leaf ${leaf.path}`;
    if (typeof leaf.title !== 'string' || !leaf.title.trim()) { fail('label', where, 'the content-map leaf has no title, so the label falls back to the id'); continue; }
    if (leaf.title === leaf.slug) fail('label', where, 'the leaf title is the raw slot id');
    const writer = agent ? names.get(`${agent}.item.${leaf.slug}`) : undefined;
    if (writer !== undefined && leaf.title !== writer) fail('label', where, `the leaf title "${leaf.title}" is not the Writer's name "${writer}"`);
    if (writer !== undefined) named++; else fallback++;
  }
  notes.push(`label: ${named} leaves carry the Writer's name; ${fallback} have no Writer name yet and show the id without its L0 prefix`);
  const route = read(`${STUDIO}/lib/studio-route-map.ts`) ?? '';
  if (!route.includes('export function studioLeafTitle(')) fail('label', 'lib/studio-route-map', 'the content-map projection has no slot label resolver (studioLeafTitle)');
  const page = read(`${STUDIO}/components/StudioPage.tsx`) ?? '';
  if (!/name\s*=\s*studioLeafTitle\(/.test(page)) fail('label', 'components/StudioPage', 'slot card titles do not come from the content-map label resolver');
  if (!/label:\s*studioLeafTitle\b/.test(page)) fail('label', 'components/StudioPage', 'the detail page header does not take its label from the content-map label resolver');
  const lib = read(`${STUDIO}/lib/slot-detail.ts`) ?? '';
  if (!/header:\s*\{\s*name:\s*links\.label\(/.test(lib)) fail('label', 'lib/slot-detail', 'the detail header names the slot by its id, not the resolved label');
  for (const dir of ['lib', 'components', 'sections', 'frames']) {
    for (const file of walk(`${STUDIO}/${dir}`)) {
      if (/\.test\./.test(file)) continue;
      if (/\bhumani[sz]e\(/.test(read(file) ?? '')) fail('label', file, 'a display label is humanised from an id outside the content-map projection');
    }
  }
}

/* group */
{
  const studio = JSON.parse(read(`${STUDIO}/generated/studio-map.json`) ?? '{}');
  const copy = JSON.parse(read(`${STUDIO}/generated/studio-copy.json`) ?? '{}');
  const keys = new Set(copyKeys(copy));
  const seen = new Map();
  // A tab's header is its record's, so the description is owned per record (an entry under a group).
  const entries = new Map((Array.isArray(studio.map) ? studio.map : studio.map?.entries ?? []).map(entry => [entry.id, entry]));
  for (const page of studio.pages ?? []) {
    if (page.data?.loader !== 'slot-groups') continue;
    if (entries.get(entries.get(page.id)?.parentId)?.kind !== 'group') continue;
    const key = page.data.description;
    if (typeof key !== 'string') { fail('group', page.path, 'the slot-groups record names no description of its own'); continue; }
    if (!keys.has(key)) fail('group', page.path, `the description key ${key} is not in the Studio copy (Writer)`);
    seen.set(key, [...(seen.get(key) ?? []), page.path]);
  }
  for (const [key, paths] of seen) if (paths.length > 1) fail('group', paths.join(', '), `${paths.length} routes share one description (${key}): the header shows the agent's, not the record's`);
  const page = read(`${STUDIO}/components/StudioPage.tsx`) ?? '';
  if (!/description:\s*[^,}]*\bdata\.description\b/.test(page) && !/\.data\.description\b/.test(page)) fail('group', 'components/StudioPage', 'the page header does not read the record\'s own description');
}

/* avatar */
{
  for (const frame of list(`${STUDIO}/frames`)) {
    const files = walk(`${STUDIO}/frames/${frame}`).filter(file => /\.tsx$/.test(file) && !/\.test\./.test(file));
    const sources = files.map(file => [file, read(file) ?? '']);
    for (const [file, source] of sources) {
      if (!/<Avatar[\s>]/.test(source)) continue;
      if (!/<AvatarImage\s[^>]*src=/.test(source)) fail('avatar', file, 'the frame avatar has no stock AvatarImage, so only the initials show');
      if (!/<AvatarFallback/.test(source)) fail('avatar', file, 'the frame avatar has no initials fallback');
    }
    if (!sources.some(([, source]) => /<Avatar[\s>]/.test(source))) continue;
    const literals = sources.flatMap(([, source]) => [...source.matchAll(/["'](\/avatars\/[^"']+)["']/g)].map(match => match[1]));
    if (!literals.length) fail('avatar', `frames/${frame}`, 'the frame avatar image does not resolve through /avatars (the pinned assets.image placeholder)');
    for (const path of literals) if (!/^\/avatars\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.(?:jpe?g|png|webp|avif|gif|svg)$/.test(path)) fail('avatar', `frames/${frame}`, `${path} is not a path Producer serves as the placeholder`);
  }
  if (!/DEFAULT_AVATAR_PATH/.test(read('packages/producer/src/server/default-avatar.ts') ?? '')) fail('avatar', 'src/server/default-avatar', 'Producer does not serve /avatars as the placeholder');
}

/* inset */
{
  const frames = read('packages/designer/ui/src/foundry/studio-frames.tsx') ?? '';
  if (!/id="studio-main"[^>]*className="[^"]*\bp-\d/.test(frames)) fail('inset', 'designer-ui/foundry/studio-frames', 'the frame body does not own the content inset');
  for (const section of list(`${STUDIO}/sections`)) {
    const file = `${STUDIO}/sections/${section}/index.tsx`;
    const source = read(file);
    if (!source) continue;
    // A section root is the element spreading the generated provenance markers.
    for (const match of source.matchAll(/<\w+[^>]*\{\.\.\.provenance\}[^>]*>/g)) {
      const className = /className="([^"]*)"/.exec(match[0])?.[1] ?? '';
      const padding = className.split(/\s+/).filter(token => /^(?:[a-z0-9:@/-]+:)?-?(?:p|px|ps|pe|pl|pr|mx|ms|me|ml|mr)-(?!0(?:!|$))\S+$/.test(token));
      if (padding.length) fail('inset', file, `the section root adds its own inline spacing (${padding.join(' ')}); the frame body owns the inset`);
    }
  }
}

function walk(dir) {
  const out = [];
  for (const name of list(dir)) {
    const path = `${dir}/${name}`;
    if (rev) {
      const type = git('cat-file', '-t', `${rev}:${path}`).trim();
      if (type === 'tree') out.push(...walk(path)); else out.push(path);
    } else if (existsSync(join(repo, path)) && readdirSync(join(repo, dir), { withFileTypes: true }).find(entry => entry.name === name)?.isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

function copyKeys(copy) {
  const keys = [];
  const visit = value => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') { if (typeof value.id === 'string') keys.push(value.id); Object.values(value).forEach(visit); }
  };
  visit(copy);
  return keys;
}

/** The pinned Writer `strings.names`, keyed by record context; empty when the pin is missing or drifted. */
function writerNames() {
  const slot = 'clossys/agents/writer/strings.names';
  const pin = JSON.parse(read(`${slot}/pin.json`) ?? 'null');
  const bytes = pin && read(`${slot}/candidates/${pin.candidate}`);
  const names = new Map();
  if (!bytes || createHash('sha256').update(bytes).digest('hex') !== pin.sha256) return names;
  const locale = /^locales:\s*\["([^"]+)"/m.exec(bytes)?.[1];
  const section = bytes.split(/^## /m).find(part => part.startsWith(`${locale}\n`)) ?? '';
  for (const record of section.split(/^### /m).slice(1)) {
    const [context, ...lines] = record.split('\n');
    const text = lines.filter(line => !/^<!-- .* -->$/.test(line)).join('\n').trim();
    if (text) names.set(context.trim(), text);
  }
  return names;
}

const rules = ['specimen', 'label', 'group', 'avatar', 'inset'];
for (const rule of rules) {
  const rows = findings.filter(row => row.rule === rule);
  console.log(`${rows.length ? 'FAIL' : 'ok  '} ${rule}${rows.length ? ` (${rows.length})` : ''}`);
  for (const row of rows.slice(0, 8)) console.log(`     ${row.where}: ${row.message}`);
  if (rows.length > 8) console.log(`     ... ${rows.length - 8} more`);
}
for (const note of notes) console.log(`note ${note}`);
console.log(findings.length ? `check-studio-template: ${findings.length} findings${rev ? ` at ${rev}` : ''}` : `check-studio-template: every rule holds${rev ? ` at ${rev}` : ''}`);
process.exit(findings.length ? 1 : 0);
