/** The navigation tree owns route matching and hierarchical keyboard navigation. */
import { NavigationTree as NavigationTreeRoot, NavigationTreeItem, NavigationTreeItemContent } from "react-aria-components";

/** The registered tree exposes its native collection parts on the same peer root. */
export const NavigationTree = Object.assign(NavigationTreeRoot, {
  Item: NavigationTreeItem,
  ItemContent: NavigationTreeItemContent,
});

export {
  NavigationTreeItem,
  NavigationTreeItemContent,
  NavigationTreeSection,
  NavigationTreeHeader,
} from "react-aria-components";
export type {
  NavigationTreeProps,
  NavigationTreeItemProps,
  NavigationTreeItemContentProps,
  NavigationTreeSectionProps,
  NavigationTreeHeaderProps,
} from "react-aria-components";
