/**
 * The composed Designer slots (FCR): a frames.* or sections.* slot with no reference adoptable in the selected style
 * and engine, whose contract fixture is the file and export of its own pinned, certified composition. The derive
 * (reference-fixtures.ts `planReferenceFixtures`) names them in the generated gaps document; this module only reads
 * that document, so the slot model, the certifier and the conform probe share the derived set without importing the
 * Designer checks (which import the slot model back).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveAgent } from "../agents.js";

/** The derived gaps document, relative to the Designer package root (generated; never hand-edited). */
export const GAPS_FILE = "src/catalog/contract-fixture-gaps.json";

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** The composed section and frame slots the Designer package's derived gaps document names; none when it is absent. */
export function composedSlots(designerRoot: string): ReadonlySet<string> {
  const path = join(designerRoot, GAPS_FILE);
  const doc: unknown = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : undefined;
  const rows = object(doc) && Array.isArray(doc.composed) ? doc.composed : [];
  return new Set(rows.filter(object).map(row => row.slot).filter((slot): slot is string => typeof slot === "string"));
}

let packageComposed: ReadonlySet<string> | undefined;
/** The installed Designer package's composed slots (`composedSlots`), read once per process. */
export function designerComposedSlots(): ReadonlySet<string> {
  return packageComposed ??= composedSlots(resolveAgent("designer").packageRoot);
}
