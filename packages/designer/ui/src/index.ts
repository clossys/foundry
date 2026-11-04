/**
 * Foundry components layer.
 *
 * One module per slot under ./foundry re-exports the stock shadcn aria-nova
 * file for that slot. The CLI output in ./components/ui stays byte-identical;
 * Clossys styling arrives only through the shadcn CSS variables in index.css.
 *
 * FOUNDRY_COMPONENT_SLOTS is the slot contract. The registry below must hold
 * every slot (`satisfies Record<FoundryComponentSlot, ...>`), so removing a
 * slot module or forgetting to wire a new slot is a type and build error.
 */
import * as avatar from "./foundry/avatar"
import * as badge from "./foundry/badge"
import * as breadcrumb from "./foundry/breadcrumb"
import * as button from "./foundry/button"
import * as card from "./foundry/card"
import * as checkbox from "./foundry/checkbox"
import * as collapsible from "./foundry/collapsible"
import * as command from "./foundry/command"
import * as dialog from "./foundry/dialog"
import * as dropdownMenu from "./foundry/dropdown-menu"
import * as empty from "./foundry/empty"
import * as field from "./foundry/field"
import * as flowBaseHandle from "./foundry/flow-base-handle"
import * as flowBaseNode from "./foundry/flow-base-node"
import * as flowCanvas from "./foundry/flow-canvas"
import * as flowEdge from "./foundry/flow-edge"
import * as flowLabeledHandle from "./foundry/flow-labeled-handle"
import * as flowNodeStatus from "./foundry/flow-node-status"
import * as input from "./foundry/input"
import * as inputGroup from "./foundry/input-group"
import * as item from "./foundry/item"
import * as label from "./foundry/label"
import * as popover from "./foundry/popover"
import * as scrollArea from "./foundry/scroll-area"
import * as select from "./foundry/select"
import * as separator from "./foundry/separator"
import * as sheet from "./foundry/sheet"
import * as sidebar from "./foundry/sidebar"
import * as skeleton from "./foundry/skeleton"
import * as switchSlot from "./foundry/switch"
import * as table from "./foundry/table"
import * as tabs from "./foundry/tabs"
import * as textarea from "./foundry/textarea"
import * as tooltip from "./foundry/tooltip"
import * as useMobile from "./foundry/use-mobile"

export const FOUNDRY_COMPONENT_SLOTS = [
  "avatar",
  "badge",
  "breadcrumb",
  "button",
  "card",
  "checkbox",
  "collapsible",
  "command",
  "dialog",
  "dropdown-menu",
  "empty",
  "field",
  "flow-base-handle",
  "flow-base-node",
  "flow-canvas",
  "flow-edge",
  "flow-labeled-handle",
  "flow-node-status",
  "input",
  "input-group",
  "item",
  "label",
  "popover",
  "scroll-area",
  "select",
  "separator",
  "sheet",
  "sidebar",
  "skeleton",
  "switch",
  "table",
  "tabs",
  "textarea",
  "tooltip",
  "use-mobile",
] as const

export type FoundryComponentSlot = (typeof FOUNDRY_COMPONENT_SLOTS)[number]

/** Each slot's required exports. A slot module that loses one fails here. */
export const foundryComponents = {
  avatar: { Avatar: avatar.Avatar, AvatarImage: avatar.AvatarImage, AvatarFallback: avatar.AvatarFallback },
  badge: { Badge: badge.Badge },
  breadcrumb: { Breadcrumb: breadcrumb.Breadcrumb, BreadcrumbList: breadcrumb.BreadcrumbList, BreadcrumbItem: breadcrumb.BreadcrumbItem, BreadcrumbLink: breadcrumb.BreadcrumbLink, BreadcrumbPage: breadcrumb.BreadcrumbPage },
  button: { Button: button.Button, LinkButton: button.LinkButton },
  card: { Card: card.Card, CardHeader: card.CardHeader, CardTitle: card.CardTitle, CardDescription: card.CardDescription, CardContent: card.CardContent },
  checkbox: { Checkbox: checkbox.Checkbox },
  collapsible: { Collapsible: collapsible.Collapsible, CollapsibleTrigger: collapsible.CollapsibleTrigger, CollapsibleContent: collapsible.CollapsibleContent },
  command: { Command: command.Command, CommandDialog: command.CommandDialog, CommandInput: command.CommandInput, CommandList: command.CommandList, CommandItem: command.CommandItem },
  dialog: { Dialog: dialog.Dialog, DialogTrigger: dialog.DialogTrigger, DialogTitle: dialog.DialogTitle },
  "dropdown-menu": { DropdownMenu: dropdownMenu.DropdownMenu, DropdownMenuTrigger: dropdownMenu.DropdownMenuTrigger, DropdownMenuItem: dropdownMenu.DropdownMenuItem },
  empty: { Empty: empty.Empty, EmptyHeader: empty.EmptyHeader, EmptyMedia: empty.EmptyMedia, EmptyTitle: empty.EmptyTitle, EmptyDescription: empty.EmptyDescription },
  field: { Field: field.Field, FieldLabel: field.FieldLabel },
  "flow-base-handle": { BaseHandle: flowBaseHandle.BaseHandle },
  "flow-base-node": { BaseNode: flowBaseNode.BaseNode, BaseNodeHeader: flowBaseNode.BaseNodeHeader, BaseNodeHeaderTitle: flowBaseNode.BaseNodeHeaderTitle, BaseNodeContent: flowBaseNode.BaseNodeContent, BaseNodeFooter: flowBaseNode.BaseNodeFooter },
  "flow-canvas": { ReactFlow: flowCanvas.ReactFlow, Background: flowCanvas.Background, Controls: flowCanvas.Controls, Handle: flowCanvas.Handle, MarkerType: flowCanvas.MarkerType, MiniMap: flowCanvas.MiniMap, Panel: flowCanvas.Panel, Position: flowCanvas.Position, useReactFlow: flowCanvas.useReactFlow },
  "flow-edge": { BaseEdge: flowEdge.BaseEdge, SmoothStepEdge: flowEdge.SmoothStepEdge },
  "flow-labeled-handle": { LabeledHandle: flowLabeledHandle.LabeledHandle },
  "flow-node-status": { NodeStatusIndicator: flowNodeStatus.NodeStatusIndicator },
  input: { Input: input.Input },
  "input-group": { InputGroup: inputGroup.InputGroup, InputGroupAddon: inputGroup.InputGroupAddon },
  item: { Item: item.Item, ItemContent: item.ItemContent, ItemTitle: item.ItemTitle, ItemActions: item.ItemActions },
  label: { Label: label.Label },
  popover: { Popover: popover.Popover, PopoverTrigger: popover.PopoverTrigger },
  "scroll-area": { ScrollArea: scrollArea.ScrollArea },
  select: { Select: select.Select, SelectTrigger: select.SelectTrigger, SelectItem: select.SelectItem },
  separator: { Separator: separator.Separator },
  sheet: { Sheet: sheet.Sheet, SheetContent: sheet.SheetContent, SheetTitle: sheet.SheetTitle },
  sidebar: { Sidebar: sidebar.Sidebar, SidebarProvider: sidebar.SidebarProvider, SidebarInset: sidebar.SidebarInset, SidebarTrigger: sidebar.SidebarTrigger, SidebarMenuButton: sidebar.SidebarMenuButton },
  skeleton: { Skeleton: skeleton.Skeleton },
  switch: { Switch: switchSlot.Switch },
  table: { Table: table.Table, TableHeader: table.TableHeader, TableBody: table.TableBody, TableRow: table.TableRow, TableHead: table.TableHead, TableCell: table.TableCell },
  tabs: { Tabs: tabs.Tabs, TabsList: tabs.TabsList, TabsTrigger: tabs.TabsTrigger, TabsContent: tabs.TabsContent },
  textarea: { Textarea: textarea.Textarea },
  tooltip: { Tooltip: tooltip.Tooltip, TooltipTrigger: tooltip.TooltipTrigger },
  "use-mobile": { useIsMobile: useMobile.useIsMobile },
} as const satisfies Record<FoundryComponentSlot, Record<string, unknown>>

export * from "./foundry/avatar"
export * from "./foundry/badge"
export * from "./foundry/breadcrumb"
export * from "./foundry/button"
export * from "./foundry/card"
export * from "./foundry/checkbox"
export * from "./foundry/collapsible"
export * from "./foundry/command"
export * from "./foundry/dialog"
export * from "./foundry/dropdown-menu"
export * from "./foundry/empty"
export * from "./foundry/field"
export * from "./foundry/flow-base-handle"
export * from "./foundry/flow-base-node"
export * from "./foundry/flow-canvas"
export * from "./foundry/flow-edge"
export * from "./foundry/flow-labeled-handle"
export * from "./foundry/flow-node-status"
export * from "./foundry/input"
export * from "./foundry/input-group"
export * from "./foundry/item"
export * from "./foundry/label"
export * from "./foundry/popover"
export * from "./foundry/scroll-area"
export * from "./foundry/select"
export * from "./foundry/separator"
export * from "./foundry/sheet"
export * from "./foundry/sidebar"
export * from "./foundry/skeleton"
export * from "./foundry/switch"
export * from "./foundry/table"
export * from "./foundry/tabs"
export * from "./foundry/textarea"
export * from "./foundry/tooltip"
export * from "./foundry/use-mobile"

// Foundry layout primitives (not a shadcn slot): card grids and fixed-ratio specimen frames.
export * from "./foundry/layout"

export * from "./foundry/studio-home-stock"
export * from "./foundry/header-edge-toggle"
export * from "./foundry/sidebar-static"
export * from "./foundry/block-viewer-iframe"
export * from "./foundry/studio-frames"

// Explicit stock Radix picks for the frame's shared asChild tooltip/popover composition.
export { Button as RadixButton } from "./components/radix/button"
export { Popover as RadixPopover, PopoverTrigger as RadixPopoverTrigger, PopoverContent as RadixPopoverContent } from "./components/radix/popover"
export { Tooltip as RadixTooltip, TooltipProvider as RadixTooltipProvider, TooltipTrigger as RadixTooltipTrigger, TooltipContent as RadixTooltipContent } from "./components/radix/tooltip"
export { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "./components/radix/resizable"
