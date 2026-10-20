/** Compiled public contract assertions; this file is not a runtime test. */
import { IndexView, type IndexViewCollection, type IndexViewProps } from "./IndexView.js";

type Row = { id: string; name: string };
const props: IndexViewProps<Row> = {
  title: "Records", subtitle: "All current records.", rows: [], collectionLabel: "Records",
  rowKey: row => row.id, columns: [{ id: "name", header: "Name", isRowHeader: true, cell: row => row.name }],
  empty: { title: "No records" },
  rowRoute: { href: row => `/records/${row.id}`, onNavigate: (href, row) => { void [href, row.id]; } },
};
export const index = <IndexView {...props} />;
export const panel: IndexViewCollection = { kind: "panel", props: { children: "Record collection" } };
// @ts-expect-error collection slots require a typed Block entry
export const rawCollection: IndexViewCollection = <div />;
// @ts-expect-error a route must report its activation
export const silentRoute: IndexViewProps<Row>["rowRoute"] = { href: row => `/records/${row.id}` };
// @ts-expect-error IndexView does not own frame chrome
export const chrome = <IndexView {...props} header={<header />} />;
// @ts-expect-error arbitrary page children bypass the Block composition
export const rawChildren = <IndexView {...props}><div /></IndexView>;
// @ts-expect-error a view exposes subtitle; PageHeader owns the description prop
export const renamedSubtitle = <IndexView {...props} description="Supporting copy" />;

export type IndexEntryParity = [
  import("./index.js").IndexViewProps<Row>,
  import("../index.js").IndexViewProps<Row>,
  import("../client.js").IndexViewProps<Row>,
  import("../server.js").IndexViewProps<Row>,
];
