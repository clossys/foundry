import type { RevisionId, SectionIntent } from "./vocabulary.js";
import { isRevisionId, SECTION_INTENTS } from "./vocabulary.js";

export interface DesignerAssetRef {
  readonly assetId: string;
  readonly libraryVersion: string;
}
export interface CopyField {
  readonly field: string;
  readonly text: string;
  readonly source: "handwritten";
  readonly locale?: string;
  readonly assets?: readonly DesignerAssetRef[];
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
      if (!object(section, path, ["key", "sectionId", "configId", "intent", "fields", "ref"])) return;
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
      if (array(section.fields, `${path}.fields`)) section.fields.forEach((field, j) => {
        const fieldPath = `${path}.fields[${j}]`;
        if (!object(field, fieldPath, ["field", "text", "source", "locale", "assets"])) return;
        text(field.field, `${fieldPath}.field`);
        // Empty draft text is represented honestly; required-field Review decides completeness.
        if (typeof field.text !== "string") issue(`${fieldPath}.text`, "string");
        if (field.source !== "handwritten") issue(`${fieldPath}.source`, "handwritten-source");
        if (field.locale !== undefined) text(field.locale, `${fieldPath}.locale`);
        if (field.assets !== undefined && array(field.assets, `${fieldPath}.assets`)) field.assets.forEach((asset, k) => {
          const assetPath = `${fieldPath}.assets[${k}]`;
          if (object(asset, assetPath, ["assetId", "libraryVersion"])) {
            text(asset.assetId, `${assetPath}.assetId`);
            text(asset.libraryVersion, `${assetPath}.libraryVersion`);
          }
        });
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
