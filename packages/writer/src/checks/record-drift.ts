import type { Strategy } from "@clossys/strategist";
import { createHash } from "node:crypto";
import { validateWriterRecord } from "../model/validate.js";
import type { WriterLayer, WriterLibrary, WriterRecord } from "../model/types.js";
import { intlDirectionFor } from "../locale.js";
import { checkWriterLength } from "./length.js";
import { checkWriterICU } from "./icu.js";
import { checkWriterCoverage } from "./coverage.js";

export interface WriterRecordSource { path: string; value: unknown; source?: string }
export interface WriterRecordDriftFinding {
  code: string; severity: "error" | "warning" | "advisory"; path: string; message: string;
  locale?: string; recordId?: string; field?: string;
}
interface Subject { path: string; locale: string; record: WriterRecord }
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const collect = (value: unknown, path: string, locale?: string): Subject[] => {
  if (Array.isArray(value)) return value.flatMap(row => collect(row, path, locale));
  if (!object(value)) return [];
  const tag = typeof value.locale === "string" ? value.locale : locale;
  if (typeof value.id === "string" && typeof value.leaf === "string") {
    if (!tag) throw new Error(`${path}: record ${value.id} has no native locale envelope`);
    return [{ path, locale: tag, record: value as unknown as WriterRecord }];
  }
  return Object.entries(value).flatMap(([key, child]) => key === "locales" && object(child)
    ? Object.entries(child).flatMap(([native, content]) => collect(content, path, native))
    : collect(child, path, tag));
};
const libraryFor = (subjects: Subject[], defaultLocale: string, declared: string[]): WriterLibrary => {
  const locales: WriterLibrary["locales"] = {};
  for (const { path, locale, record } of subjects) {
    const content = locales[locale] ??= { records: [], documents: [], files: [] };
    content.records.push(record);
    let file = content.files!.find(row => row.path === path);
    if (!file) content.files!.push(file = { path, recordIds: [] });
    file.recordIds.push(record.id);
  }
  return { manifest: {
    consumer: "catalog-record-build", messageSyntax: "icu-mf1", defaultLocale,
    locales: declared.map(tag => ({ tag, dir: intlDirectionFor(tag) ?? "ltr", state: "active" })),
    fallback: {}, strategy: { root: "not-evaluated", contract: "writer.messaging" },
    leafFreeze: { lexicon: "", strings: "", patterns: "", passages: "", narratives: "" },
  }, locales };
};

/** Build readiness only: native completeness is independent of owner approval and translation currency. */
export function checkWriterRecordDrift(sources: readonly WriterRecordSource[], options: {
  /** Open manifest.strategy.root with Strategist.openStrategy; reopen after activation. Required when sources contain claims. */
  strategy?: Pick<Strategy, "getCell" | "isStale">;
} = {}) {
  const findings: WriterRecordDriftFinding[] = [];
  const all: Subject[] = [];
  const bundles: { path: string; defaultLocale: string; declaredLocales: string[]; records: number }[] = [];
  const lengthBundles: { path: string; defaultLocale: string; subjects: Subject[] }[] = [];
  for (const source of [...sources].sort((a, b) => a.path.localeCompare(b.path))) {
    try {
      const subjects = collect(source.value, source.path);
      if (!subjects.length) throw new Error(`${source.path}: no recognized records`);
      const value = object(source.value) ? source.value : {};
      const manifest = object(value.manifest) ? value.manifest : {};
      const observed = [...new Set(subjects.map(row => row.locale))].sort();
      const declared = Array.isArray(manifest.locales)
        ? manifest.locales.map(row => object(row) && typeof row.tag === "string" ? row.tag : "")
        : object(value.locales) ? Object.keys(value.locales).sort() : observed;
      if (declared.some(tag => !tag) || !declared.length) throw new Error(`${source.path}: invalid declared locales`);
      const defaultLocale = typeof manifest.defaultLocale === "string" ? manifest.defaultLocale : observed.includes("en") ? "en" : observed[0]!;
      if (new Set(declared).size !== declared.length || !declared.includes(defaultLocale) || observed.some(tag => !declared.includes(tag))) {
        throw new Error(`${source.path}: native content and default locale must match the declared locale set`);
      }
      if (declared.some(tag => !intlDirectionFor(tag))) throw new Error(`${source.path}: unsupported native locale`);
      const shape = subjects.flatMap(({ record, path, locale }) => validateWriterRecord(record, record.leaf.split(".")[0] as WriterLayer)
        .map(issue => ({ ...issue, path: `${path}:${issue.path}`, locale, recordId: record.id, severity: "error" as const })));
      findings.push(...shape);
      bundles.push({ path: source.path, defaultLocale, declaredLocales: declared, records: subjects.length });
      if (shape.length) continue;
      for (const { record, path, locale } of subjects) {
        if (!("kind" in record) || record.kind !== "claim") continue;
        const ref = record.strategy;
        const finding = { severity: "error" as const, path, locale, recordId: record.id, field: "strategy" };
        if (!options.strategy) findings.push({ ...finding, code: "WR_STRATEGY_MISSING", message: "Claim currency requires a Strategist snapshot: pass { strategy: openStrategy(manifest.strategy.root) } to checkWriterRecordDrift." });
        else if (!options.strategy.getCell(ref.cell, ref.version)) findings.push({ ...finding, code: "WR_STRATEGY_DANGLING", message: `Strategy cell ${ref.cell}@${ref.version} does not resolve; cite an existing confirmed cell version.` });
        else if (options.strategy.isStale(ref)) findings.push({ ...finding, code: "WR_STRATEGY_STALE", message: `Strategy cell ${ref.cell}@${ref.version} is not active; review this claim against the active cell before updating its reference.` });
      }
      all.push(...subjects);
      lengthBundles.push({ path: source.path, defaultLocale, subjects });
      const library = libraryFor(subjects, defaultLocale, declared);
      findings.push(...checkWriterICU(library).map(row => ({ ...row, path: `${source.path}:${row.path}` })));
      // Do not turn drafts into approved fixtures or weaken the production WR10 check.
      // This gate covers native content/identity/file completeness; approval and
      // translation fingerprint policy remain in their existing independent checks.
      findings.push(...checkWriterCoverage(library).filter(row => row.field !== "status" && !row.field?.startsWith("translation")));
    } catch (error) {
      findings.push({ code: "WX6_LOAD", severity: "error", path: source.path, message: error instanceof Error ? error.message : String(error) });
    }
  }
  const byLocale = new Map<string, Set<string>>();
  for (const { path, locale, record } of all) {
    const seen = byLocale.get(locale) ?? new Set<string>();
    if (seen.has(record.id)) findings.push({ code: "WX6_DUPLICATE", severity: "error", path, locale, recordId: record.id, message: "Duplicate native record ID; aliases must reference their source instead of copying it." });
    seen.add(record.id); byLocale.set(locale, seen);
  }
  for (const bundle of lengthBundles) {
    // References may live in another source, but omitted translated limits must
    // inherit from the owning bundle's source locale, never a corpus-wide one.
    const owned = new Set(bundle.subjects.map(({ locale, record }) => `${locale}\u0000${record.id}`));
    try {
      findings.push(...checkWriterLength(libraryFor(all, bundle.defaultLocale, [...byLocale.keys()]))
        .filter(row => owned.has(`${row.locale}\u0000${row.recordId}`)));
    } catch (error) {
      findings.push({ code: "WX6_LENGTH", severity: "error", path: bundle.path, message: error instanceof Error ? error.message : String(error) });
    }
  }
  if (!sources.length) findings.push({ code: "WX6_LOAD", severity: "error", path: "catalog/records", message: "No record sources were supplied." });
  findings.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const inputs = [...sources].sort((a, b) => a.path.localeCompare(b.path)).map(source => ({ path: source.path, sha256: createHash("sha256").update(source.source ?? JSON.stringify(source.value)).digest("hex") }));
  return {
    version: 1, ok: !findings.some(row => row.severity === "error"),
    scope: "Real catalog/records JSON; native locale completeness per bundle. Test fixtures are not translation promises.",
    approvalEvaluated: false, translationCurrencyEvaluated: false,
    inputs, bundles, records: all.length, locales: [...byLocale.keys()].sort(), findings,
  };
}
