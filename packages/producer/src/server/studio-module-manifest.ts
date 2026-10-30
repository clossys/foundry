import { readFile } from 'node:fs/promises';

/** The exact Publisher projection also drives selected-runtime module requirements. */
export async function studioModuleRequirements(): Promise<string[]> {
  let projection: unknown;
  for (const url of [new URL('../studio/studio-map.json', import.meta.url), new URL('../../studio/generated/studio-map.json', import.meta.url)]) {
    try { projection = JSON.parse(await readFile(url, 'utf8')); break; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  if (!projection || typeof projection !== 'object' || !('pageActions' in projection) || !projection.pageActions || typeof projection.pageActions !== 'object') throw new Error('The Studio page-action projection is unavailable.');
  const sections = new Set<string>();
  for (const actions of Object.values(projection.pageActions)) {
    if (!Array.isArray(actions)) throw new Error('The Studio page-action projection is invalid.');
    for (const action of actions) {
      if (!action || typeof action !== 'object') throw new Error('The Studio page action is invalid.');
      if (!action.module) continue;
      if (typeof action.module.section !== 'string' || !/^sections\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(action.module.section)) throw new Error('The Studio module section reference is invalid.');
      sections.add(action.module.section);
    }
  }
  return sections.size ? ['frames.page-module', ...[...sections].sort()] : [];
}
