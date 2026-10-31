'use client';

/**
 * The one Studio renderer. A served path resolves through the Studio map to a Publisher page
 * record (frame + ordered sections + bindings); the record's loader turns Producer data into
 * each section's contract input, and the pinned frame and sections render it. No page has its
 * own component: every page is this assembly.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { ArrowRightIcon } from 'lucide-react';
import type { ContentMap, ContentMapEntry } from '@clossys/publisher/content-map';
import { studioFrames, studioModuleFrames, studioSections } from '../generated/assembly-bindings';
import { studioPublicationRoot, type StudioAssemblySpec, type StudioPageRecord } from '../generated/studio-map';
import { PageNotice, type PageNoticeData } from '../frames/studio-shell';
import type { ActionSpec, ModuleSpec } from '../frames/studio-module';
import type { AgentGalleryInput } from '../sections/studio-agent-gallery';
import type { CheckRow } from '../sections/studio-checks';
import type { ExplorerGroup } from '../sections/module-explorer';
import type { ModuleCheckGroup, ModuleCheckRow, ModuleChecksInput } from '../sections/module-checks';
import type { OptionsInput } from '../sections/studio-options';
import type { HomeInput } from '../sections/studio-home';
import type { OptionRow } from '../sections/studio-options';
import type { Publication, PublicationsInput } from '../sections/studio-publications';
import type { ViewportSpecimen } from '../sections/studio-specimen';
import {
  agentGalleryInput, agentGalleryPreview, agentLeafInputs, agentNotice, agentOptionsInput, agentOptionVersions, agentRecordSpecimen, isLibraryAgent, loadAgentLeaf,
  viewportSpecimen, type AgentLeafRecords, type GalleryPreviews, type LibraryAgent, type StudioLinks,
} from '../lib/agent-library';
import { stringChanges } from '../lib/agent-options';
import { AGENT_LABELS, AGENTS, type Agent } from '../lib/agents';
import { loadCell } from '../lib/cells-client';
import { designerGalleryInput, designerLeafInputs, designerNotice, loadDesignerLeaf, type DesignerLeaf } from '../lib/designer-library';
import { loadPublication, safePreviewUrl, siteRoot, type PublicationResponse } from '../lib/publisher-preview';
import { studioIcon } from '../lib/studio-icons';
import type { StudioReport } from '../lib/studio-report';
import { resolveStudioRoute, studioHref, studioLeafCount, studioLeafHref, studioPageEntries, studioShellProjection, type StudioRoute } from '../lib/studio-route-map';
import { LEAF_STATUS_LABEL, leafCountLabel } from '../lib/leaf-status';
import { useStudioData, useThemeMode, type Resource } from './StudioProviders';
import { useStudioRoutes } from './StudioRouteMap';

type Inputs = Record<string, unknown>;
/** What a page's modules show, by manifest source: the explorer tree and the checks. The outline is derived from the placed sections. */
interface ModuleData { explorer?: readonly ExplorerGroup[]; checks?: ModuleChecksInput }
type Loaded = { state: 'loading' } | { state: 'notice'; notice: PageNoticeData } | { state: 'ready'; inputs: Inputs; modules?: ModuleData };

const AGENT_PURPOSE: Record<string, string> = {
  director: 'Strategy: the direction, reasoning and signals the business runs on.',
  designer: 'Design decisions: tokens, sections and frames the product is built from.',
  writer: 'Copy: the voice and every string the product shows.',
  publisher: 'Pages: what gets published, where, and its preview state.',
};
const SEVERITY_TONE: Record<string, ModuleCheckRow['tone']> = { error: 'destructive', warning: 'outline', info: 'secondary' };
const sentence = (value: string) => value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
/** An attribute selector for an element id (ids may hold characters a `#` selector would need escaped). */
const byId = (id: string) => `[id=${JSON.stringify(id)}]`;
const sectionTarget = (name: string) => `[data-studio-section=${JSON.stringify(name)}]`;

/* Module data: what the checks and explorer modules show, from the same records the sections read. */

const needRow = (report: StudioReport): ModuleCheckRow => ({ id: report.id, badge: sentence(report.severity), tone: SEVERITY_TONE[report.severity] ?? 'outline', title: report.title, detail: report.detail });
const openNeeds = (reports: readonly StudioReport[], keep: (report: StudioReport) => boolean = () => true) => reports.filter(report => report.severity !== 'info' && report.area !== 'compile' && keep(report));

function checksInput(failing: readonly ModuleCheckRow[], options: readonly ModuleCheckRow[], needs: readonly ModuleCheckRow[]): ModuleChecksInput {
  const total = failing.length + options.length + needs.length;
  return {
    summary: total ? `${total} ${total === 1 ? 'item needs' : 'items need'} attention on this page.` : 'Nothing needs attention on this page.',
    groups: [
      { id: 'failing', label: 'Failing checks', empty: 'No check reports a finding.', rows: failing },
      { id: 'options', label: 'Pending options', empty: 'No option waits for approval.', rows: options },
      { id: 'needs', label: 'Open needs', empty: 'Nothing is waiting on you.', rows: needs },
    ] satisfies ModuleCheckGroup[],
  };
}

/** The explorer tree of an agent gallery: IA level 1 on top, then its groups and leaves (the map's L3 pages). */
function galleryExplorer(gallery: AgentGalleryInput): ExplorerGroup[] {
  return gallery.layers.map(layer => ({
    id: layer.id, label: layer.label,
    items: layer.groups.flatMap(group => [
      { id: `group:${group.id}`, label: group.label, depth: group.level - 1, target: byId(group.id) },
      ...group.cards.map(card => ({ id: `leaf:${card.key}`, label: card.name, depth: group.level, target: `[data-gallery-leaf=${JSON.stringify(card.key)}]` })),
    ]),
  }));
}

function galleryChecks(gallery: AgentGalleryInput, reports: readonly StudioReport[], agent: string): ModuleChecksInput {
  const cards = gallery.layers.flatMap(layer => layer.groups.flatMap(group => group.cards));
  const cardRow = (card: (typeof cards)[number]): ModuleCheckRow => ({ id: card.key, badge: card.statusLabel, tone: card.statusTone, title: card.name, href: card.href, openLabel: `Open ${card.name}` });
  return checksInput(
    cards.filter(card => card.statusTone === 'destructive').map(cardRow),
    cards.filter(card => card.statusLabel === LEAF_STATUS_LABEL.pending).map(cardRow),
    openNeeds(reports, report => report.agent === agent).map(needRow),
  );
}

function leafChecks(inputs: Inputs, reports: readonly StudioReport[], agent: string, slug: string): ModuleChecksInput {
  const checks = (inputs.checks as readonly CheckRow[] | undefined) ?? [];
  const options = inputs.options as OptionsInput | undefined;
  return checksInput(
    checks.filter(row => !row.ok).map(row => ({ id: row.key, badge: 'Finding', tone: 'destructive', title: row.label, detail: row.detail })),
    (options?.rows ?? []).filter(row => !row.pinned).map(row => ({ id: `v${row.version}`, badge: `v${row.version}`, tone: 'outline', title: row.label, detail: row.reason })),
    openNeeds(reports, report => report.agent === agent && `${report.title} ${report.detail}`.includes(slug)).map(needRow),
  );
}

/** Outline labels for the sections a page places, by the section's short name. */
const OUTLINE_LABEL: Record<string, string> = {
  home: 'Agents', 'agent-gallery': 'Library', publications: 'Publications', 'leaf-header': 'Overview', specimen: 'Specimen',
  options: 'Options', checks: 'Checks', contract: 'Contract', history: 'History', references: 'References',
};
const shortName = (slot: string) => slot.replace(/^sections\.studio\./, '');

const VIEWPORTS = [375, 768, 1280] as const;
const message = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;

/** Map-backed links for the adapters. */
function mapLinks(map: ContentMap): StudioLinks {
  return { gallery: agent => studioHref(map, agent), leaf: (agent, slug) => studioLeafHref(map, agent, slug) };
}

/* Loaders: Producer data -> section inputs, one per page record loader. */

function useHomeInputs(): Loaded {
  const { reports } = useStudioData();
  const { map, galleries } = useStudioRoutes();
  return useMemo(() => {
    const list: readonly StudioReport[] = reports.state === 'ready' ? reports.value : [];
    const agents = AGENTS.flatMap(agent => {
      const href = studioHref(map, agent);
      if (!href) return [];
      const gallery = galleries[agent];
      const Icon = studioIcon(undefined, agent);
      // Leaves are the one count unit: the gallery's leaf entries in the map, as its own header counts them.
      return [{
        id: agent, label: AGENT_LABELS[agent], purpose: AGENT_PURPOSE[agent] ?? '', icon: <Icon className="size-4" />,
        ...(!gallery || gallery.state === 'loading' ? {} : { count: gallery.state === 'ready' ? { label: leafCountLabel(studioLeafCount(map, agent)), tone: 'secondary' as const } : { label: 'Unavailable', tone: 'outline' as const } }),
        href, openLabel: `Open ${AGENT_LABELS[agent]}`, openIcon: <ArrowRightIcon data-icon="inline-end" />,
      }];
    });
    const home: HomeInput = { title: 'Home', description: 'Your agents and what they have written for this workspace.', agentsLabel: 'Agents', agents };
    const needs = openNeeds(list).map(needRow);
    const checks = checksInput(needs.filter(row => row.tone === 'destructive'), [], needs.filter(row => row.tone !== 'destructive'));
    return { state: 'ready', inputs: { home }, modules: { checks } };
  }, [reports, map, galleries]);
}

/** Every route the Studio publication serves: the compiled pages and the leaves the record stores add. */
function studioPublication(map: ContentMap, origin: string): Publication {
  const entries = studioPageEntries(map);
  return {
    id: map.publicationId, title: 'Studio', root: origin || 'localhost', rootNote: studioPublicationRoot.note,
    routes: entries.map(entry => {
      const compiled = !entry.id.includes(':');
      return {
        key: entry.id, path: entry.path, pageId: entry.id, frame: entry.source?.frameId ?? '—', sections: entry.source?.sectionIds ?? [],
        status: compiled ? { label: 'Compiled', tone: 'secondary' as const } : { label: 'From records', tone: 'outline' as const },
        leaf: { label: entry.title, href: entry.path },
      };
    }),
  };
}

/** The consumer site's routes, from its installed publication and the Publisher records that assemble each page. */
function sitePublication(publication: PublicationResponse | undefined, error: string | undefined, links: StudioLinks): Publication | undefined {
  if (error) return { id: 'clossys-site', title: 'clossys-site', root: 'Unavailable', rootNote: '', routes: [], notice: error };
  if (!publication) return undefined;
  if (publication.state !== 'ready') return { id: 'site', title: 'Site', root: 'Unavailable', rootNote: '', routes: [], notice: publication.message };
  return {
    id: publication.publication, title: publication.publication, ...siteRoot(publication),
    routes: publication.pages.map(page => {
      const href = page.cellId ? links.leaf('publisher', page.cellId) : undefined;
      return {
        key: page.id, path: page.route, pageId: page.id, frame: '—', sections: [],
        status: page.emitted ? { label: 'Emitted', tone: 'secondary' as const } : { label: 'Not emitted', tone: 'outline' as const },
        ...(href ? { leaf: { label: page.cellId!, href } } : {}),
      };
    }),
  };
}

function useGalleryInputs(page: StudioPageRecord): Loaded {
  const { map, galleries } = useStudioRoutes();
  const { reports } = useStudioData();
  const { resolved } = useThemeMode();
  const gallery = galleries[page.id];
  const withPublications = page.sectionIds.includes('sections.studio.publications');
  const [publication, setPublication] = useState<Resource<PublicationResponse> | undefined>(undefined);
  const [leaves, setLeaves] = useState<ReadonlyMap<string, AgentLeafRecords | null> | undefined>(undefined);
  const [origin, setOrigin] = useState('');
  useEffect(() => setOrigin(window.location.origin), []);
  useEffect(() => {
    if (!withPublications) return;
    const controller = new AbortController();
    loadPublication(controller.signal).then(value => setPublication({ state: 'ready', value }), error => { if (!controller.signal.aborted) setPublication({ state: 'error', message: message(error, 'The publication could not load.') }); });
    return () => controller.abort();
  }, [withPublications]);
  // Every leaf's records, for its full card preview (and, on Publisher, each page's frame and sections).
  const libraryAgent = gallery?.state === 'ready' && gallery.value.agent !== 'designer' ? gallery.value.agent : undefined;
  const libraryRecords = gallery?.state === 'ready' && gallery.value.agent !== 'designer' ? gallery.value.records : undefined;
  useEffect(() => {
    if (!libraryAgent || !libraryRecords) return;
    const controller = new AbortController();
    const cards = libraryRecords.sections.flatMap(section => section.cards).filter(card => card.records !== 0);
    loadLeaves(libraryAgent, cards.map(card => card.slug), controller.signal).then(rows => {
      if (!controller.signal.aborted) setLeaves(new Map(cards.map((card, index) => [card.id, rows[index] ?? null])));
    });
    return () => controller.abort();
  }, [libraryAgent, libraryRecords]);
  return useMemo((): Loaded => {
    const links = mapLinks(map);
    const agent = page.data.agent ?? page.id;
    if (!gallery || gallery.state === 'loading') return { state: 'loading' };
    if (gallery.state === 'error') return { state: 'notice', notice: agent === 'designer' ? designerNotice('error', gallery.message) : agentNotice(agent as LibraryAgent, 'error', gallery.message) };
    const count = studioLeafCount(map, page.id);
    const pages = publication?.state === 'ready' && publication.value.state === 'ready' ? publication.value.pages : [];
    const previews: GalleryPreviews = new Map([...(leaves ?? [])].map(([id, leaf]) => {
      if (!leaf) return [id, null];
      const emitted = pages.find(row => row.cellId === id && row.emitted && safePreviewUrl(row.previewUrl));
      return [id, agentGalleryPreview(leaf, links, emitted?.previewUrl)];
    }));
    const input = gallery.value.agent === 'designer' ? designerGalleryInput(gallery.value.records, resolved, links, count) : agentGalleryInput(gallery.value.records, links, count, previews);
    const inputs: Inputs = {};
    const list: readonly StudioReport[] = reports.state === 'ready' ? reports.value : [];
    const explorer: ExplorerGroup[] = 'layers' in input ? galleryExplorer(input) : [];
    const modules: ModuleData = { explorer, checks: 'layers' in input ? galleryChecks(input, list, agent) : checksInput([], [], openNeeds(list, report => report.agent === agent).map(needRow)) };
    if ('layers' in input) inputs.gallery = input;
    else if (!withPublications) return { state: 'notice', notice: input };
    if (withPublications) {
      const site = sitePublication(publication?.state === 'ready' ? publication.value : undefined, publication?.state === 'error' ? publication.message : undefined, links);
      const withSite = site && publication?.state === 'ready' && publication.value.state === 'ready' ? {
        ...site, routes: site.routes.map(route => {
          const cell = publication.value.state === 'ready' ? publication.value.pages.find(row => row.id === route.pageId)?.cellId : undefined;
          const leaf = cell ? leaves?.get(cell) : undefined;
          if (!leaf) return route;
          return { ...route, frame: leaf.contract.facts.find(fact => fact.label === 'Frame')?.value ?? route.frame, sections: leaf.contract.lists.find(list => list.label === 'Sections')?.items ?? route.sections };
        }),
      } : site;
      const publications: PublicationsInput = {
        title: 'Publications',
        description: 'Every publication with the root its config names and every route after it: the page that renders each path, its frame and sections, and the leaf that records it.',
        publications: [studioPublication(map, origin), ...(withSite ? [withSite] : [])],
      };
      inputs.publications = publications;
      explorer.push({ id: 'publications', label: 'Publications', items: publications.publications.map(row => ({ id: `publication:${row.id}`, label: row.title, depth: 0, target: byId(`publication-${row.id}`) })) });
    }
    return { state: 'ready', inputs, modules };
  }, [map, gallery, resolved, page, withPublications, publication, leaves, origin, reports]);
}

/** Every leaf of one agent, a few requests at a time; a leaf that cannot load is `undefined`. */
async function loadLeaves(agent: LibraryAgent, slugs: readonly string[], signal: AbortSignal): Promise<(AgentLeafRecords | undefined)[]> {
  const rows: (AgentLeafRecords | undefined)[] = new Array(slugs.length);
  let next = 0;
  const worker = async () => {
    while (next < slugs.length && !signal.aborted) {
      const index = next++;
      rows[index] = await loadAgentLeaf(agent, slugs[index]!, signal).catch(() => undefined);
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, slugs.length) }, worker));
  return rows;
}

type LeafRecord = { agent: 'designer'; leaf: DesignerLeaf } | { agent: LibraryAgent; leaf: AgentLeafRecords; previews: ReadonlyMap<number, OptionRow['preview']>; specimens?: readonly ViewportSpecimen[] };

async function loadLeaf(agent: string, slug: string, signal: AbortSignal): Promise<LeafRecord | undefined> {
  if (agent === 'designer') { const leaf = await loadDesignerLeaf(slug, signal); return leaf && { agent, leaf }; }
  if (!isLibraryAgent(agent)) return undefined;
  const leaf = await loadAgentLeaf(agent, slug, signal);
  if (!leaf) return undefined;
  // Each option shows the strings it changes against the active version.
  const previews = new Map<number, OptionRow['preview']>();
  const options = agentOptionVersions(leaf);
  if (options.length && agent !== 'publisher') {
    const active = leaf.history.find(row => row.active);
    const read = (version: number) => loadCell(agent as Agent, leaf.card.id, signal, version).then(cell => cell.content, () => undefined);
    const base = active ? await read(active.version) : undefined;
    for (const option of options) {
      const content = await read(option.version);
      if (content !== undefined) previews.set(option.version, stringChanges(content, base));
    }
  }
  if (agent !== 'publisher') return { agent, leaf, previews };
  // A Publisher page's specimen is the page itself, as its last install emitted it.
  const publication = await loadPublication(signal).catch(() => undefined);
  const page = publication?.state === 'ready' ? publication.pages.find(row => row.cellId === leaf.card.id) : undefined;
  const specimens = page && page.emitted && safePreviewUrl(page.previewUrl) ? VIEWPORTS.map(viewport => ({ viewport, light: page.previewUrl })) : [];
  return { agent, leaf, previews, specimens };
}

function useLeafInputs(page: StudioPageRecord, slug: string): Loaded {
  const { map } = useStudioRoutes();
  const { revision, reports } = useStudioData();
  const { resolved } = useThemeMode();
  const agent = page.leaf?.data.agent ?? page.id;
  const [record, setRecord] = useState<Resource<LeafRecord | undefined>>({ state: 'loading' });
  useEffect(() => {
    const controller = new AbortController();
    setRecord({ state: 'loading' });
    loadLeaf(agent, slug, controller.signal).then(value => setRecord({ state: 'ready', value }), error => { if (!controller.signal.aborted) setRecord({ state: 'error', message: message(error, 'This leaf could not load.') }); });
    return () => controller.abort();
  }, [agent, slug, revision]);
  return useMemo((): Loaded => {
    const label = agent === 'designer' ? 'Designer' : isLibraryAgent(agent) ? AGENT_LABELS[agent as Agent] : agent;
    if (record.state === 'loading') return { state: 'loading' };
    if (record.state === 'error') return { state: 'notice', notice: { title: 'This leaf could not load', description: record.message } };
    if (!record.value) return { state: 'notice', notice: { title: 'This leaf is gone', description: `${label} no longer records ${slug}.` } };
    const links = mapLinks(map);
    const list: readonly StudioReport[] = reports.state === 'ready' ? reports.value : [];
    const ready = (inputs: Inputs): Loaded => ({ state: 'ready', inputs, modules: { checks: leafChecks(inputs, list, agent, slug) } });
    if (record.value.agent === 'designer') return ready(designerLeafInputs(record.value.leaf, resolved, links));
    const { leaf, previews, specimens } = record.value;
    const specimen = specimens
      ? specimens.length
        ? viewportSpecimen(leaf, specimens, 'The page as its last install emitted it, framed at each viewport.')
        : agentRecordSpecimen(leaf, links)
      : undefined;
    const options = agentOptionsInput(leaf, previews);
    return ready(agentLeafInputs(leaf, links, { ...(specimen ? { specimen } : {}), ...(options ? { options } : {}) }));
  }, [record, map, resolved, agent, slug, reports]);
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

/** The module specs a page manifest declares, each placing its pinned module section over the loaded module data. */
function useManifestModules(entry: ContentMapEntry, spec: StudioAssemblySpec, loaded: Loaded): { modules: ModuleSpec[]; actions: ActionSpec[] } {
  return useMemo(() => {
    const inputs = loaded.state === 'ready' ? loaded.inputs : {};
    const data = loaded.state === 'ready' ? loaded.modules ?? {} : {};
    const outline = spec.sectionIds.filter(slot => inputs[spec.inputs[slot] ?? ''] !== undefined).map(slot => {
      const name = shortName(slot);
      return { id: name, label: OUTLINE_LABEL[name] ?? sentence(name), target: sectionTarget(name) };
    });
    const pending = loaded.state === 'loading';
    const modules = spec.manifest.modules.map((module): ModuleSpec => {
      const Section = studioSections[module.section];
      const explorer = data.explorer ?? [];
      const content = module.source === 'page.explorer'
        ? { label: `${entry.title} explorer`, searchLabel: `Search ${entry.title}`, empty: pending ? 'Loading…' : 'Nothing matches.', groups: explorer }
        : module.source === 'page.outline'
          ? { label: `${entry.title} outline`, heading: 'On this page', items: outline }
          : data.checks ?? checksInput([], [], []);
      const targets = module.source === 'page.explorer' ? explorer.flatMap(group => group.items.map(item => item.target))
        : module.source === 'page.outline' ? outline.map(item => item.target) : [];
      return {
        id: module.id, label: module.label, icon: module.icon, targets, defaultOpen: module.defaultOpen, ...(module.shortcut ? { shortcut: module.shortcut } : {}),
        render: context => Section ? <Section {...{ [module.input]: { ...content, ...(context.active ? { active: context.active } : {}), onSelect: context.select } }} /> : null,
      };
    });
    const agent = spec.data.agent ? (AGENT_LABELS[spec.data.agent as Agent] ?? spec.data.agent) : 'an agent';
    const actions = spec.manifest.actions.map((action): ActionSpec => ({
      ...action,
      handler: action.handler.kind === 'copy-prompt' ? { kind: 'copy-prompt', prompt: action.handler.prompt.replaceAll('{agent}', agent).replaceAll('{title}', entry.title) } : action.handler,
    }));
    return { modules, actions };
  }, [entry.title, spec, loaded]);
}

function Frame({ entry, page, spec, loaded = { state: 'loading' }, children, head }: { entry: ContentMapEntry; page: StudioPageRecord; spec: StudioAssemblySpec; loaded?: Loaded; children?: ReactNode; head?: ReactNode }) {
  const { map } = useStudioRoutes();
  const Shell = studioFrames[page.frameId];
  const Modules = studioModuleFrames[spec.manifest.frame];
  const projection = useMemo(() => studioShellProjection(map, entry.id), [map, entry.id]);
  const { modules, actions } = useManifestModules(entry, spec, loaded);
  if (!Shell || !Modules) return <PageNotice notice={{ title: 'This page has no frame', description: `Nothing is pinned for ${Shell ? spec.manifest.frame : page.frameId}.` }} />;
  return <Modules modules={modules} actions={actions}>
    {chrome => <Shell {...projection} toolbar={chrome.toolbar} modules={chrome.column} pageCommands={chrome.commands} open={chrome.open} body={spec.body} head={head}>{children}</Shell>}
  </Modules>;
}

function Body({ spec, loaded }: { spec: StudioAssemblySpec; loaded: Loaded }): { head?: ReactNode; children: ReactNode } {
  if (loaded.state === 'loading') return { children: <PageNotice /> };
  if (loaded.state === 'notice') return { children: <PageNotice notice={loaded.notice} /> };
  const placed = spec.sectionIds.map(slot => <Placed key={slot} slot={slot} spec={spec} inputs={loaded.inputs} />);
  return spec.body === 'detail' ? { head: placed[0], children: placed.slice(1) } : { children: placed };
}

function Assembled({ entry, page, spec, loaded }: { entry: ContentMapEntry; page: StudioPageRecord; spec: StudioAssemblySpec; loaded: Loaded }) {
  const body = Body({ spec, loaded });
  return <Frame entry={entry} page={page} spec={spec} loaded={loaded} head={body.head}>{body.children}</Frame>;
}

function HomePage(props: { entry: ContentMapEntry; page: StudioPageRecord; spec: StudioAssemblySpec }) { return <Assembled {...props} loaded={useHomeInputs()} />; }
function GalleryPage(props: { entry: ContentMapEntry; page: StudioPageRecord; spec: StudioAssemblySpec }) { return <Assembled {...props} loaded={useGalleryInputs(props.page)} />; }
function LeafPage(props: { entry: ContentMapEntry; page: StudioPageRecord; spec: StudioAssemblySpec; slug: string }) { return <Assembled {...props} loaded={useLeafInputs(props.page, props.slug)} />; }

const LOADERS = { home: HomePage, gallery: GalleryPage } as const;

/** Renders whatever page record the Studio map resolves `segments` to. */
export function StudioPage({ segments }: { segments: readonly string[] }) {
  const { map, leaves } = useStudioRoutes();
  const route: StudioRoute = resolveStudioRoute(map, leaves, segments);
  if (route.state === 'missing') notFound();
  if (route.state === 'pending') {
    const entry = map.entries.find((row): row is ContentMapEntry => row.id === route.page.id && row.kind === 'page')!;
    return <Frame key={route.key} entry={entry} page={route.page} spec={route.page.leaf!}><PageNotice /></Frame>;
  }
  if (route.state === 'leaf') return <LeafPage key={route.key} entry={route.entry} page={route.page} spec={route.spec} slug={route.slug} />;
  const Loader = LOADERS[route.spec.data.loader as keyof typeof LOADERS];
  if (!Loader) return <Frame entry={route.entry} page={route.page} spec={route.spec}><PageNotice notice={{ title: 'This page cannot load', description: `Studio has no loader named ${route.spec.data.loader}.` }} /></Frame>;
  return <Loader key={route.key} entry={route.entry} page={route.page} spec={route.spec} />;
}
