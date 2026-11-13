import configs from "../../../../examples/admin-pages.config.json" with { type: "json" };
import { createConsumerPageRecords, createConsumerPageRegistry, consumerPageRef, consumerPageStaticContent } from "../admin-page.js";
export { configs };
const byId = id => configs.find(config => config.id === id);
export function fixtureSources(id) {
  return { list: { entry: { file: `app/agents/${id}/page.tsx`, export: "default" }, source: { file: `src/pages/${id}.tsx`, export: "default" } },
    item: { entry: { file: `app/agents/${id}/[l0]/[id]/page.tsx`, export: "default" }, source: { file: `src/pages/${id}-item.tsx`, export: "default" } }, runtime: { file: "src/pages/runtime.ts", export: "usePageRuntime" } };
}
function entry(config, copy, item = false, itemTitle) {
  return { id: item ? config.item.entryId : config.entryId, ...(item ? { parentId: config.entryId } : {}), order: 0,
    title: copy(itemTitle ?? config.title), path: `/agents/${config.id}${item ? "/[l0]/[id]" : ""}`, kind: "page", source: { planItemId: `app.${config.entryId}${item ? ".item" : ""}` }, pageConfig: config.id };
}
export function fixtureMap(publication, copy, selected = configs, itemTitles = {}) {
  return { version: 1, publicationId: publication.id, format: "web.page.responsive", entries: selected.flatMap(config => [entry(config, copy), entry(config, copy, true, itemTitles[config.id])]) };
}
export const adminPageRef = (id, name, kind) => consumerPageRef(byId(id).namespace, name, kind);
export const adminPageStaticContent = (id, manifest, copy) => consumerPageStaticContent(byId(id), manifest, copy);
export const ADMIN_PAGE_COPY_REFS = { showAll: { kind: "copy", ref: "strings.admin.action.showAll" } };
function fixtureRecords(id, options) {
  const config = byId(id);
  return createConsumerPageRecords(config, { ...options, channel: "admin", entry: entry(config, options.copy), itemEntry: entry(config, options.copy, true, options.itemTitle), brand: { homeRouteId: options.homeRouteId ?? "admin.designer", label: options.copy("strings.admin.page.designer") }, sources: options.sources ?? fixtureSources(id) });
}
export const createDesignerPageRecords = options => fixtureRecords("designer", options);
export const createWriterPageRecords = options => fixtureRecords("writer", options);
export const createPublisherPageRecords = options => fixtureRecords("publisher", options);
export function createAdminPageRegistry(options) {
  const publication = { ...options.publication, inspector: options.publication.inspector ?? { section: "sections.chat", members: { part: "message" }, content: { parts: { kind: "records", ref: "admin.chat/parts" }, composer: { kind: "region", ref: "admin.chat/composer" } } } };
  return createConsumerPageRegistry({ ...options, channel: "admin", publication, map: fixtureMap(publication, options.copy, configs, options.itemTitles), configs,
    sources: Object.fromEntries(configs.map(config => [config.id, options.sources?.[config.id] ?? fixtureSources(config.id)])) });
}
