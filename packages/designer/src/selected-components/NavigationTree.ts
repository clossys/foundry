/** Selected component facade; original types remain the standalone API. */
export type * from "../components/NavigationTree.js";
import { selectedComponent } from "#designer-component-selection";
import { NavigationTree as StandaloneNavigationTree, NavigationTreeItem as StandaloneNavigationTreeItem, NavigationTreeItemContent as StandaloneNavigationTreeItemContent } from "../components/NavigationTree.js";
export const NavigationTree = selectedComponent("NavigationTree", StandaloneNavigationTree);
export const NavigationTreeItem = selectedComponent("NavigationTreeItem", StandaloneNavigationTreeItem);
export const NavigationTreeItemContent = selectedComponent("NavigationTreeItemContent", StandaloneNavigationTreeItemContent);
