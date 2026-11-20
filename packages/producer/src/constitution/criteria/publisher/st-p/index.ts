/**
 * The Publisher criteria (ST-P) by id. `index.json` in this folder is the registry of record (R15.3);
 * this map is its static twin for synchronous certification, and agents.test.ts holds the two equal.
 */
import type { Criterion } from "../../core/types.js";
import { assembled, noInlineCopy, routes } from "./page.js";
import { manifest } from "./release.js";

export const PUBLISHER_CRITERIA: Readonly<Record<string, Criterion>> = Object.freeze({
  "page.assembled": assembled,
  "page.no-inline-copy": noInlineCopy,
  "publication.routes": routes,
  "release.manifest": manifest,
});
