"use client";
import { Badge } from "../components/Badge.js";
import { Button } from "../components/Button.js";
import { RadioGroup } from "../components/RadioGroup.js";
import { Tooltip } from "../components/Tooltip.js";
import type { Candidate } from "./model.js";
import { CandidateCell } from "./CandidateCell.js";
import type { StudioLabels } from "./types.js";

import { PREVIEW_CHOICE_CLASS } from "../blocks/library-board/choice-class.js";
export { PREVIEW_CHOICE_CLASS } from "../blocks/library-board/choice-class.js";

/** One native radio owns the complete preview card; diagnostics remain a sibling control. */
export function CandidateChoice({ candidate, source = candidate?.source, target, labels }: { candidate?: Candidate; source?: string; target: string; labels: StudioLabels }) {
  // Keep the native radio mounted while pointer/focus demand evaluates its row.
  // Selection is still checked against the actual candidate by the provider.
  if (source === undefined) return null;
  return <div className="relative w-full" aria-busy={!candidate || undefined}>
    <RadioGroup.Radio value={source} isDisabled={candidate ? !candidate.usable : false} aria-label={labels.useSource(source, target)}
      className={PREVIEW_CHOICE_CLASS}>
      {candidate ? <CandidateCell candidate={candidate} labels={labels} /> : <span>{labels.loading}</span>}
    </RadioGroup.Radio>
    {candidate && candidate.errors > 0 ? <div className="absolute start-xs top-xs"><Tooltip trigger={<Button variant="ghost" size="sm" aria-label={labels.checkSummary(candidate.errors, candidate.notices)}><Badge variant="danger">!</Badge></Button>}>
      {labels.checkSummary(candidate.errors, candidate.notices)}
    </Tooltip></div> : null}
  </div>;
}
