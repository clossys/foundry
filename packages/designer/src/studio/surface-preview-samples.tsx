/**
 * Preview renderers for Foundry Section and Frame package exports that carry
 * structured data (tables, lists, tiers, a modal sheet). Each entry renders the
 * real block export the pointer names with the sample content
 * surface-preview-sample-content.ts addresses in the shared dataset. Preview only: never adoption or
 * conformance evidence.
 */
import { useState, type ReactNode } from "react";
import { Button } from "../components/Button.js";
import { SemanticContent } from "../components/SemanticContent.js";
import { TextField } from "../components/TextField.js";
import { Chat } from "../blocks/chat/Chat.js";
import { CommandMenu } from "../blocks/CommandMenu.js";
import { ContentSection } from "../blocks/ContentSection.js";
import { DataTable } from "../blocks/DataTable.js";
import { Drawer } from "../blocks/Drawer.js";
import { Explorer } from "../blocks/Explorer.js";
import { Form } from "../blocks/Form.js";
import { Hero } from "../blocks/Hero.js";
import { Matrix } from "../blocks/Matrix.js";
import { NewsletterBand } from "../blocks/NewsletterBand.js";
import { PricingTable } from "../blocks/PricingTable.js";
import { ResourceList } from "../blocks/ResourceList.js";
import { StatusList } from "../blocks/StatusList.js";
import { TaskList } from "../blocks/TaskList.js";
import { AppNavigation } from "../blocks/AppNavigation.js";
import { AppFrame } from "../frames/AppFrame.js";
import { ErrorState } from "../blocks/ErrorState.js";
import { appFrameSample, appSidebarSample, chatSample, commandSample, comparisonSample, contentSample, dataTableSample, explorerSample, formSample, heroSample, newsletterSample, pricingSample, resourceListSample, sheetSample, statusListSample, surfaceStateSample, taskListSample, type SampleOrder, type SurfaceSampleState } from "./surface-preview-sample-content.js";

const noop = () => {};
const ORDER_COLUMNS = (["id", "customer", "status", "total"] as const).map(id => ({ id, header: dataTableSample.headers[id], cell: (row: SampleOrder) => row[id], isRowHeader: id === "id" }));

/** The command menu is a controlled overlay: it previews closed, and its opener shows the real menu over the board. */
function CommandMenuPreview() {
  const [isOpen, setOpen] = useState(false), [query, setQuery] = useState("");
  const { trigger, ...menu } = commandSample;
  return <>
    <Button variant="secondary" onPress={() => setOpen(true)}>{trigger}</Button>
    <CommandMenu {...menu} isOpen={isOpen} onOpenChange={setOpen} query={query} onQueryChange={setQuery} />
  </>;
}

/** Samples keyed by the export name inside `@clossys/designer/blocks`. */
export const STRUCTURED_BLOCK_SAMPLES: Readonly<Record<string, () => ReactNode>> = {
  Matrix: () => <Matrix {...comparisonSample} />,
  ContentSection: () => <ContentSection eyebrow={contentSample.eyebrow} heading={contentSample.heading} description={contentSample.description}><SemanticContent as="p">{contentSample.body}</SemanticContent></ContentSection>,
  DataTable: () => <DataTable<SampleOrder> aria-label={dataTableSample.label} rows={dataTableSample.rows} rowKey={row => row.id} columns={ORDER_COLUMNS} />,
  Form: () => <Form heading={formSample.heading} onSubmit={event => event.preventDefault()} actions={<Button type="submit">{formSample.submit}</Button>}>
    {formSample.fields.map(field => <TextField key={field.id} label={field.label} type={field.type} />)}
  </Form>,
  PricingTable: () => <PricingTable heading={pricingSample.heading} tiers={pricingSample.tiers.map(({ cta, featured, ...tier }) => ({ ...tier, isHighlighted: featured, cta: <Button variant={featured ? "primary" : "secondary"}>{cta}</Button> }))} />,
  ResourceList: () => <ResourceList {...resourceListSample} onAction={noop} />,
  StatusList: () => <StatusList {...statusListSample} />,
  TaskList: () => <TaskList {...taskListSample} />,
  Chat: () => <Chat label={chatSample.label} placeholder={chatSample.placeholder} messages={chatSample.messages} suggestions={chatSample.suggestions} status="idle" onSend={noop} onSuggest={noop} />,
  Explorer: () => <Explorer label={explorerSample.label} tree={explorerSample.tree} selectedId={explorerSample.selectedId} defaultExpandedIds={explorerSample.defaultExpandedIds} onSelect={noop} renderDetails={node => explorerSample.details[node.id]} />,
  Hero: () => <Hero eyebrow={heroSample.eyebrow} heading={heroSample.heading} description={heroSample.description} headingLevel={heroSample.headingLevel}
    actions={<><Button>{heroSample.primary}</Button><Button variant="secondary">{heroSample.secondary}</Button></>} />,
  NewsletterBand: () => <NewsletterBand aria-label={newsletterSample.label} emailLabel={newsletterSample.emailLabel} submitLabel={newsletterSample.submitLabel} pendingLabel={newsletterSample.pendingLabel}
    sentMessage={newsletterSample.sentMessage} failedMessage={newsletterSample.failedMessage} privacyNote={newsletterSample.privacyNote} onSubmit={noop} />,
  CommandMenu: () => <CommandMenuPreview />,
  // A modal sheet previews closed: its trigger opens the real sheet over the board.
  Drawer: () => <Drawer heading={sheetSample.heading} closeLabel={sheetSample.closeLabel} placement="end" wide="sheet" trigger={<Button variant="secondary">{sheetSample.trigger}</Button>}>
    <SemanticContent as="p">{sheetSample.body}</SemanticContent>
  </Drawer>,
};

/** A non-default sample state renderer per supported state; an absent state means the export keeps its default sample. */
export type SurfaceStateSamples = Readonly<Record<string, Partial<Record<Exclude<SurfaceSampleState, "default">, () => ReactNode>>>>;

const LONG_ORDER: SampleOrder = { id: surfaceStateSample.longOrderId, customer: surfaceStateSample.longCustomer, status: surfaceStateSample.longDescription, total: surfaceStateSample.longTotal };
const LONG_RESOURCE = { id: surfaceStateSample.longResourceId, textValue: surfaceStateSample.longTitle, title: surfaceStateSample.longTitle, description: surfaceStateSample.longDescription, meta: surfaceStateSample.longMeta };

/**
 * vf35: the structured exports' own empty, loading, error and long-content states, keyed like
 * STRUCTURED_BLOCK_SAMPLES. Each renders the same real export through the props it documents for that state.
 */
export const STRUCTURED_BLOCK_STATE_SAMPLES: SurfaceStateSamples = {
  DataTable: {
    empty: () => <DataTable<SampleOrder> aria-label={dataTableSample.label} rows={[]} rowKey={row => row.id} columns={ORDER_COLUMNS} emptyStateTitle={surfaceStateSample.tableEmpty.title} emptyStateDescription={surfaceStateSample.tableEmpty.description} />,
    loading: () => <DataTable<SampleOrder> aria-label={dataTableSample.label} rows={[]} rowKey={row => row.id} columns={ORDER_COLUMNS} isLoading />,
    "long-content": () => <DataTable<SampleOrder> aria-label={dataTableSample.label} rows={[...dataTableSample.rows, LONG_ORDER]} rowKey={row => row.id} columns={ORDER_COLUMNS} />,
  },
  ResourceList: {
    empty: () => <ResourceList {...resourceListSample} items={[]} onAction={noop} />,
    loading: () => <ResourceList {...resourceListSample} isLoading loadingLabel={surfaceStateSample.loadingLabel} onAction={noop} />,
    error: () => <ResourceList {...resourceListSample} error={<ErrorState kind="failure" title={surfaceStateSample.error.title} description={surfaceStateSample.error.description} />} onAction={noop} />,
    "long-content": () => <ResourceList {...resourceListSample} items={[LONG_RESOURCE, ...resourceListSample.items]} onAction={noop} />,
  },
};

/** vf34: the app sidebar frame renders the real AppNavigation docked, with a sample tree. Separate from the structured samples above. */
export const APP_SIDEBAR_SAMPLES: Readonly<Record<string, () => ReactNode>> = {
  AppNavigation: () => <AppNavigation {...appSidebarSample} />,
};

/**
 * Samples keyed by the export name inside `@clossys/designer/frames`. The app frame keeps its global command shortcut
 * off so a preview never takes the board's keyboard, and uses the default theme storage so it reads the host's own choice.
 */
export const STRUCTURED_FRAME_SAMPLES: Readonly<Record<string, () => ReactNode>> = {
  AppFrame: () => <AppFrame brand={{ markSrc: appFrameSample.markSrc }}
    navigation={{ tree: appFrameSample.navigation, activeId: appFrameSample.activeId, label: appFrameSample.navigationLabel }}
    account={{ actor: appFrameSample.actor, signedOutLabel: appFrameSample.signedOutLabel, contextLabel: appFrameSample.workspace, sections: [{ id: appFrameSample.accountSectionId, label: appFrameSample.accountSection, entries: appFrameSample.accountEntries }] }}
    commands={{ ...appFrameSample.commands, shortcutEnabled: false }}
    page={{ title: appFrameSample.page, scope: appFrameSample.workspace }}>
    <SemanticContent as="h2">{appFrameSample.heading}</SemanticContent>
    <SemanticContent as="p">{appFrameSample.body}</SemanticContent>
  </AppFrame>,
};
