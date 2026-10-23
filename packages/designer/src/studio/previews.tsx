"use client";

import type { CSSProperties, ReactElement } from "react";
import { TokenPreview } from "../tokens/preview/index.js";
import { previewRows, type Candidate, type PreviewSpec } from "./model.js";

/** Copy for the previews. The host supplies it; this module holds no English. */
export interface PreviewLabels {
  sampleText: string;
  fontNotLoaded: string;
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
const list: CSSProperties = { listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "var(--spacing-sm, 8px)" };
const swatch = (variable: string): CSSProperties => ({
  display: "inline-block", inlineSize: 40, blockSize: 40, flexShrink: 0, background: `var(${variable}, transparent)`,
  borderStyle: "solid", borderWidth: 1, borderColor: "var(--color-line-strong, currentColor)",
});

function Specimen({ spec, labels }: { spec: PreviewSpec; labels: PreviewLabels }): ReactElement {
  switch (spec.kind) {
    case "token":
      return <TokenPreview property={spec.property} sampleText={labels.sampleText} unsupportedMessage={spec.property} />;
    case "swatch":
      return <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--spacing-sm, 8px)" }}><span aria-hidden="true" data-preview-kind="swatch" style={swatch(spec.variable)} /><code>{spec.css}</code></span>;
    case "font":
      return <span data-preview-kind="font" style={{ fontFamily: `var(${spec.variable}, inherit)` }}>{labels.sampleText}</span>;
    case "ruler":
      return <span style={{ display: "grid", gap: "var(--spacing-xs, 4px)" }}><span aria-hidden="true" data-preview-kind="ruler" style={{ display: "block", blockSize: 8, inlineSize: `var(${spec.variable}, 0px)`, maxInlineSize: "100%", background: "var(--color-accent, currentColor)" }} /><code>{spec.css}</code></span>;
    case "text":
      return <code data-preview-kind="text">{spec.css}</code>;
  }
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
      <ul style={list}>
        {shown.map(({ id, member, spec }) => {
          const family = member.$type === "fontFamily" && member.font?.kind === "fontsource" ? firstFamily(member.css.light) : undefined;
          return (
            <li key={id} style={{ display: "grid", gap: "var(--spacing-xs, 4px)" }}>
              <code>{id.slice(member.slot.length + 1)}</code>
              <Specimen spec={spec} labels={labels} />
              {family !== undefined && !fontDeclared(family) ? <small data-preview-note="font">{labels.fontNotLoaded}</small> : null}
            </li>
          );
        })}
      </ul>
      {hidden > 0 ? <p data-preview-more="">+{hidden}</p> : null}
    </div>
  );
}
