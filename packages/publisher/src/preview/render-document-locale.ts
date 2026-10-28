import { canonicalLocale, directionFor } from "@clossys/writer/locale";
import type { WriterManifest } from "@clossys/writer";

export interface DocumentLocaleOptions {
  readonly locale?: string;
  readonly manifest?: Pick<WriterManifest, "defaultLocale" | "locales">;
}

/** Compatibility declaration for existing English callers; other locales require their manifest. */
const DEFAULT_DOCUMENT_MANIFEST: Pick<WriterManifest, "defaultLocale" | "locales"> = {
  defaultLocale: "en", locales: [{ tag: "en", dir: "ltr", state: "active" }],
};

/** Canonical tags and direction are owned by Writer, including pseudo-locales. */
export function resolveDocumentLocale(options: DocumentLocaleOptions = {}): { locale: string; dir: "ltr" | "rtl" } {
  const manifest = options.manifest ?? DEFAULT_DOCUMENT_MANIFEST;
  const locale = canonicalLocale(options.locale ?? manifest.defaultLocale);
  return { locale, dir: directionFor(locale, manifest) };
}
