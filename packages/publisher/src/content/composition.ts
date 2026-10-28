import type { RevisionId, SectionIntent } from "./vocabulary.js";
import { isContentLocale, isRevisionId, SECTION_INTENTS } from "./vocabulary.js";
import type { CandidateContent } from "./model.js";

export interface DesignerAssetRef {
  readonly assetId: string;
  readonly libraryVersion: string;
}
export interface CopyField {
  readonly key: string;
  readonly locale: string;
  readonly value: string;
  readonly source: "writer";
}
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
        if (keys.has(section.key)) issue(`${path}.key`, "duplicate-section-key");
        keys.add(section.key);
      }
      if (!(SECTION_INTENTS as readonly unknown[]).includes(section.intent)) issue(`${path}.intent`, "section-intent");
      if (section.ref !== undefined && object(section.ref, `${path}.ref`, ["candidateId", "sectionKey", "revision"])) {
        text(section.ref.candidateId, `${path}.ref.candidateId`);
        text(section.ref.sectionKey, `${path}.ref.sectionKey`);
        if (!isRevisionId(section.ref.revision)) issue(`${path}.ref.revision`, "pinned-revision");
      }
      const copyKeys = new Set<string>();
      if (array(section.fields, `${path}.fields`)) section.fields.forEach((field, j) => {
        const fieldPath = `${path}.fields[${j}]`;
        if (!object(field, fieldPath, ["key", "locale", "value", "source"])) return;
        text(field.key, `${fieldPath}.key`);
        // Empty draft text is represented honestly; required-field Review decides completeness.
        if (typeof field.value !== "string") issue(`${fieldPath}.value`, "string");
        if (field.source !== "writer") issue(`${fieldPath}.source`, "writer-source");
        if (!isContentLocale(field.locale)) issue(`${fieldPath}.locale`, "locale");
        const identity = JSON.stringify([field.locale, field.key]);
        if (copyKeys.has(identity)) issue(fieldPath, "duplicate-copy-key");
        copyKeys.add(identity);
      });
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

/** Select Writer values for exactly one locale; Review owns missing-copy findings. */
export function resolveCopy(candidate: Pick<CandidateContent, "composition">, locale: string): ResolvedCopy {
  if (!isContentLocale(locale)) throw new TypeError("Copy resolution requires a locale");
  if (!candidate.composition) return {};
  const composition = parseComposition(candidate.composition);
  return Object.fromEntries(composition.sections.map(section => [section.key,
    Object.fromEntries(section.fields.filter(field => field.locale === locale).map(field => [field.key, field.value])),
  ]));
}
