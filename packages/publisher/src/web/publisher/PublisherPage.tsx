"use client";
import { Button, Link, Select } from "@clossys/designer/components";
import { Panel, SectionHeader } from "@clossys/designer/blocks";
import { PageHeaderModule } from "@clossys/designer/shell";
import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { PublisherPlanStore, alignedPlanItems, projectPlanInstances } from "../../planning/change-set.js";
import type { PublisherPlanApply } from "../../planning/change-set.js";
import type { PublisherPlanDraft } from "../../planning/plan.js";
import type { PublisherRequirementMessages } from "../../planning/configuration.js";
import { configurationInputNeeds, derivePublisherDeliveryState, recommendPlanItem } from "../../planning/configuration.js";
import { MILESTONE_IDS, PUBLISHER_MILESTONES } from "../../planning/menu.js";
import type { PublisherPlanMessages } from "./PublisherPlanView.js";
import type { ProductionSettingsFormMessages } from "./ProductionSettingsForm.js";
import type { AppPackMessages } from "./app/AppPack.js";
import { projectPlanAppInventory } from "./app/plan.js";
import type { FormatId } from "../../formats/contract.js";
import { PublisherFormatsView } from "../formats/PublisherFormatsView.js";
import type { BrandAssetsPackMessages } from "./assets/BrandAssetsPack.js";
import type { BrandAssetEntry } from "../../media/brand-assets.js";
import type { AppInventory } from "./app/inventory.js";
import { deriveAppPipeline } from "./app/pipeline.js";
import type { AppPageBindingInput, AppSubrowBindingInput, AppPipelineMessages } from "./app/pipeline.js";
import { PublisherInstancesView } from "../instances/PublisherInstancesView.js";
import { PublisherCheckResults } from "./PublisherCheckResults.js";
import type { PublisherCheckMessages } from "./PublisherCheckResults.js";
import type { PublisherInstancesViewProps } from "../instances/PublisherInstancesView.js";
import { derivePackPipeline } from "./pipeline.js";
import type { PublisherLane, PublisherPipelineItem } from "./pipeline.js";
import { ItemAssemblyView } from "./assembly/ItemAssemblyView.js";
import type { AssemblyOwnerHref } from "./assembly/assembly.js";
import { ConfigurationSummary, InputQuestions, ProductionSettingsForm, DeliverySettingsFields } from "./ProductionSettingsForm.js";
import { productionSettingsFromBinding, productionSettingsFromPlanItem, productionConfigurationNeeds } from "./production-settings.js";
import type { ProductionSettings, PublisherProductionState, PublisherInputRequests } from "./production-settings.js";
import type { PublisherConfiguration } from "../../planning/configuration.js";
import { projectPublisherChannels, projectPublisherChannelProcess } from "./publisher-channels.js";
import { PublisherChannelProcess } from "./PublisherChannelProcess.js";
import type { PublisherProcessItem } from "./publisher-channels.js";
import type { PublisherChannelId, PublisherChannelItem, PublisherRouteChannels } from "./publisher-channels.js";
import type { RouteRegistryProjection } from "../../core/route-registry.js";
import { registeredRouteFrameFinding, projectRouteRegistry } from "../../core/route-registry.js";
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
export function PublisherPage({ lanes: _lanes, planStore, draftPlan, onApplyPlan, formatsPanel, itemAssembly, assemblyOwnerHref, appInventory, registeredRoutes, registeredRouteProjection, appPageBindings, appSubrowBindings, appPipelineMessages, brandAssets, brandAssetMessages: _assetMessages, productionSettings, onProductionSettingsChange, appInputRequests, fixtureLibrary = false, messages, planMessages, appMessages, productionMessages, checkMessages, deploymentSurfaceIds, requirementMessages, routeChannels, activeChannel, channelHref, ...inputs }: PublisherPageProps) {
  const id = useId();
  const [localStore] = useState(() => new PublisherPlanStore(inputs.registries));
  const store = planStore ?? localStore;
  const versions = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  const aligned = versions.at(-1);
  const plan = aligned ?? draftPlan;
  const registryProjection = useMemo(() => {
    if (!registeredRouteProjection) return;
    const registry = plainRouteProjectionRegistry(registeredRouteProjection);
    return registry ? projectRouteRegistry(registry, plan, inputs.registries) : { rows: [], findings: [{ routeId: "", path: "projection", message: "Registered route display projection is invalid" }] };
  }, [registeredRouteProjection, plan, inputs.registries]);
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
  const opener = useRef<HTMLButtonElement | null>(null);
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
  const label = (row: PublisherChannelItem) => selectedProcess?.row === row ? selectedProcess.label : row.route?.registration.title ?? appInventory?.routes.find(route => route.id === row.item.appRouteId)?.label ?? row.menu.label;
  useEffect(() => { if (selectedProcess) detail.current?.focus(); }, [selectedProcess?.id]);
  const openItem = (item: PublisherProcessItem, button: HTMLButtonElement) => { opener.current = button; setSelection(item.id); setShowFormats(false); setInspectedFormatId(undefined); };
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
    catch (error) { setAlignmentError(error instanceof Error ? error.message : "Plan alignment failed"); }
    finally { setAligning(false); }
  }, [draftPlan, onApplyPlan, aligning, store]);
  const header = useMemo(() => ({
    title: "Publisher",
    nav: channels.length ? { label: "Publisher delivery channels", items: channels.map(channel => ({ id: channel.id, label: channel.label, href: channelHref?.(channel.id) ?? `#publisher-channel=${channel.id}` })), activeId: active?.id ?? "" } : undefined,
    actions: { render: ({ compact }: { compact: boolean }) => <Button type="button" aria-label={planMessages?.alignLabel ?? "Align plan"} isDisabled={!draftPlan || !onApplyPlan || aligning} onPress={() => { void align(); }}>{aligning ? "Aligning…" : compact ? "Align" : planMessages?.alignLabel ?? "Align plan"}</Button> },
  }), [channels, active?.id, channelHref, draftPlan, onApplyPlan, aligning, align, planMessages?.alignLabel]);
  if (channels.length > 1 && activeChannel === undefined) throw new TypeError("Publisher delivery channels require activeChannel bound through Frame onNavigate.");
  return <>
    <PageHeaderModule id={`${id}-publisher-header`} header={header} />
    <section aria-label="Publisher workspace" className="grid min-w-0 gap-lg text-ink-primary">
      {alignmentError && <p role="alert">{alignmentError}</p>}
      {!!registryProjection?.findings.length && <ul aria-label="Registered route findings">{registryProjection.findings.map((finding, index) => <li key={index}>{finding.routeId} · {finding.path}: {finding.message}</li>)}</ul>}
      {!active && <Panel><SectionHeader title={messages?.emptyLabel ?? "Tell Publisher your milestones"} /><p>No delivery items are aligned or proposed.</p></Panel>}
      {active && <section aria-label={`${active.label} delivery channel`} className="grid min-w-0 gap-lg">
        <ol aria-label={`${active.label} milestones`} className="grid gap-sm tablet:grid-cols-4">{PUBLISHER_MILESTONES.map(milestone => <li key={milestone.id} aria-current={plan?.currentMilestone === milestone.id ? "step" : undefined} className="rounded border border-line-base p-md"><strong>{milestone.id} · {milestone.label}</strong><p>{active.items.filter(row => row.milestone === milestone.id).length} items · {aligned ? `aligned v${aligned.version}` : `proposed v${draftPlan?.version ?? 0}`}</p></li>)}</ol>
        <p>{aligned ? `${messages?.alignedVersionLabel ?? "Aligned version"} ${aligned.version}` : "Proposed items · alignment required before production evidence"}</p>
        {active.items.some(row => row.facets.includes("commerce")) && <Button type="button" aria-pressed={commerceOnly} onPress={() => setCommerceOnly(value => !value)}>Commerce</Button>}
        {MILESTONE_IDS.map(milestone => {
          const rows = active.items.filter(row => row.milestone === milestone && (!commerceOnly || row.facets.includes("commerce")));
          if (!rows.length) return null;
          return <Panel key={milestone} header={<SectionHeader title={`${milestone} · ${active.label}`} />}>
            <PublisherChannelProcess key={`${active.id}-${milestone}`} label={`${milestone} ${active.label}`} process={projectPublisherChannelProcess(rows, { aligned: !!aligned, webItems: pipeline.items, appItems: appPipeline?.items ?? [] })} onOpen={openItem} outputFor={row => { const config = configuration(row); const delivery = derivePublisherDeliveryState(config, inputs.registries); return { format: (config && "format" in config ? config.format : undefined) ?? "Needs input", ...delivery }; }} openItemLabel={messages?.openItemLabel} />
          </Panel>;
        })}
        {selectedRow && <div ref={detail} tabIndex={-1} role="region" aria-label={`${label(selectedRow)} · item details`} className="outline-none">
          <Panel header={<SectionHeader title={`${label(selectedRow)} · item details`} actions={<Button type="button" onPress={() => { setSelection(undefined); const currentOpener = opener.current && document.getElementById(opener.current.id); currentOpener?.closest<HTMLElement>('[role="gridcell"], [role="rowheader"]')?.focus(); currentOpener?.focus(); }}>Close item details</Button>} />}>
            <SectionHeader level={3} title="Configure" />
            {fallback && aligned ? <ProductionSettingsForm key={`${selectedRow.item.id}-${JSON.stringify(selectedSettings)}`} messages={productionMessages} initial={selectedSettings ?? productionSettingsFromPlanItem(selectedRow.item, fallback)} recommendationAnswerIds={selectedRow.item.answerIds} deploymentSurfaceIds={deploymentSurfaceIds} configured={!!selectedSettings} formatIds={["web.page.responsive"]} registries={inputs.registries} onApply={configure} onReset={() => configure()} /> : <>
              <p>{aligned ? "Planned configuration only · no renderer or adopted binding is supplied." : "Align this proposal before configuring production choices."}</p>
              <ConfigurationSummary configuration={chosenConfiguration} messages={productionMessages} />
              {chosenConfiguration && chosenConfiguration.kind === "concept-only" && <><Select label="Output format" selectedKey={chosenFormatId ?? null} options={inputs.registries.formats.filter(format => selectedRow.channel === "messages" ? format.id === "email.html" : selectedRow.channel === "documents" ? !format.id.startsWith("web.") && format.id !== "email.html" : format.id === "web.page.responsive").map(format => ({ id: format.id, label: format.label }))} onSelectionChange={key => { if (key) setPlannedConfigurations(current => ({ ...current, [selectedRow.item.id]: { kind: "concept-only", format: String(key) as FormatId, deliveries: [] } })); }} /><DeliverySettingsFields format={chosenFormat} choices={chosenConfiguration.deliveries} onChange={deliveries => setPlannedConfigurations(current => ({ ...current, [selectedRow.item.id]: { ...chosenConfiguration, deliveries } }))} messages={productionMessages} /></>}
            </>}
            <InputQuestions requests={[...selectedRow.item.openNeeds, ...configurationInputNeeds(selectedRow.item, requirementMessages), ...(selectedApp?.inputRequests ?? selectedWeb?.inputRequests ?? [])]} />
            <SectionHeader level={3} title="Asset requirements" />
            <ul>{selectedRow.menu.requirements.brandAssets.map(role => <li key={role}>{role} · {brandAssets && Object.values(brandAssets).some(entries => entries.some(entry => role === "favicon" ? entry.role.startsWith("favicon-") : role === "share-image" ? ["open-graph", "twitter-image"].includes(entry.role) : role === "app-icons" ? ["apple-touch-180", "maskable-192", "maskable-512"].includes(entry.role) : false)) ? "Reference supplied · coverage proof pending" : "Needs input · choose a Designer asset reference"}</li>)}</ul>
            <Button type="button" onPress={() => setShowFormats(value => !value)} aria-expanded={showFormats} aria-controls={`${id}-assembly-formats`}>Inspect output format</Button>
            {showFormats && <div id={`${id}-assembly-formats`} ref={formatsDetail} tabIndex={-1} role="region" aria-label={`${label(selectedRow)} · output format`} className="outline-none">{formatsPanel ?? <PublisherFormatsView deliveriesLabel={productionMessages?.deliveryLabel} selectedFormatId={inspectedFormatId ?? chosenFormatId} onSelectFormat={setInspectedFormatId} formats={inputs.registries.formats} instances={selectedPipeline ? [selectedPipeline.binding] : []} library={inputs.library} breakpointValues={inputs.breakpointValues} designerHref={inputs.designerHref} fixtureLibrary={fixtureLibrary} />}</div>}
            <SectionHeader level={3} title="Evidence" />
            {!selectedRow.route && selectedRow.channel === "admin" && registeredRouteFrameFinding(registeredRoutes, selectedRow.item.appRouteId, selectedApp?.pipeline?.binding) && <p>Needs input · {registeredRouteFrameFinding(registeredRoutes, selectedRow.item.appRouteId, selectedApp?.pipeline?.binding)}</p>}
            {selectedRow.route && <><p>{selectedRow.route.registration.path} · {selectedRow.packId} · {selectedRow.milestone} · {selectedRow.route.status}</p><Link href={selectedRow.route.registration.path}>Open {selectedRow.route.registration.title} route</Link><ul aria-label="Registered route evidence">{selectedRow.route.pending.map(reason => <li key={reason}>{reason}</li>)}</ul></>}
            {selectedApp && <ol aria-label="App publish evidence" className="grid gap-xs">{selectedApp.stages.map(stage => <li key={stage.name}>{stage.name}: {selectedApp.configured ? stage.status : stage.name === "Configure" ? messages?.toDoLabel ?? "to do" : messages?.waitingLabel ?? "waiting"}{selectedApp.configured && <ul>{stage.reasons.map((reason, index) => <li key={index}>{stage.name}: {reason}</li>)}</ul>}</li>)}</ol>}
            {selectedWeb && <ol aria-label="Publish evidence" className="grid gap-xs">{selectedWeb.stages.map(stage => <li key={stage.name}>{stage.name}: {selectedWeb.configured ? stage.status : stage.name === "Configure" ? messages?.toDoLabel ?? "to do" : messages?.waitingLabel ?? "waiting"}{selectedWeb.configured && <ul>{[...stage.findings.map(finding => `${finding.code} ${finding.path}: ${finding.message}`), ...stage.pending].map((reason, index) => <li key={index}>{stage.name}: {reason}</li>)}</ul>}</li>)}</ol>}
            {!selectedPipeline?.configured ? <p>{messages?.unconfiguredDescription ?? "No production clearance. Configure and provide the required source bindings; rendered evidence remains pending."}</p> : <>
              {selectedPipeline.sourceFindings.length > 0 && <section aria-label={messages?.sourceEvidenceLabel ?? "Source binding findings"}><SectionHeader level={4} title={messages?.sourceEvidenceLabel ?? "Source binding findings"} /><ul>{selectedPipeline.sourceFindings.map((finding, index) => <li key={index}>{finding.code} · {finding.path}: {finding.message}</li>)}</ul></section>}
              {itemAssembly?.(selectedPipeline)}
              <PublisherInstancesView library={inputs.library} registries={inputs.registries} compiler={inputs.compiler} breakpointValues={inputs.breakpointValues} designerHref={inputs.designerHref} instances={[selectedPipeline.binding]} presentation="item" assemblyTargetPrefix={`${id}-assembly`}
                checkResultsPanel={<PublisherCheckResults item={selectedPipeline} id={`${id}-assembly-checks`} messages={checkMessages} />}
                assemblyPanel={<ItemAssemblyView item={selectedPipeline} registries={inputs.registries} designerHref={inputs.designerHref} ownerHref={assemblyOwnerHref} targetPrefix={`${id}-assembly`} onOpenFormats={openBoundFormat} />} />
            </>}
          </Panel>
        </div>}
      </section>}
    </section>
  </>;
}
