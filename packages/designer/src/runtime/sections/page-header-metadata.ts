import type { EditorialMetadata } from "../../blocks/PageHeaderMetadata.js";
import { isObject, recordsOf, stringField, type RuntimeObject } from "./group-c-content.js";
import type { RuntimeJson } from "../../catalog-core/runtime-ports.js";

/** The same Writer-owned metadata shape is used by editorial headers and cards. */
export function editorialMetadata(value: RuntimeJson | undefined): EditorialMetadata | undefined {
  if (value === undefined) return undefined;
  if (!isObject(value)) throw new TypeError("Editorial metadata must be a record");
  const required = (row: RuntimeObject, key: string) => {
    const text = stringField(row, key);
    if (!text?.trim()) throw new TypeError(`Editorial metadata requires ${key}`);
    return text;
  };
  const named = (key: "author" | "date" | "readingTime", field: "name" | "value") => {
    const row = value[key];
    if (row === undefined) return undefined;
    if (!isObject(row)) throw new TypeError(`Editorial metadata ${key} must be a record`);
    return { [field]: required(row, field), ...(row.label !== undefined ? { label: required(row, "label") } : {}), ...(key === "author" && row.href !== undefined ? { href: required(row, "href") } : {}) };
  };
  const author = named("author", "name") as EditorialMetadata["author"];
  const date = named("date", "value") as EditorialMetadata["date"];
  const readingTime = named("readingTime", "value") as EditorialMetadata["readingTime"];
  const tags = value.tags === undefined ? undefined : recordsOf("editorial", "tags", value.tags).map(row => ({ id: required(row, "id"), label: required(row, "label"), ...(row.href !== undefined ? { href: required(row, "href") } : {}) }));
  const outcomeStats = value.outcomeStats === undefined ? undefined : recordsOf("editorial", "outcomeStats", value.outcomeStats).map(row => ({ id: required(row, "id"), label: required(row, "label"), value: required(row, "value") }));
  return { author, date, readingTime, tags, outcomeStats, ...(value.summary !== undefined ? { summary: required(value, "summary") } : {}) };
}
