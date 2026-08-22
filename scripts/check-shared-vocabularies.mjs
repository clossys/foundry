/**
 * check-shared-vocabularies — one vocabulary, two packages, no import
 * between them (#443).
 *
 * `@vespeneventures/controller/conventions` and `@vespeneventures/observer`
 * both freeze the same five live-state finding kinds. They agree today.
 * Nothing proved they would keep agreeing.
 *
 * WHY THE DUPLICATE IS NOT DELETED. The obvious fix — collapse observer's
 * copy into a re-export, the way `builder` already does — does not transfer.
 * builder's own module header says why its collapse was free: "no new
 * dependency edge was needed, since builder already required controller".
 * observer requires nothing at all. That is its contract, stated in its
 * README's Requirements section, so a caller measuring gate efficacy never
 * inherits a governance package's dependency surface to do it. Spending that
 * to dedupe five strings is a bad trade, and observer's own header made the
 * argument before this gate existed.
 *
 * So the duplication stays and stops being unverified. What was "kept in
 * sync by hand ... this comment is what a reviewer checks that against"
 * becomes a gate: a reviewer noticing is not a mechanism.
 *
 * COMPARES SETS, IN BOTH DIRECTIONS, NEVER COUNTS. A renamed member keeps
 * both counts equal and both lists the same length, so a count comparison
 * reports agreement on precisely the drift most likely to happen — someone
 * renaming a kind in one copy. `scripts/check-shared-vocabularies.test.mjs`
 * carries that separating fixture and asserts the weaker check would pass it.
 *
 * TERNARY. `satisfied` (0) the two sets match. `violated` (1) they diverge,
 * and every member is named in the direction it is missing. `indeterminate`
 * (2) a vocabulary could not be read at all — an unbuilt `dist/`, a moved
 * export — which is never reported as agreement, because "I could not look"
 * and "I looked and they match" are the two answers this repository keeps
 * finding collapsed into each other.
 */

import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

/** The vocabularies this gate keeps in agreement. Adding a third copy means adding a row here. */
export const SHARED_VOCABULARIES = Object.freeze([
  Object.freeze({
    name: "live-state finding kinds",
    sources: Object.freeze([
      Object.freeze({ label: "@vespeneventures/controller/conventions", dist: "packages/controller/dist/conventions/index.js", exportName: "LIVE_STATE_SURFACE_FINDING_KINDS" }),
      Object.freeze({ label: "@vespeneventures/observer", dist: "packages/observer/dist/index.js", exportName: "liveStateFindingKinds" }),
    ]),
  }),
]);

/**
 * Compare two vocabularies as SETS, in both directions.
 *
 * Pure, and separate from the loading above, so the test can hand it a
 * renamed member directly rather than building two packages to produce one.
 */
export function compareVocabulary(name, left, right) {
  const leftSet = new Set(left.members);
  const rightSet = new Set(right.members);
  const missingFromRight = [...leftSet].filter((m) => !rightSet.has(m)).sort();
  const missingFromLeft = [...rightSet].filter((m) => !leftSet.has(m)).sort();

  if (missingFromRight.length === 0 && missingFromLeft.length === 0) {
    return { verdict: "satisfied", name, reasons: [] };
  }
  const reasons = [];
  for (const m of missingFromRight) reasons.push(`"${m}" is in ${left.label} but not in ${right.label}`);
  for (const m of missingFromLeft) reasons.push(`"${m}" is in ${right.label} but not in ${left.label}`);
  return { verdict: "violated", name, reasons };
}

/** Read one vocabulary from a built package. Any failure is indeterminate, never an empty set. */
export async function loadVocabulary(source, { repoRoot = process.cwd(), importer = (url) => import(url) } = {}) {
  const path = resolve(repoRoot, source.dist);
  let module;
  try {
    module = await importer(pathToFileURL(path).href);
  } catch (error) {
    return { ok: false, label: source.label, reason: `could not import ${source.dist} (${error instanceof Error ? error.message : String(error)}) — run \`npm run build\` first` };
  }
  const value = module[source.exportName];
  if (!Array.isArray(value)) {
    return { ok: false, label: source.label, reason: `${source.dist} does not export an array named \`${source.exportName}\`` };
  }
  if (value.length === 0) {
    return { ok: false, label: source.label, reason: `${source.label}'s \`${source.exportName}\` is empty — an empty set trivially matches nothing and would be reported as agreement` };
  }
  return { ok: true, label: source.label, members: value.map(String) };
}

export async function run(options = {}) {
  const results = [];
  for (const vocabulary of SHARED_VOCABULARIES) {
    const loaded = await Promise.all(vocabulary.sources.map((s) => loadVocabulary(s, options)));
    const unreadable = loaded.filter((l) => !l.ok);
    if (unreadable.length > 0) {
      results.push({ verdict: "indeterminate", name: vocabulary.name, reasons: unreadable.map((u) => u.reason) });
      continue;
    }
    results.push(compareVocabulary(vocabulary.name, loaded[0], loaded[1]));
  }
  return results;
}

/** indeterminate outranks violated outranks satisfied — a run that could not look never reports agreement. */
export function fold(results) {
  if (results.some((r) => r.verdict === "indeterminate")) return "indeterminate";
  if (results.some((r) => r.verdict === "violated")) return "violated";
  return "satisfied";
}

export const EXIT_CODES = Object.freeze({ satisfied: 0, violated: 1, indeterminate: 2 });

async function main() {
  const results = await run();
  for (const r of results) {
    console.log(`  [${r.verdict.toUpperCase()}] ${r.name}`);
    for (const reason of r.reasons) console.log(`      ${reason}`);
  }
  const verdict = fold(results);
  console.log(
    verdict === "satisfied"
      ? `\nSHARED VOCABULARIES OK — ${results.length} vocabulary/ies, every copy agreeing as a set in both directions.`
      : verdict === "violated"
        ? `\nSHARED VOCABULARIES FAIL — a vocabulary declared in two packages has diverged.`
        : `\nSHARED VOCABULARIES INDETERMINATE — a vocabulary could not be read, so agreement was not established.`,
  );
  process.exit(EXIT_CODES[verdict]);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) await main();
