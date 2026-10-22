/** Compiled public contract assertions; this file is not a runtime test. */
import type { DataTableViewModel } from "@clossys/designer/blocks";
import { IndexView, type IndexViewCollection, type IndexViewProps } from "./IndexView.js";

type Row = { id: string; name: string };
const props: IndexViewProps<Row> = {
  rows: [], collectionLabel: "Records",
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
// @ts-expect-error page descriptions belong in AppFrame page
export const renamedSubtitle = <IndexView {...props} description="Supporting copy" />;

declare const model: DataTableViewModel;
// A saved table view, its host copy and controlled group expansion reach DataTable without a cast.
export const modelTable = <IndexView {...props} table={{
  model, onModelChange: next => { void next.mode; }, messages: { viewOptionsLabel: "Table settings" },
  expandedGroupKeys: new Set(["Available"]), onExpandedGroupKeysChange: keys => { void keys.size; },
}} />;
export const expandAll = <IndexView {...props} table={{ model, onModelChange: () => {}, expandedGroupKeys: "all" }} />;
// @ts-expect-error a model is a complete saved-view envelope, not an arbitrary object
export const rawModel = <IndexView {...props} table={{ model: { mode: "flat" } }} />;
// @ts-expect-error group expansion keys are strings
export const numericGroupKeys = <IndexView {...props} table={{ expandedGroupKeys: new Set([1]) }} />;

export type IndexEntryParity = [
  import("./index.js").IndexViewProps<Row>,
  import("../index.js").IndexViewProps<Row>,
  import("../client.js").IndexViewProps<Row>,
  import("../server.js").IndexViewProps<Row>,
];

// @ts-expect-error page titles belong in AppFrame page
export const pageTitle = <IndexView {...props} title="Records" />;
// @ts-expect-error page descriptions belong in AppFrame page
export const pageSubtitle = <IndexView {...props} subtitle="All records" />;
// @ts-expect-error page actions belong in AppFrame page
export const pageActions = <IndexView {...props} actions={null} />;
// @ts-expect-error collection naming is explicit and required
export const unnamed = <IndexView rows={[]} rowKey={props.rowKey} columns={props.columns} empty={props.empty} />;

type Assert<T extends true> = T;
type NoPageProps<T> = Extract<keyof T, "title" | "subtitle" | "actions"> extends never ? true : false;
export type ContentOnlyIndexEntries = [
  Assert<NoPageProps<import("./index.js").IndexViewProps<Row>>>,
  Assert<NoPageProps<import("./server.js").IndexViewProps<Row>>>,
  Assert<NoPageProps<import("../index.js").IndexViewProps<Row>>>,
  Assert<NoPageProps<import("../client.js").IndexViewProps<Row>>>,
  Assert<NoPageProps<import("../server.js").IndexViewProps<Row>>>,
];
