import type { CatalogData, CompositeCatalogData, CompositeEngineInput, CompositeLibraryData, LibraryData } from "@clossys/designer/catalog";
import { hasPinFile, listSlots, withSlotReadScope } from "../records/slots.js";
import { libraryTheme, librarySelection, libraryWorkspace } from "./library-selection.js";
import { defaultStudioTheme, type StudioTheme } from "./theme-default.js";
export { defaultStudioTheme, themeHash, type StudioTheme } from "./theme-default.js";

/** A Designer catalog and library for the Studio engine selection. */
export interface StudioDesignerLibrary {
  catalog: CatalogData | CompositeCatalogData;
  library: LibraryData | CompositeLibraryData;
  activeIds: string[];
  componentOptions?: CompositeEngineInput["componentOptions"];
}

const failed = (message: string): StudioTheme => ({ ...defaultStudioTheme(), source: "error", message });

/**
 * The consumer's brand stylesheet from its pinned `themes.*` Designer slots. A consumer with no
 * Designer slot model, or no pinned theme slot, is unbranded (the Foundry theme, reported as
 * such); pinned theme slots that do not compile are a visible error, never a silent fallback.
 */
export async function studioTheme(root: string): Promise<StudioTheme> {
  try {
    // One read scope: the watched folder's identity is checked once, not once per slot.
    return withSlotReadScope(() => {
      const workspace = libraryWorkspace(root);
      if (!workspace) return defaultStudioTheme();
      // A theme pin whose candidate is missing or drifted is an error, not a slot to skip.
      const read = new Set(librarySelection(workspace).leaves.filter(leaf => leaf.source === "consumer").map(leaf => leaf.leaf));
      const pinned = listSlots(workspace, "designer").filter(entry => entry.id.startsWith("themes.") && hasPinFile(entry.dir));
      const broken = pinned.filter(entry => !read.has(entry.id)).map(entry => entry.id);
      if (broken.length) return failed(`Consumer theme could not be compiled: ${broken.join(", ")} ${broken.length === 1 ? "does" : "do"} not match ${broken.length === 1 ? "its" : "their"} pin`);
      const theme = libraryTheme(workspace);
      if (theme) return theme;
      return pinned.length ? failed("Consumer theme could not be compiled: the pinned themes.* slots declare no CSS variables") : defaultStudioTheme();
    });
  } catch (error) {
    return failed(`Consumer theme could not be compiled: ${error instanceof Error ? error.message : String(error)}`);
  }
}
