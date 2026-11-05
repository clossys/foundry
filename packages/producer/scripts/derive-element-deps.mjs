#!/usr/bin/env node
/**
 * derive-element-deps — a pinned Designer section's `meta.element.deps.elements` is generated
 * from what its code actually composes, never typed by hand.
 *
 * A section that places another pinned Studio section (`import { X } from '../<element>'`)
 * must declare that section in its pinned candidate's `meta.element.deps.elements`
 * ({ slot, element, version, hash }: the dependency's pinned slot, element id, candidate version
 * and `meta.source.hash`), so a re-pin of the dependency marks the dependent stale and the
 * ds-only rule admits the composition (R-DS-ONLY).
 *
 * Candidates are immutable, so a missing declaration is fixed by the next candidate version:
 * the pinned item byte-for-byte with only `deps.elements` set to the computed list (a strict
 * superset when the pinned list was empty or a prefix of it), written through Producer's
 * `writeCandidate`. Nothing is pinned here; `clossys pin` decides.
 *
 *   node scripts/derive-element-deps.mjs [--root <repo>]            report; exit 1 when a pinned section composes an undeclared section
 *   node scripts/derive-element-deps.mjs --write [--root <repo>]    write the next candidate for each such section and print its name
 *   --json                                                            machine-readable rows
 */
import { join, resolve } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { importsOf, pinned, slotIds } from './check-generated-derived.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoDefault = resolve(here, '..', '..', '..');
const CANDIDATE = /^([a-z0-9][a-z0-9-]*)-v([1-9][0-9]*)\.json$/;
const CODE = /\.(?:tsx?|jsx?|mjs|cjs)$/;

/** The deps.elements a pinned section's code requires, from its `../<element>` imports of pinned sections. */
export function computedElementDeps(clossysRoot, slot) {
  const entry = pinned(clossysRoot, 'designer', slot);
  if (!entry?.item) return undefined;
  const sections = new Map();
  for (const id of slotIds(clossysRoot, 'designer')) {
    if (!id.startsWith('sections.') || id === slot) continue;
    const target = pinned(clossysRoot, 'designer', id);
    const match = target && CANDIDATE.exec(target.candidate);
    if (match && target.item?.name === match[1]) sections.set(match[1], { slot: id, element: match[1], version: Number(match[2]), hash: target.item.meta?.source?.hash });
  }
  const deps = new Map();
  for (const file of entry.item.files ?? []) {
    if (typeof file?.content !== 'string' || !CODE.test(String(file.path))) continue;
    for (const { spec } of importsOf(file.content)) {
      const name = /^\.\.\/([a-z0-9-]+)$/.exec(spec)?.[1];
      const dep = name && sections.get(name);
      if (dep && typeof dep.hash === 'string') deps.set(dep.slot, dep);
    }
  }
  return { entry, deps: [...deps.values()].sort((a, b) => a.slot.localeCompare(b.slot)) };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Every pinned section whose declared deps.elements differ from its computed ones. */
export function elementDepFindings(clossysRoot) {
  const rows = [];
  for (const slot of slotIds(clossysRoot, 'designer').filter(id => id.startsWith('sections.'))) {
    const computed = computedElementDeps(clossysRoot, slot);
    if (!computed) continue;
    const declared = computed.entry.item.meta?.element?.deps?.elements ?? [];
    if (!same(declared, computed.deps)) rows.push({ slot, candidate: computed.entry.candidate, declared, computed: computed.deps });
  }
  return rows;
}

/** The next candidate: the pinned item with only deps.elements replaced. Refuses anything that is not a strict superset. */
export function supersetItem(item, deps) {
  const declared = item.meta?.element?.deps?.elements ?? [];
  if (!Array.isArray(declared) || !declared.every((row, index) => same(row, deps[index]))) throw new Error(`${item.name}: declared deps.elements are not a prefix of the computed list; refusing a non-superset candidate`);
  const next = structuredClone(item);
  next.meta.element.deps = { ...(next.meta.element.deps ?? {}), elements: deps };
  return next;
}

async function main(argv) {
  const write = argv.includes('--write'), asJson = argv.includes('--json');
  const rootAt = argv.indexOf('--root');
  const root = rootAt >= 0 ? resolve(argv[rootAt + 1]) : repoDefault;
  const clossysRoot = join(root, 'clossys');
  const findings = elementDepFindings(clossysRoot);
  const written = [];
  if (write && findings.length) {
    const { writeCandidate } = await import(pathToFileURL(join(root, 'packages/producer/dist/records/index.js')).href);
    for (const row of findings) {
      const { entry } = computedElementDeps(clossysRoot, row.slot);
      const out = writeCandidate(clossysRoot, 'designer', row.slot, entry.item.name, supersetItem(entry.item, row.computed));
      written.push({ slot: row.slot, from: row.candidate, to: out.name, sha256: out.sha256 });
    }
  }
  if (asJson) console.log(JSON.stringify({ findings, written }, null, 2));
  else {
    for (const row of findings) console.log(`derive-element-deps: ${row.slot} (${row.candidate}) composes ${row.computed.map(dep => dep.element).join(', ') || 'nothing'} but declares ${row.declared.map(dep => dep.element).join(', ') || 'nothing'}`);
    for (const row of written) console.log(`derive-element-deps: wrote ${row.slot}/${row.to} (from ${row.from}); pin it with clossys pin designer/${row.slot} ${row.to.replace(/\.json$/, '')}`);
    if (!findings.length) console.log('derive-element-deps: every pinned section declares the sections it composes');
  }
  return findings.length && !write ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main(process.argv.slice(2)).then(code => { process.exitCode = code; }, error => { console.error(error.message); process.exitCode = 2; });
