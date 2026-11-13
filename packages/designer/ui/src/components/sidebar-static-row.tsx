// Studio static sidebar row: a stock shadcn item (components.item), a non-interactive row with no button, ref or press handler.
import { Item } from "@/components/ui/item"

/** A non-interactive row (the workspace or the signed-in user) in the sidebar's header or footer. */
function SidebarStaticRow(props: React.ComponentProps<typeof Item>) {
  return <Item size="sm" {...props} />
}

export { SidebarStaticRow }
