import { isContentJson } from "../content/json.js";
import { outputPathFor } from "../content/metadata.js";
import type { CandidateContent, ContentRegistry } from "../content/model.js";
import { parseContentRegistry } from "../content/validate.js";
import { assertContentRouteRegistration } from "./content-route-registration.js";
import type { ContentRouteInput, ContentRouteRegistration, ContentRouteSelection } from "./content-route-types.js";

/** Object insertion order has no meaning; composition and section array order does. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function content(value: CandidateContent): Record<string, unknown> {
  const keys = ["name", "brief", "composition", "redirectTarget", "pageMeta", "pageMetaAssets", "links", "typeSettings", "openQuestions"] as const;
  return Object.fromEntries(keys.filter(key => value[key] !== undefined).map(key => [key, value[key]]));
}

/** Selection is display identity, not approval or cryptographic release verification. */
export function selectContentRoute(registry: ContentRegistry, slotId: string, locale: string): ContentRouteSelection {
  if (!isContentJson(registry)) throw new TypeError("A finite content registry is required");
  const parsed = parseContentRegistry(registry);
  const slot = parsed.slots.find(entry => entry.id === slotId);
  if (!slot || !slot.locales.includes(locale) || !parsed.workspace.locales.includes(locale)) {
    throw new TypeError("An exact registered slot and declared locale are required");
  }
  if (slot.kind === "redirect" || !slot.activeCandidateId) throw new TypeError("A routed content or status slot with an active pointer is required");
  const candidate = parsed.candidates.find(entry => entry.slotId === slot.id && entry.id === slot.activeCandidateId);
  if (!candidate || candidate.state !== "active" || !candidate.composition) throw new TypeError("The exact active candidate composition is required");
  const snapshot = candidate.history.at(-1);
  if (!snapshot || snapshot.revision !== candidate.revision || !/^[a-f0-9]{64}$/.test(snapshot.digest)
    || canonical(content(candidate)) !== canonical(content(snapshot.content))) {
    throw new TypeError("Active content must equal its current immutable revision snapshot");
  }
  let outputPath: string;
  try { outputPath = outputPathFor(slot); }
  catch { throw new TypeError("A canonical routed slot and deploy target are required"); }
  return { slot, candidate, locale, outputPath };
}

/** Refuse loader drift from the emitted slot, active revision and composition. */
export function bindContentRoute(input: ContentRouteInput, route: ContentRouteRegistration): ContentRouteInput {
  assertContentRouteRegistration(route);
  if (!input || input.slotId !== route.slotId || input.locale !== route.locale) throw new TypeError("Loader identity differs from the emitted route");
  const { slot, candidate, outputPath } = selectContentRoute(input.registry, input.slotId, input.locale);
  if (candidate.id !== route.candidateId || candidate.revision !== route.revision
    || candidate.history.at(-1)!.digest !== route.digest || slot.route !== route.path
    || outputPath !== route.outputPath || canonical(candidate.composition) !== canonical(route.composition)) {
    throw new TypeError("Loaded active content differs from the emitted revision");
  }
  return input;
}
