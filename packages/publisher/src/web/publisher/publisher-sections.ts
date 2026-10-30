import { isRegionPageRouteRegistration, routeInstanceBinding } from "../../core/route-identities.js";
import type { InstanceBinding, InstanceRegistries } from '../../core/instance-binding.js';
import type { PublisherPlanDraft } from '../../planning/plan.js';
import type { PublisherPlanVersion } from '../../planning/change-set.js';
import { PUBLISHER_MILESTONES } from '../../planning/menu.js';
import { configurationInputNeeds, derivePublisherDeliveryState, recommendPlanItem, type PublisherConfiguration } from '../../planning/configuration.js';
import type { FormatLeaf } from '../../formats/contract.js';
import { projectPublisherChannelProcess, type PublisherChannel, type PublisherChannelItem } from './publisher-channels.js';
import type { PublisherPipelineItem } from './pipeline.js';
import type { AppPipelineItem } from './app/pipeline.js';
import type { AppRoute } from './app/inventory.js';
import type { BrandAssetEntry } from '../../media/brand-assets.js';
import type { ProductionSettings, PublisherInputRequest } from './production-settings.js';
import { productionSettingsFromBinding, productionSettingsFromPlanItem } from './production-settings.js';
import { deriveItemAssembly, type AssemblyOwnerHref } from './assembly/assembly.js';
export type PublisherSectionCommand =
  | { readonly kind: 'select-item'; readonly itemId: string }
  | { readonly kind: 'select-milestone'; readonly milestoneId: string }
  | { readonly kind: 'close-item' | 'inspect-format' | 'close-format' | 'toggle-commerce' }
  | { readonly kind: 'configure'; readonly itemId: string; readonly settings: ProductionSettings }
  | { readonly kind: 'reset-configuration'; readonly itemId: string }
  | { readonly kind: 'plan-configuration'; readonly itemId: string; readonly configuration: PublisherConfiguration };
export type PublisherCell = { readonly kind: 'text'; readonly text: string } | { readonly kind: 'action'; readonly label: string; readonly command: PublisherSectionCommand } | { readonly kind: 'link'; readonly label: string; readonly href: string };
export interface PublisherTableRow { readonly id: string; readonly cells: Readonly<Record<string, PublisherCell>> }
interface Base { readonly id: string; readonly label: string }
export type PublisherSectionData =
  | Base & { readonly section: 'sections.notices'; readonly notices: readonly { readonly id: string; readonly message: string; readonly tone: 'danger' | 'warning' }[] }
  | Base & { readonly section: 'sections.data-table'; readonly columns: readonly { readonly id: string; readonly label: string }[]; readonly rows: readonly PublisherTableRow[]; readonly grouping?: string; readonly selectedId?: string; readonly toolbar?: readonly PublisherCell[] }
  | Base & { readonly section: 'sections.record-detail'; readonly fields: readonly { readonly id: string; readonly label: string; readonly value: string }[]; readonly actions: readonly PublisherCell[] }
  | Base & { readonly section: 'sections.form'; readonly itemId: string; readonly fields: { readonly kind: 'production'; readonly initial: ProductionSettings; readonly configured: boolean; readonly answerIds: readonly string[] } | { readonly kind: 'planning'; readonly configuration?: PublisherConfiguration; readonly formats: readonly FormatLeaf[] }; readonly requests: readonly PublisherInputRequest[] }
  | Base & { readonly section: 'sections.empty-state' | 'sections.error-state'; readonly message: string };
export interface PublisherSectionsInput {
  readonly plan?: PublisherPlanDraft | PublisherPlanVersion;
  readonly channels: readonly PublisherChannel[];
  readonly activeChannelId?: string;
  readonly selectedItemId?: string;
  readonly configurations: Readonly<Record<string, PublisherConfiguration | undefined>>;
  readonly settings: Readonly<Record<string, ProductionSettings | undefined>>;
  readonly webItems: readonly PublisherPipelineItem[];
  readonly appItems: readonly AppPipelineItem[];
  readonly routes: readonly AppRoute[];
  readonly registries: InstanceRegistries;
  readonly brandAssets?: Readonly<Record<string, readonly BrandAssetEntry[]>>;
  readonly versions: readonly PublisherPlanVersion[];
  readonly historyOpen: boolean;
  readonly formatOpen: boolean;
  readonly notices: readonly { readonly id: string; readonly message: string; readonly tone: 'danger' | 'warning' }[];
  readonly commerceOnly: boolean;
  readonly itemHrefs?: Readonly<Record<string, string>>;
  readonly formatOwnerHref?: string;
  readonly assemblyOwnerHref?: AssemblyOwnerHref;
}
const text = (value: unknown): Extract<PublisherCell, { kind: 'text' }> => ({ kind: 'text', text: value == null ? '—' : Array.isArray(value) ? value.join(', ') : String(value) });
const action = (label: string, command: PublisherSectionCommand): PublisherCell => ({ kind: 'action', label, command });
const table = (id: string, label: string, columns: readonly string[], rows: readonly PublisherTableRow[], extra: { grouping?: string; selectedId?: string; toolbar?: readonly PublisherCell[] } = {}): PublisherSectionData => ({ id, label, section: 'sections.data-table', columns: columns.map(id => ({ id, label: id })), rows, ...extra });
/** Actual controller observations become existing registered Sections, never an old-page body slot. */
export function projectPublisherSections(input: PublisherSectionsInput): readonly PublisherSectionData[] {
  const out: PublisherSectionData[] = [];
  if (input.notices.length) out.push({ id: 'P0', label: 'Publisher notices', section: 'sections.notices', notices: input.notices });
  const history = () => table('P9', 'Aligned plan history', ['plan','version','alignment','milestone','items'], input.versions.map(version => ({ id: `${version.id}/${version.version}`, cells: { plan: text(version.id), version: text(version.version), alignment: text(version.status), milestone: text(version.currentMilestone), items: text(version.milestones.flatMap(m => m.packs.flatMap(p => p.items)).length) } })));
  const active = input.channels.find(channel => channel.id === input.activeChannelId) ?? (input.channels.length === 1 ? input.channels[0] : undefined);
  if (input.channels.length > 1 && !active) throw new TypeError('Publisher Sections require the actual active channel');
  if (!active) return [...out, { id: 'publisher-empty', label: 'Tell Publisher your milestones', section: 'sections.empty-state', message: 'No delivery items are aligned or proposed.' }, ...(input.historyOpen ? [history()] : [])];
  const aligned = input.plan?.status === 'aligned';
  const planOwners = input.plan?.milestones.flatMap(milestone => milestone.packs.flatMap(pack => pack.items.map(item => ({ item, packId: pack.id, milestone: milestone.id })))) ?? [];
  const registered = (row: PublisherChannelItem) => row.route;
  const exactRegistration = (row: PublisherChannelItem) => {
    if (!row.route) return true;
    const { registration, owner, findings } = row.route, binding = routeInstanceBinding(registration);
    const owners = planOwners.filter(owner => owner.item === row.item && owner.packId === row.packId && owner.milestone === row.milestone);
    return owners.length === 1 && row.route.item === row.item && registration.planItemId === row.item.id && registration.routeId === row.item.appRouteId
      && registration.channel === row.channel && owner?.packId === row.packId && owner.milestone === row.milestone
      && !findings.length && (!binding ? isRegionPageRouteRegistration(registration) : binding.path === registration.path && binding.packIds.includes(row.packId)
      && (!row.item.frame || row.item.frame.leaf === binding.frame.leaf && row.item.frame.config === binding.frame.config)
      && (!row.item.layout || row.item.layout.leaf === binding.layout?.leaf && row.item.layout.config === binding.layout?.config));
  };
  const webItem = (row: PublisherChannelItem) => row.route ? undefined : input.webItems.find(item => item.binding.instanceId === row.item.instanceId);
  const appItem = (row: PublisherChannelItem) => row.route ? undefined : input.appItems.find(item => item.route.id === row.item.appRouteId);
  const route = (row: PublisherChannelItem) => row.route ? undefined : input.routes.find(route => route.id === row.item.appRouteId);
  const label = (row: PublisherChannelItem) => registered(row)?.registration.title ?? route(row)?.label ?? row.menu.label;
  const eligibleRows = active.items.filter(exactRegistration);
  if (eligibleRows.length !== active.items.length) {
    const notice = { id: 'registered-route-ownership', message: 'Registered route ownership or composition is invalid; affected rows require input.', tone: 'danger' as const };
    const existing = out[0];
    if (existing?.section === 'sections.notices') out[0] = { ...existing, notices: [...existing.notices, notice] };
    else out.push({ id: 'P0', label: 'Publisher notices', section: 'sections.notices', notices: [notice] });
  }
  const process = projectPublisherChannelProcess(eligibleRows, { aligned, webItems: input.webItems, appItems: input.appItems });
  const processItems = process.lanes.flatMap(lane => lane.items);
  const state = (row: PublisherChannelItem) => processItems.find(item => item.id === row.item.id)?.state ?? 'needs input';
  const configuration = (row: PublisherChannelItem) => input.configurations[row.item.id] ?? recommendPlanItem(row.item).configuration;
  out.push(table('P1', `${active.label} milestones`, ['milestone','label','count','alignment'], PUBLISHER_MILESTONES.map(milestone => ({ id: milestone.id, cells: { milestone: action(milestone.id, { kind: 'select-milestone', milestoneId: milestone.id }), label: text(milestone.label), count: text(eligibleRows.filter(row => row.milestone === milestone.id).length), alignment: text(`${input.plan?.status ?? 'draft'} v${input.plan?.version ?? 0}`) } })), { selectedId: input.plan?.currentMilestone }));
  out.push(table('P2', `${active.label} delivery items`, ['item','lane','parent','host-ref','output-format','state','first-blocker', ...process.stages, 'export','deploy','pack','milestone'], processItems.filter(item => !input.commerceOnly || item.row.facets.includes('commerce')).map(item => {
    const row = item.row, config = configuration(row), delivery = derivePublisherDeliveryState(config, input.registries);
    return { id: item.id, cells: { item: action(item.label, { kind: 'select-item', itemId: item.id }), lane: text(row.item.lane), parent: text(item.parentSubrowId ?? item.parentId), 'host-ref': text(item.path ?? row.item.instanceId ?? row.item.appRouteId), 'output-format': text(routeInstanceBinding(row.route?.registration)?.format ?? (config && 'format' in config ? config.format : undefined)), state: text(item.state), 'first-blocker': text(item.column), ...Object.fromEntries(item.stages.map(stage => [stage.name, text(`${stage.status}${stage.reasons.length ? ` · ${stage.reasons.join('; ')}` : ''}`)])), export: text(delivery.export), deploy: text(delivery.deploy), pack: text(row.route?.owner?.packId ?? row.packId), milestone: text(row.route?.owner?.milestone ?? row.milestone) } };
  }), { grouping: 'lane', selectedId: input.selectedItemId, toolbar: active.items.some(row => row.facets.includes('commerce')) ? [action('Commerce', { kind: 'toggle-commerce' })] : [] }));
  const selectedProcess = processItems.find(item => item.id === input.selectedItemId);
  const selected = selectedProcess?.row;
  if (selected) {
    const registration = selected.route, registeredBinding = exactRegistration(selected) ? routeInstanceBinding(registration?.registration) : undefined;
    const sourceRoute = selectedProcess?.app?.route ?? route(selected), web = selectedProcess?.web ?? webItem(selected), app = selectedProcess?.app ?? appItem(selected), pipeline = web ?? app?.pipeline;
    const settings = input.settings[registeredBinding?.instanceId ?? selected.item.instanceId ?? sourceRoute?.parentRecordRoute ?? sourceRoute?.id ?? ''];
    const config = configuration(selected), format = input.registries.formats.find(format => config && 'format' in config && format.id === config.format);
    const fields = { item: selected.item.id, route: sourceRoute?.id ?? selected.item.appRouteId, path: registration?.registration.path ?? sourceRoute?.path ?? pipeline?.binding.path, pack: registration?.owner?.packId ?? selected.packId, milestone: registration?.owner?.milestone ?? selected.milestone, lane: selected.item.lane, ...(selectedProcess?.parentId ? { 'parent item': selectedProcess.parentId, 'selected subrow': selectedProcess.id } : {}), 'answer IDs': selected.item.answerIds.join(', '), configuration: settings ? 'configured' : config ? 'recommended or planned' : 'needs input', state: selectedProcess?.state ?? state(selected), ...(registration ? { 'route lifecycle': registration.status, 'route findings': registration.findings.map(finding => `${finding.path}: ${finding.message}`).join('; '), pending: registration.pending.join('; ') } : {}) };
    const itemHref = selectedProcess?.parentId
      ? input.itemHrefs?.[selectedProcess.id] ?? sourceRoute?.path
      : input.itemHrefs?.[selected.item.id] ?? (registeredBinding ? registration?.registration.path : undefined);
    out.push({ id: 'P3', label: `${selectedProcess?.label ?? label(selected)} · item details`, section: 'sections.record-detail', fields: Object.entries(fields).map(([id,value]) => ({ id, label: id, value: text(value).text })), actions: [action('Close item details', { kind: 'close-item' }), ...(itemHref ? [{ kind: 'link' as const, label: 'Open item', href: itemHref }] : [])] });
    const sourceLayout = sourceRoute && input.registries.layouts.find(layout => layout.contract.configs.some(config => config.id === sourceRoute.layoutConfig));
    const fallback: ProductionSettings | undefined = registeredBinding ? registeredBinding.layout ? productionSettingsFromBinding(registeredBinding) : undefined : registration ? undefined : pipeline ? productionSettingsFromBinding(pipeline.sourceBinding) : sourceRoute && sourceLayout ? { format: 'web.page.responsive', frame: { leaf: sourceRoute.frame as ProductionSettings['frame']['leaf'] }, layout: { leaf: sourceLayout.id, config: sourceRoute.layoutConfig } } : undefined;
    const requests = [...selected.item.openNeeds, ...configurationInputNeeds(selected.item), ...(app?.inputRequests ?? web?.inputRequests ?? []), ...(registration ? registration.pending.map(question => ({ slot: 'registered-route', question })) : [])];
    const production = aligned ? fallback : undefined;
    out.push({ id: 'P4', label: 'Configure production settings', section: 'sections.form', itemId: selected.item.id,
      fields: production ? { kind: 'production', initial: settings ?? (registration ? production : productionSettingsFromPlanItem(selected.item, production)), configured: !!settings, answerIds: selected.item.answerIds } : { kind: 'planning', configuration: config, formats: input.registries.formats.filter(format => selected.channel === 'messages' ? format.id === 'email.html' : selected.channel === 'documents' ? !format.id.startsWith('web.') && format.id !== 'email.html' : format.id === 'web.page.responsive') },
      requests });
    out.push(table('P5', 'Asset requirements and inputs', ['requirement','reference','evidence'], selected.menu.requirements.brandAssets.map(role => {
      const references = Object.values(input.brandAssets ?? {}).flat().filter(entry => role === 'favicon' ? entry.role.startsWith('favicon-') : role === 'share-image' ? ['open-graph','twitter-image'].includes(entry.role) : role === 'app-icons' ? ['apple-touch-180','maskable-192','maskable-512'].includes(entry.role) : false);
      return { id: role, cells: { requirement: text(role), reference: text(references.map(entry => entry.role)), evidence: text(references.length ? 'Reference supplied · coverage proof pending' : 'Needs input · choose a Designer asset reference') } };
    }).concat(requests.map((request,index) => ({ id: `input/${request.slot}/${index}`, cells: { requirement: text(request.question), reference: text(request.slot), evidence: text('Needs input') } })))));
    const stages = selectedProcess?.stages ?? [];
    out.push(table('P6', 'Publish evidence', ['stage','status','reasons','source'], stages.map(stage => ({ id: stage.name, cells: { stage: text(stage.name), status: text(stage.status), reasons: text(stage.reasons), source: text(registration ? registration.findings.map(finding => `${finding.path}: ${finding.message}`) : [...(pipeline?.sourceFindings ?? []), ...(pipeline?.findings ?? [])].map(finding => `${finding.code} ${finding.path}: ${finding.message}`)) } })), { grouping: 'stage', toolbar: format ? [action('Inspect output format', { kind: 'inspect-format' })] : [] }));
    const assemblyBinding = registeredBinding ?? pipeline?.binding;
    if (aligned && (registration || pipeline?.configured) && assemblyBinding) {
      const nodes: PublisherTableRow[] = pipeline?.configured ? deriveItemAssembly(pipeline, input.registries).map(node => {
        const href = input.assemblyOwnerHref?.(node);
        return { id: node.owner, cells: { node: text(node.summary), kind: text(node.owner), owner: href ? { kind: 'link', label: node.owner, href } : text(node.owner), 'depends-on': text(node.references), stage: text(node.status), findings: text(node.findings.map(finding => `${finding.code} ${finding.path}: ${finding.message}`)), detail: text(node.detail) } };
      }) : [
        { id: 'registered/frame', cells: { node: text(assemblyBinding.frame.leaf), kind: text('Frames'), owner: text(assemblyBinding.frame.leaf), 'depends-on': text(assemblyBinding.frame.config), stage: text('pending'), detail: text('Registered binding only; consumer runtime qualification pending') } },
        { id: 'registered/body', cells: { node: text(assemblyBinding.body?.kind), kind: text('Body'), owner: text(assemblyBinding.instanceId), 'depends-on': text(assemblyBinding.layout ? `${assemblyBinding.layout.leaf} · ${assemblyBinding.layout.config}` : assemblyBinding.body?.kind === 'canvas' ? assemblyBinding.body.arrangement.kind : undefined), stage: text('pending'), detail: text('Registered substrate and assembly references; runtime checks pending') } },
      ];
      out.push(table('P7', 'Item assembly', ['node','kind','owner','depends-on','stage','findings','detail'], [...nodes, ...bindingBreakdown(assemblyBinding, input.registries, pipeline)], { toolbar: [action('Inspect output format', { kind: 'inspect-format' })] }));
    }
    if (input.formatOpen && format) out.push({ id: 'P8', label: format.label, section: 'sections.record-detail', fields: [
      { id: 'id', label: 'Format', value: format.id }, { id: 'status', label: 'Status', value: format.status }, { id: 'size', label: 'Size', value: JSON.stringify(format.size) }, { id: 'deliveries', label: 'Delivery choices', value: format.deliveries.map(delivery => `${delivery.id} · ${delivery.status}${delivery.fidelityChoices ? ` · ${delivery.fidelityChoices.join(', ')}` : ''}`).join('; ') }, { id: 'compositions', label: 'Compositions', value: format.allowedCompositions.join(', ') },
    ], actions: [action('Close output format', { kind: 'close-format' }), ...(input.formatOwnerHref ? [{ kind: 'link' as const, label: 'Open format owner', href: input.formatOwnerHref }] : [])] });
  }
  if (input.historyOpen) out.push(history());
  return out;
}

/** Slot addresses and content references are read directly from the supplied assembly. */
function bindingBreakdown(binding: InstanceBinding, registries: InstanceRegistries, pipeline?: PublisherPipelineItem): readonly PublisherTableRow[] {
  const fills = [...Object.entries(binding.fills).flatMap(([slot, fills]) => fills.map((fill, index) => ({ path: `fills.${slot}.${index}`, fill }))), ...Object.entries(binding.frame.slotFills ?? {}).map(([slot, fill]) => ({ path: `frame.slotFills.${slot}`, fill }))];
  return fills.flatMap(({ path, fill }) => {
    const slots = registries.sections.find(section => section.id === fill.section)?.contract.slots ?? [];
    const names = [...new Set([...slots.map(slot => slot.name), ...Object.keys(fill.content)])];
    return (names.length ? names : ['']).map(name => {
      const reference = fill.content[name], address = name ? `${path}.content.${name}` : path;
      const findings = [...(pipeline?.sourceFindings ?? []), ...(pipeline?.findings ?? [])].filter(finding => finding.path === address || finding.path.startsWith(`${address}.`));
      return { id: `binding/${address}`, cells: {
        node: text(address), kind: text('Content binding'), owner: text(fill.section), 'depends-on': text(reference ? `${reference.kind} · ${reference.ref}` : 'Needs input · content reference missing'),
        stage: text(findings.length ? 'failed' : 'pending'), findings: text(findings.map(finding => `${finding.code} ${finding.path}: ${finding.message}`)),
        detail: text(`${fill.section}${fill.config ? ` · ${fill.config}` : ''} · ${reference ? 'Reference supplied; audience content qualification pending' : 'Content input required'}`),
      } };
    });
  });
}
