"use client";
import type { Candidate } from "./model.js";
import { memo, type ReactNode } from "react";
import { CompactPreview } from "./previews.js";
import { Card } from "../components/Card.js";
import type { StudioLabels } from "./types.js";

/** Every library supplies the same resolved data shape; all L4 variants remain horizontal. */
export const CandidateCell = memo(function CandidateCell({ candidate, labels, preview }: { candidate?: Candidate; labels: StudioLabels; preview?: ReactNode }) {
  if (!candidate) return <Card variant="plate" data-candidate-cell="" className="flex w-max items-start gap-md p-sm">{preview ?? <p>{labels.previewUnavailable}</p>}</Card>;
  return <Card variant="plate" data-studio-candidate={candidate.index} data-candidate-cell="" className="flex w-max items-start gap-md p-sm">
    {candidate.previewable ? candidate.members.map(entry => <div key={entry.id} data-candidate-variant={entry.id} className="min-w-[var(--ui-control-h-lg)]">
      <p data-member-key="" className="text-caption text-ink-secondary">{entry.id.slice(entry.member.slot.length + 1)}</p>
      <CompactPreview candidate={{ ...candidate, members: [entry] }} labels={labels} />
    </div>) : <p>{labels.previewUnavailable}</p>}
  </Card>;
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
