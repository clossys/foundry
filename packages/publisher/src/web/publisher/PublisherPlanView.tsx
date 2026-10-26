"use client";
import { Disclosure } from "@clossys/designer/components";
import { Button } from "@clossys/designer/components";
import { useState } from "react";
import { PUBLISHER_MENU, PUBLISHER_MENU_VERSION, PUBLISHER_MILESTONES, PUBLISHER_PACKS } from "../../planning/menu.js";
import { validatePublisherPlan } from "../../planning/plan.js";
import { recommendPlanItem, withPublisherConfiguration, configurationInputNeeds, derivePublisherDeliveryState } from "../../planning/configuration.js";
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

const panel = "grid gap-md rounded border border-line-base bg-surface-raised p-lg";
export function PublisherPlanView({ store, draft, onApply, messages, productionMessages, deploymentSurfaceIds, requirementMessages, onDraftChange }: { store: PublisherPlanStore; draft?: PublisherPlanDraft; onDraftChange?: (draft: PublisherPlanDraft) => void; onApply?: PublisherPlanApply; messages?: Partial<PublisherPlanMessages>; productionMessages?: Partial<ProductionSettingsFormMessages>; deploymentSurfaceIds?: readonly string[]; requirementMessages?: Partial<PublisherRequirementMessages> }) {
  const [pending, setPending] = useState(false), [error, setError] = useState<string>();
  /** @default 'Plan' */
  const planLabel = messages?.planLabel ?? 'Plan';
  /** @default 'Menu → proposed plan → Align → Configure → Ready' */
  const flowLabel = messages?.flowLabel ?? 'Menu → proposed plan → Align → Configure → Ready';
  /** @default 'Align records a version through the host apply callback. Plans and menu capabilities do not prove implementation, adoption or rendered readiness.' */
  const alignmentDescription = messages?.alignmentDescription ?? 'Align records a version through the host apply callback. Plans and menu capabilities do not prove implementation, adoption or rendered readiness.';
  /** @default 'Tell Publisher your milestones' */
  const emptyLabel = messages?.emptyLabel ?? 'Tell Publisher your milestones';
  /** @default 'Aligned version' */
  const alignedVersionLabel = messages?.alignedVersionLabel ?? 'Aligned version';
  /** @default 'No aligned plan' */
  const noAlignedPlanLabel = messages?.noAlignedPlanLabel ?? 'No aligned plan';
  /** @default 'Aligned plan versions' */
  const versionsLabel = messages?.versionsLabel ?? 'Aligned plan versions';
  /** @default 'Version' */
  const versionLabel = messages?.versionLabel ?? 'Version';
  /** @default 'aligned' */
  const alignedLabel = messages?.alignedLabel ?? 'aligned';
  /** @default 'Proposed plan' */
  const proposalLabel = messages?.proposalLabel ?? 'Proposed plan';
  /** @default 'Draft version' */
  const draftVersionLabel = messages?.draftVersionLabel ?? 'Draft version';
  /** @default 'Current milestone:' */
  const currentMilestoneLabel = messages?.currentMilestoneLabel ?? 'Current milestone:';
  /** @default '. Production tabs continue to show the aligned version.' */
  const draftDescription = messages?.draftDescription ?? '. Production tabs continue to show the aligned version.';
  /** @default 'Item:' */
  const itemLabel = messages?.itemLabel ?? 'Item:';
  /** @default 'Host reference:' */
  const hostReferenceLabel = messages?.hostReferenceLabel ?? 'Host reference:';
  /** @default 'Caused by answers:' */
  const answersLabel = messages?.answersLabel ?? 'Caused by answers:';
  /** @default 'Needs input' */
  const needsInputLabel = messages?.needsInputLabel ?? 'Needs input';
  /** @default 'Plan findings' */
  const findingsLabel = messages?.findingsLabel ?? 'Plan findings';
  /** @default 'Aligning…' */
  const aligningLabel = messages?.aligningLabel ?? 'Aligning…';
  /** @default 'Align plan' */
  const alignLabel = messages?.alignLabel ?? 'Align plan';
  /** @default 'A host approval/apply callback is required to Align.' */
  const missingApprovalLabel = messages?.missingApprovalLabel ?? 'A host approval/apply callback is required to Align.';
  /** @default 'Publisher menu' */
  const menuLabel = messages?.menuLabel ?? 'Publisher menu';
  /** @default 'Menu · version' */
  const menuVersionLabel = messages?.menuVersionLabel ?? 'Menu · version';
  /** @default 'Built means a mechanism exists. Concept-only offers stay in the plan and have no renderer.' */
  const capabilityDescription = messages?.capabilityDescription ?? 'Built means a mechanism exists. Concept-only offers stay in the plan and have no renderer.';
  /** @default 'Sections:' */
  const sectionsLabel = messages?.sectionsLabel ?? 'Sections:';
  /** @default 'Frames:' */
  const framesLabel = messages?.framesLabel ?? 'Frames:';
  /** @default 'Formats:' */
  const formatsLabel = messages?.formatsLabel ?? 'Formats:';
  /** @default 'none' */
  const noneLabel = messages?.noneLabel ?? 'none';
  /** @default 'Plan alignment failed' */
  const alignmentFailedLabel = messages?.alignmentFailedLabel ?? 'Plan alignment failed';
  /** @default 'Configure recommendation' */
  const configurationLabel = messages?.configurationLabel ?? 'Configure recommendation';
  /** @default 'Update proposed configuration' */
  const updateConfigurationLabel = messages?.updateConfigurationLabel ?? 'Update proposed configuration';
  /** @default 'Original recommendation' */
  const recommendationLabel = messages?.recommendationLabel ?? 'Original recommendation';
  /** @default 'Overrides' */
  const overridesLabel = messages?.overridesLabel ?? 'Overrides';
  /** @default 'Requirements' */
  const requirementsLabel = messages?.requirementsLabel ?? 'Requirements';
  /** @default 'Recommended deliveries' */
  const deliveryLabel = messages?.deliveryLabel ?? 'Recommended deliveries';
  /** @default 'Export' */
  const exportLabel = messages?.exportLabel ?? 'Export';
  /** @default 'Deploy' */
  const deployLabel = messages?.deployLabel ?? 'Deploy';
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
  return <div className="grid gap-lg">
    <header className={panel}><h2>{planLabel}</h2><p>{flowLabel}</p><p>{alignmentDescription}</p>
      {!draft && !store.current && <p>{emptyLabel}</p>}
      {store.current ? <p>{alignedVersionLabel} {store.current.version} · {store.current.currentMilestone}</p> : <p>{noAlignedPlanLabel}</p>}
      {store.versions.length > 0 && <ol aria-label={versionsLabel}>{store.versions.map(version => <li key={version.version}>{versionLabel} {version.version} · {alignedLabel} · {version.currentMilestone}<br /><code className="break-all">{version.digest}</code></li>)}</ol>}
    </header>
    {proposal && <section aria-label={proposalLabel} className={panel}><h3>{draftVersionLabel} {proposal.version}</h3><p>{currentMilestoneLabel} {proposal.currentMilestone}{draftDescription}</p>
      {proposal.milestones.map(m => <div key={m.id}><h4>{m.id} · {PUBLISHER_MILESTONES.find(preset => preset.id === m.id)?.label}</h4>{m.packs.map(pack => <div key={pack.id}><strong>{PUBLISHER_PACKS.find(entry => entry.id === pack.id)?.label}</strong><ul>{pack.items.map(sourceItem => {
        const item = recommendPlanItem(sourceItem), configuration = item.configuration, state = derivePublisherDeliveryState(configuration, store.registries);
        const format = configuration && "format" in configuration ? store.registries.formats.find(format => format.id === configuration.format) : undefined;
        /** @default The host Requirements label followed by the plan item ID. */
        const requirementsHeading = `${requirementsLabel} · ${item.id}`;
        /** @default The host Configure recommendation label followed by the plan item ID. */
        const configurationHeading = `${configurationLabel} · ${item.id}`;
        return <li key={item.id}>{PUBLISHER_MENU.find(entry => entry.id === item.menuRef)?.label ?? item.menuRef} · {item.lane} · {PUBLISHER_MENU.find(entry => entry.id === item.menuRef)?.status}<p>{itemLabel} <code>{item.id}</code>{(item.instanceId ?? item.appRouteId ?? item.assetId) && <> · {hostReferenceLabel} <code>{item.instanceId ?? item.appRouteId ?? item.assetId}</code></>}</p><p>{answersLabel} {item.answerIds.join(", ")}</p>
          <div><h5>{recommendationLabel}</h5><ConfigurationSummary configuration={item.recommendation?.configuration} messages={productionMessages} /></div>
          <div><h5>{overridesLabel}</h5><ul>{item.overrides?.map(override => <li key={override.field}>{configurationFieldLabel(override.field, productionMessages)}: {configurationValueLabel(override.original)} → {configurationValueLabel(override.value)}</li>)}</ul></div>
          <p>{exportLabel}: {state.export} · {deployLabel}: {state.deploy}</p>
          <InputQuestions label={requirementsHeading} needsInputLabel={needsInputLabel} requests={[...item.openNeeds, ...configurationInputNeeds(item, requirementMessages)]} />
          <Disclosure  title={<>{configurationLabel} · {item.id}</>}>{configuration?.kind === "web" ? <ProductionSettingsForm key={`${proposal.id}-${proposal.version}-${item.id}`} initial={configuration} resetTo={item.recommendation?.configuration.kind === "web" ? item.recommendation.configuration : undefined} configured={false} formatIds={["web.page.responsive"]} registries={store.registries} recommendationAnswerIds={item.answerIds} deploymentSurfaceIds={deploymentSurfaceIds} messages={{ ...productionMessages, heading: configurationLabel, applyLabel: updateConfigurationLabel }} onApply={settings => updateItem(withPublisherConfiguration(item, settings.format === "web.page.responsive" ? { kind: "web", format: settings.format, frame: settings.frame, layout: settings.layout, media: settings.media ?? configuration.media, deliveries: settings.deliveries ?? configuration.deliveries, ...(settings.deploymentSurface ? { deploymentSurface: settings.deploymentSurface } : {}) } : { kind: "concept-only", format: settings.format, deliveries: settings.deliveries ?? [] }))} onReset={() => updateItem(withPublisherConfiguration(item, item.recommendation!.configuration))} /> : configuration?.kind === "concept-only" ? <DeliverySettingsFields format={format} choices={configuration.deliveries} onChange={deliveries => updateItem(withPublisherConfiguration(item, { ...configuration, deliveries }))} messages={productionMessages} /> : <InputQuestions label={configurationHeading} needsInputLabel={needsInputLabel} requests={configurationInputNeeds(item, requirementMessages)} />}</Disclosure>
        </li>;
      })}</ul></div>)}</div>)}
      {findings.length > 0 && <ul aria-label={findingsLabel}>{findings.map((finding, index) => <li key={index}>{finding.path}: {finding.message}</li>)}</ul>}
      <Button type="button" isDisabled={!onApply || pending || findings.length > 0 || proposal.version <= (store.current?.version ?? 0)} onPress={align} className="rounded border border-line-base p-sm disabled:opacity-50 focus-visible:outline">{alignButtonLabel}</Button>
      {!onApply && <p>{missingApprovalLabel}</p>}{hasError && <p role="alert">{errorMessage}</p>}
    </section>}
    <section aria-label={menuLabel} className={panel}><h3>{menuVersionLabel} {PUBLISHER_MENU_VERSION}</h3><p>{capabilityDescription}</p>
      {PUBLISHER_MILESTONES.map(m => <Disclosure key={m.id} defaultExpanded={m.id === "M1"} title={<>{m.id} · {m.label} · {m.status}</>}><ul className="grid gap-md p-md">{PUBLISHER_MENU.filter(item => item.milestone === m.id).map(item => {
        /** @default Registered section needs, or "none". */
        const sections = item.needs.sections.join(", ") || noneLabel;
        /** @default Registered frame needs, or "none". */
        const frames = item.needs.frames.join(", ") || noneLabel;
        /** @default Registered format needs, or "none". */
        const formats = item.needs.formats.join(", ") || noneLabel;
        return <li key={item.id}><strong>{item.label}</strong> · {item.status}<p>{PUBLISHER_PACKS.find(pack => pack.id === item.pack)?.label} · {item.lanes.join(", ")}</p><p>{sectionsLabel} {sections} · {framesLabel} {frames} · {formatsLabel} {formats}</p><p>{requirementsLabel}: {[...item.requirements.brandAssets, ...item.requirements.contentRefs.map(ref => `${ref.slot}: ${ref.purpose}`), ...item.requirements.integrations].join(" · ")}</p>{item.recommendations.map(row => <div key={row.lane}><p>{row.lane} · {recommendationLabel} · {deliveryLabel}</p><ConfigurationSummary configuration={row.configuration} messages={productionMessages} /></div>)}</li>;
      })}</ul></Disclosure>)}
    </section>
  </div>;
}
