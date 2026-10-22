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
import type { LegalViewFramedLabels, LegalViewLabels } from "./LegalView.js";

declare const document: LegalDocument;
declare const labels: LegalViewLabels;
declare const writerResolver: CopyResolver;
declare const webResolver: WebCopyResolver;

export const withWriterResolver = <LegalView brand="Acme" document={document} resolveCopyId={writerResolver} labels={labels} locale="en" />;

// @ts-expect-error the web CopyResolver is string-keyed and carries no CopyResolution provenance
export const withWebResolver = <LegalView brand="Acme" document={document} resolveCopyId={webResolver} labels={labels} locale="en" />;

export const insideFrame = <LegalView framed document={document} resolveCopyId={writerResolver} labels={labels} locale="en" />;

// @ts-expect-error framed content cannot take legacy site chrome
export const framedWithBrand = <LegalView framed brand="Acme" document={document} resolveCopyId={writerResolver} labels={labels} locale="en" />;
// @ts-expect-error the self-chromed path still requires its brand
export const missingLegacyBrand = <LegalView document={document} resolveCopyId={writerResolver} labels={labels} locale="en" />;
// @ts-expect-error the draft marker has no suppression prop
export const suppressedDraft = <LegalView framed hideDraft document={document} resolveCopyId={writerResolver} labels={labels} locale="en" />;
// @ts-expect-error framed content has the same ref-based Writer resolver contract
export const framedWithWebResolver = <LegalView framed document={document} resolveCopyId={webResolver} labels={labels} locale="en" />;

// The framed page renders no draft text, so it does not need the draft heading label; a full LegalViewLabels is still accepted.
declare const framedLabels: LegalViewFramedLabels;
export const framedWithoutDraftHeading = <LegalView framed document={document} resolveCopyId={writerResolver} labels={framedLabels} locale="en" />;
export const framedWithSummary = <LegalView framed summary={{ id: "acme.summary" }} document={document} resolveCopyId={writerResolver} labels={labels} locale="en" />;
// @ts-expect-error the self-chromed page still requires its draft heading
export const legacyWithoutDraftHeading = <LegalView brand="Acme" document={document} resolveCopyId={writerResolver} labels={framedLabels} locale="en" />;
// @ts-expect-error the summary is a framed-page subtitle only
export const legacyWithSummary = <LegalView brand="Acme" summary={{ id: "acme.summary" }} document={document} resolveCopyId={writerResolver} labels={labels} locale="en" />;
