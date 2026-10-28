import type { Composition, CompositionSection, CopyField } from "../composition.js";
import { computeContentDigest } from "../digest.js";
import { isContentJson } from "../json.js";
import type { CandidateContent, ContentRevision } from "../model.js";
import { createContentRevision } from "../revisions.js";
import { validateCandidateContent } from "../validate.js";
import { isContentLocale } from "../vocabulary.js";

type StoredField = Omit<CopyField, "value">;
type StoredComposition = Omit<Composition, "sections"> & {
  readonly sections: readonly (Omit<CompositionSection, "fields"> & { readonly fields: readonly StoredField[] })[];
};
/** Revision structure retains copy identity; Writer text lives in locale sidecars. */
export type StoredRevision = Omit<ContentRevision, "content"> & {
  readonly content: Omit<CandidateContent, "composition"> & { readonly composition?: StoredComposition };
};

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireLocales(locales: readonly string[]): void {
  if (!Array.isArray(locales) || !locales.length || locales.some(locale => !isContentLocale(locale)) || new Set(locales).size !== locales.length) {
    throw new TypeError("Revision storage requires distinct locales");
  }
}

function jsonObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!object(value) || !isContentJson(value)) throw new TypeError(`${label} must be a JSON object`);
}

function fieldIdentity(value: unknown, withValue: boolean, locales: readonly string[]): asserts value is CopyField {
  const keys = withValue ? ["key", "locale", "source", "value"] : ["key", "locale", "source"];
  if (!object(value) || Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key)) ||
    typeof value.key !== "string" || !value.key.trim() || typeof value.locale !== "string" || !locales.includes(value.locale) ||
    value.source !== "writer" || (withValue && typeof value.value !== "string")) {
    throw new TypeError("Revision copy field has invalid identity or value");
  }
}

/** Split one fully joined snapshot without changing its existing content digest. */
export function splitStoreRevision(snapshot: ContentRevision, locales: readonly string[]): {
  revision: StoredRevision;
  copies: Readonly<Record<string, readonly CopyField[]>>;
} {
  requireLocales(locales);
  jsonObject(snapshot, "Revision");
  const findings = validateCandidateContent(snapshot.content);
  if (findings.length) throw new TypeError("Revision content is invalid");
  const validated = createContentRevision(snapshot.content, snapshot.revision, snapshot.createdAt);
  if (snapshot.digest !== validated.digest || snapshot.digest !== computeContentDigest(snapshot.content)) throw new TypeError("Revision digest differs from content");
  const copies: Record<string, CopyField[]> = Object.fromEntries(locales.map(locale => [locale, []]));
  const { composition: sourceComposition, ...content } = structuredClone(validated.content);
  const composition = sourceComposition && {
    ...sourceComposition,
    sections: sourceComposition.sections.map(section => ({
      ...section,
      fields: section.fields.map(field => {
        fieldIdentity(field, true, locales);
        copies[field.locale]!.push(structuredClone(field));
        const { value: _value, ...identity } = field;
        return identity;
      }),
    })),
  };
  return {
    revision: { revision: validated.revision, digest: validated.digest, createdAt: validated.createdAt,
      content: { ...content, ...(composition === undefined ? {} : { composition }) } },
    copies,
  };
}

/** Join by each locale's section/field ordinal, then verify the original snapshot digest. */
export function joinStoreRevision(revision: StoredRevision, copies: Readonly<Record<string, readonly CopyField[]>>, locales: readonly string[]): ContentRevision {
  requireLocales(locales);
  jsonObject(revision, "Stored revision");
  jsonObject(copies, "Revision copies");
  if (Object.keys(copies).length !== locales.length || Object.keys(copies).some(locale => !locales.includes(locale))) {
    throw new TypeError("Revision copies must contain exactly the selected locales");
  }
  const positions = new Map(locales.map(locale => [locale, 0]));
  for (const locale of locales) {
    if (!Object.hasOwn(copies, locale) || !Array.isArray(copies[locale])) throw new TypeError("Revision locale copy must be an array");
    for (const field of copies[locale]!) {
      fieldIdentity(field, true, locales);
      if (field.locale !== locale) throw new TypeError("Revision copy belongs to another locale");
    }
  }
  if (!object(revision.content)) throw new TypeError("Stored revision content must be an object");
  const content: Record<string, unknown> = structuredClone(revision.content);
  if (content.composition !== undefined) {
    if (!object(content.composition) || !Array.isArray(content.composition.sections)) throw new TypeError("Stored composition must have sections");
    for (const section of content.composition.sections) {
      if (!object(section) || !Array.isArray(section.fields)) throw new TypeError("Stored section must have fields");
      section.fields = section.fields.map((field: unknown) => {
        fieldIdentity(field, false, locales);
        const ordinal = positions.get(field.locale)!;
        const copy = copies[field.locale]![ordinal];
        if (!copy || copy.key !== field.key || copy.locale !== field.locale || copy.source !== field.source) throw new TypeError("Revision copy does not match its structural field");
        positions.set(field.locale, ordinal + 1);
        return structuredClone(copy);
      });
    }
  }
  for (const locale of locales) if (positions.get(locale) !== copies[locale]!.length) throw new TypeError("Revision has extra copy fields");
  const findings = validateCandidateContent(content);
  if (findings.length) throw new TypeError("Joined revision content is invalid");
  const joined = createContentRevision(content as unknown as CandidateContent, revision.revision, revision.createdAt);
  if (revision.digest !== joined.digest || revision.digest !== computeContentDigest(joined.content)) throw new TypeError("Revision digest differs from joined content");
  return joined;
}
