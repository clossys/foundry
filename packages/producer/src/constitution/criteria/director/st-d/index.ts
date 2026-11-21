/**
 * The Director criteria (ST-D) by id. `index.json` in this folder is the registry of record (R15.3);
 * this map is its static twin for synchronous certification, and agents.test.ts (not shipped) holds the two equal.
 */
import type { Criterion } from "../../core/types.js";
import { becauseCited, boundary, derivedUpstream, directionValues, keys, plainDirection, quantified, sections, watchTrigger } from "./brief.js";

export const DIRECTOR_CRITERIA: Readonly<Record<string, Criterion>> = Object.freeze({
  "brief.sections": sections,
  "brief.keys": keys,
  "brief.derived-upstream": derivedUpstream,
  "brief.because-cited": becauseCited,
  "brief.watch-trigger": watchTrigger,
  "brief.plain-direction": plainDirection,
  "brief.direction-values": directionValues,
  "brief.quantified": quantified,
  "brief.boundary": boundary,
});
