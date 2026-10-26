"use client";
import type { ReactElement } from "react";
import type { Candidate } from "./model.js";
import type { StudioLabels } from "./types.js";
import { CandidateChoice } from "./CandidateChoice.js";

/** Candidate preview within the row's existing RadioGroup. */
export function CandidateCard({ candidate, target, labels, focused, onFocusSource }: {
  candidate: Candidate; target: string; labels: StudioLabels; focused: boolean; onFocusSource: (source: string) => void;
}): ReactElement {
  return <div data-studio-card={candidate.source} data-selected={candidate.selected ? "" : undefined} data-focused={focused ? "" : undefined}
    onFocus={() => onFocusSource(candidate.source)} onPointerDown={() => onFocusSource(candidate.source)}>
    <CandidateChoice candidate={candidate} target={target} labels={labels} />
  </div>;
}
