import type { ReactNode } from "react"
import { Separator } from "./separator"

/** Sidebar-15 header trigger/separator pair, mirrored by order only.
 * The header's stock gap-2 supplies identical spacing on both edges.
 */
export function HeaderEdgeToggle({ children, separatorFirst = false }: {
  children: ReactNode
  separatorFirst?: boolean
}) {
  const separator = <Separator
    orientation="vertical"
    className="aria-[orientation=vertical]:h-4 aria-[orientation=vertical]:self-auto"
  />
  return <>{separatorFirst && separator}{children}{!separatorFirst && separator}</>
}
