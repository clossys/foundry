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
 * already exist. This file adds the one axis that was still missing: not
 * "does THIS registry resolve", but "does the WHOLE SET of a project's
 * locales actually cover the same ground".
 *
 * Three governance questions, one axis each:
 *
 *   1. MISSING COVERAGE — an entry the source locale has that a target
 *      locale does not. Implemented (`"locale-coverage:missing-entry"`).
 *   2. ORPHANED ENTRIES — an entry a target locale has that the source
 *      locale does not (a translation of something that no longer exists
 *      in the source). Implemented (`"locale-coverage:orphaned-entry"`).
 *   3. STALE TRANSLATIONS — a target-locale entry whose recorded revision
 *      is behind the source entry's revision. NOT IMPLEMENTED. See
 *      "WHY STALENESS IS NOT IMPLEMENTED" below — this is a deliberate
 *      omission, not an oversight, and this file says so in its own report
 *      output (`"locale-coverage:staleness-not-checked"`), every run, so
 *      the gap is never silent.
 *
 * WHY STALENESS IS NOT IMPLEMENTED
 * ---------------------------------------------------------------------------
 * `CopyRegistryEntry` (`types.ts`) carries no per-entry revision or approval
 * timestamp — only `status: CopyEntryStatus` (draft/approved/retired), which
 * is a lifecycle state, not a version marker two entries could be compared
 * by. The only revision-shaped field anywhere in this contract is
 * `CopyRegistry.revision: string`, and it is declared at the WHOLE-REGISTRY
 * level, not per entry (see `types.ts`'s `CopyRegistry` and `schema.ts`'s
 * `registry-revision-shape` check, which only asks that it be a non-empty
 * string — never that it be ordered, incrementing, or a date). Two real
 * problems follow from that, and both are disqualifying on their own:
 *
 *   - GRANULARITY: a whole registry's `revision` moving says only "SOMETHING
 *     in this locale's registry changed" — it cannot say WHICH entry moved,
 *     so comparing `source.revision` to `target.revision` cannot answer "is
 *     THIS entry's translation behind", only "is this locale's registry as
 *     a whole behind its own last touch", a materially weaker and
 *     differently-shaped question than the one this checker was asked for.
 *   - ORDERING: `revision` is documented (here and in `schema.ts`) as an
 *     opaque provenance string — the same "may be a revision-control object,
 *     CMS revision, or editorial record" opacity `CopySource.reference`
 *     already claims. A git SHA, a CMS revision id, and an ISO date are all
 *     valid `revision` values under the current schema, and only one of
 *     those three is safely comparable with `<`. Inventing an ordering over
 *     an opaque string this package's own contract explicitly promises not
 *     to interpret would be exactly the "bolt on a new field" (or worse,
 *     silently reinterpret an existing one beyond its documented contract)
 *     this checker was told not to do.
 *
 * Given both, this file implements the two checks the existing shape
 * actually supports and refuses to fake the third — a staleness check that
 * quietly always reports clean (because it has nothing trustworthy to
 * compare) is precisely the "check that passes because it checked nothing"
 * failure mode this repository has already paid for once; see
 * `scripts/check-release-readiness.mjs`'s own header for that precedent.
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
 */

import { validateCopyRegistryShape } from "./schema.js";
import type { CopyEntryId, CopyFinding, CopyLocale, CopyRegistry } from "./types.js";

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
   * entirely absent), missing coverage, orphaned entries, and the
   * always-present staleness-not-checked notice. Populated on every decline
   * path — never left empty to imply a clean run that in fact never
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
 * Checks that every `declaredLocales` entry other than `sourceLocale` covers
 * the same set of entry ids `registries[sourceLocale]` declares, and reports
 * any entry each target locale is missing or has orphaned. See this file's
 * top-of-file doc comment for exactly what "stale translations" would mean
 * and why it is not implemented against the current `CopyRegistry` shape.
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
    const targetIds = new Set(targetRegistry.entries.map((entry) => entry.id));

    for (const entry of sourceRegistry.entries) {
      if (!targetIds.has(entry.id)) {
        findings.push({
          rule: "locale-coverage:missing-entry",
          severity: "error",
          message: `Entry "${entry.id}" exists in source locale "${sourceLocale}" but has no counterpart in locale "${locale}".`,
          path: entry.id,
          locale,
          entryId: entry.id,
        });
      }
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

  // --- always present: staleness is not a check this shape can express ---
  // See this file's top-of-file "WHY STALENESS IS NOT IMPLEMENTED". Pushed
  // unconditionally, on every run that reaches this point, so the gap is a
  // structural, unmissable part of the report rather than a doc comment a
  // caller could go without ever reading.
  findings.push({
    rule: "locale-coverage:staleness-not-checked",
    severity: "warning",
    message:
      "Stale-translation detection is not implemented: CopyRegistryEntry carries no per-entry revision, and CopyRegistry.revision is a whole-registry, unordered provenance string that cannot safely stand in for one. See locale-coverage.ts's top-of-file doc comment.",
  });

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
