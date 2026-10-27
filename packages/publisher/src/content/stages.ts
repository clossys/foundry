export const CONTENT_STAGES = Object.freeze(["Define", "Assemble", "Review", "Approve", "Publish"] as const);
export const STAGE_STATUSES = Object.freeze(["Failing", "Needs input", "Waiting", "Done", "Not applicable"] as const);
export type ContentStage = (typeof CONTENT_STAGES)[number];
export type StageStatus = (typeof STAGE_STATUSES)[number];
export type CandidateStages = Readonly<Record<ContentStage, StageStatus>>;

/** Not applicable contributes no severity; an empty aggregate is Not applicable. */
export function rollUpStageStatuses(statuses: readonly StageStatus[]): StageStatus {
  let worst = STAGE_STATUSES.length - 1;
  for (const status of statuses) {
    const rank = STAGE_STATUSES.indexOf(status);
    if (rank < 0) throw new TypeError("Unknown content stage status");
    worst = Math.min(worst, rank);
  }
  return STAGE_STATUSES[worst]!;
}
