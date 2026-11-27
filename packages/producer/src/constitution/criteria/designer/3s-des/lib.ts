/**
 * Shared reads of a Designer candidate (a shadcn-format registry item, `clossys.element` meta): its
 * meta, its files and the slot citations it carries. Pure: the subject in, values out.
 */
import { AGENT_LISTS } from "../../../../agent-lists.generated.js";
import { isRecord, strings } from "../../core/lib.js";
import type { Subject } from "../../core/types.js";

/** A slot id (section 1), with an optional `<agent>:` prefix; never a version suffix or a file path. */
export const SLOT_ID = new RegExp(String.raw`^(?:(${AGENT_LISTS.live.join("|")}):)?([a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*){1,3})$`);

/** The registry item of the subject, when it parsed as an object. */
export const itemOf = (subject: Subject): Record<string, unknown> | undefined => isRecord(subject.json) ? subject.json : undefined;

/** `meta` of the item. */
export function metaOf(subject: Subject): Record<string, unknown> | undefined {
  const meta = itemOf(subject)?.meta;
  return isRecord(meta) ? meta : undefined;
}

/** `meta.element` of the item. */
export function elementOf(subject: Subject): Record<string, unknown> | undefined {
  const element = metaOf(subject)?.element;
  return isRecord(element) ? element : undefined;
}

/** `meta.source` of the item. */
export function sourceOf(subject: Subject): Record<string, unknown> | undefined {
  const source = metaOf(subject)?.source;
  return isRecord(source) ? source : undefined;
}

/** The item's files: `{path, content}` pairs with string content. */
export function filesOf(subject: Subject): { path: string; content: string }[] {
  const files = itemOf(subject)?.files;
  if (!Array.isArray(files)) return [];
  return files.filter(isRecord).filter(file => typeof file.path === "string" && typeof file.content === "string")
    .map(file => ({ path: file.path as string, content: file.content as string }));
}

/** The source refs (a string or a list). */
export const refsOf = (source: Record<string, unknown> | undefined): string[] =>
  typeof source?.ref === "string" ? [source.ref] : strings(source?.ref);
