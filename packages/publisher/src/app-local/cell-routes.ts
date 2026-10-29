import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { readActive, tokenizeBody } from "@clossys/strategist/cell-format";
import { contentMapFromCells } from "../content-map/cells.js";
import type { ContentMap } from "../content-map/contract.js";
import { assertContentRouteRegistration } from "../web/content-route-registration.js";
import type { ContentRouteManifest, ContentRouteRegistration } from "../web/content-route-types.js";
import { noAppLocalSymlink } from "./files.js";

const object = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);
/** Existing Route bodies and native pack headers are the serving authority; generated projections are never opened. */
export async function readServingPublication(root: string, publication: string, consumer: string): Promise<{ map: ContentMap; manifest: ContentRouteManifest }> {
  const treePath = join(root, "tree.json");
  await noAppLocalSymlink(treePath);
  const before = await readFile(treePath, "utf8"), tree: unknown = JSON.parse(before);
  if (!object(tree) || !object(tree.meta) || !Array.isArray(tree.meta.publications)) throw new Error("Active Publisher publications are required for serving Route authority");
  const publications = tree.meta.publications.filter((value: unknown) => object(value) && value.id === publication);
  if (publications.length !== 1) throw new Error("One active Publisher publication is required for serving Route authority");
  const pub = publications[0];
  if (!object(pub.routePack)) throw new Error("Active serving Route metadata and its native route pack are required");
  if (pub.routePack.version !== 2) throw new Error("Serving requires native content route manifest version 2; legacy Route packs are metadata only");
  if (pub.routePack.consumer !== consumer) throw new Error("Serving route pack consumer differs from the selected Designer library");
  if (pub.routePack.packId !== undefined && pub.routePack.packId !== publication) throw new Error("Serving route pack differs from the selected publication");
  if (Object.keys(pub.routePack).some(key => !["version", "consumer", "packId"].includes(key))) throw new Error("Serving requires a native route manifest header; legacy pack extras have no native serving authority");
  const map = await contentMapFromCells(root, publication), active = await readActive(root);
  if (!object(pub.entryIds)) throw new Error("Serving requires stable active page identities");
  const pages = map.entries.filter(entry => entry.kind === "page");
  if (!pages.length) throw new Error("At least one active serving Route page is required");
  const paths = new Set<string>(), routes: ContentRouteRegistration[] = [];
  for (const page of pages) {
    const matches = active.filter(cell => pub.entryIds[cell.id] === page.id);
    if (matches.length !== 1) throw new Error(`One active serving Route cell is required for ${page.id}`);
    const cell = matches[0]!, parsed = tokenizeBody(cell.document.body);
    if (!parsed.ok) throw new Error(`Invalid serving Route body for ${page.id}`);
    let inRoute = false, metadata: unknown;
    for (const token of parsed.value) {
      if (token.type === "heading") inRoute = token.depth === 2 && token.text === "Route";
      else if (inRoute && token.type === "json") {
        if (metadata !== undefined) throw new Error(`One serving Route registration is required for ${page.id}`);
        metadata = token.value;
      }
    }
    if (!object(metadata)) throw new Error(`Missing serving Route metadata for ${page.id}`);
    const path = page.path ?? `/${page.slug}`;
    if (metadata.path !== undefined && metadata.path !== path) throw new Error(`Serving Route path differs from active page ${page.id}`);
    const route: unknown = { ...metadata, path };
    assertContentRouteRegistration(route);
    if (page.source.frameId !== undefined && (page.source.frameId !== route.composition.frame.frameId
      || JSON.stringify(page.source.sectionIds) !== JSON.stringify([...new Set(route.composition.sections.map(section => section.sectionId))]))) throw new Error(`Serving Route composition differs from active page ${page.id}`);
    if (paths.has(route.source.file)) throw new Error("Serving pages require unique native output paths");
    paths.add(route.source.file); routes.push(route);
  }
  if (await readFile(treePath, "utf8") !== before) throw new Error("Active serving Route tree changed during emission");
  return { map, manifest: { version: 2, consumer, routes } };
}
