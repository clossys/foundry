"use client";
import type { Candidate } from "./model.js";
import { memo, type CSSProperties, type ReactNode } from "react";
import { CompactPreview } from "./previews.js";
import { LeafCell } from "../blocks/library-board/LeafCell.js";
import type { StudioLabels } from "./types.js";
import { APP_FRAME_RIGHT_PANEL_CONFIG } from "../frames/right-panel-config.js";
import { orderTokenMembers } from "../tokens/preview/member-order.js";
import type { SurfaceSampleState } from "./surface-preview-sample-content.js";

/** Every library column and the Edit column share one cap: the frame right panel preset's maximum. */
export const LIBRARY_COLUMN_BOUND: CSSProperties = { maxWidth: APP_FRAME_RIGHT_PANEL_CONFIG.max };
/** Fit the column and wrap members at the cap instead of sizing the cell to max-content. */
export const LIBRARY_COLUMN_FLOW = "w-fit flex-wrap";

type Member = Candidate["members"][number];
const memberKey = (entry: Member) => entry.id.slice(entry.member.slot.length + 1);
/** A dotted member key names its family (`amber.50` is in `amber`); a flat key has none. */
const familyOf = (entry: Member) => { const key = memberKey(entry), dot = key.lastIndexOf("."); return dot > 0 ? key.slice(0, dot) : ""; };
/** Contiguous members of one family, in member order. */
export function memberFamilies(members: readonly Member[]): { family: string; members: Member[] }[] {
  const runs: { family: string; members: Member[] }[] = [];
  for (const entry of members) {
    const family = familyOf(entry), last = runs[runs.length - 1];
    if (last && last.family === family) last.members.push(entry); else runs.push({ family, members: [entry] });
  }
  return runs;
}

/**
 * Every library supplies the same resolved data shape; all L4 variants flow in rows inside the one bounded leaf cell.
 * A leaf with several member families (a palette's ramps) starts each family on its own row, so a ramp reads as one
 * run instead of breaking wherever the cap falls.
 */
export const CandidateCell = memo(function CandidateCell({ candidate, labels, preview, sampleState }: { candidate?: Candidate; labels: StudioLabels; preview?: ReactNode; sampleState?: SurfaceSampleState }) {
  if (!candidate) return <LeafCell className={LIBRARY_COLUMN_FLOW} style={LIBRARY_COLUMN_BOUND} data-sample-state={sampleState} preview={preview} previewState={preview == null ? "unavailable" : "live"} status={preview == null ? labels.previewUnavailable : undefined} />;
  const variant = (entry: Member) => <div key={entry.id} data-candidate-variant={entry.id} className="candidate-variant-min-inline token-specimen-contain">
    <p data-member-key="" className="text-caption text-ink-secondary">{memberKey(entry)}</p>
    <CompactPreview candidate={{ ...candidate, members: [entry] }} labels={labels} />
  </div>;
  // Token members display in ordinal or value order (amber.50 before amber.100, xs .. 9xl).
  const members = candidate.previewable ? orderTokenMembers(candidate.members) : [];
  const families = memberFamilies(members);
  return <LeafCell className={LIBRARY_COLUMN_FLOW} style={LIBRARY_COLUMN_BOUND} data-studio-candidate={candidate.index} previewState={candidate.previewable ? "live" : "unavailable"} status={candidate.previewable ? undefined : labels.previewUnavailable}
    preview={!candidate.previewable ? undefined : families.length > 1
      ? families.map(({ family, members }, index) => <div key={family + index} data-candidate-family={family} className="flex basis-full flex-wrap items-start gap-md">{members.map(variant)}</div>)
      : members.map(variant)} />;
}, (previous, next) => {
  if (previous.labels !== next.labels || previous.preview !== next.preview || previous.sampleState !== next.sampleState) return false;
  const a = previous.candidate, b = next.candidate;
  if (a === b) return true;
  // A row demand reprojects the matrix. Unchanged resolved members still name
  // the same immutable evaluation, so their previews need no second render.
  return !!a && !!b && a.index === b.index && a.previewable === b.previewable
    && a.members.length === b.members.length
    && a.members.every((entry, index) => entry.id === b.members[index]?.id && entry.member === b.members[index]?.member);
});
