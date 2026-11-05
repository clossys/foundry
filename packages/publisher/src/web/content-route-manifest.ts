import { localePathFor } from "../content/hreflang.js";
import { isContentJson } from "../content/json.js";
import type { ContentRegistry } from "../content/model.js";
import { validateContentWorkspace } from "../content/validate.js";
import { isContentLocale } from "../content/vocabulary.js";
import { selectContentRoute } from "./content-route-binding.js";
import { assertContentRouteLoader, assertContentRouteRegistration } from "./content-route-registration.js";
import type { ContentRouteManifest, ContentRouteRegistration } from "./content-route-types.js";

export interface CreateContentRouteManifestInput {
  readonly registry: ContentRegistry;
  readonly locale: string;
  readonly loader: ContentRouteRegistration["loader"];
  readonly slotIds?: readonly string[];
  readonly deployTarget?: string;
}

/** Snapshot active content into finite control data; generation grants no render or release clearance. */
export function createContentRouteManifest(input: CreateContentRouteManifestInput): ContentRouteManifest {
  if (!input || !input.registry || !isContentJson(input.registry)
    || validateContentWorkspace(input.registry.workspace).length > 0
    || typeof input.registry.workspace?.consumerId !== "string" || !input.registry.workspace.consumerId.trim()
    || !Array.isArray(input.registry.slots) || !Array.isArray(input.registry.candidates)
    || !Array.isArray(input.registry.workspace.locales) || !isContentLocale(input.locale)
    || !input.registry.workspace.locales.includes(input.locale)) {
    throw new TypeError("A finite content registry and an exact workspace locale are required");
  }
  assertContentRouteLoader(input.loader);
  if (input.deployTarget !== undefined && (typeof input.deployTarget !== "string" || !input.deployTarget.trim())) {
    throw new TypeError("A nonempty deploy-target filter is required");
  }
  if (input.slotIds !== undefined && (!Array.isArray(input.slotIds)
    || input.slotIds.some(id => typeof id !== "string" || !id.trim()) || new Set(input.slotIds).size !== input.slotIds.length)) {
    throw new TypeError("Unique content slot identities are required");
  }
  const ids = input.slotIds ?? input.registry.slots.filter(slot => slot.route !== undefined
    && Array.isArray(slot.locales) && slot.locales.includes(input.locale)
    && (input.deployTarget === undefined || slot.deployTarget === input.deployTarget)).map(slot => slot.id);
  const outputPaths = new Set<string>();
  const routes = ids.map(slotId => {
    const { slot, candidate, outputPath } = selectContentRoute(input.registry, slotId, input.locale);
    if (input.deployTarget !== undefined && slot.deployTarget !== input.deployTarget) {
      throw new TypeError("Selected content slot differs from the deploy-target filter");
    }
    if (!candidate.composition) throw new TypeError("A routed content or status composition is required");
    const snapshot = candidate.history.find(revision => revision.revision === candidate.revision);
    if (!snapshot) throw new TypeError("An exact active candidate snapshot is required");
    if (outputPaths.has(outputPath)) throw new TypeError("Content routes must have unique output paths");
    outputPaths.add(outputPath);
    const route: ContentRouteRegistration = {
      kind: "content", slotId: slot.id, candidateId: candidate.id, revision: candidate.revision, digest: snapshot.digest,
      locale: input.locale, path: localePathFor(slot.route!, input.locale, input.registry.workspace.defaultLocale), outputPath,
      composition: JSON.parse(JSON.stringify(candidate.composition)) as ContentRouteRegistration["composition"],
      source: { file: outputPath, export: "default" }, loader: { file: input.loader.file, export: input.loader.export },
    };
    assertContentRouteRegistration(route);
    return route;
  });
  return { version: 2, consumer: input.registry.workspace.consumerId, routes };
}
