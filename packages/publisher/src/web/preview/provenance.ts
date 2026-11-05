import type { CopyResolution } from "@clossys/writer";
import { fallbackChain } from "@clossys/writer/locale";
import { copyLocaleProvenance, type CopyLocaleProvenance } from "../../content/copy-provenance.js";
import { computeContentDigest } from "../../content/digest.js";
import type { CopyResolutionReport } from "../../content/composition.js";
import type { ContentRouteSelection } from "../content-route-types.js";

export interface ContentPreviewProvenance {
  readonly slotId: string;
  readonly candidateId: string;
  readonly revision: string;
  readonly digest: string;
  readonly libraryVersion: string;
  readonly requestedLocale: string;
  /** Registry revision and entry identity, never rendered text or interpolation values. */
  readonly copy: readonly (CopyLocaleProvenance & {
    readonly binding: string;
    readonly recordId: string;
    readonly revision: string;
    readonly entryId: string;
    readonly source: CopyResolution["source"];
  })[];
  /** Inline compatibility copy is covered by the candidate digest, not a Writer revision. */
  readonly inline: readonly { readonly binding: string; readonly requestedLocale: string; readonly servedLocale: string; readonly chain: readonly string[] }[];
}

export function createContentPreviewProvenance(
  selection: ContentRouteSelection,
  reports: readonly { readonly binding: string; readonly report: CopyResolutionReport }[],
  manifest?: Parameters<typeof fallbackChain>[1],
): ContentPreviewProvenance {
  const { candidate, slot, locale } = selection;
  const digest = computeContentDigest(candidate);
  if (candidate.history.at(-1)?.digest !== digest) throw new TypeError("Preview candidate digest does not match its composition and copy revision");
  if (!reports.length) throw new TypeError("Preview requires complete copy provenance");
  const expected = manifest === undefined ? undefined : { requestedLocale: locale, chain: fallbackChain(locale, manifest) };
  const copy: ContentPreviewProvenance["copy"][number][] = [];
  const inline: ContentPreviewProvenance["inline"][number][] = [];
  for (const { binding, report } of reports) {
    const inlineFindings = report.findings.filter(finding => finding.rule === "legacy-inline-copy");
    const fieldCount = Object.values(report.copy).reduce((count, fields) => count + Object.keys(fields).length, 0);
    if (!report.complete || report.resolutions.length + inlineFindings.length !== fieldCount) throw new TypeError("Preview requires complete copy provenance");
    for (const resolution of report.resolutions) {
      const trace = copyLocaleProvenance(resolution, binding, expected);
      if (trace.requestedLocale !== locale || !resolution.recordId?.trim() || !resolution.revision?.trim() || !resolution.entryId?.trim()
        || !["consumer", "generated", "imported"].includes(resolution.source?.kind) || !resolution.source?.reference?.trim()) {
        throw new TypeError(`${binding}: preview copy revision or requested locale is missing`);
      }
      copy.push({ binding, ...trace, recordId: resolution.recordId, revision: resolution.revision,
        entryId: resolution.entryId, source: { ...resolution.source } });
    }
    for (const finding of inlineFindings) {
      inline.push({ binding: `${binding}:${finding.path}`, requestedLocale: locale, servedLocale: locale, chain: [locale] });
    }
  }
  return { slotId: slot.id, candidateId: candidate.id, revision: candidate.revision, digest,
    libraryVersion: candidate.composition!.libraryVersion, requestedLocale: locale, copy, inline };
}
