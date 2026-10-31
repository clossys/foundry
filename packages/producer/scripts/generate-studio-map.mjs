import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { contentMapFromCells, compileContentMaps } from '@clossys/publisher/content-map/cells';

const studioRoot = fileURLToPath(new URL('../studio/', import.meta.url));
const defaultClossysRoot = fileURLToPath(new URL('../../../clossys/', import.meta.url));
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const banner = '// Generated from Foundry Publisher cells and the Studio library selection. Run npm run generate:studio-map.\n';
/** Files a library version carries beside the code Studio runs: provenance, not payload. */
const RECORD_ONLY = new Set(['registry-item.json', 'LICENCE.md']);
const LAYER_FOLDER = { frames: 'frames', sections: 'sections' };

function fail(message) { throw new Error(`Studio assembly: ${message}`); }
const object = value => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * One assembly per Publisher page cell: the frame, the ordered sections and, per section, the
 * data field its single contract input reads. A page with a `leaf` template also assembles every
 * leaf beneath it at runtime from the same frame.
 */
function assemblyOf(entry, route, contracts) {
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
  const page = { id: entry.id, path: entry.path, title: entry.title, frameId: source.frameId, sectionIds: source.sectionIds, body: route.body, data: route.data, inputs: route.inputs };
  if (route.leaf !== undefined) {
    const leaf = route.leaf;
    if (!object(leaf) || leaf.param !== 'slug' || !['plain', 'detail'].includes(leaf.body) || !object(leaf.data) || !Array.isArray(leaf.sections)) fail(`${entry.id} has an invalid leaf template`);
    checkInputs(`${entry.id} leaf`, leaf.sections, leaf.inputs);
    page.leaf = { param: leaf.param, body: leaf.body, data: leaf.data, sectionIds: leaf.sections, inputs: leaf.inputs };
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

/** The Studio folder must hold exactly the pinned payload's code: Studio runs the registered item, nothing else. */
async function checkPayload(item) {
  const code = item.payload.filter(file => !RECORD_ONLY.has(file)).sort();
  const present = existsSync(item.studioDir) ? (await readdir(item.studioDir)).filter(name => !name.startsWith('.')).sort() : [];
  if (JSON.stringify(code) !== JSON.stringify(present)) fail(`${item.slot}: studio folder files [${present}] differ from the pinned payload [${code}]`);
  for (const file of code) {
    const [stored, running] = await Promise.all([readFile(join(item.versionDir, file), 'utf8'), readFile(join(item.studioDir, file), 'utf8')]);
    if (stored !== running) fail(`${item.slot}: ${file} differs from ${item.element} v${item.version} in the library`);
  }
}

/** Build-time authoring only. Runtime consumers read the generated projection. */
export async function generateStudioMap({ clossysRoot = defaultClossysRoot, outputDir = resolve(studioRoot, 'generated'), check = false, payloads = true } = {}) {
  const cellRoot = join(clossysRoot, 'agents', 'publisher');
  const tree = await readJson(join(cellRoot, 'tree.json'));
  const publication = tree.meta.publications.find(value => value.id === 'studio');
  if (!publication?.routePack) fail('the studio publication has no route metadata');
  const root = publication.routePack.root;
  if (!object(root) || typeof root.kind !== 'string' || typeof root.note !== 'string') fail('the studio publication config names no root');
  const map = await contentMapFromCells(cellRoot, publication.id);
  await compileContentMaps(cellRoot, { check });
  const routePack = await readJson(join(cellRoot, 'route-pack', `${publication.id}.json`));
  const contracts = new Map((await readJson(join(clossysRoot, 'agents', 'designer', 'slot-contracts', 'studio.json'))).map(contract => [contract.slot, contract]));
  const routes = new Map(routePack.routes.map(route => [route.instanceId, route]));
  const pages = map.entries.filter(entry => entry.kind === 'page').map(entry => {
    const route = routes.get(entry.id);
    if (!route) fail(`${entry.id} has no Route metadata`);
    return assemblyOf(entry, route, contracts);
  });
  const selection = await readJson(join(clossysRoot, 'selection.json'));
  const slots = [...new Set(pages.flatMap(page => [page.frameId, ...page.sectionIds, ...(page.leaf?.sectionIds ?? [])]))];
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

/** How one assembly is laid out and fed: a data loader, and per section the data field its contract input reads. */
export interface StudioAssemblySpec { body: 'plain' | 'detail'; data: { loader: string; agent?: string }; inputs: Record<string, string>; sectionIds: readonly string[] }
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

/** Pinned frame per frame slot. */
export const studioFrames: Record<string, ComponentType<StudioShellProps>> = {
${frames.map((item, i) => `  ${JSON.stringify(item.slot)}: Frame${i},`).join('\n')}
};
/** Pinned section per section slot; each takes one prop, named by its contract input. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- each section types its own input; the assembly binds it by name.
export const studioSections: Record<string, ComponentType<any>> = {
${sections.map((item, i) => `  ${JSON.stringify(item.slot)}: Section${i},`).join('\n')}
};
`;
  const files = { 'studio-map.json': json(projection), 'studio-map.ts': module, 'assembly-bindings.ts': bindings };
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
