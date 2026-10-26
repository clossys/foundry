/**
 * Preview renderers for Foundry Section and Frame package exports that carry
 * structured data (tables, lists, tiers, a modal sheet). Each entry renders the
 * real block export the pointer names with the sample content in
 * surface-preview-sample-content.ts. Preview only: never adoption or
 * conformance evidence.
 */
import type { ReactNode } from "react";
import { Button } from "../components/Button.js";
import { TextField } from "../components/TextField.js";
import { ContentSection } from "../blocks/ContentSection.js";
import { DataTable } from "../blocks/DataTable.js";
import { Drawer } from "../blocks/Drawer.js";
import { Form } from "../blocks/Form.js";
import { Matrix } from "../blocks/Matrix.js";
import { PricingTable } from "../blocks/PricingTable.js";
import { ResourceList } from "../blocks/ResourceList.js";
import { StatusList } from "../blocks/StatusList.js";
import { TaskList } from "../blocks/TaskList.js";
import { AppNavigation } from "../blocks/AppNavigation.js";
import { appSidebarSample } from "./surface-preview-sample-content.js";
import { comparisonSample, contentSample, dataTableSample, formSample, pricingSample, resourceListSample, sheetSample, statusListSample, taskListSample, type SampleOrder } from "./surface-preview-sample-content.js";

const noop = () => {};
const ORDER_COLUMNS = (["id", "customer", "status", "total"] as const).map(id => ({ id, header: dataTableSample.headers[id], cell: (row: SampleOrder) => row[id], isRowHeader: id === "id" }));

/** Samples keyed by the export name inside `@clossys/designer/blocks`. */
export const STRUCTURED_BLOCK_SAMPLES: Readonly<Record<string, () => ReactNode>> = {
  Matrix: () => <Matrix {...comparisonSample} />,
  ContentSection: () => <ContentSection eyebrow={contentSample.eyebrow} heading={contentSample.heading} description={contentSample.description}><p>{contentSample.body}</p></ContentSection>,
  DataTable: () => <DataTable<SampleOrder> aria-label={dataTableSample.label} rows={dataTableSample.rows} rowKey={row => row.id} columns={ORDER_COLUMNS} />,
  Form: () => <Form heading={formSample.heading} onSubmit={event => event.preventDefault()} actions={<Button type="submit">{formSample.submit}</Button>}>
    {formSample.fields.map(field => <TextField key={field.id} label={field.label} type={field.type} />)}
  </Form>,
  PricingTable: () => <PricingTable heading={pricingSample.heading} tiers={pricingSample.tiers.map(({ cta, featured, ...tier }) => ({ ...tier, isHighlighted: featured, cta: <Button variant={featured ? "primary" : "secondary"}>{cta}</Button> }))} />,
  ResourceList: () => <ResourceList {...resourceListSample} onAction={noop} />,
  StatusList: () => <StatusList {...statusListSample} />,
  TaskList: () => <TaskList {...taskListSample} />,
  // A modal sheet previews closed: its trigger opens the real sheet over the board.
  Drawer: () => <Drawer heading={sheetSample.heading} closeLabel={sheetSample.closeLabel} placement="end" wide="sheet" trigger={<Button variant="secondary">{sheetSample.trigger}</Button>}>
    <p>{sheetSample.body}</p>
  </Drawer>,
};

/** vf34: the app sidebar frame renders the real AppNavigation docked, with a sample tree. Separate from the structured samples above. */
export const APP_SIDEBAR_SAMPLES: Readonly<Record<string, () => ReactNode>> = {
  AppNavigation: () => <AppNavigation {...appSidebarSample} />,
};
