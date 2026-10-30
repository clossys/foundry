/** Synthetic editorial fixture for the registered Cards specimen, never consumer copy. */
export function blogSpecimenRecords<T extends { readonly id: string; readonly title: unknown }>(records: readonly T[]) {
  return records.map((record, index) => ({
    ...record,
    badge: { label: "Journal", variant: "neutral" as const },
    editorial: {
      author: { name: "Studio author", label: "By" },
      readingTime: { value: `${index + 3} minutes`, label: "Reading time" },
      tags: [{ id: "journal", label: "Journal" }],
    },
  }));
}
