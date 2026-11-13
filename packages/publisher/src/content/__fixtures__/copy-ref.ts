import {
  COPY_FINGERPRINT_ALGORITHM,
  computeCopyFingerprint,
  createCopyResolver,
} from "@clossys/writer";
import type { CopyRef, CopyRegistry, CopyRegistryEntry, WriterManifest } from "@clossys/writer";
import type { CopyField } from "../composition.js";
import type { CandidateContent } from "../model.js";

export const copyRefFixtureAt = "2026-09-01T00:00:00.000Z";

/** The same locale policy shape consumed by Writer's shared I18N helpers. */
export function copyRefLocaleManifest(): Pick<WriterManifest, "defaultLocale" | "locales" | "fallback"> {
  return {
    defaultLocale: "en",
    locales: [
      { tag: "en", dir: "ltr", state: "active" },
      { tag: "ar", dir: "rtl", state: "active" },
    ],
    fallback: { ar: ["en"] },
  };
}

export function approvedCopyEntry(id: string, text: string, placeholders: string[] = []): CopyRegistryEntry {
  return {
    id, text, context: "Publisher CopyRef fixture", placeholders, status: "approved",
    approval: {
      approvedBy: "owner", approvedAt: copyRefFixtureAt,
      textFingerprint: computeCopyFingerprint(text), fingerprintAlgorithm: COPY_FINGERPRINT_ALGORITHM,
    },
  };
}

function registry(locale: string, entries: CopyRegistryEntry[]): CopyRegistry {
  return {
    id: `publisher-copy-${locale}`, locale, revision: "r1",
    source: { kind: "consumer", reference: "fixtures/publisher-copy-ref" }, entries,
  };
}

/** Actual approved registries, including ICU arguments and a native draft guard. */
export function copyRefRuntimeFixture() {
  const en = registry("en", [
    approvedCopyEntry("page.title", "Files"),
    approvedCopyEntry("page.description", "Browse approved files."),
    approvedCopyEntry("body.summary", "{count, plural, one {# file} other {# files}} — {amount, number}", ["count", "amount"]),
    approvedCopyEntry("body.alternative", "{count, plural, one {# document} other {# documents}} — {amount, number}", ["count", "amount"]),
    approvedCopyEntry("copy.fallback", "Available in English"),
    approvedCopyEntry("copy.guarded", "Approved English text"),
  ]);
  const ar = registry("ar", [
    approvedCopyEntry("page.title", "الملفات"),
    approvedCopyEntry("page.description", "تصفح الملفات المعتمدة."),
    approvedCopyEntry("body.summary", "{count, plural, zero {لا ملفات} one {ملف واحد} two {ملفان} few {# ملفات} many {# ملفًا} other {# ملف}} — {amount, number}", ["count", "amount"]),
    { id: "copy.guarded", text: "مسودة", context: "Native draft must stop fallback", placeholders: [], status: "draft" },
  ]);
  const manifest = copyRefLocaleManifest();
  const options = { manifest, registries: [ar], now: new Date(copyRefFixtureAt) };
  return { en, ar, manifest, options, resolver: createCopyResolver(en, options) };
}

export function refField(key: string, locale: string, id: string, values?: CopyRef["values"]): CopyField {
  return { key, locale, source: "writer", ref: { id, ...(values === undefined ? {} : { values }) } };
}

export function copyRefCandidate(): CandidateContent {
  return {
    name: "Files",
    brief: {
      audience: "Readers", goal: "Browse files", keyMessage: "Approved files",
      callToAction: "Browse", tone: "Clear", constraints: [], sourceAnswers: [], version: 1,
    },
    composition: {
      frame: { frameId: "frames.sample", configId: "default" }, libraryVersion: "1",
      sections: [{
        key: "intro", sectionId: "sections.sample", configId: "default", intent: "continues",
        fields: [
          refField("summary", "en", "body.summary", { count: 3, amount: 1234.5 }),
          refField("summary", "ar", "body.summary", { count: 3, amount: 1234.5 }),
        ],
      }],
    },
    pageMeta: [
      refField("title", "en", "page.title"), refField("description", "en", "page.description"),
      refField("title", "ar", "page.title"), refField("description", "ar", "page.description"),
    ],
    links: [], typeSettings: {}, openQuestions: [],
  };
}

export function withCopyRefBody(candidate: CandidateContent, fields: readonly CopyField[]): CandidateContent {
  return {
    ...candidate,
    composition: {
      ...candidate.composition!,
      sections: [{ ...candidate.composition!.sections[0]!, fields }],
    },
  };
}
