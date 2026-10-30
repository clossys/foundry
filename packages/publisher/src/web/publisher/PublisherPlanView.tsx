"use client";
import { Button } from "@clossys/designer/components";
import { DataTable, DetailView, NoticeList, ResourceList, StatGroup } from "@clossys/designer/blocks";
import { SlotModule } from "@clossys/designer/shell";
import { createPublisherValueNames } from "./value-names.js";
import { publisherCopy, PUBLISHER_COPY_REFS, type PublisherCopyResolver, type PublisherCopyRef } from "./copy.js";
import { useId, useMemo, useState } from "react";
import { PUBLISHER_MENU, PUBLISHER_MENU_VERSION, PUBLISHER_MILESTONES, PUBLISHER_PACKS, publisherMenuDisplay } from "../../planning/menu.js";
import { validatePublisherPlan, publisherPlanItemDisplay, publisherPlanNeedDisplay } from "../../planning/plan.js";
import { recommendPlanItem, withPublisherConfiguration, configurationInputNeeds, derivePublisherDeliveryState, publisherConfigurationDisplay } from "../../planning/configuration.js";
import type { PublisherRequirementMessages } from "../../planning/configuration.js";
import type { PublisherPlanItem } from "../../planning/plan.js";
import { ConfigurationSummary, configurationFieldLabel, configurationValueLabel, DeliverySettingsFields, InputQuestions, ProductionSettingsForm } from "./ProductionSettingsForm.js";
import type { ProductionSettingsFormMessages } from "./ProductionSettingsForm.js";
import type { PublisherPlanDraft } from "../../planning/plan.js";
import type { PublisherPlanApply, PublisherPlanStore } from "../../planning/change-set.js";

export interface PublisherPlanMessages {
  readonly planLabel: string;
  readonly flowLabel: string;
  readonly alignmentDescription: string;
  readonly emptyLabel: string;
  readonly alignedVersionLabel: string;
  readonly noAlignedPlanLabel: string;
  readonly versionsLabel: string;
  readonly versionLabel: string;
  readonly alignedLabel: string;
  readonly proposalLabel: string;
  readonly draftVersionLabel: string;
  readonly currentMilestoneLabel: string;
  readonly draftDescription: string;
  readonly itemLabel: string;
  readonly hostReferenceLabel: string;
  readonly answersLabel: string;
  readonly needsInputLabel: string;
  readonly findingsLabel: string;
  readonly aligningLabel: string;
  readonly alignLabel: string;
  readonly missingApprovalLabel: string;
  readonly menuLabel: string;
  readonly menuVersionLabel: string;
  readonly capabilityDescription: string;
  readonly sectionsLabel: string;
  readonly framesLabel: string;
  readonly formatsLabel: string;
  readonly noneLabel: string;
  readonly alignmentFailedLabel: string;
  readonly configurationLabel: string;
  readonly updateConfigurationLabel: string;
  readonly recommendationLabel: string;
  readonly overridesLabel: string;
  readonly requirementsLabel: string;
  readonly deliveryLabel: string;
  readonly exportLabel: string;
  readonly deployLabel: string;
}

export function PublisherPlanView({ copyResolver, routePathFor, store, draft, onApply, messages, productionMessages, deploymentSurfaceIds, requirementMessages, onDraftChange }: { copyResolver?: PublisherCopyResolver; routePathFor?: (item: PublisherPlanItem) => string | undefined; store: PublisherPlanStore; draft?: PublisherPlanDraft; onDraftChange?: (draft: PublisherPlanDraft) => void; onApply?: PublisherPlanApply; messages?: Partial<PublisherPlanMessages>; productionMessages?: Partial<ProductionSettingsFormMessages>; deploymentSurfaceIds?: readonly string[]; requirementMessages?: Partial<PublisherRequirementMessages> }) {
  const [selectedId, setSelectedId] = useState<string>();
  const [pending, setPending] = useState(false), [error, setError] = useState<string>();
  const id = useId();
  const valueNames = useMemo(() => copyResolver ? createPublisherValueNames(copyResolver) : undefined, [copyResolver]);
  const resolved = (ref: PublisherCopyRef | undefined) => publisherCopy(copyResolver, ref ?? PUBLISHER_COPY_REFS.needsInput);
  const name = (parent: string, key: string) => valueNames?.(parent, key) ?? resolved(undefined);
  const displayRequests = (requests: readonly { readonly slot: string; readonly question: string }[]) => requests.map(request => ({ ...request, question: resolved(publisherPlanNeedDisplay(request).questionRef) }));
  const planLabel = messages?.planLabel ?? name("publisher.planHeader", "planLabel");
  const flowLabel = messages?.flowLabel ?? name("publisher.planHeader", "flowLabel");
  const alignmentDescription = messages?.alignmentDescription ?? name("publisher.planHeader", "alignmentDescription");
  const emptyLabel = messages?.emptyLabel ?? name("publisher.planHeader", "emptyLabel");
  const alignedVersionLabel = messages?.alignedVersionLabel ?? name("publisher.planHeader", "alignedVersionLabel");
  const noAlignedPlanLabel = messages?.noAlignedPlanLabel ?? name("publisher.planHeader", "noAlignedPlanLabel");
  const versionsLabel = messages?.versionsLabel ?? name("publisher.planHeader", "versionsLabel");
  const versionLabel = messages?.versionLabel ?? name("publisher.planHeader", "versionLabel");
  const alignedLabel = messages?.alignedLabel ?? name("publisher.planHeader", "alignedLabel");
  const proposalLabel = messages?.proposalLabel ?? name("publisher.planHeader", "proposalLabel");
  const draftVersionLabel = messages?.draftVersionLabel ?? name("publisher.planHeader", "draftVersionLabel");
  const currentMilestoneLabel = messages?.currentMilestoneLabel ?? name("publisher.planHeader", "currentMilestoneLabel");
  const draftDescription = messages?.draftDescription ?? name("publisher.planHeader", "draftDescription");
  const itemLabel = messages?.itemLabel ?? name("publisher.planHeader", "itemLabel");
  const hostReferenceLabel = messages?.hostReferenceLabel ?? name("publisher.planHeader", "hostReferenceLabel");
  const answersLabel = messages?.answersLabel ?? name("publisher.planHeader", "answersLabel");
  const needsInputLabel = messages?.needsInputLabel ?? name("publisher.planHeader", "needsInputLabel");
  const findingsLabel = messages?.findingsLabel ?? name("publisher.planHeader", "findingsLabel");
  const aligningLabel = messages?.aligningLabel ?? name("publisher.planHeader", "aligningLabel");
  const alignLabel = messages?.alignLabel ?? name("publisher.planHeader", "alignLabel");
  const missingApprovalLabel = messages?.missingApprovalLabel ?? name("publisher.planHeader", "missingApprovalLabel");
  const menuLabel = messages?.menuLabel ?? name("publisher.planHeader", "menuLabel");
  const menuVersionLabel = messages?.menuVersionLabel ?? name("publisher.planHeader", "menuVersionLabel");
  const capabilityDescription = messages?.capabilityDescription ?? name("publisher.planHeader", "capabilityDescription");
  const sectionsLabel = messages?.sectionsLabel ?? name("publisher.planHeader", "sectionsLabel");
  const framesLabel = messages?.framesLabel ?? name("publisher.planHeader", "framesLabel");
  const formatsLabel = messages?.formatsLabel ?? name("publisher.planHeader", "formatsLabel");
  const noneLabel = messages?.noneLabel ?? name("publisher.planHeader", "noneLabel");
  const alignmentFailedLabel = messages?.alignmentFailedLabel ?? name("publisher.planHeader", "alignmentFailedLabel");
  const configurationLabel = messages?.configurationLabel ?? name("publisher.planHeader", "configurationLabel");
  const updateConfigurationLabel = messages?.updateConfigurationLabel ?? name("publisher.planHeader", "updateConfigurationLabel");
  const recommendationLabel = messages?.recommendationLabel ?? name("publisher.planHeader", "recommendationLabel");
  const overridesLabel = messages?.overridesLabel ?? name("publisher.planHeader", "overridesLabel");
  const requirementsLabel = messages?.requirementsLabel ?? name("publisher.planHeader", "requirementsLabel");
  const deliveryLabel = messages?.deliveryLabel ?? name("publisher.planHeader", "deliveryLabel");
  const exportLabel = messages?.exportLabel ?? name("publisher.planHeader", "exportLabel");
  const deployLabel = messages?.deployLabel ?? name("publisher.planHeader", "deployLabel");
  const [editing, setEditing] = useState<{ readonly source: PublisherPlanDraft; readonly value: PublisherPlanDraft }>();
  const proposal = editing?.source === draft ? editing?.value : draft;
  const updateItem = (item: PublisherPlanItem) => {
    if (!draft || !proposal) return;
    const value = { ...proposal, milestones: proposal.milestones.map(m => ({ ...m, packs: m.packs.map(pack => ({ ...pack, items: pack.items.map(existing => existing.id === item.id ? item : existing) })) })) };
    setEditing({ source: draft, value });
    onDraftChange?.(value);
  };
  const findings = proposal ? validatePublisherPlan(proposal, store.registries) : [];
  const align = async () => {
    if (!proposal || !onApply || pending) return;
    setPending(true); setError(undefined);
    try { await store.apply(store.propose(proposal), onApply); }
    catch (failure) { setError(failure instanceof Error ? failure.message : alignmentFailedLabel); }
    finally { setPending(false); }
  };
  /** @default "Aligning…" while pending, otherwise "Align plan". */
  const alignButtonLabel = pending ? aligningLabel : alignLabel;
  /** @default The host apply error, with "Plan alignment failed" as fallback. */
  const errorMessage = error;
  const hasError = Boolean(error);
  const productionCopy = { ...productionMessages, valueNames };
  const items = proposal?.milestones.flatMap(m => m.packs.flatMap(pack => pack.items)) ?? [];
  const selected = items.find(item => item.id === selectedId);
  const itemName = (item: PublisherPlanItem) => {
    const routePath = routePathFor?.(item);
    return resolved(publisherPlanItemDisplay(item, routePath && ["/agents/designer", "/agents/writer", "/agents/publisher"].includes(routePath) ? routePath : undefined).labelRef);
  };
  const selectedItem = selected && recommendPlanItem(selected);
  const selectedConfiguration = selectedItem?.configuration;
  const format = selectedConfiguration && "format" in selectedConfiguration ? store.registries.formats.find(format => format.id === selectedConfiguration.format) : undefined;
  const configurationFacts = (configuration: Parameters<typeof publisherConfigurationDisplay>[0]) => {
    const display = publisherConfigurationDisplay(configuration);
    return <DetailView fields={[
      { label: formatsLabel, value: resolved(display.formatRef) },
      ...(configuration?.kind === "web" ? [{ label: framesLabel, value: resolved(display.frameRef) }, { label: configurationLabel, value: <>{resolved(display.layoutRef)} · {resolved(display.layoutConfigRef)}</> }] : []),
      { label: deliveryLabel, value: display.deliveries.map((delivery, index) => <span key={index}>{resolved(delivery.labelRef)}{delivery.fidelityRef ? <> · {resolved(delivery.fidelityRef)}</> : null}</span>) },
    ]} />;
  };
  return <>
    <section data-publisher-plan-stage="" className="grid min-w-0 gap-lg">
      <DetailView title={planLabel} fields={[
        { label: flowLabel, value: alignmentDescription, span: 2 },
        { label: alignedVersionLabel, value: store.current ? <>{store.current.version} · {name("publisher.milestone", store.current.currentMilestone)}</> : noAlignedPlanLabel },
      ]} />
      <DataTable aria-label={versionsLabel} rows={store.versions} rowKey={version => version.version} columns={[
        { id: "version", header: versionLabel, isRowHeader: true, cell: version => version.version },
        { id: "milestone", header: currentMilestoneLabel, cell: version => name("publisher.milestone", version.currentMilestone) },
      ]} emptyStateTitle={emptyLabel} />
      {proposal && <>
        <StatGroup aria-label={proposalLabel} items={proposal.milestones.map(milestone => ({ id: milestone.id, label: name("publisher.milestone", milestone.id), value: milestone.packs.flatMap(pack => pack.items).length }))} />
        <ResourceList aria-label={proposalLabel} items={items.map(item => ({ id: item.id, textValue: itemName(item), title: itemName(item), description: name("publisher.lane", item.lane), actions: [{ id: "configure", label: configurationLabel, onAction: () => setSelectedId(item.id) }] }))}
          actionsLabel={name => name} onAction={setSelectedId} emptyState={{ title: emptyLabel, description: draftDescription }}
          footer={<Button type="button" isDisabled={!onApply || pending || findings.length > 0 || proposal.version <= (store.current?.version ?? 0)} onPress={align}>{alignButtonLabel}</Button>} />
      </>}
      {(hasError || !!proposal && !onApply || findings.length > 0) && <NoticeList label={findingsLabel} notices={[
        ...(proposal && !onApply ? [{ id: "approval", message: missingApprovalLabel }] : []),
        ...(hasError ? [{ id: "alignment", message: alignmentFailedLabel, tone: "danger" as const }] : []),
        ...findings.map((finding, index) => ({ id: `finding-${index}`, message: <span data-publisher-plan-finding={finding.message}>{findingsLabel}</span>, tone: "warning" as const })),
      ]} />}
      <ResourceList aria-label={menuLabel} items={PUBLISHER_MENU.map(item => { const display = publisherMenuDisplay(item); return { id: item.id, textValue: resolved(display.labelRef), title: resolved(display.labelRef), description: resolved(display.milestoneRef), meta: resolved(display.packRef) }; })} emptyState={{ title: emptyLabel, description: capabilityDescription }} />
    </section>
    {selectedItem && <SlotModule id={`${id}-publisher-plan-inspector`} slot="right-panel" label={itemName(selectedItem)}>
      <DetailView className="[&_strong]:font-medium" data-publisher-display-needs={JSON.stringify(publisherConfigurationDisplay(selectedConfiguration).needsInput)} title={itemName(selectedItem)} actions={<Button variant="ghost" onPress={() => setSelectedId(undefined)}>{publisherCopy(copyResolver, PUBLISHER_COPY_REFS.closeDetails)}</Button>} fields={[
        { label: recommendationLabel, value: configurationFacts(selectedItem.recommendation?.configuration), span: 2 },
        { label: overridesLabel, value: selectedItem.overrides?.length ? selectedItem.overrides.map(override => configurationFieldLabel(override.field, productionCopy)).join(", ") : noneLabel },
        { label: requirementsLabel, value: <InputQuestions valueNames={valueNames} label={requirementsLabel} needsInputLabel={needsInputLabel} requests={displayRequests([...selectedItem.openNeeds, ...configurationInputNeeds(selectedItem, requirementMessages)])} />, span: 2 },
        { label: configurationLabel, value: selectedConfiguration?.kind === "web" ? <ProductionSettingsForm key={`${proposal!.id}-${proposal!.version}-${selectedItem.id}`} initial={selectedConfiguration} resetTo={selectedItem.recommendation?.configuration.kind === "web" ? selectedItem.recommendation.configuration : undefined} configured={false} formatIds={["web.page.responsive"]} registries={store.registries} recommendationAnswerIds={selectedItem.answerIds} deploymentSurfaceIds={deploymentSurfaceIds} messages={{ ...productionCopy, heading: configurationLabel, applyLabel: updateConfigurationLabel }} onApply={settings => updateItem(withPublisherConfiguration(selectedItem, settings.format === "web.page.responsive" ? { kind: "web", format: settings.format, frame: settings.frame, layout: settings.layout, media: settings.media ?? selectedConfiguration.media, deliveries: settings.deliveries ?? selectedConfiguration.deliveries, ...(settings.deploymentSurface ? { deploymentSurface: settings.deploymentSurface } : {}) } : { kind: "concept-only", format: settings.format, deliveries: settings.deliveries ?? [] }))} onReset={() => updateItem(withPublisherConfiguration(selectedItem, selectedItem.recommendation!.configuration))} /> : selectedConfiguration?.kind === "concept-only" ? <DeliverySettingsFields format={format} choices={selectedConfiguration.deliveries} onChange={deliveries => updateItem(withPublisherConfiguration(selectedItem, { ...selectedConfiguration, deliveries }))} messages={productionCopy} /> : null, span: 2 },
      ]} />
    </SlotModule>}
  </>;
}
