import type { SpecimenDataset } from "./specimen-dataset.js";

/**
 * Synthetic editorial fixture for the registered Cards specimen, never consumer copy. Every value is read from the
 * shared dataset's `recordEditorial` record; record `index` takes that record's reading time.
 */
export function blogSpecimenRecords<T extends { readonly id: string; readonly title: unknown }>(records: readonly T[], editorial: SpecimenDataset["sections"]["recordEditorial"]) {
  return records.map((record, index) => {
    const readingTime = editorial.readingTimes[index];
    if (readingTime === undefined) throw new TypeError(`recordEditorial has no reading time for record ${record.id}`);
    return {
      ...record,
      badge: { label: editorial.badge, variant: "neutral" as const },
      editorial: {
        author: { name: editorial.author.name, label: editorial.author.label },
        "reading-time": { value: readingTime, label: editorial.readingTimeLabel },
        tags: editorial.tags.map(tag => ({ id: tag.id, label: tag.label })),
      },
    };
  });
}
