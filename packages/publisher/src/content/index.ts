/** Provider-neutral stored content. Library Review and publishing run separately. */
export { CONTENT_TAXONOMY, isContentPlacement, createSlotId, isSlotId } from "./taxonomy.js";
export type { ContentL1, ContentL2, ContentPlacement, SlotId } from "./taxonomy.js";
export { CONTENT_STAGES, STAGE_STATUSES, rollUpStageStatuses } from "./stages.js";
export type { ContentStage, StageStatus, CandidateStages } from "./stages.js";
export { CANDIDATE_STATES, CANDIDATE_ORIGINS, SLOT_KINDS, SECTION_INTENTS, LINK_RELATIONS, isRevisionId } from "./vocabulary.js";
export type { CandidateState, CandidateOrigin, SlotKind, SectionIntent, LinkRelation, RevisionId } from "./vocabulary.js";
export { validateComposition, parseComposition, resolveCopy } from "./composition.js";
export type { DesignerAssetRef, CopyField, ResolvedCopy, SectionReference, CompositionSection, Composition, ContentFinding } from "./composition.js";
export { isContentJson, isSourceAnswer } from "./json.js";
export type { ContentJson, ContentJsonObject, SourceAnswer } from "./json.js";
export type { ContentWorkspace, ContentBrief, ContentOpenQuestion, ContentLink, ContentApproval, CandidateContent, ContentRevision, ContentCandidate, ContentRelease, ContentSlot, ContentRegistry } from "./model.js";
export { validateCandidateContent, validateContentCandidate, validateContentSlot, validateContentWorkspace, validateContentRegistry, parseContentRegistry } from "./validate.js";
export { validateConsumerLibrarySnapshots, checkContentLibraryReferences } from "./library.js";
export type { ConsumerLibrarySnapshot } from "./library.js";
