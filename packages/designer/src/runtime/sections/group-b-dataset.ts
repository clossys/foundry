import type { RuntimeJson } from "../../catalog-core/runtime-ports.js";
import { specimenDataset } from "../../studio/specimen-dataset.js";

/**
 * The group-b Sections bound to the one shared synthetic dataset: each leaf's content, keyed by its contract
 * slot names, derived from the dataset's people, orders, tree, list, disclosure and meter records. Values
 * are plain JSON, exactly what runtime assembly delivers as `RuntimeContent.value`. Labels a renderer owns
 * (headers, empty states, accessible names) are not content and are not here.
 *
 * The base dataset has no per-Section records yet; once the L7 `specimenDataset.sections` records land,
 * these builders read from them instead of deriving from the shared records.
 */
const { people, table, tree, list, disclosure, meter } = specimenDataset;
const orders = table.rows;
const columnKinds: Readonly<Record<string, string>> = { order: "text", customer: "text", status: "enum", items: "number", total: "text", placed: "date" };
const statusTasks: Readonly<Record<string, string>> = { Shipped: "done", Delivered: "done", Pending: "todo", Processing: "in-progress" };
const cents = (total: string): number => Math.round(Number(total.replace(/[^0-9.]/g, "")) * 100);
const money = (value: number): string => `$${(value / 100).toFixed(2)}`;
const at = (date: string): string => `${date}T09:00:00Z`;
const columns = table.columns.map(column => ({ id: column.id, label: column.label, kind: columnKinds[column.id] ?? "text", allowsSorting: column.allowsSorting }));
// Item counts are numbers in the table model (the shared records carry them as display strings).
const rows = orders.map(row => ({ ...row, items: Number(row.items) }));
const ordersBy = (name: string) => orders.filter(row => row.customer === name);
const statuses = [...new Set(orders.map(row => row.status))];
const revenue = orders.reduce((sum, row) => sum + cents(row.total), 0);
const itemCount = orders.reduce((sum, row) => sum + Number(row.items), 0);
const groupId = (status: string) => status.toLowerCase();
const pagination = { page: 1, pageCount: 1, totalItems: orders.length, pageSize: orders.length };
const treeNodes = (nodes: readonly { id: string; label: string; children?: readonly { id: string; label: string }[] }[]): RuntimeJson =>
  nodes.map((node): RuntimeJson => node.children ? { id: node.id, label: node.label, children: treeNodes(node.children) } : { id: node.id, label: node.label });

export const groupBDataset: Readonly<Record<`sections.${string}`, Readonly<Record<string, RuntimeJson>>>> = {
  "sections.access-matrix": {
    roles: people.slice(0, 3).map((person, index) => ({ id: person.id, label: person.name, ...(index === 2 ? { isLocked: true, lockedReason: `${person.name} owns the workspace.` } : {}) })),
    permissions: [
      { id: "orders", label: "Orders", permissions: [
        { id: "view-orders", label: "View orders", grants: { [people[0].id]: { state: "granted" }, [people[1].id]: { state: "granted" }, [people[2].id]: { state: "granted" } } },
        { id: "edit-orders", label: "Edit orders", grants: { [people[1].id]: { state: "granted" }, [people[2].id]: { state: "granted" } } },
        { id: "refund-orders", label: "Refund orders", description: "Returns the order total to the customer.", grants: { [people[2].id]: { state: "granted" } } },
      ] },
      { id: "customers", label: "Customers", permissions: [
        { id: "view-customers", label: "View customers", grants: { [people[0].id]: { state: "granted" }, [people[1].id]: { state: "inherited", reason: "Included with order access." }, [people[2].id]: { state: "granted" } } },
      ] },
    ],
  },
  "sections.activity-feed": {
    events: orders.map((row, index) => ({ id: `event-${row.id}`, at: at(row.placed), timeText: row.placed, actor: { name: row.customer }, summary: `${row.customer} placed order ${row.order}.`, ...(index === 0 ? { unread: true } : {}) })),
    grouping: statuses.map(status => ({ id: groupId(status), label: status, eventIds: orders.filter(row => row.status === status).map(row => `event-${row.id}`) })),
    filters: { links: [{ id: "all", label: "All activity", href: "#activity" }, ...statuses.map(status => ({ id: groupId(status), label: status, href: `#${groupId(status)}` }))] },
  },
  "sections.audit-log": {
    entries: orders.slice(0, 5).map(row => ({ id: `audit-${row.id}`, at: at(row.placed), timeText: row.placed, actor: row.customer, action: `Marked ${row.status.toLowerCase()}`, target: `Order ${row.order}` })),
    filter: { search: { label: "Search entries", placeholder: "Actor or order" } },
    export: { label: "Export entries" },
  },
  "sections.column-mapper": {
    "source-columns": table.columns.map(column => ({ id: column.id, header: column.label, samples: orders.slice(0, 2).map(row => row[column.id as keyof typeof row]) })),
    "target-fields": [
      { id: "number", label: "Order number", kind: "text", required: true },
      { id: "buyer", label: "Buyer", kind: "text", required: true },
      { id: "amount", label: "Amount", kind: "number", required: false },
      { id: "date", label: "Order date", kind: "date", required: false },
    ],
    mapping: [{ target: "number", source: "order" }, { target: "buyer", source: "customer" }, { target: "amount", source: "total" }, { target: "date", source: null }],
  },
  "sections.data-grid": {
    rows,
    cells: columns,
    pinning: [{ column: "order" }],
  },
  "sections.data-table": {
    columns,
    rows,
    sort: [{ column: table.sortDescriptor.column, direction: table.sortDescriptor.direction }],
    selection: [{ id: orders[0]!.id }],
    grouping: [{ column: "status" }],
    toolbar: { search: { label: "Filter orders", placeholder: "Order or customer" } },
    pagination,
  },
  "sections.explorer": {
    tree: { label: tree.label, nodes: treeNodes(tree.items), expanded: [...tree.defaultExpandedKeys] },
    list: { label: list.label, items: list.items.map(item => ({ id: item.id, label: item.label })) },
    selection: [{ id: tree.items[0]!.children[0]!.id }],
  },
  "sections.filter-builder": {
    fields: table.columns.map(column => ({ id: column.id, label: column.label })),
    operators: [{ id: "is", label: "is" }, { id: "is-not", label: "is not" }, { id: "contains", label: "contains" }, { id: "empty", label: "is empty", takesValue: false }],
    groups: [
      { id: "group-1", match: "all", conditions: [{ id: "group-1-1", field: "status", operator: "is", value: orders[0]!.status }] },
      { id: "group-2", match: "any", conditions: [{ id: "group-2-1", field: "customer", operator: "contains", value: people[0].name }, { id: "group-2-2", field: "placed", operator: "empty", value: "" }] },
    ],
  },
  "sections.record-detail": {
    fields: table.columns.map(column => ({ label: column.label, value: orders[0]![column.id as keyof (typeof orders)[number]] })),
    actions: [{ id: "refund", label: "Refund order" }, { id: "print", label: "Print invoice" }],
    status: orders[0]!.status,
  },
  "sections.resource-list": {
    records: people.map(person => ({ id: person.id, title: person.name, description: `${ordersBy(person.name).length} order${ordersBy(person.name).length === 1 ? "" : "s"}`, meta: ordersBy(person.name)[0]?.total ?? money(0), status: ordersBy(person.name)[0]?.status ?? "No orders" })),
    selection: [{ id: people[0].id }],
    toolbar: { label: "Customer list options", toggles: [{ id: "archived", label: "Show archived" }] },
    pagination: { page: 1, pageCount: 1, totalItems: people.length, pageSize: people.length },
  },
  "sections.stats": {
    stats: [
      { id: "orders", label: "Orders", value: String(orders.length), description: "Last 30 days" },
      { id: "revenue", label: "Revenue", value: money(revenue), description: "Last 30 days" },
      { id: "items", label: "Items sold", value: String(itemCount), description: "Last 30 days" },
      { id: "average", label: "Average order", value: money(Math.round(revenue / orders.length)), description: "Last 30 days" },
    ],
  },
  "sections.status-list": {
    items: [
      ...disclosure.items.map((item, index) => ({ id: item.id, label: item.label, detail: item.content, state: index === 0 ? "available" : "partial" })),
      { id: "pickup", label: "Store pickup", state: "planned" },
      { id: "freight", label: "Freight", disposition: "not-offered" },
    ],
    legend: "Status key",
  },
  "sections.task-list": {
    tasks: orders.slice(0, 5).map(row => ({ id: `task-${row.id}`, title: `Pack order ${row.order}`, description: row.customer, status: statusTasks[row.status] ?? "todo" })),
  },
  "sections.timeline": {
    events: [...orders].reverse().slice(0, 4).map(row => ({ id: `history-${row.id}`, at: row.placed, dateText: row.placed, heading: `Order ${row.order} placed`, description: `${row.customer}, ${row.items} items, ${row.total}.` })),
  },
  "sections.usage": {
    meters: [
      { id: "usage-orders", label: "Orders", used: orders.length, limit: 20, usedText: `${orders.length} orders`, limitText: "of 20", periodText: "This month" },
      { id: "usage-items", label: "Items shipped", used: itemCount, limit: 100, usedText: `${itemCount} items`, limitText: "of 100", periodText: "This month", thresholds: [{ at: 0.8, tone: "warning", message: "At least 80 percent of this limit is used." }] },
      { id: "usage-storage", label: meter.label, used: meter.value, limit: meter.scaleMax, usedText: meter.valueText, limitText: `of ${meter.scaleMax} GB`, periodText: "Current plan" },
    ],
  },
};
