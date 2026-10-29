import type { SurfaceRendererGroup } from "../../studio/surface-renderer-contract.js";
/** Frame renderer registry: one package-owned runtime renderer per designer Frames leaf. */
import { mergeRendererGroups } from "../contract.js";
import { authShellRenderer } from "./auth-shell.js";
import { appHeaderRenderer } from "./app-header.js";
import { appShellRenderer } from "./app-shell.js";
import { appSidebarRenderer } from "./app-sidebar.js";
import { commandRenderer } from "./command.js";
import { documentRenderer } from "./document.js";
import { inspectorRenderer } from "./inspector.js";
import { sheetRenderer } from "./sheet.js";
import { siteFooterRenderer } from "./site-footer.js";
import { siteShellRuntimeRenderer } from "./site-shell.js";
import { siteHeaderRenderer } from "./site-header.js";

export const frameRenderers: SurfaceRendererGroup = mergeRendererGroups({
  "frames.document": documentRenderer,
  "frames.site-shell": siteShellRuntimeRenderer,
  "frames.auth-shell": authShellRenderer,
  "frames.app-shell": appShellRenderer,
  "frames.site-header": siteHeaderRenderer,
  "frames.app-header": appHeaderRenderer,
  "frames.app-sidebar": appSidebarRenderer,
  "frames.inspector": inspectorRenderer,
  "frames.site-footer": siteFooterRenderer,
  "frames.sheet": sheetRenderer,
  "frames.command": commandRenderer,
});
