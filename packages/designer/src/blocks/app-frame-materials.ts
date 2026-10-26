import { GroupedTable } from "./GroupedTable.js";
import { Panel } from "./Panel.js";
import { Drawer } from "./Drawer.js";
import { ResizablePane } from "./ResizablePane.js";
import { CommandMenu } from "./CommandMenu.js";
import { PageBar } from "./PageBar.js";
import { AppNavigation } from "./AppNavigation.js";
import { RelationGraph } from "./RelationGraph.js";
import { FlowCanvas } from "./FlowCanvas.js";
import { AccountMenu } from "./AccountMenu.js";

/** Source-backed Material selections within the Block tier; these records grant no role qualification. */
export const APP_FRAME_MATERIALS = [
  {
    id: "panel", layer: "blocks", exportName: "Panel", component: Panel, source: "src/blocks/Panel.tsx",
    regions: ["header", "content", "footer"],
    dependencies: [{ exportName: "Card", source: "src/components/Card.tsx" }],
    configs: [{ prop: "ground", values: ["base", "sunken", "inverse"], default: "base", source: "src/components/Card.tsx" }],
    authoredInputs: ["header", "children", "footer"],
  },
  {
    id: "drawer", layer: "blocks", exportName: "Drawer", component: Drawer, source: "src/blocks/Drawer.tsx",
    regions: ["trigger", "header", "content", "footer"],
    dependencies: [
      { exportName: "Dialog", source: "src/components/Dialog.tsx" },
      { exportName: "Panel", source: "src/blocks/Panel.tsx" },
      { exportName: "Button", source: "src/components/Button.tsx" },
      { exportName: "Icon", source: "src/components/Icon.tsx" },
    ],
    configs: [
      { prop: "placement", values: ["start", "end", "bottom"], default: "start", source: "src/blocks/Drawer.tsx" },
      { prop: "wide", values: ["dismiss", "sheet"], default: "dismiss", source: "src/blocks/Drawer.tsx" },
    ],
    authoredInputs: ["trigger", "heading", "closeLabel", "children", "footer", "navigationKey", "dismissAt", "closeButtonStyle"],
  },
  {
    id: "resizable-pane", layer: "blocks", exportName: "ResizablePane", component: ResizablePane, source: "src/blocks/ResizablePane.tsx",
    regions: ["header", "content", "footer", "resize-handle"],
    dependencies: [
      { exportName: "Panel", source: "src/blocks/Panel.tsx" },
      { exportName: "ResizeHandle", source: "src/components/ResizeHandle.tsx" },
    ],
    configs: [{ prop: "orientation", values: ["vertical", "horizontal"], default: "vertical", source: "src/components/ResizeHandle.tsx" }],
    authoredInputs: ["min", "max", "defaultValue", "value", "step", "label", "handleLabel", "onChange", "children"],
  },
  {
    id: "command-menu", layer: "blocks", exportName: "CommandMenu", component: CommandMenu, source: "src/blocks/CommandMenu.tsx",
    regions: ["heading", "search", "content", "status"],
    dependencies: [
      { exportName: "Dialog", source: "src/components/Dialog.tsx" },
      { exportName: "SearchField", source: "src/components/SearchField.tsx" },
      { exportName: "Tooltip", source: "src/components/Tooltip.tsx" },
      { exportName: "IconButton", source: "src/components/IconButton.tsx" },
    ],
    configs: [],
    authoredInputs: ["heading", "searchLabel", "closeLabel", "emptyMessage", "groups", "isOpen", "onOpenChange", "query", "onQueryChange", "filter", "dir", "resultCountMessage"],
  },
  {
    id: "app-navigation", layer: "blocks", exportName: "AppNavigation", component: AppNavigation, source: "src/blocks/AppNavigation.tsx",
    regions: ["header", "content", "links", "footer"],
    dependencies: [
      { exportName: "Panel", source: "src/blocks/Panel.tsx" },
      { exportName: "Drawer", source: "src/blocks/Drawer.tsx" },
      { exportName: "Link", source: "src/components/Link.tsx" },
      { exportName: "Button", source: "src/components/Button.tsx" },
      { exportName: "Tooltip", source: "src/components/Tooltip.tsx" },
      { exportName: "Icon", source: "src/components/Icon.tsx" },
    ],
    configs: [{ prop: "collapsed", values: [false, true], default: false, source: "src/blocks/AppNavigation.tsx" }],
    authoredInputs: ["tree", "activeId", "activeHref", "label", "header", "footer", "trigger", "emptyMessage", "navigationKey", "defaultCollapsed", "onCollapsedChange", "drawerOpen", "onDrawerOpenChange", "dismissAt", "openLabel", "closeLabel", "expandLabel", "collapseLabel", "formatDisclosureLabel"],
  },
  {
    id: "page-bar", layer: "blocks", exportName: "PageBar", component: PageBar, source: "src/blocks/PageBar.tsx",
    regions: ["brand", "trail", "page-info", "actions"],
    dependencies: [
      { exportName: "Link", source: "src/components/Link.tsx" },
      { exportName: "Menu", source: "src/components/Menu.tsx" },
      { exportName: "Popover", source: "src/components/Popover.tsx" },
      { exportName: "Button", source: "src/components/Button.tsx" },
      { exportName: "Icon", source: "src/components/Icon.tsx" },
    ],
    configs: [{ prop: "narrow", values: [false, true], default: false, source: "src/blocks/PageBar.tsx" }],
    authoredInputs: ["root", "page", "workspaces", "brand", "header", "onNavigate", "labels", "reserveStart", "reserveEnd", "dir", "onHeightChange"],
  },
  {
    id: "account-menu", layer: "blocks", exportName: "AccountMenu", component: AccountMenu, source: "src/blocks/AccountMenu.tsx",
    regions: ["identity", "trigger", "content", "preferences"],
    dependencies: [
      { exportName: "Avatar", source: "src/components/Avatar.tsx" },
      { exportName: "Button", source: "src/components/Button.tsx" },
      { exportName: "Icon", source: "src/components/Icon.tsx" },
      { exportName: "Menu", source: "src/components/Menu.tsx" },
      { exportName: "Tooltip", source: "src/components/Tooltip.tsx" },
    ],
    configs: [{ prop: "collapsed", values: [false, true], default: false, source: "src/blocks/AccountMenu.tsx" }],
    authoredInputs: ["actor", "sections", "contextLabel", "triggerLabel", "collapsed", "onClose", "onRoute"],
  },
  {
    id: "grouped-table", layer: "blocks", exportName: "GroupedTable", component: GroupedTable, source: "src/blocks/GroupedTable.tsx",
    regions: ["caption", "headers", "content"],
    dependencies: [{ exportName: "Card", source: "src/components/Card.tsx" }],
    configs: [],
    authoredInputs: ["caption", "rowHeader", "groups", "rows", "rowKey", "emptyMessage"],
  },
  {
    id: "relation-graph", layer: "blocks", informationArchitecture: "navigation", exportName: "RelationGraph", component: RelationGraph, source: "src/blocks/RelationGraph.tsx",
    regions: ["content", "drawing", "list"],
    dependencies: [{ exportName: "Link", source: "src/components/Link.tsx" }, { exportName: "Button", source: "src/components/Button.tsx" }],
    configs: [],
    authoredInputs: ["nodes", "edges", "kinds", "label", "selectedId", "onSelectionChange", "emptyMessage", "unavailableMessage", "incomingLabel", "outgoingLabel", "refusedLabel"],
  },
  {
    id: "flow-canvas", layer: "blocks", exportName: "FlowCanvas", component: FlowCanvas, source: "src/blocks/FlowCanvas.tsx",
    regions: ["content", "viewport", "drawing", "edge-labels", "nodes"],
    dependencies: [{ exportName: "StatusMark", source: "src/components/StatusMark.tsx" }],
    configs: [{ prop: "orientation", values: ["horizontal", "vertical"], default: "horizontal", source: "src/blocks/flow-canvas-layout.ts" }],
    authoredInputs: ["nodes", "edges", "label", "emptyMessage", "outgoingLabel", "orientation", "selectedId", "onSelect"],
  },
] as const;
