/**
 * frames.app-sidebar runtime renderer: the real AppNavigation from JSON `tree` and
 * `header` content and the selected presentation member (docked, collapsed or the overlay
 * drawer). Navigation is guarded by the host port; account and theme stay unmapped and are
 * refused, never dropped (AppFrame composes them into its own navigation footer).
 */
import { useState, type ReactNode } from "react";
import { AppNavigation, type AppNavigationProps } from "../../blocks/AppNavigation.js";
import { Button } from "../../selected-components/Button.js";
import { Link } from "../../selected-components/Link.js";
import type { RuntimeRenderInput } from "../../catalog-core/runtime-ports.js";
import { runtimeMember, runtimeValue, type SurfaceRendererEntry } from "../contract.js";
import { plainJson } from "../sections/dataset-json.js";
import { frameContent, guardedNavigate, type FrameInput, type FrameJson } from "./frame-content.js";

const read = frameContent("frames.app-sidebar");
type Presentation = "docked" | "collapsed" | "overlay";

export function appSidebarProps(input: Pick<FrameInput, "content" | "selection" | "host">): AppNavigationProps & { presentation: Presentation } {
  read.only(input, ["tree", "header"]);
  const host = input.host, tree = read.record(runtimeValue(input, "tree")) ?? read.fail("tree content is required");
  const nodes = read.navigationTree(read.records(tree.items), host, "tree.items");
  if (!nodes.length) read.fail("tree.items must list at least one destination");
  const header = read.record(runtimeValue(input, "header"));
  let headerNode: ReactNode;
  if (header) {
    const label = read.required(header.label, "header.label"), target = read.destination(header, host, "header");
    headerNode = "href" in target ? <Link href={target.href} buttonVariant="secondary">{label}</Link> : <Button variant="secondary" onPress={target.onAction}>{label}</Button>;
  }
  const presentation = runtimeMember<Presentation>(input, "presentation", "docked");
  return {
    tree: nodes, presentation,
    ...(read.text(tree.label) ? { label: read.text(tree.label) } : {}), ...(read.text(tree.activeId) ? { activeId: read.text(tree.activeId) } : {}),
    ...(read.text(tree.emptyMessage) ? { emptyMessage: read.text(tree.emptyMessage) } : {}),
    ...(headerNode ? { header: headerNode } : {}),
    ...(presentation === "collapsed" ? { defaultCollapsed: true } : {}),
    onNavigate: guardedNavigate(host),
  };
}

/** The overlay presentation opens the navigation drawer; the person can still close it. */
function RuntimeAppSidebar({ presentation, ...props }: AppNavigationProps & { presentation: Presentation }) {
  const [drawerOpen, setDrawerOpen] = useState(presentation === "overlay");
  return <AppNavigation {...props} {...(presentation === "overlay" ? { drawerOpen, onDrawerOpenChange: setDrawerOpen } : {})} />;
}

export function renderAppSidebar(input: RuntimeRenderInput<ReactNode>): ReactNode {
  return <RuntimeAppSidebar {...appSidebarProps(input)} />;
}

function sample(dataset: Parameters<SurfaceRendererEntry["sample"]>[0]): FrameJson {
  return {
    tree: { label: dataset.frames.appSidebar.label, activeId: dataset.frames.appSidebar.activeId, items: plainJson(dataset.frames.appSidebar.tree) },
    header: dataset.frames.appSidebarHeader,
  };
}

export const appSidebarRenderer: SurfaceRendererEntry = { leaf: "frames.app-sidebar", render: renderAppSidebar, sample };
