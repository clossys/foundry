/**
 * The one reader of a parsed JSON candidate view's source kind (`meta.source.kind`). A leaf module (no imports), so the
 * write guard (constitution/guard.ts) reads it without joining the records import graph; records/slot-current.ts
 * re-exports it beside viewSourceKind and submissionSources.
 */
const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** The source kind of a parsed JSON candidate view (`meta.source.kind`): what the write guard's ref-verbatim gate reads (constitution/guard.ts). */
export function sourceKindOf(view: unknown): string | undefined {
  const meta = object(view) && object(view.meta) ? view.meta : undefined;
  return meta && object(meta.source) && typeof meta.source.kind === "string" ? meta.source.kind : undefined;
}
