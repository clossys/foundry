import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readPinnedPublication } from '@clossys/publisher/content-map/slots';
import { projectRedirects } from '@clossys/publisher/content-map';
import { listSlots, readCandidate, readIa, readSlot } from '../dist/records/slots.js';
import { slotPositions, validateSlotDoc } from '../dist/records/slot-model/index.js';
import { validateSlotContract } from '../dist/records/validate.js';
import { publishNext } from '../dist/publish/install-next.js';
import { expandPublication } from '../dist/publish/expand-tabs.js';
import { checkPayload } from './studio-payload.mjs';
import { draftStudioItems, previewArguments, previewDescriptor, previewOptionsFromEnvironment } from './studio-draft-items.mjs';

const studioRoot = fileURLToPath(new URL('../studio/', import.meta.url));
const defaultClossysRoot = fileURLToPath(new URL('../../../clossys/', import.meta.url));
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const banner = '// Generated from pinned Foundry Publisher and Designer candidates. Run npm run generate:studio-map.\n';
const LAYER_FOLDER = { frames: 'frames', sections: 'sections' };

function fail(message) { throw new Error(`Studio assembly: ${message}`); }
const object = value => typeof value === 'object' && value !== null && !Array.isArray(value);
const nonEmpty = value => typeof value === 'string' && value.length > 0;

/** The page manifest vocabulary: navigators, module sources, action handlers and wiring verbs. */
export const NAVIGATORS = ['outline'];
export const MODULE_SOURCES = ['page.outline', 'page.checks', 'page.versions'];
export const HANDLERS = ['copy-prompt'];
const WIRING_EXPECT = { 'copy-prompt': 'clipboard prompt' };

/**
 * A page manifest (app-frame-target "Page manifest"): the navigator (the page outline), the
 * modules and the actions, each one header icon that opens a popover (a module popover places a
 * pinned module section fed from a named source; an action popover copies a prompt), each with
 * a shortcut and a command menu entry, and one wiring line per interaction.
 * A page missing any part fails here, before anything renders.
 */
export function checkManifest(owner, manifest, contracts) {
  if (!object(manifest)) fail(`${owner} declares no page manifest`);
  for (const retired of ['frame', 'defaultOpen']) if (retired in manifest) fail(`${owner} manifest names ${retired}; popovers have no module frame or default open state`);
  if (!NAVIGATORS.includes(manifest.navigator)) fail(`${owner} manifest needs an outline navigator`);
  if (!Array.isArray(manifest.modules) || !manifest.modules.length) fail(`${owner} manifest declares no modules`);
  if (!Array.isArray(manifest.actions)) fail(`${owner} manifest needs an actions array (which may be empty)`);
  if (!Array.isArray(manifest.wiring) || !manifest.wiring.length) fail(`${owner} manifest declares no wiring checks`);
  const ids = new Set(), keys = new Set();
  const key = (id, shortcut) => {
    if (!/^[a-z]$/.test(shortcut ?? '')) fail(`${owner} ${id} needs a shortcut of one lowercase letter`);
    if (keys.has(shortcut)) fail(`${owner} reuses the shortcut ${shortcut}`);
    keys.add(shortcut);
  };
  const modules = manifest.modules.map(module => {
    if (!object(module) || !nonEmpty(module.id) || !nonEmpty(module.icon) || !nonEmpty(module.label) || 'defaultOpen' in module) fail(`${owner} has an invalid module`);
    if (ids.has(module.id)) fail(`${owner} declares ${module.id} twice`);
    ids.add(module.id);
    if (!/^sections\.module\.[a-z][a-z0-9-]*$/.test(module.section ?? '')) fail(`${owner} module ${module.id} must place a sections.module.* section`);
    const contract = contracts.get(module.section);
    if (!contract) fail(`${owner} module ${module.id} places ${module.section}, which has no slot contract`);
    if (!MODULE_SOURCES.includes(module.source)) fail(`${owner} module ${module.id} reads an unknown source ${module.source}`);
    key(module.id, module.shortcut);
    return { ...module, input: contract.inputs[0].name };
  });
  const navigator = modules.find(module => module.id === manifest.navigator);
  if (!navigator || navigator.section !== `sections.module.${manifest.navigator}`) fail(`${owner} manifest names ${manifest.navigator} but places no sections.module.${manifest.navigator} module`);
  for (const action of manifest.actions) {
    if (!object(action) || !nonEmpty(action.id) || !nonEmpty(action.icon) || !nonEmpty(action.label) || 'cmdk' in action) fail(`${owner} has an invalid action`);
    if (action.id === 'copy-link') fail(`${owner} declares the retired copy-link action`);
    if (ids.has(action.id)) fail(`${owner} declares ${action.id} twice`);
    ids.add(action.id);
    const handler = action.handler;
    if (!object(handler) || !HANDLERS.includes(handler.kind)) fail(`${owner} action ${action.id} has no copy handler`);
    if (handler.kind === 'copy-prompt' && !nonEmpty(handler.prompt)) fail(`${owner} action ${action.id} copies no prompt`);
    key(action.id, action.shortcut);
  }
  const lines = manifest.wiring.map(line => {
    if (!object(line) || !nonEmpty(line.do) || !nonEmpty(line.expect)) fail(`${owner} has an invalid wiring line`);
    const [verb, target] = line.do.split(' ');
    if (['open', 'copy', 'select', 'search'].includes(verb) && !ids.has(target)) fail(`${owner} wiring names unknown popover ${target}`);
    return line;
  });
  const has = (verb, expect) => lines.some(line => line.do === verb && (expect === undefined || line.expect.startsWith(expect)));
  for (const id of ids) if (!has(`open ${id}`, `${id} open`)) fail(`${owner} has no wiring line for the ${id} popover`);
  for (const action of manifest.actions) if (!has(`copy ${action.id}`, WIRING_EXPECT[action.handler.kind])) fail(`${owner} has no wiring line for the ${action.id} copy`);
  if (!has(`select ${manifest.navigator}`)) fail(`${owner} has no wiring line for ${manifest.navigator} selection`);
  if (!has('cmdk')) fail(`${owner} has no wiring line for the command menu`);
  if (!has('key escape', 'popover closed') || !has('click outside', 'popover closed')) fail(`${owner} has no wiring line for closing a popover`);
  if (!lines.some(line => /^key [a-z]$/.test(line.do))) fail(`${owner} has no wiring line for keyboard use`);
  return { navigator: manifest.navigator, modules, actions: manifest.actions, wiring: lines };
}

/**
 * One assembly per pinned Publisher page: the frame, the ordered sections and, per section, the
 * data field its single contract input reads. A page with a `leaf` template also assembles every
 * leaf beneath it at runtime from the same frame.
 */
export function assemblyOf(entry, route, contracts) {
  const { source } = entry;
  if (!object(source) || typeof source.frameId !== 'string' || !Array.isArray(source.sectionIds)) fail(`${entry.id} is not a frame + sections assembly`);
  if (!contracts.has(source.frameId)) fail(`${entry.id} places ${source.frameId}, which has no slot contract`);
  const checkInputs = (owner, sections, inputs) => {
    if (!object(inputs)) fail(`${owner} has no section inputs`);
    for (const slot of sections) {
      const contract = contracts.get(slot);
      if (!contract) fail(`${owner} places ${slot}, which has no slot contract`);
      const input = contract.inputs[0]?.name;
      if (inputs[slot] !== input) fail(`${owner} binds ${slot} to "${inputs[slot]}", but its contract input is "${input}"`);
    }
    for (const slot of Object.keys(inputs)) if (!sections.includes(slot)) fail(`${owner} binds ${slot}, which it does not place`);
  };
  if (!['plain', 'detail'].includes(route.body) || !object(route.data) || typeof route.data.loader !== 'string') fail(`${entry.id} needs a body and a data loader`);
  checkInputs(entry.id, source.sectionIds, route.inputs);
  const page = { id: entry.id, path: entry.path, title: entry.title, frameId: source.frameId, sectionIds: source.sectionIds, body: route.body, data: route.data, inputs: route.inputs, manifest: checkManifest(entry.id, route.manifest, contracts) };
  if (route.leaf !== undefined) {
    const leaf = route.leaf;
    if (!object(leaf) || leaf.param !== 'slug' || !['plain', 'detail'].includes(leaf.body) || !object(leaf.data) || !Array.isArray(leaf.sections)) fail(`${entry.id} has an invalid leaf template`);
    checkInputs(`${entry.id} leaf`, leaf.sections, leaf.inputs);
    page.leaf = { param: leaf.param, body: leaf.body, data: leaf.data, sectionIds: leaf.sections, inputs: leaf.inputs, manifest: checkManifest(`${entry.id} leaf`, leaf.manifest, contracts) };
    if (!page.leaf.manifest.actions.some(action => action.id === 'request-change' && action.handler.kind === 'copy-prompt')) fail(`${entry.id} leaf needs the request-change prompt action`);
  }
  return page;
}

async function readJson(path) { return JSON.parse(await readFile(path, 'utf8')); }

/** Read Designer's IA in order and use only contracts belonging to their slot. */
export function designerContracts(clossysRoot) {
  const ia = readIa(clossysRoot, 'designer');
  if (!ia) fail('Designer IA is missing');
  const contracts = new Map();
  for (const [id, position] of slotPositions('designer', ia)) {
    const doc = readSlot(clossysRoot, 'designer', id);
    if (validateSlotDoc(doc).length || doc.id !== id || doc.agent !== 'designer' ||
        ['l0', 'l1', 'l2', 'order'].some(key => doc.ia[key] !== position[key])) fail(`invalid Designer slot ${id}`);
    const contract = doc.contract;
    if (contract.schema !== 'clossys.slot-contract/1') continue;
    if (!validateSlotContract(contract).ok || contract.slot !== id || !Array.isArray(contract.inputs) || !contract.inputs.length ||
        !contract.inputs.every(input => object(input) && nonEmpty(input.name))) fail(`invalid Designer contract ${id}`);
    contracts.set(id, contract);
  }
  return contracts;
}

/** The pinned Designer candidate for a slot, and the Studio folder that runs it. */
function pinnedItem(clossysRoot, entries, slot) {
  const entry = entries.get(slot);
  if (!entry) fail(`${slot} is not a Designer slot`);
  const pin = entry.pin;
  if (!pin) fail(`${slot} has no pin in the Designer slot model`);
  const layer = slot.split('.')[0];
  const folder = LAYER_FOLDER[layer];
  if (!folder) fail(`${slot} is not a frame or section`);
  if (!entry.candidates.includes(pin.candidate)) fail(`${slot} pins a missing candidate ${pin.candidate}`);
  const candidate = readCandidate(clossysRoot, 'designer', slot, pin.candidate);
  if (candidate.sha256 !== pin.sha256) fail(`${slot} pin hash does not match its candidate`);
  const item = JSON.parse(candidate.bytes);
  const source = item.meta?.source;
  if (!['registry', 'derived'].includes(source?.kind) || !Array.isArray(source.ref) || !source.ref.length) fail(`${slot} must come from a trusted reference (source registry or derived with a ref)`);
  if (!nonEmpty(item.name) || !Array.isArray(item.files) || !item.files.length) fail(`${slot} candidate ${pin.candidate} carries no files`);
  const version = Number(/-v([1-9][0-9]*)\.json$/.exec(pin.candidate)?.[1] ?? 0);
  if (!version) fail(`${slot} pins a non-element candidate ${pin.candidate}`);
  const files = new Map(item.files.map(file => [file.path, Buffer.from(file.content, 'utf8')]));
  return { slot, element: item.name, version, files, payload: [...files.keys()], studioDir: join(studioRoot, folder, item.name), module: `../${folder}/${item.name}` };
}

// Studio copy slots, by slot id: folders are flat (agents/writer/<slot-id>), so a
// regroup in ia.json never drops a slot from Studio copy. `placement` in the
// recorded source is the slot's current IA position (provenance only).
const STUDIO_COPY_SLOTS = new Set([
  'strings.descriptions',
  'strings.statuses',
  'strings.common',
  'strings.field-labels',
]);
const candidateVersion = name => /^[a-z0-9][a-z0-9.-]*-v([1-9][0-9]*)\.md$/.exec(name)?.[1];

/** Pins remain authoritative. Only explicit preview may read an absent pin's newest draft. */
export async function studioCopyRegistry(clossysRoot, { target, absentPin } = {}) {
  if (absentPin !== undefined && (target !== 'preview' || absentPin !== 'newest-draft')) throw new Error('Studio Writer draft selection requires explicit newest-draft preview');
  const previewDrafts = target === 'preview' && absentPin === 'newest-draft';
  const root = join(clossysRoot, 'agents/writer');
  let ia;
  try { ia = JSON.parse(await readFile(join(root, 'ia.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; ia = { nodes: [] }; }
  const entries = [], revisions = [], sources = [];
  for (const node of ia.nodes) for (const group of node.children) for (const slot of group.slots) {
    if (!STUDIO_COPY_SLOTS.has(slot)) continue;
    const placement = `${node.id}/${group.id}/${slot}`;
    const dir = join(root, slot);
    let pin, candidate, selectedBy;
    try { pin = JSON.parse(await readFile(join(dir, 'pin.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (pin !== undefined) {
      if (!object(pin) || !candidateVersion(pin.candidate)) throw new Error(`Invalid Studio Writer pin: ${slot}`);
      candidate = pin.candidate;
      selectedBy = 'pin';
    } else {
      if (!previewDrafts) continue;
      const candidates = (await readdir(join(dir, 'candidates'))).filter(name => name.endsWith('.md')).map(name => {
        const version = candidateVersion(name);
        if (!version) throw new Error(`Invalid Studio Writer draft candidate: ${placement}/${name}`);
        return { name, version: BigInt(version) };
      });
      if (!candidates.length) throw new Error(`No Studio Writer draft candidate: ${placement}`);
      const newest = candidates.reduce((latest, row) => row.version > latest ? row.version : latest, 0n);
      const matches = candidates.filter(row => row.version === newest);
      if (matches.length !== 1) throw new Error(`Ambiguous Studio Writer draft version: ${placement}/v${newest}`);
      candidate = matches[0].name;
      selectedBy = 'absent-pin-preview';
    }
    const content = await readFile(join(dir, 'candidates', candidate));
    const sha256 = createHash('sha256').update(content).digest('hex');
    const bytes = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(content);
    if (pin !== undefined && sha256 !== pin.sha256) throw new Error(`Studio Writer pin hash mismatch: ${slot}`);
    revisions.push(sha256);
    sources.push({ placement, candidate, version: candidateVersion(candidate), sha256, selectedBy });
    if (!bytes.startsWith('---\n') || !bytes.includes('\nlocales: ["en"]\n')) throw new Error(`Invalid Studio Writer locale: ${slot}`);
    const records = bytes.split(/^### /m).slice(1);
    if (!records.length) throw new Error(`Invalid Studio Writer records: ${slot}`);
    for (const record of records) {
      const match = /^([^\n]+)\n<!-- (.+) -->\n([\s\S]*)$/.exec(record);
      if (!match) throw new Error(`Invalid Studio Writer record: ${slot}`);
      const meta = JSON.parse(match[2]);
      if (!object(meta) || typeof meta.id !== 'string') throw new Error(`Invalid Studio Writer metadata: ${slot}`);
      if (!meta.id.startsWith('studio.')) continue;
      if (!Array.isArray(meta.bindings) || !meta.bindings.every(binding => typeof binding === 'string')) throw new Error(`Invalid Studio Writer bindings: ${meta.id}`);
      if (entries.some(row => row.id === meta.id)) throw new Error(`Duplicate Studio Writer copy: ${meta.id}`);
      entries.push({ id: meta.id, text: match[3].replace(/\n\n?$/, ''), context: meta.bindings.join(', '), status: 'draft' });
    }
  }
  const reference = previewDrafts ? `clossys/agents/writer#${JSON.stringify(sources)}` : 'clossys/agents/writer';
  const revision = previewDrafts ? JSON.stringify(sources) : revisions.join('');
  return { id: 'studio-copy', locale: 'en', revision: createHash('sha256').update(revision).digest('hex'),
    source: { kind: 'consumer', reference }, entries };
}

/** Studio's assembly module, relative to its app directory: what every installed route mounts. */
export const STUDIO_ASSEMBLY = '../components/StudioInstalledPage.tsx';

/**
 * Install Studio's own routes: Publisher installs `publication.studio` into the app directory
 * (`publish --install --next`), one route per page and one live `[slug]` route per leaf template.
 * Returns the installed route per page id; check mode refuses drift instead of writing.
 */
export async function installStudioRoutes({ clossysRoot = defaultClossysRoot, appDir = resolve(studioRoot, 'app'), check = false, installOut } = {}) {
  const result = await publishNext({ root: dirname(resolve(clossysRoot)), publication: 'studio', app: appDir, assembly: STUDIO_ASSEMBLY, live: true, check, ...(installOut ? { out: installOut } : {}) });
  const blocking = result.findings.filter(finding => finding.severity !== 'info');
  if (blocking.length) fail(`Publisher could not install the studio routes: ${blocking.map(finding => finding.detail).join('; ')}`);
  const drift = result.files.filter(file => file.state === 'drift');
  if (drift.length) throw new Error(`Generated Studio routes drift: ${drift.map(file => file.file).join(', ')}`);
  return result.files.filter(file => file.state !== 'removed');
}

export async function generateStudioMap({ clossysRoot = defaultClossysRoot, outputDir = resolve(studioRoot, 'generated'), appDir = join(outputDir, '..', 'app'), installOut, check = false, payloads = true, target, previewItems } = {}) {
  if ((target !== undefined && target !== 'preview') || (target !== 'preview' && previewItems !== undefined)) fail('Draft bindings require an explicit preview target');
  const publisherRoot = join(clossysRoot, 'agents', 'publisher');
  const pinned = await readPinnedPublication(publisherRoot, 'studio');
  const routePack = pinned.routePack;
  if (!routePack) fail('the studio publication has no route metadata');
  // Parameterized records expand through the content map: one tab page per IA group, one leaf template per tab.
  const expansion = expandPublication(clossysRoot, pinned.map, routePack.routes);
  const map = expansion.map;
  const root = routePack.root;
  if (!object(root) || typeof root.kind !== 'string' || typeof root.note !== 'string') fail('the studio publication config names no root');
  const contracts = designerContracts(clossysRoot);
  const routes = new Map(expansion.routes.map(route => [route.instanceId, route]));
  const pages = map.entries.filter(entry => entry.kind === 'page').map(entry => {
    const route = routes.get(entry.id);
    if (!route) fail(`${entry.id} has no Route metadata`);
    return assemblyOf(entry, route, contracts);
  });
  const manifestSlots = manifest => manifest.modules.map(module => module.section);
  const slots = [...new Set(pages.flatMap(page => [page.frameId, ...page.sectionIds, ...(page.leaf?.sectionIds ?? []), ...manifestSlots(page.manifest), ...(page.leaf ? manifestSlots(page.leaf.manifest) : [])]))];
  const items = target === 'preview' ? await draftStudioItems(clossysRoot, studioRoot, previewItems, slots) : [];
  if (target !== 'preview') {
    const entries = new Map(listSlots(clossysRoot, 'designer').map(entry => [entry.id, entry]));
    for (const slot of slots) items.push(pinnedItem(clossysRoot, entries, slot));
  }
  if (payloads) for (const item of items) await checkPayload(item);
  const installed = await installStudioRoutes({ clossysRoot, appDir, check, installOut });
  const routeOf = (page, kind) => {
    const row = installed.find(file => file.pageId === page.id && file.kind === kind);
    return row && { path: row.route, entry: { file: `studio/app/${row.file}`, export: 'default' } };
  };
  const frames = items.filter(item => item.slot.startsWith('frames.'));
  const sections = items.filter(item => item.slot.startsWith('sections.'));
  const projection = {
    publicationId: map.publicationId, homeId: routePack.homeRouteId, root, map, pages,
    // Every leaf a tab serves (`<tab path>/<slot id>`), and the redirects the expanded map declares.
    leaves: expansion.leafTemplates.flatMap(template => {
      const tab = expansion.tabs.find(row => row.id === template.pageId);
      return template.leaves.map(leaf => ({ page: template.pageId, slug: leaf.slug, title: leaf.title, path: `${tab.path}/${leaf.slug}` }));
    }),
    redirects: projectRedirects(map),
    ...(target === 'preview' ? { assembly: previewDescriptor(previewItems) } : {}),
    items: items.map(item => ({ slot: item.slot, element: item.element, version: item.version, ...(item.previewEvidence ? { previewEvidence: item.previewEvidence } : {}) })),
    // Page module actions per page, for the selected-runtime module census.
    pageActions: Object.fromEntries(map.entries.filter(entry => entry.kind === 'page').map(entry => [entry.id, entry.actions ?? []])),
    // Every page is an App Router route Publisher installed; a leaf template is one more, `[slug]`.
    routes: pages.map(page => {
      const own = routeOf(page, 'page'), leaf = routeOf(page, 'leaf');
      if (!own || (page.leaf && !leaf)) fail(`${page.id} has no route installed by Publisher`);
      return { instanceId: page.id, path: page.path, label: page.title, entry: own.entry, ...(leaf ? { leaf } : {}) };
    }),
  };
  const assemblyBanner = target === 'preview' ? '// Generated Studio DRAFT preview from explicit native bindings; unapproved and not release qualified.\n' : banner;
  const module = `${assemblyBanner}import type { ContentMap, ContentMapPageAction } from '@clossys/publisher/content-map';
import projection from './studio-map.json';

/** One page module: a header icon whose popover places a pinned module section, fed from a named source. */
export interface StudioManifestModule { id: string; icon: string; label: string; section: string; input: string; source: string; shortcut: string }
/** One header action: a header icon whose popover copies a prompt naming the page. */
export interface StudioManifestAction { id: string; icon: string; label: string; shortcut: string; handler: { kind: 'copy-prompt'; prompt: string } }
/** The page manifest: navigator, modules, header actions and one wiring line per interaction. */
export interface StudioPageManifest { navigator: 'outline'; modules: readonly StudioManifestModule[]; actions: readonly StudioManifestAction[]; wiring: readonly { do: string; expect: string }[] }
/** How one assembly is laid out and fed: a data loader, and per section the data field its contract input reads. */
export interface StudioAssemblySpec { body: 'plain' | 'detail'; data: { loader: string; agent?: string; purpose?: string; description?: string; groups?: readonly string[] }; inputs: Record<string, string>; sectionIds: readonly string[]; manifest: StudioPageManifest }
/** A Publisher page record: frame + ordered sections + bindings; \`leaf\` assembles every leaf beneath the page. */
export interface StudioPageRecord extends StudioAssemblySpec { id: string; path: string; title: string; frameId: string; leaf?: StudioAssemblySpec & { param: 'slug' } }

export const studioMap = projection.map as ContentMap;
export const studioPages = projection.pages as unknown as readonly StudioPageRecord[];
export const studioHomeId: string = projection.homeId;
export const studioPublicationRoot = projection.root as { kind: string; note: string };
export const studioItems = projection.items as readonly { slot: string; element: string; version: number }[];
/** A page module action, as the Publisher content map declares it. */
export type StudioPageAction = ContentMapPageAction;
export const studioPageActions = projection.pageActions as unknown as Readonly<Record<string, readonly ContentMapPageAction[]>>;
/** The route files Publisher installed under app/ (\`publish --install --next\`): each page, and each gallery's leaf template. */
export interface StudioInstalledRoute { instanceId: string; path: string; label: string; entry: { file: string; export: string }; leaf?: { path: string; entry: { file: string; export: string } } }
export const studioRoutes = projection.routes as readonly StudioInstalledRoute[];
/** One leaf a tab page serves: the tab's page id, the slot slug, its label and its served path. */
export interface StudioLeaf { page: string; slug: string; title: string; path: string }
export const studioLeaves = projection.leaves as readonly StudioLeaf[];
/** The top-level groups of the content map: the agents, in map order. */
export const studioAgents = studioMap.entries.filter(row => row.kind === 'group' && !row.parentId).sort((a, b) => a.order - b.order).map(row => ({ id: row.id, label: row.title }));
`;
  const bindings = `${assemblyBanner}import type { ComponentType } from 'react';
import type { StudioShellProps } from '../frames/studio-shell';
${frames.map((item, i) => `import Frame${i} from ${JSON.stringify(item.module)};`).join('\n')}
${sections.map((item, i) => `import Section${i} from ${JSON.stringify(item.module)};`).join('\n')}

/** ${target === 'preview' ? 'Draft preview' : 'Pinned'} page frame per frame slot. */
export const studioFrames: Record<string, ComponentType<StudioShellProps>> = {
${frames.map((item, i) => `  ${JSON.stringify(item.slot)}: Frame${i},`).join('\n')}
};
/** ${target === 'preview' ? 'Draft preview' : 'Pinned'} section per section slot; each takes one prop, named by its contract input. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- each section types its own input; the assembly binds it by name.
export const studioSections: Record<string, ComponentType<any>> = {
${sections.map((item, i) => `  ${JSON.stringify(item.slot)}: Section${i},`).join('\n')}
};
`;
  const copy = target === 'preview'
    ? await studioCopyRegistry(clossysRoot, { target: 'preview', absentPin: 'newest-draft' })
    : await studioCopyRegistry(clossysRoot);
  const files = { 'studio-copy.json': json(copy), 'studio-map.json': json(projection), 'studio-map.ts': module, 'assembly-bindings.ts': bindings };
  if (check && (await readdir(outputDir)).some(name => !Object.hasOwn(files, name))) throw new Error('Unexpected file in generated Studio projection');
  if (!check) {
    await mkdir(outputDir, { recursive: true });
    for (const name of await readdir(outputDir)) if (!Object.hasOwn(files, name)) await import('node:fs/promises').then(fs => fs.rm(join(outputDir, name)));
  }
  for (const [name, content] of Object.entries(files)) {
    const path = resolve(outputDir, name);
    if (check) {
      let stored; try { stored = await readFile(path, 'utf8'); } catch { throw new Error(`Generated Studio projection missing: ${name}`); }
      if (stored !== content) throw new Error(`Generated Studio projection drift: ${name}`);
    } else await writeFile(path, content);
  }
  return projection;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const invocation = await previewArguments(process.argv.slice(2));
  const preview = invocation.options.target ? invocation.options : await previewOptionsFromEnvironment();
  await generateStudioMap({ check: invocation.args.includes('--check'), ...preview });
}
