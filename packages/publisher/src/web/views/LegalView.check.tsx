/**
 * Compile-time-only assertions about `LegalView`'s `resolveCopyId`. Named
 * `.check.tsx` rather than `.test.tsx` on purpose: this package's tsconfig
 * excludes test files from the real `tsc` run, so a `@ts-expect-error` inside
 * one asserts nothing. Nothing imports this file at runtime.
 *
 * `resolveCopyId` is `@clossys/writer`'s ref-based `CopyResolver`, the type
 * `renderStructuredDocument` takes. The string-keyed `CopyResolver` exported
 * from `@clossys/publisher/web` has no `CopyResolution` to report, so it is a
 * different shape and must not be accepted.
 */
import type { CopyResolver } from "@clossys/writer";
import type { LegalDocument } from "../../document/legal.js";
import type { CopyResolver as WebCopyResolver } from "../index.js";
import { LegalView } from "./LegalView.js";
import type { LegalViewLabels } from "./LegalView.js";

declare const document: LegalDocument;
declare const labels: LegalViewLabels;
declare const writerResolver: CopyResolver;
declare const webResolver: WebCopyResolver;

export const withWriterResolver = <LegalView brand="Acme" document={document} resolveCopyId={writerResolver} labels={labels} locale="en" />;

// @ts-expect-error the web CopyResolver is string-keyed and carries no CopyResolution provenance
export const withWebResolver = <LegalView brand="Acme" document={document} resolveCopyId={webResolver} labels={labels} locale="en" />;
