import type { Candidate } from "./model.js";

/** Display provenance only: selected engine candidates and their eligibility are unchanged. */
export function activeCandidateSource(candidates: readonly Candidate[]): string | null {
  const active = candidates.find(candidate => candidate.selected);
  if (!active) return null;
  const origin = active.members[0]?.member.origin;
  if (origin?.kind !== "adopted") return active.source;
  const provided = candidates.find(candidate => candidate.source === origin.source && candidate.usable);
  if (!provided || provided.members.length !== active.members.length) return active.source;
  const exact = active.members.every(({ id, member }) => {
    const offered = provided.members.find(entry => entry.id === id)?.member;
    const prior = member.origin, current = offered?.origin;
    return offered && prior?.kind === "adopted" && current?.kind === "adopted" && prior.source === origin.source
      && prior.fill === current.fill && prior.sha256 === current.sha256 && JSON.stringify(prior.pin) === JSON.stringify(current.pin)
      && member.$type === offered.$type && JSON.stringify(member.value) === JSON.stringify(offered.value) && JSON.stringify(member.css) === JSON.stringify(offered.css);
  });
  return exact ? provided.source : active.source;
}
