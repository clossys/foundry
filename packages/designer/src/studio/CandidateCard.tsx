"use client";

import type { ReactElement } from "react";
import { Badge } from "../atoms/Badge.js";
import { Card } from "../atoms/Card.js";
import { cx } from "../atoms/internal/cx.js";
import { RadioGroup } from "../atoms/RadioGroup.js";
import { StatusMark } from "../atoms/StatusMark.js";
import { toneOf, type Candidate } from "./model.js";
import { SlotPreview } from "./previews.js";
import type { StudioLabels } from "./types.js";

/** One source's fill for the slot: a Use radio, the preview in the source's own values, and a one-line check status. */
export function CandidateCard({ candidate, target, labels, focused, onFocusSource }: {
  candidate: Candidate; target: string; labels: StudioLabels; focused: boolean; onFocusSource: (source: string) => void;
}): ReactElement {
  const { source, errors, notices } = candidate;
  return (
    <Card
      data-studio-card={source}
      data-selected={candidate.selected ? "" : undefined}
      data-focused={focused ? "" : undefined}
      onFocus={() => onFocusSource(source)}
      onPointerDown={() => onFocusSource(source)}
      className={cx(
        "flex min-w-0 flex-col gap-sm p-md",
        candidate.selected ? "ring-2 ring-accent forced-colors:outline forced-colors:outline-2 forced-colors:outline-solid forced-colors:outline-[color:Highlight]" : "",
        focused ? "forced-colors:border-2 forced-colors:border-dashed forced-colors:border-[color:CanvasText]" : "",
      )}
    >
      <h3 className="text-body text-ink-primary">{source}</h3>
      <div className="flex flex-wrap items-start justify-between gap-sm">
        <RadioGroup.Radio value={source} isDisabled={!candidate.usable} aria-label={labels.useSource(source, target)}>{labels.useSource(source, target)}</RadioGroup.Radio>
        {candidate.inUseByDefault ? <Badge variant="info">{labels.inUseByDefault}</Badge> : null}
      </div>
      {candidate.reason === "reference" ? <p className="text-caption text-ink-muted">{labels.referenceOnly}</p> : null}
      <div data-studio-candidate={candidate.index}>
        <SlotPreview members={candidate.members} labels={labels} />
      </div>
      <StatusMark tone={toneOf(errors, notices)}>{labels.checkSummary(errors, notices)}</StatusMark>
    </Card>
  );
}
