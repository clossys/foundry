export { validateAgainst } from "./schema.js";
export type { JsonSchema, SchemaIssue } from "./schema.js";
export {
  ELEMENT_SCHEMA,
  PREVIEW_SCHEMA,
  RECORD_SCHEMA_IDS,
  REFERENCES_MANIFEST_SCHEMA,
  SLOT_CONTRACT_SCHEMA,
} from "./schemas.js";
export type * from "./types.js";
export { hashFiles, listFiles, sha256Hex, treeHash } from "./hash.js";
export {
  loadElement,
  loadPreview,
  loadReferencesManifest,
  loadSlotContract,
  RecordError,
  validateElement,
  validatePreview,
  validateReferencesManifest,
  validateSlotContract,
} from "./validate.js";
export type { Validation } from "./validate.js";
export {
  ELEMENT_FILE,
  elementDir,
  listVersions,
  payloadFiles,
  PREVIEW_FILE,
  readElementVersion,
  verifyElementVersion,
  versionDir,
  writeElementVersion,
} from "./library.js";
export type { ElementVersion, NewElementVersion } from "./library.js";
export { manifestReferenceHash, STATUS_PRECEDENCE, workspaceSlotStatus } from "./status.js";
export type { ReferenceHash, SlotStatus, SlotStatusRow } from "./status.js";

export { guardDesignerFlow, DesignerNeedError } from "./owner-approval.js";
export type { DesignerFlow, DesignerPath, OwnerApproval } from "./owner-approval.js";

// The Designer, Writer, Director and Publisher slot model: readers and the one writer.
export { listSlots, readCandidate, readPin, readSlotState, rejectedSlots, type RejectedSlot } from "./slots.js";
export { writeCandidate, writeNotNeeded, writePin } from "./slot-write.js";
