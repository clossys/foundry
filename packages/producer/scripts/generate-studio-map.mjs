import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readPinnedPublication } from '@clossys/publisher/content-map/slots';
import { checkPayload } from './studio-payload.mjs';

const studioRoot = fileURLToPath(new URL('../studio/', import.meta.url));
const defaultClossysRoot = fileURLToPath(new URL('../../../clossys/', import.meta.url));
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const banner = '// Generated from pinned Foundry Publisher candidates and the Studio library selection. Run npm run generate:studio-map.\n';
const LAYER_FOLDER = { frames: 'frames', sections: 'sections' };

function fail(message) { throw new Error(`Studio assembly: ${message}`); }
const object = value => typeof value === 'object' && value !== null && !Array.isArray(value);
const nonEmpty = value => typeof value === 'string' && value.length > 0;

/** The page manifest vocabulary: navigators, module sources, action handlers and wiring verbs. */
export const NAVIGATORS = ['explorer', 'outline'];
export const MODULE_SOURCES = ['page.explorer', 'page.outline', 'page.checks', 'page.versions'];
export const HANDLERS = ['copy-prompt'];
const WIRING_EXPECT = { 'copy-prompt': 'clipboard prompt' };

/**
 * A page manifest (app-frame-target "Page manifest"): the navigator (explorer or outline), the
 * modules and the actions, each one header icon that opens a popover (a module popover places a
 * pinned module section fed from a named source; an action popover copies a prompt), each with
 * a shortcut and a command menu entry, and one wiring line per interaction.
 * A page missing any part fails here, before anything renders.
 */
export function checkManifest(owner, manifest, contracts) {
  if (!object(manifest)) fail(`${owner} declares no page manifest`);
  for (const retired of ['frame', 'defaultOpen']) if (retired in manifest) fail(`${owner} manifest names ${retired}; popovers have no module frame or default open state`);
  if (!NAVIGATORS.includes(manifest.navigator)) fail(`${owner} manifest needs an explorer or an outline`);
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

/** The pinned element for a slot, and the Studio folder that runs it. */
async function pinnedItem(clossysRoot, selection, slot) {
  const pin = selection.pins?.[slot];
  if (!pin) fail(`${slot} has no pin in the Studio library selection`);
  const layer = slot.split('.')[0];
  const folder = LAYER_FOLDER[layer];
  if (!folder) fail(`${slot} is not a frame or section`);
  const versionDir = join(clossysRoot, 'library', slot, pin.element, `v${pin.version}`);
  const element = await readJson(join(versionDir, 'element.json'));
  if (element.hash !== pin.hash) fail(`${slot} pin hash does not match its library record`);
  if (!['adopted', 'customized', 'verbatim'].includes(element.lineage?.mode) || !element.lineage?.source?.registry) fail(`${slot} must come from a trusted reference (lineage adopted/customized with a source)`);
  return { slot, element: pin.element, version: pin.version, versionDir, payload: element.payload, studioDir: join(studioRoot, folder, pin.element), module: `../${folder}/${pin.element}` };
}

/** Project the dogfood Writer pins; an unpinned candidate or corrupt pin never becomes fallback copy. */
export async function studioCopyRegistry(clossysRoot) {
  const root = join(clossysRoot, 'agents/writer');
  let ia;
  try { ia = JSON.parse(await readFile(join(root, 'ia.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; ia = { nodes: [] }; }
  const entries = [], revisions = [];
  for (const node of ia.nodes) for (const group of node.children) for (const slot of group.slots) {
    if (!['strings.common', 'strings.statuses', 'strings.descriptions', 'strings.field-labels'].includes(slot)) continue;
    const dir = join(root, node.id, group.id, slot);
    let pin;
    try { pin = JSON.parse(await readFile(join(dir, 'pin.json'), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (!/^[a-z0-9][a-z0-9.-]*-v[1-9][0-9]*\.md$/.test(pin.candidate)) throw new Error(`Invalid Studio Writer pin: ${slot}`);
    const bytes = await readFile(join(dir, 'candidates', pin.candidate), 'utf8');
    if (createHash('sha256').update(bytes).digest('hex') !== pin.sha256) throw new Error(`Studio Writer pin hash mismatch: ${slot}`);
    revisions.push(pin.sha256);
    if (!bytes.startsWith('---\n') || !bytes.includes('\nlocales: ["en"]\n')) throw new Error(`Invalid Studio Writer locale: ${slot}`);
    const records = bytes.split(/^### /m).slice(1);
    for (const record of records) {
      const match = /^([^\n]+)\n<!-- (.+) -->\n([\s\S]*)$/.exec(record);
      if (!match) throw new Error(`Invalid Studio Writer record: ${slot}`);
      const meta = JSON.parse(match[2]);
      if (typeof meta.id !== 'string' || !meta.id.startsWith('studio.')) continue;
      if (!Array.isArray(meta.bindings) || !meta.bindings.every(binding => typeof binding === 'string')) throw new Error(`Invalid Studio Writer bindings: ${meta.id}`);
      if (entries.some(row => row.id === meta.id)) throw new Error(`Duplicate Studio Writer copy: ${meta.id}`);
      entries.push({ id: meta.id, text: match[3].replace(/\n\n?$/, ''), context: meta.bindings.join(', '), status: 'draft' });
    }
  }
  return { id: 'studio-copy', locale: 'en', revision: createHash('sha256').update(revisions.join('')).digest('hex'),
    source: { kind: 'consumer', reference: 'clossys/agents/writer' }, entries };
}

export async function generateStudioMap({ clossysRoot = defaultClossysRoot, outputDir = resolve(studioRoot, 'generated'), check = false, payloads = true } = {}) {
  const publisherRoot = join(clossysRoot, 'agents', 'publisher');
  const { map, routePack } = await readPinnedPublication(publisherRoot, 'studio');
  if (!routePack) fail('the studio publication has no route metadata');
  const root = routePack.root;
  if (!object(root) || typeof root.kind !== 'string' || typeof root.note !== 'string') fail('the studio publication config names no root');
  const contracts = new Map((await readJson(join(clossysRoot, 'agents', 'designer', 'slot-contracts', 'studio.json'))).map(contract => [contract.slot, contract]));
  const routes = new Map(routePack.routes.map(route => [route.instanceId, route]));
  const pages = map.entries.filter(entry => entry.kind === 'page').map(entry => {
    const route = routes.get(entry.id);
    if (!route) fail(`${entry.id} has no Route metadata`);
    return assemblyOf(entry, route, contracts);
  });
  const selection = await readJson(join(clossysRoot, 'selection.json'));
  const manifestSlots = manifest => manifest.modules.map(module => module.section);
  const slots = [...new Set(pages.flatMap(page => [page.frameId, ...page.sectionIds, ...(page.leaf?.sectionIds ?? []), ...manifestSlots(page.manifest), ...(page.leaf ? manifestSlots(page.leaf.manifest) : [])]))];
  const items = [];
  for (const slot of slots) items.push(await pinnedItem(clossysRoot, selection, slot));
  if (payloads) for (const item of items) await checkPayload(item);
  const frames = items.filter(item => item.slot.startsWith('frames.'));
  const sections = items.filter(item => item.slot.startsWith('sections.'));
  const projection = {
    publicationId: map.publicationId, homeId: routePack.homeRouteId, root, map, pages,
    items: items.map(item => ({ slot: item.slot, element: item.element, version: item.version })),
    // Page module actions per page, for the selected-runtime module census.
    pageActions: Object.fromEntries(map.entries.filter(entry => entry.kind === 'page').map(entry => [entry.id, entry.actions ?? []])),
    // Every page renders through the one generic App Router page.
    routes: pages.map(page => ({ instanceId: page.id, path: page.path, label: page.title, entry: { file: 'studio/app/[[...route]]/page.tsx', export: 'default' } })),
  };
  const module = `${banner}import type { ContentMap, ContentMapPageAction } from '@clossys/publisher/content-map';
import projection from './studio-map.json';

/** One page module: a header icon whose popover places a pinned module section, fed from a named source. */
export interface StudioManifestModule { id: string; icon: string; label: string; section: string; input: string; source: string; shortcut: string }
/** One header action: a header icon whose popover copies a prompt naming the page. */
export interface StudioManifestAction { id: string; icon: string; label: string; shortcut: string; handler: { kind: 'copy-prompt'; prompt: string } }
/** The page manifest: navigator, modules, header actions and one wiring line per interaction. */
export interface StudioPageManifest { navigator: 'explorer' | 'outline'; modules: readonly StudioManifestModule[]; actions: readonly StudioManifestAction[]; wiring: readonly { do: string; expect: string }[] }
/** How one assembly is laid out and fed: a data loader, and per section the data field its contract input reads. */
export interface StudioAssemblySpec { body: 'plain' | 'detail'; data: { loader: string; agent?: string }; inputs: Record<string, string>; sectionIds: readonly string[]; manifest: StudioPageManifest }
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
export const studioAgents = studioMap.entries.filter(row => row.kind === 'page' && row.parentId === 'agents').sort((a, b) => a.order - b.order).map(row => ({ id: row.id, label: row.title }));
`;
  const bindings = `${banner}import type { ComponentType } from 'react';
import type { StudioShellProps } from '../frames/studio-shell';
${frames.map((item, i) => `import Frame${i} from ${JSON.stringify(item.module)};`).join('\n')}
${sections.map((item, i) => `import Section${i} from ${JSON.stringify(item.module)};`).join('\n')}

/** Pinned page frame per frame slot. */
export const studioFrames: Record<string, ComponentType<StudioShellProps>> = {
${frames.map((item, i) => `  ${JSON.stringify(item.slot)}: Frame${i},`).join('\n')}
};
/** Pinned section per section slot; each takes one prop, named by its contract input. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- each section types its own input; the assembly binds it by name.
export const studioSections: Record<string, ComponentType<any>> = {
${sections.map((item, i) => `  ${JSON.stringify(item.slot)}: Section${i},`).join('\n')}
};
`;
  const files = { 'studio-copy.json': json(await studioCopyRegistry(clossysRoot)), 'studio-map.json': json(projection), 'studio-map.ts': module, 'assembly-bindings.ts': bindings };
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
  await generateStudioMap({ check: process.argv.includes('--check') });
}
