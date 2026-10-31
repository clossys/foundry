import type { ContentMap, ContentMapEntry, ContentMapFinding, ContentMapNode } from "./contract.js";

const segment = (value: unknown): value is string => typeof value === "string" && /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value);
const title = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.trim() === value;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const reserved = new Set(["settings", "__specimen", "sign-in", "auth"]);

/** Validate collection inputs before any traversal or route expansion. */
export function checkCollections(map: ContentMap): ContentMapFinding[] {
  const findings: ContentMapFinding[] = [];
  const ids = new Set(map.entries.filter(record).map(entry => entry.id));
  const paths = new Set(map.entries.filter(record).map(entry => entry.path ?? `/${entry.slug}`));
  for (const entry of map.entries) {
    if (!record(entry)) continue;
    const add = (message: string) => findings.push({ severity: "P0", code: "contract", path: `entries.${entry.id}.collection`, entryId: entry.id, message });
    if (entry.kind !== "collection") { if (entry.collection !== undefined) add("Only collection entries declare a collection"); continue; }
    const value = entry.collection;
    if (map.format !== "web.page.responsive" || !record(value) || Object.keys(value).some(key => !["agent", "groups", "leaves"].includes(key))
      || !segment(value.agent) || reserved.has(value.agent) || (entry.path ?? `/${entry.slug}`) !== `/${value.agent}`
      || entry.parentId !== undefined || !record(entry.source) || typeof entry.source.frameId !== "string"
      || !Array.isArray(value.groups) || !Array.isArray(value.leaves)) { add("A collection requires a nonreserved agent, gallery path, frame template and slot IA"); continue; }
    const groups = value.groups;
    const groupIds = new Set<string>(), anchors = new Set<string>(), slugs = new Set<string>();
    for (const [kind, rows] of [["group", groups], ["leaf", value.leaves]] as const) {
      for (const row of rows) {
        if (!record(row) || Object.keys(row).some(key => !["id", "title", "parentId", "order", kind === "group" ? "anchor" : "slug"].includes(key))
          || !title(row.id) || !title(row.title) || !Number.isSafeInteger(row.order) || (row.order as number) < 0
          || row.parentId !== undefined && !title(row.parentId) || !segment(kind === "group" ? row.anchor : row.slug)) { add("Invalid collection member"); continue; }
        if (ids.has(row.id)) add("Collection member identity collides with a map entry or member");
        ids.add(row.id);
        if (kind === "group") {
          groupIds.add(row.id);
          if (anchors.has(row.anchor as string)) add("Collection group anchors must be unique per agent");
          anchors.add(row.anchor as string);
        } else {
          if (slugs.has(row.slug as string)) add("Collection leaf slugs must be unique per agent");
          slugs.add(row.slug as string);
          const path = `/${value.agent}/${row.slug}`;
          if (paths.has(path)) add("Collection leaf route collides with a mapped path");
          paths.add(path);
        }
      }
    }
    for (const row of [...groups, ...value.leaves]) {
      if (!record(row)) continue;
      const seen = new Set<unknown>([row.id]);
      let parent = row.parentId;
      let depth = 0;
      while (parent !== undefined) {
        if (!groupIds.has(parent as string) || seen.has(parent)) { add("Collection group ancestry must reach its agent without cycles"); break; }
        seen.add(parent);
        depth++;
        if (depth > (groups.includes(row) ? 2 : 3)) { add("Collection groups are limited to L0 through L2"); break; }
        parent = groups.find(group => record(group) && group.id === parent)?.parentId;
      }
    }
  }
  return findings;
}

/** Expand only validated collections. Template identity is preserved in source;
 * group ancestry influences navigation, never the leaf's stable route. */
export function expandCollections(map: ContentMap): ContentMap {
  return { ...map, entries: map.entries.flatMap((entry): ContentMapNode[] => {
    if (entry.kind !== "collection") return [entry];
    const { collection: value, ...template } = entry;
    const source = template.source;
    const gallery: ContentMapEntry = { ...template, kind: "page" };
    return [gallery,
      ...value!.groups.map(group => ({ id: group.id, title: group.title, order: group.order, parentId: group.parentId ?? entry.id, kind: "group" as const, path: `/${value!.agent}#${group.anchor}`, source, ...(entry.pin ? { pin: { nav: true as const } } : {}) })),
      ...value!.leaves.map(leaf => ({ ...template, id: leaf.id, title: leaf.title, order: leaf.order, parentId: leaf.parentId ?? entry.id, kind: "page" as const, path: `/${value!.agent}/${leaf.slug}`, slug: undefined })),
    ];
  }) };
}
