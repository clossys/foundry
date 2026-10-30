import type { ContentMapBodyContainer, ContentMapBodyContainerBinding, ContentMapPageBody } from "./contract.js";

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const fields = (value: object, keys: readonly string[]) => Object.keys(value).every(key => keys.includes(key));
const COLUMNS = ["title", "specimen", "status", "version", "usedBy", "linkOut"] as const;

/** Identity syntax only. The consuming Designer checker owns registration. */
export function isContentMapSpecimenId(value: unknown): value is `sections.specimen-${string}` {
  return typeof value === "string" && /^sections\.specimen-[a-z][a-z0-9-]*$/.test(value);
}

function isContainerBinding(value: unknown): value is ContentMapBodyContainerBinding {
  if (!record(value)) return false;
  return value.section === "sections.data-table" && fields(value, ["section"])
    || value.section === "sections.cards" && fields(value, ["section", "mode"]) && (value.mode === "stack" || value.mode === "grid");
}

function isContainer(value: unknown): value is ContentMapBodyContainer {
  if (isContainerBinding(value)) return true;
  if (!record(value) || !fields(value, ["byLayer"]) || !record(value.byLayer)) return false;
  const layers = Object.entries(value.byLayer);
  return layers.length > 0 && layers.every(([layer, binding]) => /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(layer) && isContainerBinding(binding));
}

export function isContentMapPageBody(value: unknown): value is ContentMapPageBody {
  if (!record(value) || !fields(value, ["template", "bands", "container", "row"]) || value.template !== "ia-scroll"
    || !record(value.bands) || !fields(value.bands, ["L0", "L1"])
    || value.bands.L0 !== "sections.section-header" || value.bands.L1 !== "sections.section-header"
    || !isContainer(value.container)
    || !record(value.row) || !fields(value.row, ["specimen", "columns"])
    || Object.hasOwn(value.row, "specimen") && !isContentMapSpecimenId(value.row.specimen)
    || !Array.isArray(value.row.columns) || value.row.columns.length !== COLUMNS.length) return false;
  const columns = value.row.columns;
  return COLUMNS.every((column, index) => columns[index] === column);
}
