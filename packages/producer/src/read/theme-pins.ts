/**
 * Theme pin resolution (designer.md 9.8, system.md 14.2): read the consumer's pinned `themes.*`
 * Designer slots and hand them to `@clossys/designer`'s pure projection. A consumer with no Designer
 * slot model, or no pinned theme slot, gets the package default theme; a pinned theme slot that does
 * not resolve is a visible error, never a silent fallback.
 */
import { join } from "node:path";
import { defaultThemeCss, isEmptyProjection, projectTheme, themeHash, toCss, type ResolvedThemePins, type ThemeProjection as DesignerThemeProjection } from "@clossys/designer/build/theme";
import type { ThemeProjection } from "../records/types.js";
import { hasAgentModel, hasPinFile, listSlots, readCandidate, withSlotReadScope } from "../records/slots.js";

/**
 * Designer declares `clossys.theme/1` locally (it never imports producer, system.md 14.2); this
 * fails the build if that declaration and the canonical record type in `records/types.ts` drift.
 */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const projectionMatchesRecord: Same<DesignerThemeProjection, ThemeProjection> = true;
void projectionMatchesRecord;

export interface ConsumerTheme {
  source: "consumer" | "foundry" | "error";
  css: string;
  hash: string;
  /** A failed consumer theme remains distinguishable from an uninitialized one. */
  message?: string;
}

export interface PinnedItem { item: Record<string, any>; version: number; candidate: string; sha256: string }

/** The consumer's `clossys/` root, when it carries a Designer slot model. */
export function designerWorkspace(root: string): string | undefined {
  const library = join(root, "clossys");
  return hasAgentModel(library, "designer") ? library : undefined;
}

/** Every pinned Designer candidate's registry item, only while its bytes still match the pin. */
export function pinnedDesignerItems(library: string): Map<string, PinnedItem> {
  // One read scope for the whole pass: the record memo's folder check runs once, not once per pin.
  return withSlotReadScope(() => {
    const items = new Map<string, PinnedItem>();
    for (const entry of listSlots(library, "designer")) {
      if (!entry.pin || !entry.candidates.includes(entry.pin.candidate)) continue;
      // A drifted candidate is not the pin; a pinned candidate that cannot be read or parsed surfaces.
      const candidate = readCandidate(library, "designer", entry.id, entry.pin.candidate);
      if (candidate.sha256 !== entry.pin.sha256) continue;
      const item = JSON.parse(candidate.bytes);
      const version = Number(/-v([1-9][0-9]*)\.json$/.exec(entry.pin.candidate)?.[1] ?? 0);
      if (typeof item?.name === "string" && version) items.set(entry.id, { item, version, candidate: entry.pin.candidate, sha256: candidate.sha256 });
    }
    return items;
  });
}

/** The consumer's `themes.*` pins projected to the `clossys.theme/1` record. */
export function consumerThemeProjection(library: string): ThemeProjection {
  return projectTheme(resolveThemePins(library));
}

/** The consumer's resolved `themes.*` pins, ready for `projectTheme()`. */
export function resolveThemePins(library: string): ResolvedThemePins {
  const pins: ResolvedThemePins = {};
  for (const [slot, pin] of pinnedDesignerItems(library)) {
    if (slot.startsWith("themes.")) pins[slot] = { slot, candidate: pin.candidate, sha256: pin.sha256, sample: false, content: pin.item };
  }
  return pins;
}

/** The pinned `themes.*` slots as CSS, or undefined when they declare no variable. */
export function pinnedThemeCss(library: string): string | undefined {
  const pins = resolveThemePins(library);
  if (!Object.keys(pins).length) return undefined;
  const projection = projectTheme(pins);
  return isEmptyProjection(projection) ? undefined : toCss(projection.vars);
}

export function packageDefaultTheme(): ConsumerTheme {
  const css = defaultThemeCss();
  return { source: "foundry", css, hash: themeHash(css) };
}

const failed = (message: string): ConsumerTheme => ({ ...packageDefaultTheme(), source: "error", message });

/** The consumer's theme stylesheet from its pinned `themes.*` slots, else the package default. */
export function readConsumerTheme(root: string): ConsumerTheme {
  try {
    // One read scope: the watched folder's identity is checked once, not once per slot.
    return withSlotReadScope(() => {
      const library = designerWorkspace(root);
      if (!library) return packageDefaultTheme();
      const items = pinnedDesignerItems(library);
      const pinned = listSlots(library, "designer").filter(entry => entry.id.startsWith("themes.") && hasPinFile(entry.dir));
      // A theme pin whose candidate is missing or drifted is an error, not a slot to skip.
      const broken = pinned.filter(entry => !items.has(entry.id)).map(entry => entry.id);
      if (broken.length) return failed(`Consumer theme could not be compiled: ${broken.join(", ")} ${broken.length === 1 ? "does" : "do"} not match ${broken.length === 1 ? "its" : "their"} pin`);
      const css = pinnedThemeCss(library);
      if (css !== undefined) return { source: "consumer", css, hash: themeHash(css) };
      return pinned.length ? failed("Consumer theme could not be compiled: the pinned themes.* slots declare no CSS variables") : packageDefaultTheme();
    });
  } catch (error) {
    return failed(`Consumer theme could not be compiled: ${error instanceof Error ? error.message : String(error)}`);
  }
}
