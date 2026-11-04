'use client';
/**
 * The one Studio renderer. A served path resolves through the Studio map to a Publisher page
 * record (frame + ordered sections + bindings); the record's loader turns Producer data into
 * each section's contract input, and the pinned frame and sections render it. No page has its
 * own component and nothing here knows an agent: the agent a page reads is its record's data.
 */
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { ArrowRightIcon } from 'lucide-react';
import type { ContentMapEntry } from '@clossys/publisher/content-map';
import { studioFrames, studioSections } from '../generated/assembly-bindings';
import { studioPages, type StudioAssemblySpec, type StudioPageRecord } from '../generated/studio-map';
import { PageNotice, type PageNoticeData, type PopoverSpec } from '../frames/studio-shell';
import type { ChecksInput } from '../sections/studio-checks';
import type { HistoryInput } from '../sections/studio-history';
import type { HomeCensus, HomeCensusLabels, HomeInput } from '../sections/studio-home';
import type { ModuleCheckGroup, ModuleCheckRow, ModuleChecksInput } from '../sections/module-checks';
import type { OptionsInput } from '../sections/studio-options';
import type { PageHeaderInput } from '../sections/studio-page-header';
import type { PageTabsInput } from '../sections/studio-page-tabs';
import type { SystemEmptyInput } from '../sections/producer-system-empty';
import type { SlotGroupsInput, SlotTone } from '../sections/studio-slot-groups';
import { slotCardSpecimen, slotDetailInputs, versionLabel } from '../lib/slot-detail';
import { studioShellCopy } from '../lib/shell-copy';
import { studioCopy } from '../lib/studio-copy';
import { studioIcon } from '../lib/studio-icons';
import type { StudioReport } from '../lib/studio-report';
import { resolveStudioRoute, studioGroupOf, studioGroups, studioLanding, studioLeafHref, studioLeafTitle, studioAgentRecords, studioRecordTabs, studioShellProjection, type StudioRoute } from '../lib/studio-route-map';
import { useSlotCensus } from '../lib/slot-census';
import { pipelineInputs, type PipelineGraphFile } from '../lib/pipeline-flow';
import { loadLeaf, loadPipeline, loadSlotGroups, type LeafRecord, type SlotGroupsRecord, type StudioPageSeed } from '../lib/studio-seed';
import { useStudioData, useThemeMode, type Resource } from './StudioProviders';
import { useStudioRoutes } from './StudioRouteMap';

type Inputs = Record<string, unknown>;
/** What a page's modules show, by manifest source: the checks. The outline is derived from the placed sections. */
interface ModuleData { checks?: ModuleChecksInput }
type Loaded = { state: 'loading' } | { state: 'notice'; notice: PageNoticeData } | { state: 'ready'; inputs: Inputs; modules?: ModuleData };
interface LoaderProps { entry: ContentMapEntry; page: StudioPageRecord; spec: StudioAssemblySpec; slug?: string }

const SEVERITY_TONE: Record<string, ModuleCheckRow['tone']> = { error: 'destructive', warning: 'outline', info: 'secondary' };
/** A slot card's tone by its shown state. */
const STATUS_TONE: Record<string, SlotTone> = { active: 'secondary', draft: 'outline', missing: 'outline', failing: 'destructive' };
/** A report's severity as shown (Writer copy). */
const SEVERITY_LABEL: Record<string, string> = { error: studioCopy('studio.severity-error'), warning: studioCopy('studio.severity-warning'), info: studioCopy('studio.severity-info') };
/** A placed section's root, by the slot id the assembly's generated provenance marks it with. */
const sectionTarget = (slot: string) => `[data-clossys-slot=${JSON.stringify(slot)}]`;
const message = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;
const pageById = new Map(studioPages.map(page => [page.id, page]));

/* Module data: what the checks module shows, from the same records the sections read. */

const needRow = (report: StudioReport): ModuleCheckRow => ({ id: report.id, badge: SEVERITY_LABEL[report.severity] ?? report.severity, tone: SEVERITY_TONE[report.severity] ?? 'outline', title: report.title, detail: report.detail });
const openNeeds = (reports: readonly StudioReport[], keep: (report: StudioReport) => boolean = () => true) => reports.filter(report => report.severity !== 'info' && report.area !== 'compile' && keep(report));

function checksInput(failing: readonly ModuleCheckRow[], options: readonly ModuleCheckRow[], needs: readonly ModuleCheckRow[]): ModuleChecksInput {
  const total = failing.length + options.length + needs.length;
  return {
    summary: total ? studioCopy("studio.page-attention-count", { count: total }) : studioCopy("studio.nothing-needs-attention-on-this-page"),
    groups: [
      { id: 'failing', label: studioCopy("studio.failing-checks"), empty: studioCopy("studio.no-check-reports-a-finding"), rows: failing },
      { id: 'options', label: studioCopy("studio.pending-options"), empty: studioCopy("studio.no-option-waits-for-approval"), rows: options },
      { id: 'needs', label: studioCopy("studio.open-needs"), empty: studioCopy("studio.nothing-is-waiting-on-you"), rows: needs },
    ] satisfies ModuleCheckGroup[],
  };
}

function leafChecks(inputs: Inputs, reports: readonly StudioReport[], agent: string, slug: string): ModuleChecksInput {
  const checks = (inputs.checks as ChecksInput | undefined)?.rows ?? [];
  const options = inputs.options as OptionsInput | undefined;
  return checksInput(
    checks.filter(row => !row.ok).map(row => ({ id: row.key, badge: studioCopy("studio.finding"), tone: 'destructive', title: row.label, detail: row.detail })),
    (options?.rows ?? []).filter(row => !row.pinned).map(row => ({ id: `v${row.version}`, badge: versionLabel(row.version), tone: 'outline', title: row.label, detail: row.reason })),
    openNeeds(reports, report => report.agent === agent && `${report.title} ${report.detail}`.includes(slug)).map(needRow),
  );
}

/** Outline labels for the sections a page places, by the section's short name. */
const OUTLINE_LABEL: Record<string, string> = {
  home: studioCopy("studio.agents"), 'page-header': studioCopy("studio.overview"), 'page-tabs': studioCopy("studio.overview"), 'slot-groups': studioCopy("studio.library"),
  'leaf-header': studioCopy("studio.overview"), specimen: studioCopy("studio.specimen"), options: studioCopy("studio.options"), checks: studioCopy("studio.checks"),
  contract: studioCopy("studio.contract"), history: studioCopy("studio.history"), references: studioCopy("studio.references"),
};
const shortName = (slot: string) => slot.replace(/^sections\.studio\./, '');

/** A Home census card's accessible count labels, for the agent's census state. */
function censusLabels(agent: string, census: HomeCensus | undefined): HomeCensusLabels {
  if (census?.state === 'ready') return { total: studioCopy('studio.slot-count', { count: census.total }), candidates: studioCopy('studio.slots-with-candidates', { count: census.withCandidate }), pinned: studioCopy('studio.pinned-slots', { count: census.pinned }) };
  const loading = census?.state === 'loading';
  const status = loading ? studioCopy('studio.census-loading') : studioCopy('studio.unavailable');
  return { total: loading ? studioCopy('studio.slot-census-loading', { agent }) : studioCopy('studio.slot-census-unavailable', { agent }), candidates: status, pinned: status };
}

/** A page record's own head: its title and the one-line purpose its record data names. */
function pageHeader(record: StudioPageRecord): PageHeaderInput {
  return { title: record.title, ...(record.data.description ? { description: studioCopy(record.data.description) } : {}) };
}

/** What the server render already loaded for this route; each loader starts from it instead of loading. */
const PageSeedContext = createContext<StudioPageSeed>({});

/** Loads one Producer resource per revision, starting from the server seed when it is for the same key. */
function useResource<T>(key: string | undefined, seed: { key: string; record: Resource<T> } | undefined, load: (signal: AbortSignal) => Promise<T>, fallback: string): Resource<T> {
  const { revision } = useStudioData();
  const fresh = seed && seed.key === key ? seed.record : undefined;
  const [value, setValue] = useState<Resource<T>>(() => fresh ?? { state: 'loading' });
  const seeded = useRef(fresh ? revision : undefined);
  useEffect(() => {
    if (key === undefined || seeded.current === revision) return;
    seeded.current = undefined;
    const controller = new AbortController();
    setValue({ state: 'loading' });
    load(controller.signal).then(result => setValue({ state: 'ready', value: result }), error => { if (!controller.signal.aborted) setValue({ state: 'error', message: message(error, fallback) }); });
    return () => controller.abort();
    // `load` is derived from `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, revision]);
  return value;
}

/* Loaders: Producer data -> section inputs, one per page record loader. */

function useHomeInputs({ page }: LoaderProps): Loaded {
  const { reports, revision, census: initialCensus } = useStudioData();
  const census = useSlotCensus(revision, initialCensus);
  return useMemo(() => {
    const list: readonly StudioReport[] = reports.state === 'ready' ? reports.value : [];
    // Home lists the projected agent groups; each opens on its projected landing (its first record's first tab).
    const agents = studioGroups().flatMap(group => {
      const href = studioLanding(group.id);
      const record = pageById.get(studioAgentRecords(group.id)[0] ?? '');
      if (!href || !record) return [];
      const Icon = studioIcon(group.icon);
      // The agent's purpose, which its records carry beside their own description.
      const purpose = record.data.purpose ?? record.data.description;
      return [{
        id: group.id, label: group.label, purpose: purpose ? studioCopy(purpose) : '', icon: <Icon className="size-4" />,
        census: census[group.id], censusLabels: censusLabels(group.label, census[group.id]), href, openLabel: studioCopy("studio.open", { value0: String(group.label) }), openIcon: <ArrowRightIcon data-icon="inline-end" />,
      }];
    });
    const home: HomeInput = { agentsLabel: studioCopy("studio.agents"), agents };
    const needs = openNeeds(list).map(needRow);
    const checks = checksInput(needs.filter(row => row.tone === 'destructive'), [], needs.filter(row => row.tone !== 'destructive'));
    return { state: 'ready', inputs: { header: pageHeader(page), home }, modules: { checks } };
  }, [reports, census, page]);
}

/** A group-tab page: the record's head, its tab routes, and the tab's IA groups of slot cards. */
function useSlotGroupsInputs({ entry, page, spec }: LoaderProps): Loaded {
  const { reports } = useStudioData();
  const { resolved } = useThemeMode();
  const agent = spec.data.agent;
  const seed = useContext(PageSeedContext).groups;
  const record = useResource<SlotGroupsRecord>(agent, seed && { key: seed.agent, record: seed.record }, signal => loadSlotGroups(agent!, signal), studioCopy("studio.the-library-could-not-load"));
  return useMemo((): Loaded => {
    if (!agent) return { state: 'notice', notice: { title: studioCopy("studio.this-page-cannot-load"), description: studioCopy("studio.studio-has-no-loader-named", { value0: String(spec.data.loader) }) } };
    if (record.state === 'loading') return { state: 'loading' };
    if (record.state === 'error') return { state: 'notice', notice: { title: studioCopy("studio.the-library-could-not-load"), description: record.message } };
    // The record the tab belongs to (its route data names it) heads the page; Publisher's projected tabs are the record's tabs.
    const owner = pageById.get(spec.data.record ?? '') ?? page;
    const tabs: PageTabsInput = { label: owner.title, active: entry.id, tabs: studioRecordTabs(owner.id).map(tab => ({ id: tab.id, label: tab.title, href: tab.path })) };
    const sections = new Map(record.value.sections.filter(section => section.level === 2).map(section => [section.id, section]));
    const groups: SlotGroupsInput = {
      empty: studioCopy("studio.nothing-to-preview-yet"),
      groups: (spec.data.groups ?? []).flatMap(id => {
        const section = sections.get(id);
        return section ? [{ id, label: section.label, cards: section.cards.map(card => {
          const name = studioLeafTitle(agent, card.slug) ?? card.name;
          return {
            id: card.id, name, href: studioLeafHref(agent, card.slug) ?? '',
            statusLabel: studioCopy(`studio.${card.status}`), statusTone: STATUS_TONE[card.status] ?? 'outline',
            ...(card.version ? { version: card.version, versionLabel: versionLabel(card.version) } : {}), specimen: slotCardSpecimen(card, name, resolved, record.value.publication),
          };
        }) }] : [];
      }),
    };
    const cards = groups.groups.flatMap(group => group.cards);
    const cardRow = (card: (typeof cards)[number]): ModuleCheckRow => ({ id: card.id, badge: card.statusLabel, tone: card.statusTone, title: card.name, href: card.href, openLabel: studioCopy("studio.open", { value0: String(card.name) }) });
    const list: readonly StudioReport[] = reports.state === 'ready' ? reports.value : [];
    const failing = cards.filter(card => card.statusTone === 'destructive').map(cardRow);
    const waiting = record.value.sections.flatMap(section => section.level === 2 && sections.has(section.id) ? section.cards.filter(card => card.status !== 'active' && card.options > 0) : []);
    const options = cards.filter(card => waiting.some(row => row.id === card.id)).map(cardRow);
    return { state: 'ready', inputs: { header: { ...pageHeader(owner) }, tabs, groups }, modules: { checks: checksInput(failing, options, openNeeds(list, report => report.agent === agent).map(needRow)) } };
  }, [agent, record, entry, page, spec, reports, resolved]);
}

/** A leaf page: one slot's detail, back-linked to the tab that lists it. */
function useLeafInputs({ page, spec, slug }: LoaderProps): Loaded {
  const { reports } = useStudioData();
  const { resolved } = useThemeMode();
  const agent = spec.data.agent;
  const seed = useContext(PageSeedContext).leaf;
  const key = agent && slug ? `${agent}/${slug}` : undefined;
  const record = useResource<LeafRecord | undefined>(key, seed && { key: `${seed.agent}/${seed.slug}`, record: seed.record }, signal => loadLeaf(agent!, slug!, signal), studioCopy("studio.this-leaf-could-not-load"));
  return useMemo((): Loaded => {
    if (!agent || !slug) return { state: 'notice', notice: { title: studioCopy("studio.this-page-cannot-load"), description: studioCopy("studio.studio-has-no-loader-named", { value0: String(spec.data.loader) }) } };
    if (record.state === 'loading') return { state: 'loading' };
    if (record.state === 'error') return { state: 'notice', notice: { title: studioCopy("studio.this-leaf-could-not-load-61e548"), description: record.message } };
    const label = studioGroupOf(page.id)?.title ?? agent;
    if (!record.value) return { state: 'notice', notice: { title: studioCopy("studio.this-leaf-is-gone"), description: studioCopy("studio.no-longer-records", { value0: String(label), value1: String(slug) }) } };
    const inputs = slotDetailInputs(record.value.detail, { leaf: studioLeafHref, label: studioLeafTitle, back: { href: page.path, label: page.title } }, resolved, record.value.publication);
    const list: readonly StudioReport[] = reports.state === 'ready' ? reports.value : [];
    return { state: 'ready', inputs, modules: { checks: leafChecks(inputs, list, agent, slug) } };
  }, [agent, slug, record, page, spec, resolved, reports]);
}

/** The URL's `?seat=<id>` (a team card's link): the lane the overview highlights. Read after mount, so the server render and hydration agree. */
function useSeatParam(): string | null {
  const [seat, setSeat] = useState<string | null>(null);
  useEffect(() => {
    const read = () => setSeat(new URLSearchParams(window.location.search).get('seat'));
    read();
    window.addEventListener('popstate', read);
    return () => window.removeEventListener('popstate', read);
  }, []);
  return seat;
}

/** A system overview: graph.json's roster as the team strip, its steps and edges as the swimlane flow, its counts and kinds as the legend. */
function usePipelineInputs({ page }: LoaderProps): Loaded {
  const record = useResource<PipelineGraphFile>('pipeline', undefined, loadPipeline, studioCopy("studio.pipeline.empty.description"));
  const seat = useSeatParam();
  return useMemo((): Loaded => {
    if (record.state === 'loading') return { state: 'loading' };
    if (record.state === 'error') return { state: 'notice', notice: { title: studioCopy("studio.pipeline.empty.title"), description: record.message } };
    const inputs = pipelineInputs(record.value, pageHeader(page), page.path, seat);
    return { state: 'ready', inputs: { ...inputs }, modules: { checks: checksInput([], [], []) } };
  }, [record, page, seat]);
}

/** A system that is not set up yet: the record's empty state, its words Writer keys. */
function useEmptyInputs({ spec }: LoaderProps): Loaded {
  return useMemo((): Loaded => {
    const keys = spec.data.empty;
    if (!keys) return { state: 'notice', notice: { title: studioCopy("studio.this-page-cannot-load"), description: studioCopy("studio.studio-has-no-loader-named", { value0: String(spec.data.loader) }) } };
    const empty: SystemEmptyInput = { title: studioCopy(keys.title), description: studioCopy(keys.description) };
    return { state: 'ready', inputs: { empty }, modules: { checks: checksInput([], [], []) } };
  }, [spec]);
}

/* Assembly. */

function Placed({ slot, spec, inputs }: { slot: string; spec: StudioAssemblySpec; inputs: Inputs }) {
  const Section = studioSections[slot];
  const name = spec.inputs[slot];
  if (!Section || !name) return null;
  const value = inputs[name];
  if (value === undefined) return null;
  return <Section {...{ [name]: value }} />;
}

/** The outline of the recorded versions: one item per history row, pointing at that row of the history section. */
function versionsOutline(history: HistoryInput | undefined) {
  return (history?.rows ?? []).map(row => ({
    id: `v${row.version}`,
    label: [row.versionLabel, row.date, ...row.marks].filter(Boolean).join(' · '),
    target: `${sectionTarget('sections.studio.history')} [data-key=${JSON.stringify(String(row.version))}]`,
  }));
}

/**
 * The header popovers a page manifest declares, in order: each module places its pinned module
 * section over the loaded module data; each action shows the link or prompt it copies.
 */
function useManifestPopovers(entry: ContentMapEntry, spec: StudioAssemblySpec, loaded: Loaded): PopoverSpec[] {
  return useMemo(() => {
    const inputs = loaded.state === 'ready' ? loaded.inputs : {};
    const data = loaded.state === 'ready' ? loaded.modules ?? {} : {};
    // Each placed section the outline names; a section without an outline label is not listed.
    const outline = spec.sectionIds.filter(slot => inputs[spec.inputs[slot] ?? ''] !== undefined).flatMap(slot => {
      const name = shortName(slot);
      const label = OUTLINE_LABEL[name];
      return label ? [{ id: name, label, target: sectionTarget(slot) }] : [];
    });
    const versions = versionsOutline(inputs.history as HistoryInput | undefined);
    const modules = spec.manifest.modules.map((module): PopoverSpec => {
      const Section = studioSections[module.section];
      const content = module.source === 'page.outline'
        ? { label: studioCopy("studio.outline", { value0: String(entry.title) }), heading: studioCopy("studio.on-this-page"), items: outline }
        : module.source === 'page.versions'
          ? { label: studioCopy("studio.versions", { value0: String(entry.title) }), heading: studioCopy("studio.recorded-versions"), items: versions }
          : data.checks ?? checksInput([], [], []);
      const targets = module.source === 'page.outline' ? outline.map(item => item.target) : module.source === 'page.versions' ? versions.map(item => item.target) : [];
      return {
        id: module.id, label: studioCopy(module.label), icon: module.icon, shortcut: module.shortcut, targets,
        render: context => Section ? <Section {...{ [module.input]: { ...content, ...(context.active ? { active: context.active } : {}), onSelect: context.select } }} /> : null,
      };
    });
    const agent = studioGroupOf(entry.id)?.title ?? entry.title;
    const actions = spec.manifest.actions.flatMap((action): PopoverSpec[] => {
      if (action.handler.kind !== 'copy-prompt') return [];
      return [{
        id: action.id, label: studioCopy(action.label), icon: action.icon, shortcut: action.shortcut,
        // `{url}` stays a placeholder: the frame fills in the page link once the popover opens.
        copy: { kind: 'prompt', prompt: studioCopy(action.handler.prompt, { agent, title: entry.title, url: '{url}' }) },
      }];
    });
    return [...modules, ...actions];
  }, [entry.id, entry.title, spec, loaded]);
}

function Frame({ entry, page, spec, loaded = { state: 'loading' }, children, head }: { entry: ContentMapEntry; page: StudioPageRecord; spec: StudioAssemblySpec; loaded?: Loaded; children?: ReactNode; head?: ReactNode }) {
  const { map } = useStudioRoutes();
  const Shell = studioFrames[page.frameId];
  const projection = useMemo(() => studioShellProjection(map, entry.id), [map, entry.id]);
  const copy = useMemo(() => studioShellCopy(), []);
  const popovers = useManifestPopovers(entry, spec, loaded);
  if (!Shell) return <PageNotice notice={{ title: studioCopy("studio.this-page-has-no-frame"), description: studioCopy("studio.nothing-is-pinned-for", { value0: String(page.frameId) }) }} />;
  return <Shell {...projection} copy={copy} popovers={popovers} body={spec.body} head={head}>{children}</Shell>;
}

function Body({ spec, loaded }: { spec: StudioAssemblySpec; loaded: Loaded }): { head?: ReactNode; children: ReactNode } {
  if (loaded.state === 'loading') return { children: <PageNotice loadingLabel={studioCopy('studio.loading-page')} /> };
  if (loaded.state === 'notice') return { children: <PageNotice notice={loaded.notice} /> };
  const placed = spec.sectionIds.map(slot => <Placed key={slot} slot={slot} spec={spec} inputs={loaded.inputs} />);
  return spec.body === 'detail' ? { head: placed[0], children: placed.slice(1) } : { children: placed };
}

function Assembled(props: LoaderProps & { loaded: Loaded }) {
  const body = Body({ spec: props.spec, loaded: props.loaded });
  return <Frame entry={props.entry} page={props.page} spec={props.spec} loaded={props.loaded} head={body.head}>{body.children}</Frame>;
}

function HomePage(props: LoaderProps) { return <Assembled {...props} loaded={useHomeInputs(props)} />; }
function SlotGroupsPage(props: LoaderProps) { return <Assembled {...props} loaded={useSlotGroupsInputs(props)} />; }
function LeafPage(props: LoaderProps) { return <Assembled {...props} loaded={useLeafInputs(props)} />; }
function PipelinePage(props: LoaderProps) { return <Assembled {...props} loaded={usePipelineInputs(props)} />; }
function EmptyPage(props: LoaderProps) { return <Assembled {...props} loaded={useEmptyInputs(props)} />; }

/** The loaders a page record may name (`data.loader`). */
const LOADERS = { home: HomePage, 'slot-groups': SlotGroupsPage, leaf: LeafPage, pipeline: PipelinePage, empty: EmptyPage } as const;

/** Renders whatever page record the Studio map resolves `segments` to. */
export function StudioPage({ segments, seed }: { segments: readonly string[]; seed?: StudioPageSeed }) {
  return <PageSeedContext.Provider value={seed ?? {}}><StudioRoute segments={segments} /></PageSeedContext.Provider>;
}

function StudioRoute({ segments }: { segments: readonly string[] }) {
  const { map } = useStudioRoutes();
  const route: StudioRoute = resolveStudioRoute(map, segments);
  if (route.state === 'missing') notFound();
  const Loader = LOADERS[route.spec.data.loader as keyof typeof LOADERS];
  if (!Loader) return <Frame entry={route.entry} page={route.page} spec={route.spec}><PageNotice notice={{ title: studioCopy("studio.this-page-cannot-load"), description: studioCopy("studio.studio-has-no-loader-named", { value0: String(route.spec.data.loader) }) }} /></Frame>;
  return <Loader key={route.key} entry={route.entry} page={route.page} spec={route.spec} {...(route.state === 'leaf' ? { slug: route.slug } : {})} />;
}
