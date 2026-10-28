import { copyLocaleProvenance } from "./copy-provenance.js";
import type { CopyRef, CopyRegistry, CopyResolveOptions, CopyResolver } from "@clossys/writer";
import type { RevisionId, SectionIntent } from "./vocabulary.js";
import { isContentLocale, isRevisionId, SECTION_INTENTS } from "./vocabulary.js";
import type { CandidateContent } from "./model.js";

export interface DesignerAssetRef {
  readonly assetId: string;
  readonly libraryVersion: string;
}
export interface WriterCopyField {
  readonly key: string;
  readonly locale: string;
  readonly source: "writer";
  readonly ref: CopyRef;
  readonly value?: never;
}
/** @deprecated Migrate inline text to a Writer CopyRef. Historical Writer literals remain readable. */
export interface LegacyCopyField {
  readonly key: string;
  readonly locale: string;
  readonly source: "handwritten" | "writer";
  readonly value: string;
  readonly ref?: never;
}
export type CopyField = WriterCopyField | LegacyCopyField;
export interface SectionReference {
  readonly candidateId: string;
  readonly sectionKey: string;
  readonly revision: RevisionId;
}
export interface CompositionSection {
  readonly key: string;
  readonly sectionId: string;
  readonly configId: string;
  readonly intent: SectionIntent;
  readonly fields: readonly CopyField[];
  readonly assets?: readonly DesignerAssetRef[];
  readonly ref?: SectionReference;
}
export interface Composition {
  readonly frame: { readonly frameId: string; readonly configId: string };
  readonly sections: readonly CompositionSection[];
  readonly libraryVersion: string;
}
export interface ContentFinding {
  readonly path: string;
  readonly rule: string;
  readonly message: string;
}

export const PAGE_META_KEY = "$pageMeta";
export const PAGE_META_FIELDS = ["title", "description", "share-title", "share-text"] as const;

/** Plain JSON records keep prototype-shaped keys as ordinary own data. */
function isCopyRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

/** Validate copy identities and values without requiring draft completeness. */
export function validateCopyFields(value: unknown, path: string, allowedKeys?: readonly string[]): readonly ContentFinding[] {
  const findings: ContentFinding[] = [];
  const issue = (at: string, rule: string) => findings.push({ path: at, rule, message: `Invalid ${rule}` });
  const closed = (record: Record<string, unknown>, at: string, keys: readonly string[]) => {
    for (const key of Reflect.ownKeys(record)) {
      if (typeof key !== "string" || !keys.includes(key)) issue(`${at}.${String(key)}`, "unknown-field");
    }
  };
  if (!Array.isArray(value)) { issue(path, "array"); return findings; }
  const copyKeys = new Set<string>();
  for (let i = 0; i < value.length; i++) {
    const field: unknown = value[i];
    const fieldPath = `${path}[${i}]`;
    if (!Object.hasOwn(value, i) || !isCopyRecord(field)) { issue(fieldPath, "object"); continue; }
    closed(field, fieldPath, ["key", "locale", "value", "source", "ref"]);
    if (typeof field.key !== "string" || !field.key.trim()) issue(`${fieldPath}.key`, "nonempty-string");
    if (allowedKeys && (typeof field.key !== "string" || !allowedKeys.includes(field.key))) issue(`${fieldPath}.key`, "copy-key");
    if (!isContentLocale(field.locale)) issue(`${fieldPath}.locale`, "locale");
    const hasRef = Object.hasOwn(field, "ref");
    const hasValue = Object.hasOwn(field, "value");
    if (hasRef && hasValue) issue(fieldPath, "mixed-copy-field");
    if (hasRef) {
      if (field.source !== "writer") issue(`${fieldPath}.source`, "writer-source");
      if (!isCopyRecord(field.ref)) issue(`${fieldPath}.ref`, "copy-ref");
      else {
        const ref = field.ref;
        closed(ref, `${fieldPath}.ref`, ["id", "locale", "values"]);
        if (typeof ref.id !== "string" || !ref.id.trim()) issue(`${fieldPath}.ref.id`, "nonempty-string");
        if (Object.hasOwn(ref, "locale")) {
          if (!isContentLocale(ref.locale)) issue(`${fieldPath}.ref.locale`, "locale");
          else if (ref.locale !== field.locale) issue(`${fieldPath}.ref.locale`, "copy-ref-locale");
        }
        if (Object.hasOwn(ref, "values")) {
          if (!isCopyRecord(ref.values)) issue(`${fieldPath}.ref.values`, "copy-values");
          else for (const key of Reflect.ownKeys(ref.values)) {
            const scalar = typeof key === "string" ? ref.values[key] : undefined;
            if (typeof key !== "string" || !(typeof scalar === "string" || typeof scalar === "boolean"
              || (typeof scalar === "number" && Number.isFinite(scalar)))) issue(`${fieldPath}.ref.values.${String(key)}`, "copy-value");
          }
        }
      }
    } else {
      // Empty inline drafts remain honest; required-field Review owns readiness.
      if (typeof field.value !== "string") issue(`${fieldPath}.value`, "string");
      if (field.source !== "writer" && field.source !== "handwritten") issue(`${fieldPath}.source`, "writer-source");
    }
    const identity = JSON.stringify([field.locale, field.key]);
    if (copyKeys.has(identity)) issue(fieldPath, "duplicate-copy-key");
    copyKeys.add(identity);
  }
  return findings;
}

/** Structural checks only. Registered-library resolution belongs to Review. */
export function validateComposition(value: unknown): readonly ContentFinding[] {
  const findings: ContentFinding[] = [];
  const issue = (path: string, rule: string) => findings.push({ path, rule, message: `Invalid ${rule}` });
  const object = (v: unknown, path: string, keys: readonly string[]): v is Record<string, unknown> => {
    if (!v || typeof v !== "object" || Array.isArray(v)) { issue(path, "object"); return false; }
    for (const key of Object.keys(v)) if (!keys.includes(key)) issue(`${path}.${key}`, "unknown-field");
    return true;
  };
  const text = (v: unknown, path: string) => {
    if (typeof v !== "string" || !v.trim()) issue(path, "nonempty-string");
  };
  const array = (v: unknown, path: string): v is unknown[] => {
    if (!Array.isArray(v)) { issue(path, "array"); return false; } return true;
  };
  if (!object(value, "composition", ["frame", "sections", "libraryVersion"])) return findings;
  text(value.libraryVersion, "composition.libraryVersion");
  if (object(value.frame, "composition.frame", ["frameId", "configId"])) {
    text(value.frame.frameId, "composition.frame.frameId");
    text(value.frame.configId, "composition.frame.configId");
  }
  if (array(value.sections, "composition.sections")) {
    const keys = new Set<string>();
    value.sections.forEach((section, i) => {
      const path = `composition.sections[${i}]`;
      if (!object(section, path, ["key", "sectionId", "configId", "intent", "fields", "assets", "ref"])) return;
      for (const key of ["key", "sectionId", "configId"]) text(section[key], `${path}.${key}`);
      if (typeof section.key === "string") {
        if (section.key === PAGE_META_KEY) issue(`${path}.key`, "reserved-section-key");
        if (keys.has(section.key)) issue(`${path}.key`, "duplicate-section-key");
        keys.add(section.key);
      }
      if (!(SECTION_INTENTS as readonly unknown[]).includes(section.intent)) issue(`${path}.intent`, "section-intent");
      if (section.ref !== undefined && object(section.ref, `${path}.ref`, ["candidateId", "sectionKey", "revision"])) {
        text(section.ref.candidateId, `${path}.ref.candidateId`);
        text(section.ref.sectionKey, `${path}.ref.sectionKey`);
        if (!isRevisionId(section.ref.revision)) issue(`${path}.ref.revision`, "pinned-revision");
      }
      findings.push(...validateCopyFields(section.fields, `${path}.fields`));
      if (section.assets !== undefined && array(section.assets, `${path}.assets`)) section.assets.forEach((asset, k) => {
        const assetPath = `${path}.assets[${k}]`;
        if (object(asset, assetPath, ["assetId", "libraryVersion"])) {
          text(asset.assetId, `${assetPath}.assetId`);
          text(asset.libraryVersion, `${assetPath}.libraryVersion`);
        }
      });
    });
  }
  return findings;
}

export function parseComposition(value: unknown): Composition {
  const findings = validateComposition(value);
  if (findings.length) throw new TypeError(findings.map(f => `${f.path}: ${f.rule}`).join("; "));
  return value as Composition;
}

export type ResolvedCopy = Readonly<Record<string, Readonly<Record<string, string>>>>;

export interface CopyFinding extends ContentFinding {
  readonly severity: "error" | "warning";
  readonly locale: string;
  readonly servedLocale?: string;
  readonly chain?: readonly string[];
}
/** Serializable Writer inputs shared by content review, preview, and release. */
export interface ContentWriterContext {
  readonly registry: CopyRegistry;
  readonly registries?: readonly CopyRegistry[];
  readonly manifest?: CopyResolveOptions["manifest"];
  readonly timeZone?: string;
}
export interface ResolveCopyOptions {
  readonly resolver?: CopyResolver;
  /** Page rendering requires a native title; projection of body copy alone does not. */
  readonly requirePageMeta?: boolean;
}
export interface CopyResolutionReport {
  readonly copy: ResolvedCopy;
  readonly findings: readonly CopyFinding[];
  readonly complete: boolean;
  readonly resolutions: readonly NonNullable<ReturnType<CopyResolver>>[];
}

/** Resolve exact authored locale bindings through the caller's Writer resolver.
 * Reports and rendered text remain outside the immutable authored candidate.
 */
export function resolveCopy(
  candidate: Pick<CandidateContent, "composition"> & Partial<Pick<CandidateContent, "pageMeta">>,
  locale: string,
  options: ResolveCopyOptions = {},
): CopyResolutionReport {
  if (!isContentLocale(locale)) throw new TypeError("Copy resolution requires a locale");
  const composition = candidate.composition === undefined ? undefined : parseComposition(candidate.composition);
  if (candidate.pageMeta !== undefined) {
    const invalid = validateCopyFields(candidate.pageMeta, "pageMeta", PAGE_META_FIELDS);
    if (invalid.length) throw new TypeError(invalid.map(f => `${f.path}: ${f.rule}`).join("; "));
  }
  const findings: CopyFinding[] = [];
  const resolutions: NonNullable<ReturnType<CopyResolver>>[] = [];
  const issue = (path: string, rule: string, severity: CopyFinding["severity"], message: string,
    trace?: { servedLocale: string; chain: readonly string[] }) => {
    findings.push({ path, rule, severity, message, locale, ...trace });
  };
  const resolveFields = (fields: readonly CopyField[], path: string, metadata: boolean): Readonly<Record<string, string>> => {
    const pairs: [string, string][] = [];
    fields.forEach((field, index) => {
      if (field.locale !== locale) return;
      const fieldPath = `${path}[${index}]`;
      if (field.ref === undefined) {
        pairs.push([field.key, field.value]);
        issue(fieldPath, "legacy-inline-copy", "warning", "Migrate inline copy to a Writer CopyRef.");
        return;
      }
      if (typeof options.resolver !== "function") {
        issue(fieldPath, "copy-resolver-required", "error", "Writer copy requires a resolver.");
        return;
      }
      let result: ReturnType<CopyResolver>;
      // Supply a fresh request so a callback cannot mutate the authored reference.
      const ref: CopyRef = { id: field.ref.id, locale,
        ...(field.ref.values === undefined ? {} : { values: Object.fromEntries(Object.entries(field.ref.values)) }) };
      try { result = options.resolver(ref); }
      catch {
        issue(fieldPath, "copy-resolution-error", "error", "Writer copy resolution failed.");
        return;
      }
      if (result === undefined) {
        issue(fieldPath, "unresolved-copy", "error", "Writer copy could not be resolved.");
        return;
      }
      if (!result || !isCopyRecord(result.ref) || result.ref.id !== ref.id || result.ref.locale !== locale
        || typeof result.text !== "string" || !result.text.trim()
        || !isContentLocale(result.servedLocale) || !Array.isArray(result.chain) || !result.chain.length
        || Array.from({ length: result.chain.length }, (_, index) => Object.hasOwn(result.chain!, index) && isContentLocale(result.chain![index])).some(valid => !valid)
        || new Set(result.chain).size !== result.chain.length || !result.chain.includes(result.servedLocale)) {
        issue(fieldPath, "invalid-copy-resolution", "error", "Writer copy requires text and a canonical locale trace.");
        return;
      }
      try { copyLocaleProvenance(result, fieldPath); }
      catch {
        issue(fieldPath, "invalid-copy-resolution", "error", "Writer copy requires a consistent requested and served locale trace.");
        return;
      }
      const trace = { servedLocale: result.servedLocale, chain: [...result.chain] };
      if (result.servedLocale !== locale) {
        if (metadata) {
          issue(fieldPath, "page-metadata-fallback", "error", "Page metadata requires native locale copy.", trace);
          return;
        }
        issue(fieldPath, "body-copy-fallback", "warning", "Body copy uses Writer locale fallback.", trace);
      }
      pairs.push([field.key, result.text]);
      resolutions.push(result);
    });
    return Object.fromEntries(pairs);
  };
  const sections: [string, Readonly<Record<string, string>>][] = (composition?.sections ?? []).map((section, index) =>
    [section.key, resolveFields(section.fields, `composition.sections[${index}].fields`, false)]);
  if (candidate.pageMeta !== undefined || options.requirePageMeta) {
    const metadata = resolveFields(candidate.pageMeta ?? [], "pageMeta", true);
    if (!Object.hasOwn(metadata, "title") || !metadata.title?.trim()) {
      issue("pageMeta", "required-page-metadata", "error", "Page metadata requires a native title for the requested locale.");
    }
    sections.push([PAGE_META_KEY, metadata]);
  }
  return { copy: Object.fromEntries(sections), findings, complete: !findings.some(f => f.severity === "error"), resolutions };
}
