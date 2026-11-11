/**
 * The archetype record: which archetype's extra core cells join the default core. It is one
 * Director evidence finding, `<consumer>/evidence/director/director-archetype.md`, written only by
 * `clossys director check archetype <name> --by owner[:<ref>]` (the clossys CLI traces that run as
 * step `director.store`, so the write leaves a run record). Without the record the core is the
 * default archetype's; a record naming an unknown archetype or a non-owner decider is a root issue.
 */
import type { StrategyCatalog } from "./catalog.js";
import type { Finding } from "./format/types.js";

export const ARCHETYPE_RECORD_ID = "director-archetype";
/** The archetype is an owner decision: `owner` or `owner:<ref>`. */
export const ARCHETYPE_DECIDER = /^owner(?::\S.*)?$/;

export function archetypeNames(catalog: StrategyCatalog): string[] {
  return ["default", ...Object.keys(catalog.archetypes.extras)];
}

/** The recorded archetype, or a reason the record is not usable; undefined when there is no record. */
export function recordedArchetype(findings: readonly Finding[], catalog: StrategyCatalog): { ok: true; archetype: string; by: string } | { ok: false; message: string } | undefined {
  const record = findings.find(finding => finding.id === ARCHETYPE_RECORD_ID);
  if (!record) return undefined;
  if (typeof record.value !== "string" || !archetypeNames(catalog).includes(record.value))
    return { ok: false, message: `value must be one of ${archetypeNames(catalog).join(", ")}` };
  if (!ARCHETYPE_DECIDER.test(record.by)) return { ok: false, message: "by must be owner or owner:<ref>: the archetype is an owner decision" };
  return { ok: true, archetype: record.value, by: record.by };
}

/** The record's bytes, in the finding format the evidence reader parses. */
export function archetypeRecord(archetype: string, by: string, observed: string): string {
  return `---\nid: ${ARCHETYPE_RECORD_ID}\nsource: user\nobserved: ${observed}\nby: ${by}\nvalue: ${archetype}\n---\n- Archetype ${archetype}, decided by ${by}: its extra core cells join the default core.\n`;
}
