import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { contentMapFromCells, compileContentMaps } from '@clossys/publisher/content-map/cells';
import { projectNavigation, projectCommands, projectBreadcrumbs } from '@clossys/publisher/content-map';

const studioRoot = fileURLToPath(new URL('../studio/', import.meta.url));
const defaultCellRoot = fileURLToPath(new URL('../../../clossys/agents/publisher/', import.meta.url));
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const banner = '// Generated from Foundry Publisher cells. Run npm run generate:studio-map.\n';

function sourceModule(source) {
  if (!source || typeof source.file !== 'string' || source.export !== 'default' || !/^studio\/views\/[A-Za-z][A-Za-z0-9]*\.tsx$/.test(source.file)) throw new TypeError('Studio routes require a real default-export Studio view');
  return `../${source.file.slice('studio/'.length, -'.tsx'.length)}`;
}

/** Build-time authoring only. Runtime consumers read the generated projection. */
export async function generateStudioMap({ cellRoot = defaultCellRoot, outputDir = resolve(studioRoot, 'generated'), check = false } = {}) {
  const tree = JSON.parse(await readFile(resolve(cellRoot, 'tree.json'), 'utf8'));
  const publication = tree.meta.publications.find(value => value.id === 'studio');
  if (!publication?.routePack) throw new TypeError('Studio publication requires authored route metadata');
  const map = await contentMapFromCells(cellRoot, publication.id);
  await compileContentMaps(cellRoot, { check });
  // CELL-P projects Route source metadata with each active cell's current path/title.
  // These consumer view exports are not Publisher executable assembly registrations.
  const routePack = JSON.parse(await readFile(resolve(cellRoot, 'route-pack', `${publication.id}.json`), 'utf8'));
  for (const route of routePack.routes) {
    sourceModule(route.entry);
    const target = resolve(studioRoot, '..', route.entry.file);
    const rel = relative(studioRoot, target);
    if (isAbsolute(rel) || rel.startsWith('..')) throw new TypeError('Studio view escapes its package');
    const view = await readFile(target, 'utf8');
    if (!/export\s+default\s/.test(view)) throw new TypeError(`Studio view has no default export: ${route.entry.file}`);
  }
  const routes = routePack.routes;
  const pages = map.entries.filter(row => row.kind === 'page');
  const projection = {
    publicationId: map.publicationId, map, routes,
    navigation: Object.fromEntries(pages.map(page => [page.id, projectNavigation(map, page.id)])),
    commands: projectCommands(map),
    pageActions: Object.fromEntries(pages.map(page => [page.id, page.actions ?? []])),
    breadcrumbs: Object.fromEntries(pages.map(page => [page.id, projectBreadcrumbs(map, page.id)])),
  };
  const module = `${banner}import type { ContentMap, ContentMapNavigation, ContentMapCommandGroup, ContentMapBreadcrumb, ContentMapPageAction } from '@clossys/publisher/content-map';
import projection from './studio-map.json';
export type StudioPageAction = ContentMapPageAction;
export const studioMap = projection.map as ContentMap;
export const studioPageActions = projection.pageActions as Record<string, readonly StudioPageAction[]>;
export const studioRoutes = projection.routes;
export const studioNavigation = projection.navigation as Record<string, ContentMapNavigation>;
export const studioCommands = projection.commands as readonly ContentMapCommandGroup[];
export const studioBreadcrumbs = projection.breadcrumbs as Record<string, readonly ContentMapBreadcrumb[]>;
export const studioHome = (() => { const route = studioRoutes.find(row => row.instanceId === ${JSON.stringify(routePack.homeRouteId)})!; return { id: route.instanceId, label: route.label, href: route.path }; })();
export const studioAgents = studioMap.entries.filter(row => row.kind === 'page' && row.parentId === 'agents').sort((a,b) => a.order-b.order).map(row => ({ id: row.id, label: row.title }));
export function studioRouteForPath(path: string) { return studioRoutes.find(row => row.path === path); }
export function studioRouteForSegments(segments: readonly string[]) { return studioRouteForPath('/' + segments.join('/')); }
export function studioAgentHref(agent: string) { return studioRoutes.find(row => row.instanceId === agent)?.path ?? studioHome.href; }
`;
  const bindings = `${banner}import type { ComponentType } from 'react';\n${routes.map((route, i) => `import View${i} from ${JSON.stringify(sourceModule(route.entry))};`).join('\n')}
export const studioViewBindings: Record<string, ComponentType> = {\n${routes.map((route, i) => `  ${JSON.stringify(route.instanceId)}: View${i},`).join('\n')}\n};\n`;
  const files = { 'studio-map.json': json(projection), 'studio-map.ts': module, 'view-bindings.ts': bindings };
  if (check && (await readdir(outputDir)).some(name => !Object.hasOwn(files, name))) throw new Error('Unexpected file in generated Studio projection');
  if (!check) await mkdir(outputDir, { recursive: true });
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
