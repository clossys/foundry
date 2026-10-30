import { Slot, layoutState, slotNodes } from "./preview/structure.js";
import type { LayoutProps } from "./preview/structure.js";
export interface SidebarContentProps extends LayoutProps { readonly asideSections?: readonly string[] }
/** The Stage supplies DOM order; the rail adds no landmark or width observer. */
export function SidebarContent(props: SidebarContentProps) {
  const { members } = layoutState("layouts.sidebar-content", props);
  const aside = props.asideSections ?? [];
  if (!Array.isArray(aside)) throw new Error("Invalid aside sections");
  if (members.sticky === "aside" && (aside.length !== (props.slots.aside?.length ?? 0) || aside.some(id => id !== "sections.table-of-contents" && id !== "sections.link-index"))) throw new Error("Sticky aside requires navigation sections");
  const ids = props.stage.slotOrder.filter(id => id === "main" || id === "aside");
  return <div data-layout="layouts.sidebar-content" className="grid gap-lg">
    <Slot id="lead">{slotNodes(props, "lead")}</Slot>
    <div data-layout-columns="" className="flex flex-col gap-lg" data-aside-width={members["aside-width"]} data-sticky={members.sticky}>
      {ids.map(id => props.slots[id]?.length ? <div data-layout-slot={id} key={id} className="grid gap-lg">{slotNodes(props, id)}</div> : null)}
    </div>
  </div>;
}
