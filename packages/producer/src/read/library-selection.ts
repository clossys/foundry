/**
 * Studio selection and brand from the Designer slot model (`clossys/agents/designer`): each
 * slot's `pin.json` and the shadcn registry item candidate it names. The legacy Designer fills
 * schema is only read when the consumer has no Designer slot model.
 */
import { join } from "node:path";
import { themeHash } from "@clossys/designer/build/theme";
import { hasAgentModel, hasPinFile, listSlots, withSlotReadScope } from "../records/slots.js";
import { pinnedDesignerItems, pinnedThemeCss, type ConsumerTheme } from "./theme-pins.js";

export interface LibrarySelection {
  /** A slot-model selection composes from the pins; it has no compiled catalog runtime. */
  model: "slots";
  hash: string;
  leaves: ({ leaf: string; source: "consumer"; fill: string; hash?: string } | { leaf: string; source: "unavailable"; message: string })[];
  gateReports: never[];
}

/** The consumer's `clossys/` root, when it carries a Designer slot model. */
export function libraryWorkspace(root: string): string | undefined {
  const library = join(root, "clossys");
  return hasAgentModel(library, "designer") ? library : undefined;
}

/** A pinned candidate's registry item, only while its bytes still match the pin. */
const pinnedItems = pinnedDesignerItems;

/**
 * One leaf per pinned slot, provenance `consumer`, hashed from the pins it reads. A slot with a pin
 * file whose candidate is missing, drifted or not a registry item is an `unavailable` leaf, never skipped.
 */
export function librarySelection(library: string): LibrarySelection {
  return withSlotReadScope(() => librarySelectionIn(library));
}
function librarySelectionIn(library: string): LibrarySelection {
  const items = pinnedItems(library);
  const resolved = [...items].map(([leaf, pin]) => ({ leaf, source: "consumer" as const, fill: `${pin.item.name}@v${pin.version}`, hash: `sha256:${pin.sha256}` }));
  const unresolved = listSlots(library, "designer").filter(entry => !items.has(entry.id) && hasPinFile(entry.dir))
    .map(entry => ({ leaf: entry.id, source: "unavailable" as const, message: "pinned candidate is missing, drifted from its pin or not a registry item" }));
  const leaves = [...resolved, ...unresolved].sort((a, b) => a.leaf.localeCompare(b.leaf));
  return { model: "slots", hash: themeHash(JSON.stringify(resolved.sort((a, b) => a.leaf.localeCompare(b.leaf)))), leaves, gateReports: [] };
}

/**
 * The pinned `themes.*` slots composed into Studio's brand stylesheet: each `registry:theme`
 * item's shadcn variables (theme and light on `:root`, dark on `.dark`) and each
 * `registry:font` item's variable. Undefined when the consumer pins no theme slot.
 */
export function libraryTheme(library: string): ConsumerTheme | undefined {
  const css = pinnedThemeCss(library);
  return css === undefined ? undefined : { source: "consumer", css, hash: themeHash(css) };
}
