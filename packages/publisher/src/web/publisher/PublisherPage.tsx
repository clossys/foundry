"use client";
import { createPublisherValueNames } from "./value-names.js";
import { publisherCopy, PUBLISHER_COPY_REFS, type PublisherCopyResolver, type PublisherCopyRef } from "./copy.js";
import { Button, Link, Select } from "@clossys/designer/components";
import { DataTable, DetailView, EmptyState, NoticeList, ResourceList, StatGroup } from "@clossys/designer/blocks";
import { SlotModule, PageHeaderModule } from "@clossys/designer/shell";
import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { PublisherPlanStore, alignedPlanItems, projectPlanInstances } from "../../planning/change-set.js";
import type { PublisherPlanApply } from "../../planning/change-set.js";
import { publisherPlanItemDisplay, publisherPlanNeedDisplay, type PublisherPlanDraft } from "../../planning/plan.js";
import type { PublisherRequirementMessages } from "../../planning/configuration.js";
import { configurationInputNeeds, publisherConfigurationDisplay, recommendPlanItem } from "../../planning/configuration.js";
import { PUBLISHER_MILESTONES, publisherMenuDisplay } from "../../planning/menu.js";
import type { PublisherPlanMessages } from "./PublisherPlanView.js";
import type { ProductionSettingsFormMessages } from "./ProductionSettingsForm.js";
import type { AppPackMessages } from "./app/AppPack.js";
import { projectPlanAppInventory } from "./app/plan.js";
import type { FormatId } from "../../formats/contract.js";
import type { BrandAssetsPackMessages } from "./assets/BrandAssetsPack.js";
import type { BrandAssetEntry } from "../../media/brand-assets.js";
import type { AppInventory } from "./app/inventory.js";
import { deriveAppPipeline } from "./app/pipeline.js";
import type { AppPageBindingInput, AppSubrowBindingInput, AppPipelineMessages } from "./app/pipeline.js";
import type { PublisherCheckMessages } from "./PublisherCheckResults.js";
import type { PublisherInstancesViewProps } from "../instances/PublisherInstancesView.js";
import { derivePackPipeline } from "./pipeline.js";
import type { PublisherLane, PublisherPipelineItem } from "./pipeline.js";
import type { AssemblyOwnerHref } from "./assembly/assembly.js";
import { ConfigurationSummary, InputQuestions, ProductionSettingsForm, DeliverySettingsFields } from "./ProductionSettingsForm.js";
import { productionSettingsFromBinding, productionSettingsFromPlanItem, productionConfigurationNeeds } from "./production-settings.js";
import type { ProductionSettings, PublisherProductionState, PublisherInputRequests } from "./production-settings.js";
import type { PublisherConfiguration } from "../../planning/configuration.js";
import { projectPublisherChannels, projectPublisherChannelProcess } from "./publisher-channels.js";
import type { PublisherChannelId, PublisherChannelItem, PublisherRouteChannels } from "./publisher-channels.js";
import type { RouteRegistryProjection } from "../../core/route-registry.js";
import { projectRouteRegistry } from "../../core/route-registry.js";
import { plainRouteProjectionRegistry } from "../../core/route-projection.js";
import type { PlainRegisteredRouteProjection } from "../../core/route-projection.js";

export interface PublisherPageMessages {
  readonly toDoLabel: string;
  readonly waitingLabel: string;
  readonly noneLabel: string;
  readonly outsideMilestoneLabel: string;
  readonly alignedVersionLabel: string;
  readonly emptyLabel: string;
  readonly configurationDescription: string;
  readonly unboundItemsDescription: string;
  readonly unboundItemDescription: string;
  readonly unconfiguredDescription: string;
  readonly sourceEvidenceLabel: string;
  readonly itemLabel: string;
  readonly hostReferenceLabel: string;
  readonly conceptDescription: string;
  readonly framesLabel: string;
  readonly formatsLabel: string;
  readonly needsInputLabel: string;
  readonly unboundAssetDescription: string;
  /** @default "Open LABEL · STATE" */
  readonly openItemLabel: (label: string, state: string) => string;
  /** @default "Asset reference: ID; coverage proof pending" */
  readonly assetReferenceMessage: (id: string) => string;
}

export interface PublisherPageProps extends Omit<PublisherInstancesViewProps, "packLabels" | "presentation" | "assemblyPanel" | "checkResultsPanel" | "assemblyTargetPrefix"> {
  /** Host-configured Writer resolver. Missing copy fails closed; no locale or approval is inferred. */
  readonly copyResolver?: PublisherCopyResolver;
  readonly appInventory?: AppInventory;
  /** Node-produced display projection. It grants no runtime or lifecycle clearance. */
  readonly registeredRouteProjection?: PlainRegisteredRouteProjection;
  readonly registeredRoutes?: RouteRegistryProjection;
  readonly appPageBindings?: readonly AppPageBindingInput[];
  readonly appSubrowBindings?: readonly AppSubrowBindingInput[];
  readonly appPipelineMessages?: Partial<AppPipelineMessages>;
  /** Override the documented roster messages. */
  readonly brandAssetMessages?: Partial<BrandAssetsPackMessages>;
  /** Consumer-owned brand rosters keyed by the aligned item assetId; no asset fetching. */
  readonly brandAssets?: Readonly<Record<string, readonly BrandAssetEntry[]>>;
  /** IDs only from the host deployment manifest; no provider or credential contract. */
  readonly deploymentSurfaceIds?: readonly string[];
  readonly requirementMessages?: Partial<PublisherRequirementMessages>;
  /** Override the documented messages for the workspace and its child panels. */
  readonly messages?: Partial<PublisherPageMessages>;
  readonly planMessages?: Partial<PublisherPlanMessages>;
  readonly appMessages?: Partial<AppPackMessages>;
  readonly productionMessages?: Partial<ProductionSettingsFormMessages>;
  readonly checkMessages?: Partial<PublisherCheckMessages>;
  /** Consumer-owned plan history; omission creates an empty local history. */
  readonly planStore?: PublisherPlanStore;
  readonly draftPlan?: PublisherPlanDraft;
  readonly onApplyPlan?: PublisherPlanApply;
  /** Controlled production choices; omission uses local UI state, initially all unset. */
  readonly productionSettings?: PublisherProductionState;
  readonly onProductionSettingsChange?: (settings: PublisherProductionState) => void;
  /** App questions are supplied explicitly by the host, never inferred from route inventory. */
  readonly appInputRequests?: PublisherInputRequests;
  readonly lanes?: readonly PublisherLane[];
  /** Optional host override of the registry-backed Formats panel. */
  readonly formatsPanel?: ReactNode;
  /** Assembly detail extension; the existing inspector remains the drill-in seam. */
  readonly itemAssembly?: (item: PublisherPipelineItem) => ReactNode;
  /** Resolve owner links using the host's established Designer navigation. */
  readonly assemblyOwnerHref?: AssemblyOwnerHref;
  readonly fixtureLibrary?: boolean;
  /** Host audience classification when no Node route projection is supplied. */
  readonly routeChannels?: PublisherRouteChannels;
  /** Required with multiple channels. The host handles header hrefs through Frame onNavigate. */
  readonly activeChannel?: PublisherChannelId;
  /** Defaults to the closed #publisher-channel=ID fragment handled by publisherChannelFromHref. */
  readonly channelHref?: (channel: PublisherChannelId) => string;
}


/** Channel-first workspace. All check evidence still comes from the original bindings. */
export function PublisherPage({ copyResolver, lanes: _lanes, planStore, draftPlan, onApplyPlan, formatsPanel, itemAssembly, assemblyOwnerHref, appInventory, registeredRoutes, registeredRouteProjection, appPageBindings, appSubrowBindings, appPipelineMessages, brandAssets, brandAssetMessages: _assetMessages, productionSettings, onProductionSettingsChange, appInputRequests, fixtureLibrary = false, messages, planMessages, appMessages, productionMessages, checkMessages, deploymentSurfaceIds, requirementMessages, routeChannels, activeChannel, channelHref, ...inputs }: PublisherPageProps) {
  const id = useId();
  const valueNames = useMemo(() => copyResolver ? createPublisherValueNames(copyResolver) : undefined, [copyResolver]);
  const productionCopy = { ...productionMessages, valueNames };
  const resolved = (ref: PublisherCopyRef | undefined) => ref ? publisherCopy(copyResolver, ref) : copy("needsInput");
  const name = (parent: string, key: string) => valueNames?.(parent, key) ?? copy("needsInput");
  const displayRequests = (requests: readonly { readonly slot: string; readonly question: string }[]) => requests.map(request => ({ ...request, question: resolved(publisherPlanNeedDisplay(request).questionRef) }));
  const stateName = (state: string) => state === "to do" ? copy("toDo") : name("admin.enum", state);
  const copy = useCallback((key: keyof typeof PUBLISHER_COPY_REFS) => publisherCopy(copyResolver, PUBLISHER_COPY_REFS[key]), [copyResolver]);
  const [localStore] = useState(() => new PublisherPlanStore(inputs.registries));
  const store = planStore ?? localStore;
  const versions = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  const aligned = versions.at(-1);
  const plan = aligned ?? draftPlan;
  const registryProjection = useMemo(() => {
    if (!registeredRouteProjection) return;
    const registry = plainRouteProjectionRegistry(registeredRouteProjection);
    return registry ? projectRouteRegistry(registry, plan, inputs.registries) : { rows: [], findings: [{ routeId: "", path: "projection", message: copy("projectionFailure") }] };
  }, [registeredRouteProjection, plan, inputs.registries, copy]);
  const channels = useMemo(() => projectPublisherChannels(plan, routeChannels, registryProjection), [plan, routeChannels, registryProjection]);
  const active = channels.find(channel => channel.id === activeChannel) ?? channels[0];
  const [commerceOnly, setCommerceOnly] = useState(false);
  const [selection, setSelection] = useState<string>();
  const [showFormats, setShowFormats] = useState(false);
  const [formatsFocusRequest, setFormatsFocusRequest] = useState(0);
  const [inspectedFormatId, setInspectedFormatId] = useState<FormatId>();
  const [aligning, setAligning] = useState(false);
  const [alignmentError, setAlignmentError] = useState<string>();
  const [localSettings, setLocalSettings] = useState<PublisherProductionState>({});
  const settings = productionSettings ?? localSettings;
  const [plannedConfigurations, setPlannedConfigurations] = useState<Readonly<Record<string, PublisherConfiguration>>>({});
  const opener = useRef<HTMLElement | null>(null);
  const detail = useRef<HTMLDivElement>(null);
  const formatsDetail = useRef<HTMLDivElement>(null);
  useEffect(() => { if (formatsFocusRequest) formatsDetail.current?.focus(); }, [formatsFocusRequest]);
  const changeSettings = (next: PublisherProductionState) => { if (productionSettings === undefined) setLocalSettings(next); onProductionSettingsChange?.(next); };
  const planRows = alignedPlanItems(aligned);
  const members = useMemo(() => projectPlanInstances(aligned, inputs.instances).filter(binding => planRows.some(row => row.item.instanceId === binding.instanceId)), [aligned, inputs.instances]);
  const pipeline = useMemo(() => derivePackPipeline(members, inputs.library, inputs.registries, inputs.compiler, settings.instances, Object.fromEntries(planRows.filter(row => row.item.instanceId).map(row => [row.item.instanceId!, [...row.item.openNeeds, ...productionConfigurationNeeds(row.item, settings.instances?.[row.item.instanceId!], requirementMessages)]]))), [members, inputs.library, inputs.registries, inputs.compiler, settings.instances, aligned, requirementMessages]);
  const projectedApp = projectPlanAppInventory(aligned, appInventory);
  const appPipeline = projectedApp ? deriveAppPipeline({ inventory: projectedApp, library: inputs.library, registries: inputs.registries, compiler: inputs.compiler, settings: settings.appPages, messages: appPipelineMessages,
    pageBindings: appPageBindings?.filter(entry => projectedApp.routes.some(route => route.id === entry.pageId && route.kind !== "detail-tab")),
    subrowBindings: appSubrowBindings?.filter(entry => projectedApp.routes.some(route => route.id === entry.subrowId && route.kind === "detail-tab")),
    inputRequests: Object.fromEntries(projectedApp.routes.map(route => [route.id, [...(planRows.find(row => row.item.appRouteId === route.id)?.item.openNeeds ?? []), ...(appInputRequests?.[route.id] ?? []), ...productionConfigurationNeeds(planRows.find(row => row.item.appRouteId === route.id)?.item, settings.appPages?.[route.parentRecordRoute ?? route.id], requirementMessages)]])) }) : undefined;
  const webItem = (row: PublisherChannelItem) => row.route ? undefined : pipeline.items.find(item => item.binding.instanceId === row.item.instanceId);
  const process = projectPublisherChannelProcess(active?.items ?? [], { aligned: !!aligned, webItems: pipeline.items, appItems: appPipeline?.items ?? [] });
  const selectedProcess = process.lanes.flatMap(lane => lane.items).find(item => item.id === selection);
  const selectedRow = selectedProcess?.row;
  const label = (row: PublisherChannelItem) => {
    const routePath = row.route?.registration.path ?? appInventory?.routes.find(route => route.id === row.item.appRouteId)?.path;
    return resolved(publisherPlanItemDisplay(row.item, routePath && ["/agents/designer", "/agents/writer", "/agents/publisher"].includes(routePath) ? routePath : undefined).labelRef);
  };
  const focusDetail = useCallback((node: HTMLDivElement | null) => { detail.current = node; node?.focus(); }, [selection]);
  const configuration = (row: PublisherChannelItem): PublisherConfiguration | undefined => {
    const chosen = row.item.instanceId ? settings.instances?.[row.item.instanceId] : row.item.appRouteId ? settings.appPages?.[row.item.appRouteId] : undefined;
    const recommended = recommendPlanItem(row.item).configuration;
    if (chosen) return chosen.format === "web.page.responsive" && recommended?.kind === "web" ? { ...recommended, ...chosen, format: chosen.format, deliveries: chosen.deliveries ?? recommended.deliveries } : { kind: "concept-only", format: chosen.format, deliveries: chosen.deliveries ?? [] };
    return plannedConfigurations[row.item.id] ?? recommended;
  };
  const selectedWeb = selectedRow && webItem(selectedRow);
  const selectedApp = selectedProcess?.app;
  const selectedPipeline = selectedWeb ?? selectedApp?.pipeline;
  const sourceRoute = selectedApp?.route;
  const selectedSettings = selectedRow?.item.instanceId ? settings.instances?.[selectedRow.item.instanceId] : sourceRoute ? settings.appPages?.[sourceRoute.parentRecordRoute ?? sourceRoute.id] : undefined;
  const chosenConfiguration = selectedRow && configuration(selectedRow);
  const chosenDisplay = publisherConfigurationDisplay(chosenConfiguration);
  const selectedMenuDisplay = selectedRow && publisherMenuDisplay(selectedRow.menu);
  const chosenFormatId = chosenConfiguration && "format" in chosenConfiguration ? chosenConfiguration.format : undefined;
  const chosenFormat = inputs.registries.formats.find(format => format.id === chosenFormatId);
  const openBoundFormat = () => {
    setInspectedFormatId(selectedPipeline?.binding.format ?? chosenFormatId);
    setShowFormats(true);
    setFormatsFocusRequest(request => request + 1);
  };
  const fallback: ProductionSettings | undefined = selectedPipeline ? productionSettingsFromBinding(selectedPipeline.sourceBinding) : sourceRoute ? {
    format: "web.page.responsive" as const, frame: { leaf: sourceRoute.frame as ProductionSettings["frame"]["leaf"] },
    layout: { leaf: inputs.registries.layouts.find(layout => layout.contract.configs.some(config => config.id === sourceRoute.layoutConfig))?.id ?? "layouts.stack", config: sourceRoute.layoutConfig },
  } : undefined;
  const configure = (value?: ProductionSettings) => {
    if (selectedRow?.item.instanceId) changeSettings({ ...settings, instances: { ...settings.instances, [selectedRow.item.instanceId]: value } });
    else if (sourceRoute) changeSettings({ ...settings, appPages: { ...settings.appPages, [sourceRoute.parentRecordRoute ?? sourceRoute.id]: value } });
  };
  useEffect(() => { setSelection(undefined); setShowFormats(false); setCommerceOnly(false); setInspectedFormatId(undefined); }, [active?.id]);
  const align = useCallback(async () => {
    if (!draftPlan || !onApplyPlan || aligning) return;
    setAligning(true); setAlignmentError(undefined);
    try { await store.apply(store.propose(draftPlan), onApplyPlan); }
    catch (error) { setAlignmentError(error instanceof Error ? error.message : copy("applyFailure")); }
    finally { setAligning(false); }
  }, [draftPlan, onApplyPlan, aligning, store, copy]);
  const header = useMemo(() => ({
    title: copy("title"),
    nav: channels.length ? { label: copy("channels"), items: channels.map(channel => ({ id: channel.id, label: name("publisher.channel", channel.id), href: channelHref?.(channel.id) ?? `#publisher-channel=${channel.id}` })), activeId: active?.id ?? "" } : undefined,
    actions: { render: ({ compact }: { compact: boolean }) => <Button type="button" aria-label={planMessages?.alignLabel ?? copy("apply")} isDisabled={!draftPlan || !onApplyPlan || aligning} onPress={() => { void align(); }}>{aligning ? copy("applying") : compact ? copy("applyCompact") : planMessages?.alignLabel ?? copy("apply")}</Button> },
  }), [channels, active?.id, channelHref, draftPlan, onApplyPlan, aligning, align, planMessages?.alignLabel, copy, valueNames]);
  if (channels.length > 1 && activeChannel === undefined) throw new TypeError("Publisher delivery channels require activeChannel bound through Frame onNavigate.");
  const closeItem = () => {
    setSelection(undefined);
    opener.current?.focus();
  };
  const visibleItems = process.lanes.flatMap(lane => lane.items).filter(item => !commerceOnly || item.row.facets.includes("commerce"));
  const selectedLabel = selectedRow ? label(selectedRow) : undefined;
  const notices = [
    ...(alignmentError ? [{ id: "alignment", tone: "danger" as const, message: <span data-publisher-source-error={alignmentError}>{copy("applyFailure")}</span> }] : []),
    ...(registryProjection?.findings.map((finding, index) => ({ id: `route-${index}`, tone: "warning" as const, message: <span data-publisher-source-finding={finding.message}>{copy("projectionFailure")}</span> })) ?? []),
  ];
  const reasonText = (reason: string) => {
    if (reason === "Adopted source binding unavailable") return name("publisher.setupStatus", "bindingPending");
    if (reason === "Waiting for parent Configure") return name("publisher.setupStatus", "subrowPending");
    if (reason.includes("Concept only")) return copy("plannedDescription");
    if (reason.includes("Waiting for Configure") || reason.startsWith("to do:")) return copy("unconfiguredDescription");
    const code = reason.match(/\b(?:LK\d+|DE2b)\b/)?.[0];
    if (code || /\b(?:frames|layouts|pack|tokens|stack|split|bento)\.[\w.-]+/.test(reason)) return <>{code ? <>{name("publisher.check", code)} · </> : null}{copy("unconfiguredDescription")}</>;
    return reason;
  };
  const configurationPanel = selectedRow && <>
    {fallback && aligned ? <ProductionSettingsForm key={`${selectedRow.item.id}-${JSON.stringify(selectedSettings)}`} messages={productionCopy} initial={selectedSettings ?? productionSettingsFromPlanItem(selectedRow.item, fallback)} recommendationAnswerIds={selectedRow.item.answerIds} deploymentSurfaceIds={deploymentSurfaceIds} configured={!!selectedSettings} formatIds={["web.page.responsive"]} registries={inputs.registries} onApply={configure} onReset={() => configure()} /> : <>
      <p>{aligned ? copy("plannedDescription") : copy("alignBeforeConfigure")}</p>
      <ConfigurationSummary configuration={chosenConfiguration} messages={productionCopy} />
      {chosenConfiguration?.kind === "concept-only" && <>
        <Select label={copy("outputFormat")} selectedKey={chosenFormatId ?? null} options={inputs.registries.formats.filter(format => selectedRow.channel === "messages" ? format.id === "email.html" : selectedRow.channel === "documents" ? !format.id.startsWith("web.") && format.id !== "email.html" : format.id === "web.page.responsive").map(format => ({ id: format.id, label: name("publisher.format", format.id) }))} onSelectionChange={key => { if (key) setPlannedConfigurations(current => ({ ...current, [selectedRow.item.id]: { kind: "concept-only", format: String(key) as FormatId, deliveries: [] } })); }} />
        <DeliverySettingsFields format={chosenFormat} choices={chosenConfiguration.deliveries} onChange={deliveries => setPlannedConfigurations(current => ({ ...current, [selectedRow.item.id]: { ...chosenConfiguration, deliveries } }))} messages={productionCopy} />
      </>}
    </>}
    <InputQuestions valueNames={valueNames} label={copy("needsInput")} needsInputLabel={copy("needsInput")} requests={displayRequests([...selectedRow.item.openNeeds, ...configurationInputNeeds(selectedRow.item, requirementMessages), ...(selectedApp?.inputRequests ?? selectedWeb?.inputRequests ?? [])])} />
  </>;
  return <>
    <PageHeaderModule id={`${id}-publisher-header`} header={header} />
    <section aria-label={copy("workspace")} data-publisher-stage="" className="grid min-w-0 gap-lg text-ink-primary">
      {notices.length > 0 && <NoticeList label={copy("routeFindings")} notices={notices} />}
      {!active ? <EmptyState title={messages?.emptyLabel ?? copy("emptyTitle")} description={copy("emptyDescription")} /> : <>
        <StatGroup aria-label={name("publisher.planHeader", "currentMilestoneLabel")} items={PUBLISHER_MILESTONES.map(milestone => ({ id: milestone.id, label: name("publisher.milestone", milestone.id), value: active.items.filter(row => row.milestone === milestone.id).length }))} />
        <NoticeList label={copy("workspace")} notices={[{ id: "alignment-state", message: aligned ? <>{messages?.alignedVersionLabel ?? copy("alignedVersion")} {aligned.version}</> : copy("proposedDescription") }]} />
        <ResourceList aria-label={name("publisher.channel", active.id)} items={visibleItems.map(item => ({ id: item.id, textValue: label(item.row), title: label(item.row),
          description: <>{stateName(item.state)} · {name("publisher.stage", item.column)}</>, meta: item.path,
          actions: [{ id: "inspect", label: messages?.openItemLabel?.(label(item.row), stateName(item.state)) ?? label(item.row), onAction: () => { opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setSelection(item.id); setShowFormats(false); } }],
        }))} actionsLabel={name => name} onAction={itemId => { opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setSelection(itemId); }} emptyState={{ title: messages?.emptyLabel ?? copy("emptyTitle"), description: copy("emptyDescription") }}
          toolbar={active.items.some(row => row.facets.includes("commerce")) ? <Button variant="secondary" type="button" aria-pressed={commerceOnly} onPress={() => setCommerceOnly(value => !value)}>{copy("commerce")}</Button> : undefined} />
      </>}
    </section>
    {selectedRow && <SlotModule id={`${id}-publisher-inspector`} slot="right-panel" label={selectedLabel!}>
      <div ref={focusDetail} tabIndex={-1} role="region" aria-label={selectedLabel} data-publisher-display-needs={JSON.stringify([...(selectedMenuDisplay?.needsInput ?? []), ...chosenDisplay.needsInput])} className="grid min-w-0 gap-lg outline-none [&_strong]:font-medium">
        <DetailView title={selectedLabel} actions={<Button variant="ghost" type="button" onPress={closeItem}>{copy("closeDetails")}</Button>} fields={[
          { label: copy("configure"), value: configurationPanel, span: 2 },
          { label: copy("assetRequirements"), value: <ul>{selectedRow.menu.requirements.brandAssets.map((role, index) => <li key={role}>{resolved(selectedMenuDisplay?.requirements.brandAssets[index])} · {brandAssets && Object.values(brandAssets).some(entries => entries.some(entry => role === "favicon" ? entry.role.startsWith("favicon-") : role === "share-image" ? ["open-graph", "twitter-image"].includes(entry.role) : role === "app-icons" ? ["apple-touch-180", "maskable-192", "maskable-512"].includes(entry.role) : false)) ? copy("assetPending") : copy("assetMissing")}</li>)}</ul>, span: 2 },
        ]} />
        <DataTable aria-label={copy("evidence")} rows={selectedProcess?.stages ?? []} rowKey={stage => stage.name} columns={[
          { id: "stage", header: copy("evidence"), isRowHeader: true, cell: stage => name("publisher.stage", stage.name) },
          { id: "status", header: copy("needsInput"), cell: stage => stateName(stage.status) },
          { id: "reasons", header: copy("sourceFindings"), cell: stage => <ul>{stage.reasons.map((reason, index) => <li key={index} data-publisher-source-reason={reason}>{reasonText(reason)}</li>)}</ul> },
        ]} />
        {selectedPipeline?.configured && <DataTable aria-label={checkMessages?.tableLabel ?? copy("publishEvidence")} rows={selectedPipeline.checks} rowKey={check => check.code} columns={[
          { id: "check", header: checkMessages?.codeLabel ?? copy("evidence"), isRowHeader: true, cell: check => <span data-publisher-check={check.code}>{name("publisher.check", check.code)}</span> },
          { id: "status", header: checkMessages?.statusLabel ?? copy("needsInput"), cell: check => stateName(check.status) },
          { id: "findings", header: checkMessages?.findingsLabel ?? copy("sourceFindings"), cell: check => check.findings.length },
        ]} />}
        <DetailView fields={[{ label: copy("outputFormat"), value: <>
          <Button variant="secondary" type="button" onPress={() => { if (showFormats) setShowFormats(false); else openBoundFormat(); }} aria-expanded={showFormats}>{copy("inspectFormat")}</Button>
          {showFormats && (formatsPanel ?? <DetailView fields={[
            { label: copy("outputFormat"), value: resolved(chosenDisplay.formatRef) },
            ...(chosenConfiguration?.kind === "web" ? [{ label: messages?.framesLabel ?? name("publisher.planHeader", "framesLabel"), value: resolved(chosenDisplay.frameRef) }, { label: name("publisher.contentKey", "layout"), value: <>{resolved(chosenDisplay.layoutRef)} · {resolved(chosenDisplay.layoutConfigRef)}</> }] : []),
            { label: name("publisher.contentKey", "deliveries"), value: chosenDisplay.deliveries.map((delivery, index) => <span key={index}>{resolved(delivery.labelRef)}{delivery.fidelityRef ? <> · {resolved(delivery.fidelityRef)}</> : null}</span>) },
          ]} />)}
        </> }]} />
        {selectedRow.route && <DetailView fields={[{ label: copy("routeEvidence"), value: <Link href={selectedRow.route.registration.path}>{selectedLabel}</Link> }]} />}
        {itemAssembly && selectedPipeline?.configured && <DetailView fields={[{ label: copy("evidence"), value: itemAssembly(selectedPipeline), span: 2 }]} />}
      </div>
    </SlotModule>}
  </>;
}
