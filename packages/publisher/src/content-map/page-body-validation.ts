import type { ContentMapPageBody } from "./contract.js";

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const fields = (value: object, keys: readonly string[]) => Object.keys(value).every(key => keys.includes(key));
const COLUMNS = ["title", "specimen", "status", "version", "usedBy", "linkOut"] as const;

/** Identity syntax only. The consuming Designer checker owns registration. */
export function isContentMapSpecimenId(value: unknown): value is `sections.specimen-${string}` {
  return typeof value === "string" && /^sections\.specimen-[a-z][a-z0-9-]*$/.test(value);
}

export function isContentMapPageBody(value: unknown): value is ContentMapPageBody {
  if (!record(value) || !fields(value, ["template", "bands", "row"]) || value.template !== "ia-scroll"
    || !record(value.bands) || !fields(value.bands, ["L0", "L1", "L2"])
    || value.bands.L0 !== "sections.section-header" || value.bands.L1 !== "sections.section-header"
    || value.bands.L2 !== "sections.cards"
    || !record(value.row) || !fields(value.row, ["specimen", "columns"])
    || Object.hasOwn(value.row, "specimen") && !isContentMapSpecimenId(value.row.specimen)
    || !Array.isArray(value.row.columns) || value.row.columns.length !== COLUMNS.length) return false;
  const columns = value.row.columns;
  return COLUMNS.every((column, index) => columns[index] === column);
}
