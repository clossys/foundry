"use client";
import { Badge } from "../components/Badge.js";
import { Button } from "../components/Button.js";
import { RadioGroup } from "../components/RadioGroup.js";
import { Tooltip } from "../components/Tooltip.js";
import type { Candidate } from "./model.js";
import { CandidateCell } from "./CandidateCell.js";
import { ErrorReason } from "../blocks/library-board/ErrorReason.js";
import type { StudioLabels } from "./types.js";
import { checkCounts, isRuntimePending } from "./runtime-pending.js";
import { RuntimePendingLine } from "./board-summary.js";

import { PREVIEW_CHOICE_CLASS } from "../blocks/library-board/choice-class.js";
export { PREVIEW_CHOICE_CLASS } from "../blocks/library-board/choice-class.js";

/** One native radio owns the complete preview card; diagnostics remain a sibling control. */
export function CandidateChoice({ candidate, source = candidate?.source, target, labels }: { candidate?: Candidate; source?: string; target: string; labels: StudioLabels }) {
  // Keep the native radio mounted while pointer/focus demand evaluates its row.
  // Selection is still checked against the actual candidate by the provider.
  if (source === undefined) return null;
  // Display counts: a runtime-pending finding reads as the neutral pending line, never as an error badge.
  // Pending findings are notices, so they come out of the notice count; the candidate's error count stands as given.
  const pending = candidate ? checkCounts(candidate.findings).pending : 0;
  const shown = candidate ? { errors: candidate.errors, notices: Math.max(0, candidate.notices - pending), pending } : undefined;
  return <div className="relative w-full" aria-busy={!candidate || undefined}>
    <RadioGroup.Radio value={source} isDisabled={candidate ? !candidate.usable : false} aria-label={labels.useSource(source, target)}
      className={PREVIEW_CHOICE_CLASS}>
      {candidate ? <CandidateCell candidate={candidate} labels={labels} /> : <span>{labels.loading}</span>}
    </RadioGroup.Radio>
    {shown && shown.errors > 0 ? <div className="absolute start-xs top-xs"><Tooltip trigger={<Button variant="ghost" size="sm" aria-label={labels.checkSummary(shown.errors, shown.notices)}><Badge variant="danger"><span aria-hidden>!</span> {labels.checkSummary(shown.errors, shown.notices)}</Badge></Button>}>
      {labels.checkSummary(shown.errors, shown.notices)}
    </Tooltip></div> : null}
    {shown && shown.errors > 0 ? <ErrorReason findings={candidate!.findings.filter(finding => !isRuntimePending(finding))} /> : null}
    <RuntimePendingLine count={shown && shown.errors === 0 ? shown.pending : 0} label={labels.runtimePending} className="text-caption" />
  </div>;
}
