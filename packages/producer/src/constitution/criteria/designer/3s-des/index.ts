/**
 * The Designer standards' criteria (unit 3S-DES, ST-Des1 and ST-Des2). `index.json` in this folder
 * is the registry of record (R15.3); this map is its static twin, which certification resolves
 * synchronously (certify/requirements.ts). The folder test holds the two equal both ways.
 */
import { composeLayers } from "./compose.js";
import { directorDerived } from "./derive.js";
import { sourceRef } from "./source.js";
import { assetSvgFiles } from "./svgfiles.js";
import { tokenDtcg } from "./token.js";
import type { Criterion } from "../../core/types.js";

export const DESIGNER_STANDARD_CRITERIA: Readonly<Record<string, Criterion>> = Object.freeze({
  "derive.director": directorDerived,
  "source.ref": sourceRef,
  "token.dtcg": tokenDtcg,
  "asset.svg-files": assetSvgFiles,
  "compose.layers": composeLayers,
});
