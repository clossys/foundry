/** The Producer engine: one event log per workspace, its lock, its derived index and the checks over them (docs/engine.md (not shipped)). */
export * from "./types.js";
export * from "./lock.js";
export * from "./chain.js";
export * from "./derived.js";
export * from "./log.js";
export * from "./check.js";
export { ENGINE_SURFACE, SIDE_DOOR_SCOPE, SIDE_DOOR_MESSAGES, sideDoorFiles, sideDoorFindings, formatSideDoor, type SideDoorFinding } from "./side-door.js";
