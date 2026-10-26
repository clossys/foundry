"use client";

import { Logomark } from "../components/Logomark.js";
import { inspectSvg } from "../catalog-assets/svg.js";
import type { ReactElement } from "react";
import type { StudioLabels } from "./types.js";
import { TokenPreview, TokenValuePreview } from "../tokens/preview/index.js";
import { describePreview, previewRows, type Candidate, type PreviewSpec } from "./model.js";

/** Copy for the previews. The host supplies it; this module holds no English. */
export interface PreviewLabels {
  sampleText: string;
  fontNotLoaded: string;
  visualPreviewUnsupported: string;
  inspector: Pick<StudioLabels["inspector"], "light" | "dark">;
}

/** At most this many members render in a card; the rest collapse into a `+<n>` line. The inspector lists them all. */
export const PREVIEW_LIMIT = 24;

/** True when the page already declares a font face with this family. Studio never loads fonts. */
export function isFontDeclared(family: string): boolean {
  const faces = typeof document === "undefined" ? undefined : (document as Document & { fonts?: Iterable<{ family: string }> }).fonts;
  if (!faces) return false;
  for (const face of faces) if (face.family.replace(/^["']|["']$/g, "") === family) return true;
  return false;
}

const firstFamily = (css: string): string => (css.split(",")[0] ?? "").trim().replace(/^["']|["']$/g, "");
function Specimen({ id, member, spec, labels }: { id: string; member: Candidate["members"][number]["member"]; spec: PreviewSpec; labels: PreviewLabels }): ReactElement {
  if (member.slot.startsWith("assets.")) {
    if (member.$type !== "svg" || typeof member.value.light !== "string") return <code>{member.css.light}</code>;
    try { inspectSvg(member.value.light, id === "assets.favicon.vector" ? { favicon: true } : undefined); }
    catch { return <code>{member.css.light}</code>; }
    return <Logomark src={`data:image/svg+xml,${encodeURIComponent(member.value.light)}`} size="lg" title={id} />;
  }
  if (spec.kind === "text" && spec.visualUnsupported) return <div data-preview-kind="unsupported-text"><p>{labels.visualPreviewUnsupported}</p><dl><dt>{labels.inspector.light}</dt><dd><code>{spec.css}</code></dd><dt>{labels.inspector.dark}</dt><dd><code>{spec.dark}</code></dd></dl></div>;
  if (spec.kind === "token") return <TokenPreview property={spec.property} sampleText={labels.sampleText} unsupportedMessage={spec.property} />;
  if (spec.kind === "text") return <code data-preview-kind="text">{spec.css}</code>;
  return <TokenValuePreview id={id} member={member} sampleText={labels.sampleText} lightLabel="" darkLabel="" />;
}

/** The preview of one card: a row per member, capped at `limit`. */
export function SlotPreview({ members, labels, limit = PREVIEW_LIMIT, fontDeclared = isFontDeclared }: {
  members: Candidate["members"]; labels: PreviewLabels; limit?: number; fontDeclared?: (family: string) => boolean;
}): ReactElement {
  const rows = previewRows(members);
  const shown = rows.slice(0, limit);
  const hidden = rows.length - shown.length;
  return (
    <div data-studio-slot-preview="">
      <ul className="m-0 grid list-none gap-sm p-0">
        {shown.map(({ id, member, spec }) => {
          const family = member.$type === "fontFamily" && member.font?.kind === "fontsource" ? firstFamily(member.css.light) : undefined;
          return (
            <li key={id} className="grid gap-xs">
              <code>{id.slice(member.slot.length + 1)}</code>
              <Specimen id={id} member={member} spec={spec} labels={labels} />
              {family !== undefined && !fontDeclared(family) ? <small data-preview-note="font">{labels.fontNotLoaded}</small> : null}
            </li>
          );
        })}
      </ul>
      {hidden > 0 ? <p data-preview-more="">+{hidden}</p> : null}
    </div>
  );
}

/**
 * The specimen of one member inside a labelled cell. The cell owns the member key, so this never
 * re-enters the labelled SlotPreview; it adds the member value only where the specimen shows none.
 */
export function CompactPreview({ candidate, labels }: { candidate: Candidate; labels: StudioLabels }): ReactElement | null {
  const id = candidate.members[0]?.id, member = candidate.members[0]?.member;
  if (!candidate.previewable || !id || !member) return null;
  const spec = describePreview(member, 0);
  const compact = !(spec.kind === "text" && spec.visualUnsupported) && (member.$type === "color" || member.$type === "duration" || member.$type === "cubicBezier");
  const specimen = compact
    ? <TokenValuePreview id={id} member={member} sampleText={labels.sampleText} lightLabel={labels.inspector.light} darkLabel={labels.inspector.dark} compact />
    : <Specimen id={id} member={member} spec={spec} labels={labels} />;
  const valueShown = member.slot.startsWith("assets.") || spec.kind === "text" || spec.kind === "ruler";
  const family = member.$type === "fontFamily" && member.font?.kind === "fontsource" ? firstFamily(member.css.light) : undefined;
  return <>
    {specimen}
    {valueShown ? null : <code data-member-value="">{member.css.light}</code>}
    {family !== undefined && !isFontDeclared(family) ? <small data-preview-note="font">{labels.fontNotLoaded}</small> : null}
  </>;
}
