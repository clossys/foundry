"use client";
import type { Candidate } from "./model.js";
import { memo, type CSSProperties, type ReactNode } from "react";
import { CompactPreview } from "./previews.js";
import { LeafCell } from "../blocks/library-board/LeafCell.js";
import type { StudioLabels } from "./types.js";
import { APP_FRAME_RIGHT_PANEL_CONFIG } from "../frames/right-panel-config.js";

/** Every library column and the Edit column share one cap: the frame right panel preset's maximum. */
export const LIBRARY_COLUMN_BOUND: CSSProperties = { maxWidth: APP_FRAME_RIGHT_PANEL_CONFIG.max };
/** Fit the column and wrap members at the cap instead of sizing the cell to max-content. */
export const LIBRARY_COLUMN_FLOW = "w-fit flex-wrap";

/** Every library supplies the same resolved data shape; all L4 variants flow in rows inside the one bounded leaf cell. */
export const CandidateCell = memo(function CandidateCell({ candidate, labels, preview }: { candidate?: Candidate; labels: StudioLabels; preview?: ReactNode }) {
  if (!candidate) return <LeafCell className={LIBRARY_COLUMN_FLOW} style={LIBRARY_COLUMN_BOUND} preview={preview} status={preview == null ? labels.previewUnavailable : undefined} />;
  return <LeafCell className={LIBRARY_COLUMN_FLOW} style={LIBRARY_COLUMN_BOUND} data-studio-candidate={candidate.index} status={candidate.previewable ? undefined : labels.previewUnavailable}
    preview={candidate.previewable ? candidate.members.map(entry => <div key={entry.id} data-candidate-variant={entry.id} className="min-w-[var(--ui-control-h-lg)]">
      <p data-member-key="" className="text-caption text-ink-secondary">{entry.id.slice(entry.member.slot.length + 1)}</p>
      <CompactPreview candidate={{ ...candidate, members: [entry] }} labels={labels} />
    </div>) : undefined} />;
}, (previous, next) => {
  if (previous.labels !== next.labels || previous.preview !== next.preview) return false;
  const a = previous.candidate, b = next.candidate;
  if (a === b) return true;
  // A row demand reprojects the matrix. Unchanged resolved members still name
  // the same immutable evaluation, so their previews need no second render.
  return !!a && !!b && a.index === b.index && a.previewable === b.previewable
    && a.members.length === b.members.length
    && a.members.every((entry, index) => entry.id === b.members[index]?.id && entry.member === b.members[index]?.member);
});
