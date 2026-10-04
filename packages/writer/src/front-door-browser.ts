/**
 * Immutable shipped English defaults for browser rendering. This entry accepts
 * only a reserved key and nouns; package defaults do not authorize consumer copy.
 * Consumer registries and approval records belong to the strict root resolver.
 */
import { CANONICAL_IDS, CANONICAL_NOUNS, createDefaultCatalog, prepareFrontDoorCopy } from "./front-door-core.js";
import type { FrontDoorKey, FrontDoorNouns, FrontDoorCopyResolution } from "./front-door-core.js";
export type { FrontDoorKey, FrontDoorNoun, FrontDoorNouns, FrontDoorCopyIssueReason, FrontDoorCopyIssue, FrontDoorCopyResolution } from "./front-door-core.js";

const defaults = createDefaultCatalog();
for (const entry of defaults.entries) {
  if (entry.placeholders) Object.freeze(entry.placeholders);
  Object.freeze(entry);
}
Object.freeze(defaults.entries);
Object.freeze(defaults.source);
Object.freeze(defaults);

/** Pure and total; each success returns independent values and provenance. */
export function resolveFrontDoorCopy(key: FrontDoorKey, nouns: FrontDoorNouns): FrontDoorCopyResolution {
  const prepared = prepareFrontDoorCopy(key, nouns, defaults, CANONICAL_IDS, CANONICAL_NOUNS);
  if (!prepared.complete) return prepared;
  const { entry, values } = prepared;
  const text = entry.text.replace(/\{([^{}]+)\}/g, (_match, name: string) => String(values[name]!));
  return {
    complete: true, text, issues: [], resolution: {
      ref: { id: key, values }, text, recordId: defaults.id, revision: defaults.revision,
      locale: defaults.locale, source: { ...defaults.source! }, entryId: entry.id,
    }
  };
}
