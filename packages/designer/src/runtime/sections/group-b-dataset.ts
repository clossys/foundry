import type { RuntimeJson } from "../../catalog-core/runtime-ports.js";
import { specimenDataset } from "../../studio/specimen-dataset.js";
import { plainJson } from "./dataset-json.js";

/**
 * The group-b Sections bound to the one shared synthetic dataset: each leaf's content, keyed by its contract
 * slot names, read from its `specimenDataset.sections` record (L7). Values are plain JSON, exactly what runtime
 * assembly delivers as `RuntimeContent.value`. Labels a renderer owns (headers, empty states, accessible names)
 * are not content and are not here; the renderers read those from the same records. Optional chrome regions
 * read their sections chrome records or the shared component records (the search field, the menu, the list).
 */
const { sections: S, searchField, menu, list } = specimenDataset;

/** The Section order table's columns, from the record's header labels; status is the one enumerated column. */
const columns = Object.entries(S.dataTable.headers).map(([id, label]) => ({ id, label, kind: id === "status" ? "enum" : "text", allowsSorting: true }));
const [firstColumn] = columns;
const rows = plainJson(S.dataTable.rows);
const firstRow = S.dataTable.rows[0]!;
const search = { search: { label: searchField.label, placeholder: searchField.placeholder } };
const wholePage = (count: number) => ({ page: 1, pageCount: 1, totalItems: count, pageSize: count });

/** Access groups with each permission carrying the role cells the sample's value grants it. */
const accessPermissions = S.accessMatrix.groups.map(group => ({
  ...group,
  permissions: group.permissions.map(permission => ({
    ...permission,
    grants: Object.fromEntries(S.accessMatrix.roles.flatMap(role => {
      const cell = S.accessMatrix.value[role.id]?.[permission.id];
      return cell ? [[role.id, cell]] : [];
    })),
  })),
}));

export const groupBDataset: Readonly<Record<`sections.${string}`, Readonly<Record<string, RuntimeJson>>>> = {
  "sections.access-matrix": {
    roles: plainJson(S.accessMatrix.roles),
    permissions: plainJson(accessPermissions),
  },
  "sections.activity-feed": {
    events: plainJson(S.activityFeed.events),
    grouping: plainJson(S.activityFeed.groups),
    filters: { links: plainJson((S.activityFeed.groups ?? []).map(group => ({ id: group.id, label: group.label, href: `#${group.id}` }))) },
  },
  "sections.audit-log": {
    entries: plainJson(S.auditLog.entries),
    filter: search,
    export: plainJson(S.auditLogExport),
  },
  "sections.column-mapper": {
    "source-columns": plainJson(S.columnMapper.sourceColumns),
    "target-fields": plainJson(S.columnMapper.targets),
    mapping: Object.entries(S.columnMapper.mapping).map(([target, source]) => ({ target, source })),
  },
  "sections.data-grid": {
    rows,
    cells: columns,
    pinning: [{ column: firstColumn!.id }],
  },
  "sections.data-table": {
    columns,
    rows,
    sort: [{ column: firstColumn!.id, direction: specimenDataset.table.sortDescriptor.direction }],
    selection: [{ id: firstRow.id }],
    grouping: [{ column: "status" satisfies keyof typeof S.dataTable.headers }],
    toolbar: search,
    pagination: wholePage(S.dataTable.rows.length),
  },
  "sections.explorer": {
    tree: { label: S.explorer.label, nodes: plainJson(S.explorer.tree), expanded: [...S.explorer.defaultExpandedIds] },
    list: { label: list.label, items: list.items.map(item => ({ id: item.id, label: item.label })) },
    selection: [{ id: S.explorer.selectedId }],
  },
  "sections.filter-builder": {
    fields: plainJson(S.filterBuilder.fields),
    operators: plainJson(S.filterBuilder.operators),
    groups: plainJson(S.filterBuilder.groups),
  },
  "sections.record-detail": {
    fields: plainJson(S.detailView.fields),
    actions: menu.items.slice(0, 2).map(item => ({ id: item.id, label: item.label })),
    status: plainJson(S.detailView.fields.find(field => field.label === S.dataTable.headers.status)?.value),
  },
  "sections.resource-list": {
    records: S.resourceList.items.map(item => plainJson({ id: item.id, title: item.title, description: item.description, meta: item.meta })),
    selection: [{ id: S.resourceList.items[0]!.id }],
    toolbar: plainJson(S.resourceListChrome.toolbar),
    pagination: wholePage(S.resourceList.items.length),
  },
  "sections.stats": {
    stats: plainJson(S.statGroup.items),
  },
  "sections.status-list": {
    // Grouped records keep each group's heading; the renderer draws them as StatusList groups.
    items: plainJson(S.statusList.groups ?? []),
    legend: plainJson(S.statusList.legendLabel),
  },
  "sections.task-list": {
    tasks: plainJson(S.taskList.items),
  },
  "sections.timeline": {
    events: plainJson(S.timeline.events),
  },
  "sections.usage": {
    meters: plainJson(S.usageSummary.meters),
  },
};
