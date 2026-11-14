/**
 * The core criteria by id (section 5a "Core criteria", 5b mechanical taste checks). `index.json` in
 * this folder is the registry of record (R15.3); this map is its static twin, and the catalog test
 * holds the two equal both ways.
 */
import { clean, terms } from "./lexicon.js";
import { apgRoles, citationGrammar, composesAllowed, icuValid, propsDeclared } from "./markup.js";
import { noRaster, smallSize, svgModes, svgViewbox } from "./svg.js";
import { nonempty, noPlaceholder, plainVerbs, readingGrade, sentenceCount, voiceRules, wordLimit } from "./text.js";
import {
  colorContrast, gridAligned, restraintCounts, spaceOnScale, tokensOnly, typeLevels, typeMeasure, typeOnScale,
} from "./design.js";
import type { Criterion } from "./types.js";

export const CORE_CRITERIA: Readonly<Record<string, Criterion>> = Object.freeze({
  "text.nonempty": nonempty,
  "text.word-limit": wordLimit,
  "text.sentence-count": sentenceCount,
  "text.reading-grade": readingGrade,
  "text.voice-rules": voiceRules,
  "text.plain-verbs": plainVerbs,
  "text.no-placeholder": noPlaceholder,
  "lexicon.clean": clean,
  "lexicon.terms": terms,
  "citation.grammar": citationGrammar,
  "icu.valid": icuValid,
  "props.declared": propsDeclared,
  "composes.allowed": composesAllowed,
  "apg.roles": apgRoles,
  "svg.viewbox": svgViewbox,
  "svg.modes": svgModes,
  "render.small-size": smallSize,
  "svg.no-raster": noRaster,
  "space.on-scale": spaceOnScale,
  "type.on-scale": typeOnScale,
  "type.levels": typeLevels,
  "type.measure": typeMeasure,
  "color.contrast": colorContrast,
  "grid.aligned": gridAligned,
  "tokens.only": tokensOnly,
  "restraint.counts": restraintCounts,
});

export type { Criterion, CriterionCase, CriterionEntry, Params, Subject } from "./types.js";
