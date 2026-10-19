import { Panel } from "./Panel.js";
import { Drawer } from "./Drawer.js";
import { ResizablePane } from "./ResizablePane.js";
import { CommandMenu } from "./CommandMenu.js";

/** Source-backed Material selections within the Block tier; these records grant no role qualification. */
export const APP_FRAME_MATERIALS = [
  {
    id: "panel", layer: "blocks", exportName: "Panel", component: Panel, source: "src/blocks/Panel.tsx",
    regions: ["header", "content", "footer"],
    dependencies: [{ exportName: "Card", source: "src/atoms/Card.tsx" }],
    configs: [{ prop: "ground", values: ["base", "sunken", "inverse"], default: "base", source: "src/atoms/Card.tsx" }],
    authoredInputs: ["header", "children", "footer"],
  },
  {
    id: "drawer", layer: "blocks", exportName: "Drawer", component: Drawer, source: "src/blocks/Drawer.tsx",
    regions: ["trigger", "header", "content", "footer"],
    dependencies: [
      { exportName: "Dialog", source: "src/atoms/Dialog.tsx" },
      { exportName: "Panel", source: "src/blocks/Panel.tsx" },
      { exportName: "Button", source: "src/atoms/Button.tsx" },
    ],
    configs: [{ prop: "placement", values: ["start", "end", "bottom"], default: "start", source: "src/blocks/Drawer.tsx" }],
    authoredInputs: ["trigger", "heading", "closeLabel", "children", "footer", "navigationKey", "dismissAt"],
  },
  {
    id: "resizable-pane", layer: "blocks", exportName: "ResizablePane", component: ResizablePane, source: "src/blocks/ResizablePane.tsx",
    regions: ["header", "content", "footer", "resize-handle"],
    dependencies: [
      { exportName: "Panel", source: "src/blocks/Panel.tsx" },
      { exportName: "ResizeHandle", source: "src/atoms/ResizeHandle.tsx" },
    ],
    configs: [{ prop: "orientation", values: ["vertical", "horizontal"], default: "vertical", source: "src/atoms/ResizeHandle.tsx" }],
    authoredInputs: ["min", "max", "defaultValue", "value", "step", "label", "handleLabel", "onChange", "children"],
  },
  {
    id: "command-menu", layer: "blocks", exportName: "CommandMenu", component: CommandMenu, source: "src/blocks/CommandMenu.tsx",
    regions: ["heading", "search", "content", "status"],
    dependencies: [
      { exportName: "Dialog", source: "src/atoms/Dialog.tsx" },
      { exportName: "SearchField", source: "src/atoms/SearchField.tsx" },
      { exportName: "Tooltip", source: "src/atoms/Tooltip.tsx" },
      { exportName: "IconButton", source: "src/atoms/IconButton.tsx" },
    ],
    configs: [],
    authoredInputs: ["heading", "searchLabel", "closeLabel", "emptyMessage", "groups", "isOpen", "onOpenChange", "query", "onQueryChange", "filter", "dir", "resultCountMessage"],
  },
] as const;
