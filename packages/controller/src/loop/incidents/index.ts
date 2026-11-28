/** The incident loop (CP1-HEAL): detect -> match -> heal -> guard -> report, with no model for a known cause. */
export * from "./types.js";
export { normalizeLine, normalizeSignature, incidentRecord, recordFindings, SIGNATURE_LINES } from "./signature.js";
export { causeFindings, matchCause, matchText, readCauses, readRegistryRules } from "./causes.js";
export type { RegistryRow } from "./causes.js";
export { REMEDIES, NO_REMEDY, killOrphanGroups, rerunAloneThenBase, compareWithBase, fetchThenCompare } from "./remedies.js";
export type { HealEnv, ProcessRow, Remedy, RemedyResult } from "./remedies.js";
export { heal, oneLineSignature } from "./heal.js";
export type { HealResult } from "./heal.js";
export { healReport, isRepeat } from "./report.js";
export type { HealReport, Repeat, ReportWindow } from "./report.js";
export { packetFindings, packetExpectations, validationLines, classifyRed, redFindings, foldPlanFindings, stepBranches, probeSpawner, ROOT_CHECK } from "./guards.js";
export type { Expectation, GuardFinding, RedEntry, RedVerdict, RunState } from "./guards.js";
export { spawnFixture, runInGroup, processAlive, groupAlive, signalGroup, waitGroupGone } from "./spawn-fixture.js";
export type { SpawnedFixture } from "./spawn-fixture.js";
export { healMain, systemEnv, readRecords, HEAL_USAGE } from "./cli.js";
export type { CliOutcome } from "./cli.js";
