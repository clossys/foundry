/**
 * `checkLocaleCoverage` — governance over WHICH locales a copy registry set
 * actually covers, and where they have drifted from each other. This is the
 * other half of the split this package's README states plainly: translation
 * RUNTIME (ICU plural rules, locale negotiation, date/number formatting) is
 * out of scope, deliberately left to `Intl` and a consumer's own choice —
 * see `types.ts`'s doc comment on `CopyLocale`. Translation GOVERNANCE —
 * is every locale covered, has the source locale drifted ahead of its
 * translations — is already this package's job: `CopyLocale`,
 * locale-keyed registries, and `resolve.ts`'s `"locale-mismatch"` issue all
 * already exist. This file adds the axis that was still missing: not
 * "does THIS registry resolve", but "does the WHOLE SET of a project's
 * locales actually cover the same ground, with translations that are still
 * current and interpolate correctly".
 *
 * Four governance questions, one axis each — all implemented:
 *
 *   1. MISSING COVERAGE — an entry the source locale has that a target
 *      locale does not (`"locale-coverage:missing-entry"`).
 *   2. ORPHANED ENTRIES — an entry a target locale has that the source
 *      locale does not — a translation of something that no longer exists
 *      in the source (`"locale-coverage:orphaned-entry"`).
 *   3. STALE TRANSLATIONS — a target-locale entry whose recorded
 *      `translation.sourceFingerprint` no longer matches the source entry's
 *      current text (`"locale-coverage:stale-entry"`), or — when the target
 *      entry carries no provenance at all — that staleness genuinely
 *      cannot be evaluated (`"locale-coverage:provenance-missing"`). See
 *      "STALE TRANSLATIONS, NOW IMPLEMENTED" below.
 *   4. INTERPOLATION PARITY — a placeholder name declared by one locale's
 *      entry and missing from the other's, checked both directions
 *      (`"locale-coverage:interpolation-missing"`,
 *      `"locale-coverage:interpolation-extra"`).
 *
 * STALE TRANSLATIONS, NOW IMPLEMENTED
 * ---------------------------------------------------------------------------
 * This package previously left staleness unimplemented — `CopyRegistryEntry`
 * carried no per-entry revision or approval timestamp, only
 * `status: CopyEntryStatus` (a lifecycle state, not a version marker), and
 * the only revision-shaped field anywhere in the contract,
 * `CopyRegistry.revision: string`, was declared at the WHOLE-REGISTRY level
 * and documented as an opaque, unordered provenance string — a git SHA, a
 * CMS revision id, and an ISO date were all valid values, and only one of
 * those three is safely comparable with `<`. Comparing it would have meant
 * inventing an ordering this package's own contract explicitly promised not
 * to interpret. Rather than fake the check, every run unconditionally
 * pushed a `"locale-coverage:staleness-not-checked"` finding instead.
 *
 * `CopyRegistryEntry.translation?: CopyTranslationProvenance` (`types.ts`)
 * closes that gap with per-entry, CONTENT-DERIVED provenance instead of a
 * human-maintained counter: `translation.sourceFingerprint` records
 * `computeCopyFingerprint(sourceEntry.text)` (`fingerprint.ts`, `node:crypto`
 * `sha256`) at the moment a translation was produced. Content-derived, not
 * hand-bumped, because a hand-bumped revision requires someone to remember
 * to update it every time source copy changes, and nothing enforces that
 * discipline — it can drift silently, indistinguishable at the type level
 * from a genuinely current one. A content hash cannot drift: if the source
 * `text` changed by one character, a fresh `computeCopyFingerprint` call
 * returns a different value with certainty; if it did not change, the same
 * value with equal certainty. See `fingerprint.ts`'s and `types.ts`'s own
 * doc comments for the fuller argument.
 *
 * `checkLocaleCoverage` now, for every target entry that exists in both
 * locales (i.e. already excluded from missing/orphaned):
 *
 *   - if the entry carries `translation`, recomputes
 *     `computeCopyFingerprint(sourceEntry.text)` and compares it to
 *     `translation.sourceFingerprint`. A mismatch is
 *     `"locale-coverage:stale-entry"` (`"warning"`) — the translation is
 *     real, current-shaped data that has fallen behind.
 *   - if the entry carries no `translation` at all, emits
 *     `"locale-coverage:provenance-missing"` (`"warning"`) instead. This is
 *     load-bearing, not decoration: `translation` is optional (see
 *     BACKWARD COMPATIBILITY below), so an entry with none is neither
 *     "checked and current" nor "checked and stale" — it is "cannot tell".
 *     Collapsing that into either of the other two would recreate exactly
 *     the silent-pass failure mode this file previously avoided by naming
 *     `"staleness-not-checked"` on every run. Now that a real per-entry
 *     verdict exists for entries that DO carry provenance,
 *     `"provenance-missing"` is that same "cannot tell" honesty, narrowed to
 *     the one entry it is actually true of, instead of a blanket notice
 *     covering every entry regardless of whether it could have been
 *     checked.
 *
 * `"locale-coverage:staleness-not-checked"` is REMOVED — not gated, not
 * deprecated, deleted — because leaving it in place once a real per-entry
 * verdict exists would be a gate reporting a gap it no longer has, actively
 * misleading a caller into believing the whole axis is still unchecked.
 *
 * INTERPOLATION PARITY, BOTH DIRECTIONS
 * ---------------------------------------------------------------------------
 * For every entry present in both locales — independent of whether it
 * carries `translation` — this file also compares `placeholders` (`{name}`
 * interpolations, `types.ts`'s `CopyEntry.placeholders`) between the source
 * and target entry. A name the source declares but the target's translation
 * omits renders a broken sentence at runtime: `resolve.ts`'s `interpolate`
 * only fills placeholders the entry itself declares, so a value with
 * nowhere to interpolate into is a hole in the rendered text
 * (`"locale-coverage:interpolation-missing"`). A name the target declares
 * that the source never did renders the opposite failure: an unfilled,
 * literal `{name}` token sent straight to a user
 * (`"locale-coverage:interpolation-extra"`). Both are real correctness
 * bugs, both `"error"` severity — matching `schema.ts`'s existing
 * `placeholder-missing-from-text` precedent for the same class of bug
 * within one locale — never `"warning"`: unlike staleness, which can be
 * "cannot tell", a placeholder set is present-or-absent, always computable
 * for any two entries with well-formed `placeholders` arrays, so there is
 * no "cannot tell" state for this axis.
 *
 * BACKWARD COMPATIBILITY
 * ---------------------------------------------------------------------------
 * `translation` is optional on `CopyRegistryEntry` at the TYPE level, and
 * `schema.ts`'s `validateCopyRegistryShape` does not require it — an entry
 * with no `translation` remains a fully valid `CopyRegistryEntry`, and no
 * registry that predates this field becomes invalid overnight.
 * `report.complete` is unaffected by provenance presence or absence: it
 * continues to mean only "every declared target locale was evaluated",
 * exactly as before this file's own doc comment already stated —
 * presence/absence of `translation` produces FINDINGS
 * (`stale-entry`/`provenance-missing`), never a decline. The one rule this
 * file will not bend on: `"locale-coverage:provenance-missing"` and
 * `"locale-coverage:stale-entry"` are never the same finding and never
 * collapsed into one signal. A caller must be able to tell apart three
 * genuinely different outcomes for any one target entry — "checked, and
 * still current" (no finding at all), "checked, and it's stale"
 * (`stale-entry`), and "could not check — no provenance recorded"
 * (`provenance-missing`). Folding the third into either of the first two is
 * exactly the silent-pass failure this file exists to refuse.
 *
 * FAIL-CLOSED DESIGN, matching `checker.ts`'s `checkCopyRecord` precedent
 * ---------------------------------------------------------------------------
 * An empty registry set, a source locale with zero entries, or a declared
 * target locale entirely absent from the registries given to this run must
 * never look like a clean pass — each is its own named finding, and each
 * collapses `report.complete` to `false`. `report.complete` means "every
 * declared target locale was actually evaluated", never "everything found
 * was fine" — the same non-negotiable split `checker.ts` and `voice`'s own
 * `checkCopy` both draw for their own `.complete` fields. No branch in this
 * file returns an empty `findings` array on a decline path; every early
 * return states, in `findings`, exactly why nothing further was checked.
 *
 * NON-GOAL, RESTATED: no competing i18n runtime. Everything above is
 * translation GOVERNANCE — is a translation current, does it interpolate
 * correctly. Translation RUNTIME — ICU plural rules, locale negotiation,
 * date/number formatting — remains out of scope and belongs to `Intl`
 * (`Intl.PluralRules`, `Intl.ListFormat`, `Intl.RelativeTimeFormat`,
 * `Intl.NumberFormat`) plus a consumer's own locale-negotiation policy, per
 * the README's "Where this package sits on i18n". Nothing in this file
 * formats, negotiates, or pluralizes anything, and it never will.
 */

import { computeCopyFingerprint } from "./fingerprint.js";
import { validateCopyRegistryShape } from "./schema.js";
import type { CopyEntryId, CopyFinding, CopyLocale, CopyRegistry, CopyRegistryEntry } from "./types.js";

/** One thing `checkLocaleCoverage` found wrong, tagged with the locale and/or entry it concerns. */
export interface LocaleCoverageFinding extends CopyFinding {
  /** The locale this finding is about. Absent for a finding about the declared-locale set as a whole (e.g. no locales declared at all). */
  locale?: CopyLocale;
  /** The specific entry id this finding is about, when there is one. */
  entryId?: CopyEntryId;
}

/** Why a declared target locale was not actually evaluated this run. */
export type LocaleCoverageSkipReason =
  | "target-locale-missing"
  | "target-registry-invalid"
  | "target-registry-locale-mismatch";

/** One declared target locale `checkLocaleCoverage` did NOT evaluate, and why — mirrors `checker.ts`'s `CopyEntrySkip`. */
export interface LocaleCoverageSkip {
  locale: CopyLocale;
  reason: LocaleCoverageSkipReason;
}

export interface LocaleCoverageReport {
  /** Echoed back for a caller building its own report header. */
  sourceLocale: CopyLocale;
  /** Every locale this run was told the project must cover, `sourceLocale` included, in the order given. */
  declaredLocales: CopyLocale[];
  /** `declaredLocales` minus `sourceLocale` — every locale this run attempted to check coverage for. */
  targetLocales: CopyLocale[];
  /** Target locales actually evaluated (had a valid, correctly-keyed registry to compare against the source). */
  checkedLocales: CopyLocale[];
  /** Target locales NOT evaluated, and why — never silently folded into a report that looks like every declared locale was checked. */
  skippedLocales: LocaleCoverageSkip[];
  /** `sourceRegistry.entries.length`, once a valid source registry was found — `0` while a decline finding explains why no source registry was reached at all. */
  sourceEntryCount: number;
  /**
   * Every finding this run produced: structural declines (empty registry
   * set, missing/invalid/empty source locale, a declared target locale
   * entirely absent), missing coverage, orphaned entries, stale entries,
   * entries with no translation provenance to check staleness against, and
   * interpolation-parity mismatches (both directions). Populated on every
   * decline path — never left empty to imply a clean run that in fact never
   * started. This is the one field a caller checking "is anything wrong"
   * should read; read `.complete`, not an empty `findings`, to decide
   * whether a run can be trusted as "checked everything it could".
   */
  findings: LocaleCoverageFinding[];
  /**
   * `true` exactly when: at least one locale was declared, `sourceLocale`
   * is among them, the registry set was non-empty, the source locale's
   * registry was present/valid/non-empty and correctly keyed, and every
   * OTHER declared locale was actually evaluated (`skippedLocales` is
   * empty). Independent of whether any finding was produced — a project
   * with real missing-coverage or orphaned-entry findings can still be
   * `complete: true` (every declared locale got checked; some of them
   * failed). A mapping to this package's usual three-state exit-code
   * contract (0 clean / 1 findings / 2 could not run), for a caller that
   * wants one: `!complete` → 2, `complete && findings.some(f =>
   * f.severity === "error")` → 1, otherwise → 0.
   */
  complete: boolean;
}

function decline(
  sourceLocale: CopyLocale,
  declaredLocales: CopyLocale[],
  targetLocales: CopyLocale[],
  finding: LocaleCoverageFinding,
): LocaleCoverageReport {
  return {
    sourceLocale,
    declaredLocales,
    targetLocales,
    checkedLocales: [],
    skippedLocales: [],
    sourceEntryCount: 0,
    findings: [finding],
    complete: false,
  };
}

function uniqueInOrder(values: readonly CopyLocale[]): CopyLocale[] {
  const seen = new Set<CopyLocale>();
  const result: CopyLocale[] = [];
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }
  return result;
}

/**
 * Compares one target-locale entry against its source-locale counterpart
 * for the two per-entry axes beyond missing/orphaned: staleness (via
 * content fingerprint) and interpolation parity (both directions). Called
 * only for an entry id present in BOTH `sourceEntry` and `targetEntry` —
 * missing/orphaned entries never reach this function, since there is no
 * counterpart to compare against. See this file's top-of-file doc comment,
 * "STALE TRANSLATIONS, NOW IMPLEMENTED" and "INTERPOLATION PARITY, BOTH
 * DIRECTIONS", for the full argument behind each finding pushed here.
 */
function checkEntryProvenanceAndInterpolation(
  sourceEntry: CopyRegistryEntry,
  targetEntry: CopyRegistryEntry,
  sourceLocale: CopyLocale,
  targetLocale: CopyLocale,
  findings: LocaleCoverageFinding[],
): void {
  // --- staleness: content fingerprint, or "cannot tell" if none was recorded ---
  if (targetEntry.translation === undefined) {
    findings.push({
      rule: "locale-coverage:provenance-missing",
      severity: "warning",
      message: `Entry "${targetEntry.id}" in locale "${targetLocale}" carries no translation provenance — staleness cannot be evaluated for it. This is distinct from "checked and not stale": it means "cannot tell".`,
      path: targetEntry.id,
      locale: targetLocale,
      entryId: targetEntry.id,
    });
  } else {
    const currentFingerprint = computeCopyFingerprint(sourceEntry.text);
    if (targetEntry.translation.sourceFingerprint !== currentFingerprint) {
      findings.push({
        rule: "locale-coverage:stale-entry",
        severity: "warning",
        message: `Entry "${targetEntry.id}" in locale "${targetLocale}" was translated from source text fingerprinted as "${targetEntry.translation.sourceFingerprint}", but source locale "${sourceLocale}"'s current text fingerprints as "${currentFingerprint}" — the translation is behind an edited source.`,
        path: targetEntry.id,
        locale: targetLocale,
        entryId: targetEntry.id,
      });
    }
  }

  // --- interpolation parity, both directions ---------------------------------
  const sourcePlaceholders = new Set(sourceEntry.placeholders ?? []);
  const targetPlaceholders = new Set(targetEntry.placeholders ?? []);

  for (const name of sourcePlaceholders) {
    if (!targetPlaceholders.has(name)) {
      findings.push({
        rule: "locale-coverage:interpolation-missing",
        severity: "error",
        message: `Entry "${targetEntry.id}" in locale "${targetLocale}" is missing placeholder "{${name}}", which source locale "${sourceLocale}"'s entry declares — the translation will render with a required value that has nowhere to interpolate into.`,
        path: targetEntry.id,
        locale: targetLocale,
        entryId: targetEntry.id,
      });
    }
  }
  for (const name of targetPlaceholders) {
    if (!sourcePlaceholders.has(name)) {
      findings.push({
        rule: "locale-coverage:interpolation-extra",
        severity: "error",
        message: `Entry "${targetEntry.id}" in locale "${targetLocale}" declares placeholder "{${name}}", which source locale "${sourceLocale}"'s entry does not — the translation will render an unfilled "{${name}}" token to a user.`,
        path: targetEntry.id,
        locale: targetLocale,
        entryId: targetEntry.id,
      });
    }
  }
}

/**
 * Checks that every `declaredLocales` entry other than `sourceLocale` covers
 * the same set of entry ids `registries[sourceLocale]` declares, and reports
 * any entry each target locale is missing or has orphaned. For every entry
 * present in both locales, also checks staleness (via content fingerprint)
 * and interpolation parity — see this file's top-of-file doc comment for
 * the full design and the rule names each check can produce.
 *
 * `registries` is deliberately typed to accept `unknown` per-locale values
 * and validated here via `validateCopyRegistryShape`, the same "do not trust
 * a typed input at runtime" discipline `checker.ts`'s `checkCopyRecord`
 * documents for itself: a plain-JS caller, or a value from parsed JSON that
 * merely satisfies the type at compile time, is exactly the case a check
 * that "passes while asserting nothing" would fail to catch.
 *
 * Never throws. Every input shape — an empty `registries` object, an empty
 * `declaredLocales` array, a `sourceLocale` not present in either, a
 * malformed registry at any key — produces a `LocaleCoverageReport` with
 * `complete: false` and a finding explaining exactly what could not be
 * checked, never an exception and never a silently empty result.
 */
export function checkLocaleCoverage(
  registries: Readonly<Record<CopyLocale, unknown>>,
  sourceLocale: CopyLocale,
  declaredLocales: readonly CopyLocale[],
): LocaleCoverageReport {
  const declared = uniqueInOrder(declaredLocales);
  const targetLocales = declared.filter((locale) => locale !== sourceLocale);

  // --- fail closed: nothing declared at all ---------------------------------
  if (declared.length === 0) {
    return decline(sourceLocale, declared, targetLocales, {
      rule: "locale-coverage:no-declared-locales",
      severity: "error",
      message:
        "declaredLocales is empty — there is no locale set to check coverage against. At minimum, sourceLocale must be declared. An empty declared-locale set must never report clean.",
    });
  }

  // --- fail closed: sourceLocale itself was not declared --------------------
  if (!declared.includes(sourceLocale)) {
    return decline(sourceLocale, declared, targetLocales, {
      rule: "locale-coverage:source-locale-not-declared",
      severity: "error",
      message: `sourceLocale "${sourceLocale}" is not present in declaredLocales (${declared.join(", ") || "(empty)"}). The source locale must be one of the locales this run is told to cover.`,
      locale: sourceLocale,
    });
  }

  // --- fail closed: an empty registry set --------------------------------
  const registryLocales = Object.keys(registries);
  if (registryLocales.length === 0) {
    return decline(sourceLocale, declared, targetLocales, {
      rule: "locale-coverage:no-registries",
      severity: "error",
      message:
        "registries is empty — there is nothing to check coverage against. An empty registry set must never report clean.",
    });
  }

  // --- fail closed: declared source locale entirely absent ------------------
  if (!Object.hasOwn(registries, sourceLocale)) {
    return decline(sourceLocale, declared, targetLocales, {
      rule: "locale-coverage:source-locale-missing",
      severity: "error",
      message: `sourceLocale "${sourceLocale}" is declared but has no registry in the given registry set — there is no source of truth to check other locales against.`,
      locale: sourceLocale,
    });
  }

  // --- fail closed: source registry is not structurally valid --------------
  const sourceCandidate = registries[sourceLocale];
  const sourceShapeFindings = validateCopyRegistryShape(sourceCandidate);
  if (sourceShapeFindings.length > 0) {
    const detail = sourceShapeFindings.map((f) => `${f.path ?? "(root)"}: ${f.message}`).join("; ");
    return decline(sourceLocale, declared, targetLocales, {
      rule: "locale-coverage:source-registry-invalid",
      severity: "error",
      message: `The registry for source locale "${sourceLocale}" is not a valid CopyRegistry: ${detail}`,
      locale: sourceLocale,
    });
  }
  const sourceRegistry = sourceCandidate as CopyRegistry;

  // --- fail closed: the registry keyed under sourceLocale claims a different locale ---
  if (sourceRegistry.locale !== sourceLocale) {
    return decline(sourceLocale, declared, targetLocales, {
      rule: "locale-coverage:source-registry-locale-mismatch",
      severity: "error",
      message: `The registry keyed under source locale "${sourceLocale}" declares locale "${sourceRegistry.locale}" — the registries map key and the registry's own locale must agree, or a caller cannot trust which locale is actually being read.`,
      locale: sourceLocale,
    });
  }

  // --- fail closed: source locale with zero entries -------------------------
  if (sourceRegistry.entries.length === 0) {
    return decline(sourceLocale, declared, targetLocales, {
      rule: "locale-coverage:source-locale-empty",
      severity: "error",
      message: `Source locale "${sourceLocale}" has zero entries — there is nothing for other locales' coverage to be measured against. A source locale with zero entries must never report clean.`,
      locale: sourceLocale,
    });
  }

  const sourceIds = new Set(sourceRegistry.entries.map((entry) => entry.id));
  const findings: LocaleCoverageFinding[] = [];
  const checkedLocales: CopyLocale[] = [];
  const skippedLocales: LocaleCoverageSkip[] = [];

  for (const locale of targetLocales) {
    // --- a declared target locale entirely absent from the registry set ---
    if (!Object.hasOwn(registries, locale)) {
      skippedLocales.push({ locale, reason: "target-locale-missing" });
      findings.push({
        rule: "locale-coverage:target-locale-missing",
        severity: "error",
        message: `Locale "${locale}" is declared but has no registry in the given registry set — its coverage could not be checked at all. A declared locale that is entirely absent must never report clean.`,
        locale,
      });
      continue;
    }

    const targetCandidate = registries[locale];
    const targetShapeFindings = validateCopyRegistryShape(targetCandidate);
    if (targetShapeFindings.length > 0) {
      const detail = targetShapeFindings.map((f) => `${f.path ?? "(root)"}: ${f.message}`).join("; ");
      skippedLocales.push({ locale, reason: "target-registry-invalid" });
      findings.push({
        rule: "locale-coverage:target-registry-invalid",
        severity: "error",
        message: `The registry for locale "${locale}" is not a valid CopyRegistry, so its coverage could not be checked: ${detail}`,
        locale,
      });
      continue;
    }
    const targetRegistry = targetCandidate as CopyRegistry;

    if (targetRegistry.locale !== locale) {
      skippedLocales.push({ locale, reason: "target-registry-locale-mismatch" });
      findings.push({
        rule: "locale-coverage:target-registry-locale-mismatch",
        severity: "error",
        message: `The registry keyed under locale "${locale}" declares locale "${targetRegistry.locale}" — the registries map key and the registry's own locale must agree, so its coverage could not be checked.`,
        locale,
      });
      continue;
    }

    // --- the real work: compare entry ids against the source locale -------
    checkedLocales.push(locale);
    const targetById = new Map(targetRegistry.entries.map((entry) => [entry.id, entry]));

    for (const entry of sourceRegistry.entries) {
      const targetEntry = targetById.get(entry.id);
      if (!targetEntry) {
        findings.push({
          rule: "locale-coverage:missing-entry",
          severity: "error",
          message: `Entry "${entry.id}" exists in source locale "${sourceLocale}" but has no counterpart in locale "${locale}".`,
          path: entry.id,
          locale,
          entryId: entry.id,
        });
        continue;
      }
      // Present in both locales: staleness and interpolation parity are
      // only meaningful for a real pair — see this function's own doc
      // comment and this file's top-of-file "STALE TRANSLATIONS, NOW
      // IMPLEMENTED" / "INTERPOLATION PARITY, BOTH DIRECTIONS".
      checkEntryProvenanceAndInterpolation(entry, targetEntry, sourceLocale, locale, findings);
    }
    for (const entry of targetRegistry.entries) {
      if (!sourceIds.has(entry.id)) {
        findings.push({
          rule: "locale-coverage:orphaned-entry",
          severity: "warning",
          message: `Entry "${entry.id}" exists in locale "${locale}" but has no counterpart in source locale "${sourceLocale}" — likely a translation of an entry that no longer exists.`,
          path: entry.id,
          locale,
          entryId: entry.id,
        });
      }
    }
  }

  return {
    sourceLocale,
    declaredLocales: declared,
    targetLocales,
    checkedLocales,
    skippedLocales,
    sourceEntryCount: sourceRegistry.entries.length,
    findings,
    complete: skippedLocales.length === 0,
  };
}
