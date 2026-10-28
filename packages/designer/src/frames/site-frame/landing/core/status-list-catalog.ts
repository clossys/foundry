import { SECTIONED_VIEW_CONTENT_CONTRACT } from "./content-contract.js";

type Readiness = "available" | "partial" | "planned";
type StatusRow<T> = { id: string; label: T; detail?: T } & (
  | { state: Readiness; disposition?: never }
  | { disposition: "not-offered"; state?: never }
);
type StatusSource<T> = {
  labels: Record<Readiness, T> & { dispositions: Record<"not-offered", T> };
  items?: readonly StatusRow<T>[];
  groups?: readonly { id: string; heading: T; items: readonly StatusRow<T>[] }[];
};
const READINESS_TONES = { available: "success", partial: "warning", planned: "info" } as const;

/** Package-private projection. Callers validate the complete original status shape first. */
export function projectStatusListItems<T>(source: StatusSource<T>) {
  const rows = source.items ?? source.groups!.flatMap(group => group.items);
  // Status lookup starts at three; the shared row ceiling and every other Items cap stay unchanged.
  if (rows.length < 3 || rows.length > SECTIONED_VIEW_CONTENT_CONTRACT.counts.rows[1])
    throw new Error("A status-list catalog lookup needs three to eight entries.");
  return {
    type: "items" as const,
    recipe: "topics" as const,
    arrangement: "rows" as const,
    columns: 1 as const,
    order: "none" as const,
    reveal: "all" as const,
    treatment: "rule" as const,
    scale: "item" as const,
    items: rows.map(row => ({
      id: row.id,
      heading: row.label,
      ...(row.detail === undefined ? {} : { description: row.detail }),
      badge: row.disposition === "not-offered"
        ? { label: source.labels.dispositions["not-offered"], tone: "neutral" as const }
        : { label: source.labels[row.state!], tone: READINESS_TONES[row.state!] },
    })),
    ...(source.groups === undefined ? {} : {
      groups: source.groups.map(group => ({ id: group.id, label: group.heading, items: group.items.map(row => row.id) })),
    }),
  };
}
