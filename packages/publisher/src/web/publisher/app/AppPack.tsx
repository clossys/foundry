"use client";
import { Badge, Button, Card } from "@clossys/designer/components";
import { Fragment, useEffect, useId, useRef, useState } from "react";
import type { PublisherRequirementMessages } from "../../../planning/configuration.js";
import type { PublisherPlanItem } from "../../../planning/plan.js";
import { productionSettingsFromPlanItem, productionConfigurationNeeds } from "../production-settings.js";
import type { ConsumerInstanceLibrary, InstanceRegistries } from "../../../core/instance-binding.js";
import type { ProductionSettingsFormMessages } from "../ProductionSettingsForm.js";
import { InputQuestions, ProductionSettingsForm } from "../ProductionSettingsForm.js";
import type { ProductionSettings, ProductionSettingsByItem, PublisherInputRequests } from "../production-settings.js";
import { APP_LANES, APP_STAGES, APP_STATE_NAMES } from "./inventory.js";
import type { AppInventory, AppRoute, AppStageEvidence } from "./inventory.js";

import type { LayoutCompilerPort } from "../../../core/layout-source.js";
import { deriveAppPipeline } from "./pipeline.js";
import type { AppPageBindingInput, AppSubrowBindingInput, AppPipelineMessages } from "./pipeline.js";

const cell = "border-b border-line-base p-md text-left align-top";
const panel = "min-w-0 rounded border border-line-base bg-surface-raised p-lg";
const pending = "rounded border border-status-warning bg-status-warning-tint p-sm text-status-warning-text";
function RouteIdentity({ route }: { route: AppRoute }) {
  return <span className="break-words">{route.path}{route.transport === "hash" && <span className="block text-sm">{route.pathParameters.length > 0 ? "Constrained route pattern · no record IDs expanded" : "Hash route pattern"}</span>}</span>;
}
interface StageStripProps {
  readonly stages: readonly AppStageEvidence[];
  readonly configured: boolean;
  /** @default "to do" */
  readonly toDoLabel?: string;
  /** @default "waiting" */
  readonly waitingLabel?: string;
}
function StageStrip({ stages, configured, toDoLabel = "to do", waitingLabel = "waiting" }: StageStripProps) {
  return <ol aria-label="Full App publish stages" className="flex flex-wrap gap-xs">{stages.map(stage => {
    /** @default The derived stage status, or "to do"/"waiting" before configuration. */
    const statusLabel = !configured ? stage.name === "Configure" ? toDoLabel : waitingLabel : stage.status;
    return <li key={stage.name}><Badge variant={stage.status === "failed" ? "destructive" : stage.status === "passed" ? "default" : "secondary"} title={stage.reasons.join(" · ")}>{stage.name}: {statusLabel}</Badge></li>;
  })}</ol>;
}
interface PlanningDescriptionProps {
  /** @default "Planner default only · adoption unverified" */
  readonly description?: string;
}
function PlanningDescription({ description = "Planner default only · adoption unverified" }: PlanningDescriptionProps) {
  return <>{description}</>;
}
function suggestedAppSettings(route: AppRoute, registries?: InstanceRegistries): ProductionSettings {
  return {
    format: "web.page.responsive", frame: { leaf: route.frame as ProductionSettings["frame"]["leaf"] },
    layout: { leaf: registries?.layouts.find(layout => layout.contract.configs.some(config => config.id === route.layoutConfig))?.id ?? "" as ProductionSettings["layout"]["leaf"], config: route.layoutConfig },
  };
}
export interface AppPackMessages {
  readonly toDoLabel: string;
  readonly waitingLabel: string;
  readonly needsInputLabel: string;
  readonly pendingLabel: string;
  readonly fillsPendingLabel: string;
  /** @default "failed" */
  readonly failedLabel: string;
  /** @default "ready" */
  readonly readyLabel: string;
  /** @default "N findings" */
  readonly findingCountLabel: (count: number) => string;
  /** @default "N pages · R Ready · U not ready" */
  readonly pageSummary: (count: number, ready: number) => string;
  /** @default "Source binding findings" */
  readonly sourceFindingsLabel: string;
  /** @default "Effective binding findings" */
  readonly effectiveFindingsLabel: string;
  /** @default "LK12 pending" */
  readonly renderedPendingLabel: string;
  /** @default "undecided" */
  readonly undecidedLabel: string;
  /** @default "App frame leaves" */
  readonly frameLeavesLabel: string;
  /** @default "STATE: DECLARATION · applicability: APPLICABILITY" */
  readonly stateDeclarationLabel: (state: string, declared: boolean, applicability: string) => string;
  readonly configurationDescription: string;
  readonly stageDescription: string;
  readonly decisionsSummary: string;
  readonly decisionsLabel: string;
  readonly decisionStatusLabel: string;
  readonly noRouteLabel: string;
  readonly decisionSummary: string;
  readonly missingConfigLabel: string;
  readonly waitingForConfigureLabel: string;
  /** @default "Planner default only · adoption unverified" */
  readonly defaultSettingsDescription: string;
  readonly decisionLabel: string;
  readonly closeDecisionLabel: string;
  readonly decisionConfigureLabel: string;
  readonly decisionDescription: string;
  readonly decisionInstructions: string;
  readonly inheritedSettingsLabel: string;
  readonly configureParentLabel: string;
  /** @default "Open LABEL · PATH · STATE" */
  readonly openRouteLabel: (label: string, path: string, state: string) => string;
  /** @default "Open LABEL page decision · to do" */
  readonly openDecisionLabel: (label: string) => string;
}
export interface AppPackProps {
  /** Override the documented messages for configuration and input decisions. */
  readonly messages?: Partial<AppPackMessages>;
  readonly productionMessages?: Partial<ProductionSettingsFormMessages>;
  readonly planItems?: readonly PublisherPlanItem[];
  readonly deploymentSurfaceIds?: readonly string[];
  readonly requirementMessages?: Partial<PublisherRequirementMessages>;
  readonly inventory?: AppInventory;
  readonly pageBindings?: readonly AppPageBindingInput[];
  readonly subrowBindings?: readonly AppSubrowBindingInput[];
  readonly library?: ConsumerInstanceLibrary;
  readonly compiler?: LayoutCompilerPort;
  readonly pipelineMessages?: Partial<AppPipelineMessages>;
  readonly registries?: InstanceRegistries;
  readonly productionSettings?: ProductionSettingsByItem;
  readonly onProductionSettingsChange?: (settings: ProductionSettingsByItem) => void;
  readonly inputRequests?: PublisherInputRequests;
}
/** Host inventory and manual configuration are planning inputs, never adopted bindings. */
export function AppPack({ inventory, pageBindings, subrowBindings, library, compiler, pipelineMessages, registries, productionSettings, onProductionSettingsChange, inputRequests = {}, messages, productionMessages, planItems = [], deploymentSurfaceIds, requirementMessages }: AppPackProps) {
  const decisionTitleId = useId();
  /** @default 'to do' */
  const toDoLabel = messages?.toDoLabel ?? 'to do';
  /** @default 'waiting' */
  const waitingLabel = messages?.waitingLabel ?? 'waiting';
  /** @default 'needs input' */
  const needsInputLabel = messages?.needsInputLabel ?? 'needs input';
  /** @default 'pending' */
  const pendingLabel = messages?.pendingLabel ?? 'pending';
  /** @default 'pending · Fills unassigned' */
  const fillsPendingLabel = messages?.fillsPendingLabel ?? 'pending · Fills unassigned';
  /** @default 'Configure production choices first. Later stages read the supplied consumer bindings and actual check coverage.' */
  const configurationDescription = messages?.configurationDescription ?? 'Configure production choices first. Later stages read the supplied consumer bindings and actual check coverage.';
  /** @default 'Chips show the first failing or pending stage. Scoped state declarations and whole-instance rendered proof remain separate.' */
  const stageDescription = messages?.stageDescription ?? 'Chips show the first failing or pending stage. Scoped state declarations and whole-instance rendered proof remain separate.';
  /** @default 'page decisions · no route or adopted page · excluded from page counts' */
  const decisionsSummary = messages?.decisionsSummary ?? 'page decisions · no route or adopted page · excluded from page counts';
  /** @default 'page decisions' */
  const decisionsLabel = messages?.decisionsLabel ?? 'page decisions';
  /** @default 'to do · page decision' */
  const decisionStatusLabel = messages?.decisionStatusLabel ?? 'to do · page decision';
  /** @default 'No route or adopted page' */
  const noRouteLabel = messages?.noRouteLabel ?? 'No route or adopted page';
  /** @default '· Configure to do · page decisions only; no route or adopted page' */
  const decisionSummary = messages?.decisionSummary ?? '· Configure to do · page decisions only; no route or adopted page';
  /** @default 'Config not supplied' */
  const missingConfigLabel = messages?.missingConfigLabel ?? 'Config not supplied';
  /** @default 'Waiting for Configure' */
  const waitingForConfigureLabel = messages?.waitingForConfigureLabel ?? 'Waiting for Configure';
  /** @default '· page decision' */
  const decisionLabel = messages?.decisionLabel ?? '· page decision';
  /** @default 'Close page decision' */
  const closeDecisionLabel = messages?.closeDecisionLabel ?? 'Close page decision';
  /** @default 'Configure: to do' */
  const decisionConfigureLabel = messages?.decisionConfigureLabel ?? 'Configure: to do';
  /** @default '· No route or adopted page. This decision is excluded from page counts.' */
  const decisionDescription = messages?.decisionDescription ?? '· No route or adopted page. This decision is excluded from page counts.';
  /** @default 'Choose the page and its route in the host inventory before configuring production settings.' */
  const decisionInstructions = messages?.decisionInstructions ?? 'Choose the page and its route in the host inventory before configuring production settings.';
  /** @default 'Production settings inherited from parent page ·' */
  const inheritedSettingsLabel = messages?.inheritedSettingsLabel ?? 'Production settings inherited from parent page ·';
  /** @default 'Configure parent page' */
  const configureParentLabel = messages?.configureParentLabel ?? 'Configure parent page';
  const openRouteLabel = messages?.openRouteLabel ?? ((label: string, path: string, state: string) => `Open ${label} · ${path} · ${state}`);
  const openDecisionLabel = messages?.openDecisionLabel ?? ((label: string) => `Open ${label} page decision · to do`);
  /** @default "failed" */
  const failedLabel = messages?.failedLabel ?? "failed";
  /** @default "ready" */
  const readyLabel = messages?.readyLabel ?? "ready";
  /** @default "N findings" */
  const findingCountLabel = messages?.findingCountLabel ?? ((count: number) => `${count} findings`);
  /** @default "N pages · R Ready · U not ready" */
  const pageSummary = messages?.pageSummary ?? ((count: number, ready: number) => `${count} pages · ${ready} Ready · ${count - ready} not ready`);
  /** @default "Source binding findings" */
  const sourceFindingsLabel = messages?.sourceFindingsLabel ?? "Source binding findings";
  /** @default "Effective binding findings" */
  const effectiveFindingsLabel = messages?.effectiveFindingsLabel ?? "Effective binding findings";
  /** @default "LK12 pending" */
  const renderedPendingLabel = messages?.renderedPendingLabel ?? "LK12 pending";
  /** @default "undecided" */
  const undecidedLabel = messages?.undecidedLabel ?? "undecided";
  /** @default "App frame leaves" */
  const frameLeavesLabel = messages?.frameLeavesLabel ?? "App frame leaves";
  /** @default "STATE: DECLARATION · applicability: APPLICABILITY" */
  const stateDeclarationLabel = messages?.stateDeclarationLabel ?? ((state: string, declared: boolean, applicability: string) => `${state}: ${declared ? "declared" : "not declared"} · applicability: ${applicability}`);
  const id = useId(), title = useRef<HTMLHeadingElement>(null), opener = useRef<HTMLButtonElement | null>(null);
  const [localSettings, setLocalSettings] = useState<ProductionSettingsByItem>({});
  const settings = productionSettings ?? localSettings;
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [expandedPages, setExpandedPages] = useState<ReadonlySet<string>>(new Set());
  const [selection, setSelection] = useState<{ readonly kind: "route" | "decision"; readonly id: string }>();
  const selected = selection?.kind === "route" ? inventory?.routes.find(route => route.id === selection.id) : undefined;
  const decision = selection?.kind === "decision" ? inventory?.missingDecisions?.find(row => row.id === selection.id) : undefined;
  useEffect(() => { if (selected || decision) title.current?.focus(); }, [selected?.id, decision?.id]);
  if (!inventory) return <div className={panel}><h2>App routes pending</h2><p>No host route inventory supplied.</p></div>;
  const { routes, missingDecisions = [] } = inventory;
  const pages = routes.filter(route => route.kind !== "detail-tab");
  const ownerId = (route: AppRoute) => route.parentRecordRoute ?? route.id;
  const configuration = (route: AppRoute) => settings[ownerId(route)];
  const configure = (route: AppRoute, value?: ProductionSettings) => {
    const next = { ...settings, [ownerId(route)]: value };
    if (productionSettings === undefined) setLocalSettings(next);
    onProductionSettingsChange?.(next);
  };
  const pipeline = deriveAppPipeline({ inventory, pageBindings, subrowBindings, library, registries, compiler, settings, messages: pipelineMessages,
    inputRequests: Object.fromEntries(routes.map(route => [route.id, [...(inputRequests[route.id] ?? []), ...productionConfigurationNeeds(planItems.find(item => item.appRouteId === route.id), configuration(route), requirementMessages)]])) });
  const evidence = (route: AppRoute) => pipeline.items.find(item => item.route.id === route.id)!;
  const questions = (route: AppRoute) => evidence(route).inputRequests;
  const stageStrip = (route: AppRoute) => <StageStrip stages={evidence(route).stages} configured={evidence(route).configured} toDoLabel={toDoLabel} waitingLabel={waitingLabel} />;
  const stateLabel = (route: AppRoute) => ({ "to do": toDoLabel, "needs input": needsInputLabel, pending: pendingLabel, failed: failedLabel, ready: readyLabel })[evidence(route).state];
  const open = (route: AppRoute, button: HTMLButtonElement) => { opener.current = button; setSelection({ kind: "route", id: route.id }); };
  const close = () => { setSelection(undefined); opener.current?.focus(); };
  const chip = (route: AppRoute) => {
    /** @default "Open LABEL · PATH · STATE" */
    const openLabel = openRouteLabel(route.label, route.path, stateLabel(route));
    /** @default "to do", "needs input", or "pending · Fills unassigned". */
    const statusLabel = stateLabel(route);
    /** @default "N findings" */
    const findingLabel = findingCountLabel(evidence(route).findings.length);
    return <Button type="button" className={`${evidence(route).state === "failed" ? "rounded border border-status-danger bg-status-danger-tint p-sm text-status-danger-text" : pending} grid gap-xs text-left focus-visible:outline`} aria-label={openLabel} aria-description={questions(route).map(request => `${request.slot}: ${request.question}`).join(" · ")} onPress={event => open(route, (event.target as HTMLButtonElement))}><strong>{route.label}</strong><RouteIdentity route={route} /><span className="text-sm">{statusLabel} · {findingLabel}</span><InputQuestions requests={questions(route)} /></Button>;
  };
  const tabs = (route: AppRoute) => routes.filter(child => child.parentRecordRoute === route.id);
  /** @default "N pages · R Ready · U not ready" */
  const summaryLabel = pageSummary(pages.length, pipeline.readyCount);
  return <div className="grid min-w-0 gap-lg">
    <header className={`${panel} grid gap-md`}><div className="flex flex-wrap gap-md"><h2>App</h2><span>Local only</span></div>
      <p>{summaryLabel}</p>
      {pipeline.frameLeaves.length > 0 && <p>{frameLeavesLabel}: {pipeline.frameLeaves.flatMap(entry => entry.leaves).join(", ")}</p>}
      <p>{routes.filter(route => route.transport === "hash" && route.kind !== "detail-tab").length} bound hash patterns · {routes.filter(route => route.kind === "detail-tab").length} detail tabs · {routes.filter(route => route.kind !== "detail-tab" && route.transport === "next").length} native pages</p>
      <p>{configurationDescription}</p>
      <p>{stageDescription}</p>
      <p>{missingDecisions.length} {decisionsSummary}</p>
    </header>
    <Card variant="outline" role="region" aria-label="Scrollable App lane matrix" tabIndex={0} className="min-w-0 overflow-x-auto">
      <table aria-label="App publish stages" className="w-full min-w-[calc(var(--ui-layout-aside-w)*4)] border-collapse"><thead className="bg-surface-sunken"><tr><th scope="col" className={cell}>Lane</th>{APP_STAGES.map(stage => <th scope="col" className={cell} key={stage}>{stage}</th>)}</tr></thead>
        <tbody>{APP_LANES.map(lane => {
          const items = pages.filter(route => route.lane === lane), decisions = missingDecisions.filter(row => row.lane === lane), isExpanded = expanded.has(lane);
          return <Fragment key={lane}><tr><th scope="row" className={`${cell} bg-surface-sunken`}><Button type="button" aria-expanded={isExpanded} aria-controls={`${id}-${lane}`} aria-label={`${isExpanded ? "Collapse" : "Expand"} ${lane} · ${items.length} pages`} className="grid gap-xs text-left focus-visible:outline" onPress={() => setExpanded(current => { const next = new Set(current); if (next.has(lane)) next.delete(lane); else next.add(lane); return next; })}><strong>{isExpanded ? "−" : "+"} {lane}</strong><span>{items.length} pages</span><span>{items.length ? `${items.filter(route => evidence(route).state !== "ready").length} not ready` : "no pages yet"}</span>{decisions.length > 0 && <span>{decisions.length} {decisionsLabel}</span>}</Button></th>
            {APP_STAGES.map(stage => <td className={cell} key={stage}><div className="grid gap-sm">
              {items.filter(route => stage === evidence(route).column).map(route => <Fragment key={route.id}>{chip(route)}</Fragment>)}
              {stage === "Configure" && decisions.map(row => {
                /** @default "Open LABEL page decision · to do" */
                const openLabel = openDecisionLabel(row.label);
                return <Button key={row.id} type="button" className={`${pending} grid gap-xs text-left focus-visible:outline`} onPress={event => { opener.current = (event.target as HTMLButtonElement); setSelection({ kind: "decision", id: row.id }); }} aria-label={openLabel}><strong>{row.label}</strong><span>{decisionStatusLabel}</span><span>{noRouteLabel}</span></Button>; })}
            </div></td>)}
          </tr><tr id={`${id}-${lane}`} hidden={!isExpanded}><td colSpan={APP_STAGES.length + 1} className="bg-surface-base p-md">
            {decisions.length > 0 && <p>{decisions.map(row => row.label).join(", ")} {decisionSummary}</p>}
            {!items.length ? <p>no pages yet</p> : <table aria-label={`${lane} routes`} className="w-full border-collapse"><thead><tr>{["Item", "Path / Route", "Frame.config", "Layout.config", "Stages", "Findings"].map(label => <th scope="col" key={label} className={cell}>{label}</th>)}</tr></thead><tbody>{items.flatMap(page => [page, ...tabs(page)]).map(route => {
              /** @default "N findings" */
              const findingLabel = findingCountLabel(evidence(route).findings.length);
              return <tr key={route.id} id={`${id}-route-${encodeURIComponent(route.id)}`} hidden={route.parentRecordRoute !== null && !expandedPages.has(route.parentRecordRoute)} data-parent-page={route.parentRecordRoute ?? undefined} data-parent-subrow={route.parentSubrowId}><th scope="row" className={cell}><Button type="button" className="underline focus-visible:outline" onPress={event => open(route, (event.target as HTMLButtonElement))}>{route.parentRecordRoute ? `↳ ${route.label}` : route.label}</Button>{tabs(route).length > 0 && <Button type="button" className="mt-sm block underline focus-visible:outline" aria-expanded={expandedPages.has(route.id)} aria-controls={tabs(route).map(tab => `${id}-route-${encodeURIComponent(tab.id)}`).join(" ")} onPress={() => setExpandedPages(current => { const next = new Set(current); if (next.has(route.id)) next.delete(route.id); else next.add(route.id); return next; })}>{expandedPages.has(route.id) ? "Collapse" : "Expand"} {route.label} tabs · {tabs(route).length}</Button>}</th><td className={cell}><RouteIdentity route={route} /></td><td className={cell}>{route.kind === "detail-tab" ? "N/A · parent page owns Frame" : <>{configuration(route)?.frame.leaf ?? evidence(route).pipeline?.sourceBinding.frame.leaf ?? route.frame}<br />{configuration(route)?.frame.config ?? evidence(route).pipeline?.sourceBinding.frame.config ?? <>{missingConfigLabel}</>}<br />{!evidence(route).pipeline && <PlanningDescription description={messages?.defaultSettingsDescription} />}</>}</td><td className={cell}>{route.kind === "detail-tab" ? "N/A · parent page owns Layout" : <>{configuration(route)?.layout.config ?? evidence(route).pipeline?.sourceBinding.layout.config ?? route.layoutConfig}<br />{!evidence(route).pipeline && <PlanningDescription description={messages?.defaultSettingsDescription} />}</>}</td><td className={cell}>{stageStrip(route)}</td><td className={cell}>{configuration(route) ? <>{findingLabel} · {renderedPendingLabel}</> : <>{waitingForConfigureLabel}</>}</td></tr>; })}</tbody></table>}
          </td></tr></Fragment>;
        })}</tbody></table>
    </Card>
    {decision && <section aria-labelledby={decisionTitleId} className={`${panel} grid gap-md`}><header className="flex flex-wrap justify-between gap-md"><h2 id={decisionTitleId} ref={title} tabIndex={-1}>{decision.label} {decisionLabel}</h2><Button type="button" onPress={close}>{closeDecisionLabel}</Button></header><p>{decisionConfigureLabel}</p><p>{decision.lane} {decisionDescription}</p><p>{decisionInstructions}</p></section>}
    {selected && <section aria-labelledby={`${id}-detail`} className={`${panel} grid gap-md`}><header className="flex flex-wrap justify-between gap-md"><h2 id={`${id}-detail`} ref={title} tabIndex={-1}>{selected.label} · route details</h2><Button type="button" className="rounded border border-line-base p-sm focus-visible:outline" onPress={close}>Close route details</Button></header>
      <RouteIdentity route={selected} />
      {selected.kind === "detail-tab" ? <div><p>{inheritedSettingsLabel} {selected.parentRecordRoute}</p><Button type="button" className="underline" onPress={event => { const parent = pages.find(route => route.id === selected.parentRecordRoute); if (parent) open(parent, (event.target as HTMLButtonElement)); }}>{configureParentLabel}</Button></div> : <ProductionSettingsForm key={`${selected.id}-${!!configuration(selected)}-${JSON.stringify(configuration(selected))}`} initial={configuration(selected) ?? productionSettingsFromPlanItem(planItems.find(item => item.appRouteId === selected.id), suggestedAppSettings(selected, registries))} recommendationAnswerIds={planItems.find(item => item.appRouteId === selected.id)?.answerIds} deploymentSurfaceIds={deploymentSurfaceIds} messages={productionMessages} configured={!!configuration(selected)} registries={registries} onApply={value => configure(selected, value)} onReset={() => configure(selected)} />}
      {stageStrip(selected)}<InputQuestions requests={questions(selected)} />
      <ul className="grid gap-xs">{evidence(selected).stages.flatMap(stage => stage.reasons.map((reason, index) => <li key={`${stage.name}-${index}`}>{stage.name}: {reason}</li>))}</ul>
      {evidence(selected).pipeline && <><h3>{sourceFindingsLabel}</h3><ul>{evidence(selected).pipeline!.sourceFindings.map((finding, index) => <li key={index}>{finding.code}: {finding.path} · {finding.message}</li>)}</ul><h3>{effectiveFindingsLabel}</h3><ul>{evidence(selected).findings.map((finding, index) => <li key={index}>{finding.code}: {finding.path} · {finding.message}</li>)}</ul></>}
      <h3>Scoped source state declarations</h3><p>Declarations describe inspected source conditions, not an active failure or LK14 clearance.</p><dl>{APP_STATE_NAMES.map(name => { const state = selected.declaredStates[name];
        /** @default "STATE: DECLARATION · applicability: APPLICABILITY" */
        const declarationLabel = stateDeclarationLabel(name, state.declared, state.applicability ?? undecidedLabel);
        return <Fragment key={name}><dt>{declarationLabel}</dt><dd>{state.scope}{state.condition ? ` · ${state.condition}` : ""}</dd></Fragment>; })}</dl>
      {inventory.nonAddressableTabs.filter(row => row.hostRouteId === selected.id).map(row => <div key={row.hostRouteId}><h3>Local tabs</h3><ul>{row.tabIds.map(tab => <li key={tab}>{tab} · no URL route</li>)}</ul><p>Local tab identity is missing; this is not a check finding.</p></div>)}
    </section>}
  </div>;
}
