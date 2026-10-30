import { parseLinkRef, positiveInteger } from "@clossys/strategist/cell-format/schema";
import type { RecordBase } from "./types.js";

/** Native citation shape only; derivation checks current source lines and cell links. */
export function isDirectorSource(value: unknown): value is NonNullable<RecordBase["directorSources"]>[number] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const source = value as Record<string, unknown>;
  return Object.hasOwn(source, "ref") && Object.hasOwn(source, "line")
    && Object.keys(source).every(key => key === "ref" || key === "line")
    && typeof source.ref === "string" && parseLinkRef(source.ref)?.agent === "director"
    && positiveInteger(source.line);
}
