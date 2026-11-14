/**
 * The Writer criteria (ST-W1, ST-W2) by id. `index.json` in this folder is the registry of record
 * (R15.3); this map is its static twin for synchronous certification, and agents.test.ts holds the two equal.
 */
import type { Criterion } from "../../core/types.js";
import { claimSourced, derivedUpstream, entries, lexiconRecord, narrativeSequence, patternParts, plainValues, sentenceCase, voiceDerived, withinLimits } from "./copy.js";

export const WRITER_CRITERIA: Readonly<Record<string, Criterion>> = Object.freeze({
  "copy.voice-derived": voiceDerived,
  "copy.derived-upstream": derivedUpstream,
  "copy.entries": entries,
  "copy.plain-values": plainValues,
  "copy.within-limits": withinLimits,
  "copy.sentence-case": sentenceCase,
  "lexicon.record": lexiconRecord,
  "lexicon.claim-sourced": claimSourced,
  "narrative.sequence": narrativeSequence,
  "pattern.parts": patternParts,
});
