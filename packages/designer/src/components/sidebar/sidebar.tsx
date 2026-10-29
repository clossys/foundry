"use client"

import { Icon as LibraryIcon } from "../icon/index.js"
import * as React from "react"
import { cn, classNames, type ClassValue, type VariantProps, resolveRailCopy, RAIL_COPY_REFS, type CopyResolver } from "../_parts/rail-utils/index.js"
import {
  Button as ButtonPrimitive,
  Link as LinkPrimitive,
  type ButtonProps,
  type LinkProps,
} from "react-aria-components"

import { useIsMobile } from "../_parts/rail-use-mobile/index.js"
import { Button } from "../_parts/rail-button/index.js"
import { Input } from "../_parts/rail-input/index.js"
import { Separator } from "../_parts/rail-separator/index.js"
import {
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../sheet/index.js"
import { Skeleton } from "../_parts/rail-skeleton/index.js"
import { Tooltip, TooltipTrigger } from "../_parts/rail-tooltip/index.js"
const SIDEBAR_COOKIE_NAME = "sidebar_state"
const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7
const SIDEBAR_KEYBOARD_SHORTCUT = "b"

type SidebarContextProps = {
  state: "expanded" | "collapsed"
  open: boolean
  setOpen: (open: boolean) => void
  openMobile: boolean
  setOpenMobile: (open: boolean) => void
  isMobile: boolean
  toggleSidebar: () => void
}

type SidebarButtonProps =
  | (LinkProps & { href: string })
  | (ButtonProps & { href?: never })

const SidebarContext = React.createContext<SidebarContextProps | null>(null)

function useSidebar() {
  const context = React.useContext(SidebarContext)
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider.")
  }

  return context
}

function SidebarProvider({
  /** @default true */
  defaultOpen = true,
  open: openProp,
  onOpenChange: setOpenProp,
  className,
  style,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const isMobile = useIsMobile()
  const [openMobile, setOpenMobile] = React.useState(false)

  // This is the internal state of the sidebar.
  // We use openProp and setOpenProp for control from outside the component.
  const [_open, _setOpen] = React.useState(defaultOpen)
  const open = openProp ?? _open
  const setOpen = React.useCallback(
    (value: boolean | ((value: boolean) => boolean)) => {
      const openState = typeof value === "function" ? value(open) : value
      if (setOpenProp) {
        setOpenProp(openState)
      } else {
        _setOpen(openState)
      }

      // This sets the cookie to keep the sidebar state.
      document.cookie = `${SIDEBAR_COOKIE_NAME}=${openState}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}`
    },
    [setOpenProp, open]
  )

  // Helper to toggle the sidebar.
  const toggleSidebar = React.useCallback(() => {
    return isMobile ? setOpenMobile((open) => !open) : setOpen((open) => !open)
  }, [isMobile, setOpen, setOpenMobile])

  // Adds a keyboard shortcut to toggle the sidebar.
  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === SIDEBAR_KEYBOARD_SHORTCUT &&
        (event.metaKey || event.ctrlKey)
      ) {
        event.preventDefault()
        toggleSidebar()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [toggleSidebar])

  // We add a state so that we can do data-state="expanded" or "collapsed".
  // This makes it easier to style the sidebar with Tailwind classes.
  const state = open ? "expanded" : "collapsed"

  const contextValue = React.useMemo<SidebarContextProps>(
    () => ({
      state,
      open,
      setOpen,
      isMobile,
      openMobile,
      setOpenMobile,
      toggleSidebar,
    }),
    [state, open, setOpen, isMobile, openMobile, setOpenMobile, toggleSidebar]
  )

  return (
    <SidebarContext.Provider value={contextValue}>
      <div
        data-slot="sidebar-wrapper"
        style={
          {
            ...style,
          } as React.CSSProperties
        }
        className={cn(
          "group/sidebar-wrapper flex min-h-svh w-full has-data-[variant=inset]:bg-(--color-surface-base)",
          className
        )}
        {...props}
      >
        {children}
      </div>
    </SidebarContext.Provider>
  )
}

function Sidebar({
  copyResolver,
  /** @default "left" */
  side = "left",
  /** @default "sidebar" */
  variant = "sidebar",
  /** @default "offcanvas" */
  collapsible = "offcanvas",
  className,
  children,
  dir,
  ...props
}: (React.ComponentProps<"div"> & {
  side?: "left" | "right"
  variant?: "sidebar" | "floating" | "inset"
  collapsible?: "offcanvas" | "icon" | "none"
}) & { copyResolver?: CopyResolver }) {
  const { isMobile, state, openMobile, setOpenMobile } = useSidebar()

  if (collapsible === "none") {
    return (
      <div
        data-slot="sidebar"
        className={cn(
          "flex h-full w-(--ui-layout-sidebar-w) flex-col bg-(--color-surface-base) text-(--color-ink-primary)",
          className
        )}
        {...props}
      >
        {children}
      </div>
    )
  }

  if (isMobile) {
    return (
      <Sheet
        copyResolver={copyResolver}
        isOpen={openMobile}
        onOpenChange={setOpenMobile}
        dir={dir}
        data-sidebar="sidebar"
        data-slot="sidebar"
        data-mobile="true"
        className="w-(--ui-layout-sidebar-w) bg-(--color-surface-base) p-0 text-(--color-ink-primary) [&>button]:hidden"
        style={
          {
          } as React.CSSProperties
        }
        side={side}
        {...props}
      >
        <SheetHeader className="sr-only">
          <SheetTitle>{resolveRailCopy(copyResolver, RAIL_COPY_REFS["sidebar.title"])}</SheetTitle>
          <SheetDescription>{resolveRailCopy(copyResolver, RAIL_COPY_REFS["sidebar.description"])}</SheetDescription>
        </SheetHeader>
        <div className="flex h-full w-full flex-col">{children}</div>
      </Sheet>
    )
  }

  return (
    <div
      className="hidden text-(--color-ink-primary) md:block"
      data-state={state}
      data-collapsible={state === "collapsed" ? collapsible : ""}
      data-variant={variant}
      data-side={side}
      data-slot="sidebar"
    >
      {/* This is what handles the sidebar gap on desktop */}
      <div
        data-slot="sidebar-gap"
        className={cn(
          "motion-safe:transition-[width] motion-reduce:transition-none motion-reduce:animate-none motion-reduce:duration-0 motion-safe:duration-(--ui-duration-default) ease-(--ease-default) relative w-(--ui-layout-sidebar-w) bg-transparent",
          "[[data-slot=sidebar][data-collapsible=offcanvas]_&]:w-0",
          "[[data-slot=sidebar][data-side=right]_&]:rotate-180",
          variant === "floating" || variant === "inset"
            ? "[[data-slot=sidebar][data-collapsible=icon]_&]:w-[calc(var(--ui-layout-sidebar-rail-w)+(var(--spacing-lg)))]"
            : "[[data-slot=sidebar][data-collapsible=icon]_&]:w-(--ui-layout-sidebar-rail-w)"
        )}
      />
      <div
        data-slot="sidebar-container"
        data-side={side}
        className={cn(
          "fixed inset-y-0 z-(--ui-z-sticky) hidden h-svh w-(--ui-layout-sidebar-w) motion-safe:transition-[inset-inline-start,inset-inline-end,width] motion-reduce:transition-none motion-reduce:animate-none motion-reduce:duration-0 motion-safe:duration-(--ui-duration-default) ease-(--ease-default) data-[side=left]:start-0 data-[side=left]:[[data-slot=sidebar][data-collapsible=offcanvas]_&]:start-[calc(var(--ui-layout-sidebar-w)*-1)] data-[side=right]:end-0 data-[side=right]:[[data-slot=sidebar][data-collapsible=offcanvas]_&]:end-[calc(var(--ui-layout-sidebar-w)*-1)] md:flex",
          // Adjust the padding for floating and inset variants.
          variant === "floating" || variant === "inset"
            ? "p-(--spacing-sm) [[data-slot=sidebar][data-collapsible=icon]_&]:w-[calc(var(--ui-layout-sidebar-rail-w)+(var(--spacing-lg))+var(--ui-border-rule))]"
            : "[[data-slot=sidebar][data-collapsible=icon]_&]:w-(--ui-layout-sidebar-rail-w) [[data-slot=sidebar][data-side=left]_&]:border-e-(length:--ui-border-hairline) [[data-slot=sidebar][data-side=right]_&]:border-s-(length:--ui-border-hairline)",
          className
        )}
        {...props}
      >
        <div
          data-sidebar="sidebar"
          data-slot="sidebar-inner"
          className="bg-(--color-surface-base) [[data-slot=sidebar][data-variant=floating]_&]:ring-(--color-line-base) [[data-slot=sidebar][data-variant=floating]_&]:rounded-(--radius-control) [[data-slot=sidebar][data-variant=floating]_&]:shadow-(--ui-elevation-raised) [[data-slot=sidebar][data-variant=floating]_&]:ring-(length:--ui-border-hairline) flex size-full flex-col"
        >
          {children}
        </div>
      </div>
    </div>
  )
}

function SidebarTrigger({
  copyResolver,
  className,
  onPress,
  ...props
}: (React.ComponentProps<typeof Button>) & { copyResolver?: CopyResolver }) {
  const { toggleSidebar } = useSidebar()

  return (
    <Button
      data-sidebar="trigger"
      data-slot="sidebar-trigger"
      variant="ghost"
      size="icon-sm"
      className={cn("", className)}
      onPress={(event) => {
        onPress?.(event)
        toggleSidebar()
      }}
      {...props}
    >
      <LibraryIcon asset="assets.icon-panel-left" mirrorInRtl decorative className=""  />
      <span className="sr-only">{resolveRailCopy(copyResolver, RAIL_COPY_REFS["sidebar.toggle"])}</span>
    </Button>
  )
}

function SidebarRail({
  copyResolver, className, ...props }: (React.ComponentProps<"button">) & { copyResolver?: CopyResolver }) {
  const { toggleSidebar } = useSidebar()

  return (
    <button
      data-sidebar="rail"
      data-slot="sidebar-rail"
      aria-label={resolveRailCopy(copyResolver, RAIL_COPY_REFS["sidebar.toggle"])}
      tabIndex={-1}
      onClick={toggleSidebar}
      title={resolveRailCopy(copyResolver, RAIL_COPY_REFS["sidebar.toggle"])}
      className={cn(
        "hover:after:bg-(--color-line-base) absolute inset-y-0 z-(--ui-z-aside) hidden w-(--spacing-lg) motion-safe:transition-all motion-reduce:transition-none motion-reduce:animate-none motion-reduce:duration-0 motion-safe:duration-(--ui-duration-default) ease-(--ease-default) [[data-slot=sidebar][data-side=left]_&]:-end-(--spacing-lg) [[data-slot=sidebar][data-side=right]_&]:start-0 after:absolute after:inset-y-0 after:start-1/2 after:w-(--ui-border-rule) sm:flex ltr:-translate-x-1/2 rtl:translate-x-1/2",
        "in-data-[side=left]:cursor-w-resize in-data-[side=right]:cursor-e-resize",
        "[[data-side=left][data-state=collapsed]_&]:cursor-e-resize [[data-side=right][data-state=collapsed]_&]:cursor-w-resize",
        "[[data-slot=sidebar][data-collapsible=offcanvas]_&]:translate-x-0 after:[[data-slot=sidebar][data-collapsible=offcanvas]_&]:start-full hover:[[data-slot=sidebar][data-collapsible=offcanvas]_&]:bg-(--color-surface-base)",
        "[[data-side=left][data-collapsible=offcanvas]_&]:-end-2",
        "[[data-side=right][data-collapsible=offcanvas]_&]:-start-2",
        className
      )}
      {...props}
    />
  )
}

function SidebarInset({ className, ...props }: React.ComponentProps<"main">) {
  return (
    <main
      data-slot="sidebar-inset"
      className={cn(
        "bg-(--color-surface-base) md:[[data-slot=sidebar][data-variant=inset]~&]:m-(--spacing-sm) md:[[data-slot=sidebar][data-variant=inset]~&]:ms-0 md:[[data-slot=sidebar][data-variant=inset]~&]:rounded-(--radius-control) md:[[data-slot=sidebar][data-variant=inset]~&]:shadow-(--ui-elevation-raised) md:[[data-slot=sidebar][data-variant=inset][data-state=collapsed]~&]:ms-(--spacing-sm) relative flex w-full flex-1 flex-col",
        className
      )}
      {...props}
    />
  )
}

function SidebarInput({
  className,
  ...props
}: React.ComponentProps<typeof Input>) {
  return (
    <Input
      data-slot="sidebar-input"
      data-sidebar="input"
      className={cn("bg-(--color-surface-base) h-(--spacing-2xl) w-full shadow-(--ui-elevation-none)", className)}
      {...props}
    />
  )
}

function SidebarHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-header"
      data-sidebar="header"
      className={cn("gap-(--spacing-sm) p-(--spacing-sm) flex flex-col", className)}
      {...props}
    />
  )
}

function SidebarFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-footer"
      data-sidebar="footer"
      className={cn("gap-(--spacing-sm) p-(--spacing-sm) flex flex-col", className)}
      {...props}
    />
  )
}

function SidebarSeparator({
  className,
  ...props
}: React.ComponentProps<typeof Separator>) {
  return (
    <Separator
      data-slot="sidebar-separator"
      data-sidebar="separator"
      className={cn("bg-(--color-line-base) mx-(--spacing-sm) w-auto", className)}
      {...props}
    />
  )
}

function SidebarContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-content"
      data-sidebar="content"
      className={cn(
        "no-scrollbar gap-0 flex min-h-0 flex-1 flex-col overflow-auto [[data-slot=sidebar][data-collapsible=icon]_&]:overflow-hidden",
        className
      )}
      {...props}
    />
  )
}

function SidebarGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-group"
      data-sidebar=""
      className={cn(
        "p-(--spacing-sm) relative flex w-full min-w-0 flex-col",
        className
      )}
      {...props}
    />
  )
}

function SidebarGroupLabel({
  className,
  /** @default "div" */
  elementType: Element = "div",
  ...props
}: React.HTMLAttributes<HTMLElement> & { elementType?: React.ElementType }) {
  return (
    <Element
      data-slot="sidebar-group-label"
      data-sidebar="group-label"
      className={cn(
        "text-(--color-ink-primary)/70 ring-(--color-focus-ring) h-(--spacing-2xl) rounded-(--radius-control) px-(--spacing-sm) text-(length:--text-xs) font-(weight:--font-weight-medium) motion-safe:transition-[margin,opacity] motion-reduce:transition-none motion-reduce:animate-none motion-reduce:duration-0 motion-safe:duration-(--ui-duration-default) ease-(--ease-default) [[data-slot=sidebar][data-collapsible=icon]_&]:-mt-(--spacing-2xl) [[data-slot=sidebar][data-collapsible=icon]_&]:opacity-0 focus-visible:ring-(length:--ui-border-rule) [&>svg]:size-(--spacing-lg) flex shrink-0 items-center focus-visible:outline-solid focus-visible:outline-(length:--ui-border-focus) focus-visible:outline-offset-(--ui-focus-offset) focus-visible:outline-(--color-focus-ring) [&>svg]:shrink-0",
        className
      )}
      {...props}
    />
  )
}

function SidebarGroupAction({
  className,
  ...props
}: React.ComponentProps<"button">) {
  return (
    <button
      data-slot="sidebar-group-action"
      data-sidebar="group-action"
      className={cn(
        "text-(--color-ink-primary) ring-(--color-focus-ring) hover:bg-(--color-surface-selected) hover:text-(--color-ink-primary) absolute top-(--spacing-lg) end-(--spacing-md) w-(--spacing-xl) rounded-(--radius-control) p-0 focus-visible:ring-(length:--ui-border-rule) [&>svg]:size-(--spacing-lg) flex aspect-square items-center justify-center focus-visible:outline-solid focus-visible:outline-(length:--ui-border-focus) focus-visible:outline-offset-(--ui-focus-offset) focus-visible:outline-(--color-focus-ring) motion-safe:transition-transform motion-reduce:transition-none motion-reduce:animate-none motion-reduce:duration-0 motion-safe:duration-(--ui-duration-default) ease-(--ease-default) [[data-slot=sidebar][data-collapsible=icon]_&]:hidden after:absolute after:-inset-(--spacing-sm) md:after:hidden [&>svg]:shrink-0",
        className
      )}
      {...props}
    />
  )
}

function SidebarGroupContent({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-group-content"
      data-sidebar="group-content"
      className={cn("text-(length:--text-sm) w-full", className)}
      {...props}
    />
  )
}

function SidebarMenu({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-menu"
      data-sidebar="menu"
      className={cn("gap-0 flex w-full min-w-0 flex-col", className)}
      {...props}
    />
  )
}

function SidebarMenuItem({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-menu-item"
      data-sidebar="menu-item"
      className={cn("group/menu-item relative", className)}
      {...props}
    />
  )
}

const sidebarMenuButtonVariants_DEFINITION = {"base":"ring-(--color-focus-ring) hover:bg-(--color-surface-selected) hover:text-(--color-ink-primary) active:bg-(--color-surface-selected) active:text-(--color-ink-primary) data-active:bg-(--color-surface-selected) data-active:text-(--color-ink-primary) data-open:hover:bg-(--color-surface-selected) data-open:hover:text-(--color-ink-primary) gap-(--spacing-sm) rounded-(--radius-control) p-(--spacing-sm) text-start text-(length:--text-sm) motion-safe:transition-[width,height,padding] motion-reduce:transition-none motion-reduce:animate-none motion-reduce:duration-0 motion-safe:duration-(--ui-duration-default) ease-(--ease-default) group-has-data-[sidebar=menu-action]/menu-item:pe-(--spacing-2xl) [[data-slot=sidebar][data-collapsible=icon]_&]:size-(--spacing-2xl)! [[data-slot=sidebar][data-collapsible=icon]_&]:p-(--spacing-sm)! focus-visible:ring-(length:--ui-border-rule) data-active:font-(weight:--font-weight-medium) aria-expanded:hover:bg-(--color-surface-selected) aria-expanded:hover:text-(--color-ink-primary) peer/menu-button group/menu-button flex w-full items-center overflow-hidden focus-visible:outline-solid focus-visible:outline-(length:--ui-border-focus) focus-visible:outline-offset-(--ui-focus-offset) focus-visible:outline-(--color-focus-ring) disabled:pointer-events-none disabled:opacity-(--ui-alpha-disabled) aria-disabled:pointer-events-none aria-disabled:opacity-(--ui-alpha-disabled) [&_svg]:size-(--spacing-lg) [&_svg]:shrink-0 [&>span:last-child]:truncate","variants":{"variant":{"default":"hover:bg-(--color-surface-selected) hover:text-(--color-ink-primary)","outline":"bg-(--color-surface-base) hover:bg-(--color-surface-selected) hover:text-(--color-ink-primary) shadow-[0_0_0_1px_var(--color-line-base)] hover:shadow-[0_0_0_1px_var(--color-surface-selected)]"},"size":{"default":"h-(--spacing-2xl) text-(length:--text-sm)","sm":"h-(--spacing-xl) text-(length:--text-xs)","lg":"h-(--spacing-3xl) text-(length:--text-sm) [[data-slot=sidebar][data-collapsible=icon]_&]:p-0!"}},"defaultVariants":{"variant":"default","size":"default"}}
function sidebarMenuButtonVariants(props: { "variant"?: "default" | "outline" | null; "size"?: "default" | "sm" | "lg" | null; class?: ClassValue; className?: ClassValue } = {}) {
  props ??= {}
  const definition = sidebarMenuButtonVariants_DEFINITION
  const key = (value: unknown) => typeof value === "boolean" ? String(value) : value === 0 ? "0" : value
  const supplied = Object.fromEntries(Object.entries(props).filter(([, value]) => value !== undefined))
  const values: { [axis: string]: unknown } = { ...definition.defaultVariants, ...supplied }
  const selected = Object.entries(definition.variants).map(([axis, choices]) => {
    if ((props as { [axis: string]: unknown })[axis] === null) return null
    const value = key((props as { [axis: string]: unknown })[axis]) || key((definition.defaultVariants as { [axis: string]: unknown })[axis])
    return (choices as { [value: string]: ClassValue })[String(value)]
  })
  const compound = (([]) as { [key: string]: unknown }[]).flatMap(({ class: value, className, ...conditions }) =>
    Object.entries(conditions).every(([axis, expected]) => Array.isArray(expected) ? expected.includes(values[axis]) : values[axis] === expected)
      ? [value as ClassValue, className as ClassValue] : [])
  return classNames(definition.base, selected, compound, props.class, props.className)
}

function SidebarMenuButton({
  /** @default false */
  isActive = false,
  /** @default "default" */
  variant = "default",
  /** @default "default" */
  size = "default",
  tooltip,
  className,
  ...props
}: SidebarButtonProps & {
  isActive?: boolean
  tooltip?: string | React.ComponentProps<typeof Tooltip>
} & VariantProps<typeof sidebarMenuButtonVariants>) {
  const { isMobile, state } = useSidebar()
  const comp =
    props.href !== undefined ? (
      <LinkPrimitive
        data-slot="sidebar-menu-button"
        data-sidebar="menu-button"
        data-size={size}
        data-active={isActive}
        className={cn(sidebarMenuButtonVariants({ variant, size }), className)}
        {...props}
      />
    ) : (
      <ButtonPrimitive
        data-slot="sidebar-menu-button"
        data-sidebar="menu-button"
        data-size={size}
        data-active={isActive}
        className={cn(sidebarMenuButtonVariants({ variant, size }), className)}
        {...props}
      />
    )

  if (!tooltip) {
    return comp
  }

  if (typeof tooltip === "string") {
    tooltip = {
      children: tooltip,
    }
  }

  return (
    <TooltipTrigger isDisabled={state !== "collapsed" || isMobile}>
      {comp}
      <Tooltip placement="right" {...tooltip} />
    </TooltipTrigger>
  )
}

function SidebarMenuAction({
  className,
  /** @default false */
  showOnHover = false,
  ...props
}: ButtonProps & {
  showOnHover?: boolean
}) {
  return (
    <ButtonPrimitive
      data-slot="sidebar-menu-action"
      data-sidebar="menu-action"
      className={cn(
        "text-(--color-ink-primary) ring-(--color-focus-ring) hover:bg-(--color-surface-selected) hover:text-(--color-ink-primary) peer-hover/menu-button:text-(--color-ink-primary) absolute top-(--spacing-sm) end-(--spacing-xs) aspect-square w-(--spacing-xl) rounded-(--radius-control) p-0 peer-data-[size=default]/menu-button:top-(--spacing-sm) peer-data-[size=lg]/menu-button:top-(--spacing-md) peer-data-[size=sm]/menu-button:top-(--spacing-xs) focus-visible:ring-(length:--ui-border-rule) [&>svg]:size-(--spacing-lg) flex items-center justify-center focus-visible:outline-solid focus-visible:outline-(length:--ui-border-focus) focus-visible:outline-offset-(--ui-focus-offset) focus-visible:outline-(--color-focus-ring) motion-safe:transition-transform motion-reduce:transition-none motion-reduce:animate-none motion-reduce:duration-0 motion-safe:duration-(--ui-duration-default) ease-(--ease-default) [[data-slot=sidebar][data-collapsible=icon]_&]:hidden after:absolute after:-inset-(--spacing-sm) md:after:hidden [&>svg]:shrink-0",
        showOnHover &&
          "group-focus-within/menu-item:opacity-100 group-hover/menu-item:opacity-100 peer-data-active/menu-button:text-(--color-ink-primary) aria-expanded:opacity-100 md:opacity-0",
        className
      )}
      {...props}
    />
  )
}

function SidebarMenuBadge({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-menu-badge"
      data-sidebar="menu-badge"
      className={cn(
        "text-(--color-ink-primary) peer-hover/menu-button:text-(--color-ink-primary) peer-data-active/menu-button:text-(--color-ink-primary) pointer-events-none absolute end-(--spacing-xs) flex h-(--spacing-xl) min-w-(--spacing-xl) rounded-(--radius-control) px-(--spacing-xs) text-(length:--text-xs) font-(weight:--font-weight-medium) peer-data-[size=default]/menu-button:top-(--spacing-sm) peer-data-[size=lg]/menu-button:top-(--spacing-md) peer-data-[size=sm]/menu-button:top-(--spacing-xs) items-center justify-center tabular-nums select-none [[data-slot=sidebar][data-collapsible=icon]_&]:hidden",
        className
      )}
      {...props}
    />
  )
}

function SidebarMenuSkeleton({
  className,
  /** @default false */
  showIcon = false,
  ...props
}: React.ComponentProps<"div"> & {
  showIcon?: boolean
}) {

  return (
    <div
      data-slot="sidebar-menu-skeleton"
      data-sidebar="menu-skeleton"
      className={cn("h-(--spacing-2xl) gap-(--spacing-sm) rounded-(--radius-control) px-(--spacing-sm) flex items-center", className)}
      {...props}
    >
      {showIcon && (
        <Skeleton
          className="size-(--spacing-lg) rounded-(--radius-control)"
          data-sidebar="menu-skeleton-icon"
        />
      )}
      <Skeleton
        className="h-(--spacing-lg) max-w-(--ui-width-notice-max) flex-1"
        data-sidebar="menu-skeleton-text"
        style={
          {
            maxWidth: "var(--ui-width-notice-max)",
          } as React.CSSProperties
        }
      />
    </div>
  )
}

function SidebarMenuSub({ className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul
      data-slot="sidebar-menu-sub"
      data-sidebar="menu-sub"
      className={cn("border-(--color-line-base) mx-(--spacing-lg) translate-x-(--ui-border-hairline) gap-(--spacing-xs) border-s-(length:--ui-border-hairline) px-(--spacing-md) py-(--spacing-xs) [[data-slot=sidebar][data-collapsible=icon]_&]:hidden flex min-w-0 flex-col", className)}
      {...props}
    />
  )
}

function SidebarMenuSubItem({
  className,
  ...props
}: React.ComponentProps<"li">) {
  return (
    <li
      data-slot="sidebar-menu-sub-item"
      data-sidebar="menu-sub-item"
      className={cn("group/menu-sub-item relative", className)}
      {...props}
    />
  )
}

function SidebarMenuSubButton({
  /** @default "md" */
  size = "md",
  /** @default false */
  isActive = false,
  className,
  ...props
}: SidebarButtonProps & {
  size?: "sm" | "md"
  isActive?: boolean
}) {
  return props.href !== undefined ? (
    <LinkPrimitive
      data-slot="sidebar-menu-sub-button"
      data-sidebar="menu-sub-button"
      data-size={size}
      data-active={isActive}
      className={cn(
        "text-(--color-ink-primary) ring-(--color-focus-ring) hover:bg-(--color-surface-selected) hover:text-(--color-ink-primary) active:bg-(--color-surface-selected) active:text-(--color-ink-primary) [&>svg]:text-(--color-ink-primary) data-active:bg-(--color-surface-selected) data-active:text-(--color-ink-primary) h-(--spacing-xl) gap-(--spacing-sm) rounded-(--radius-control) px-(--spacing-sm) focus-visible:ring-(length:--ui-border-rule) data-[size=md]:text-(length:--text-sm) data-[size=sm]:text-(length:--text-xs) [&>svg]:size-(--spacing-lg) flex min-w-0 -translate-x-(--ui-border-hairline) items-center overflow-hidden focus-visible:outline-solid focus-visible:outline-(length:--ui-border-focus) focus-visible:outline-offset-(--ui-focus-offset) focus-visible:outline-(--color-focus-ring) [[data-slot=sidebar][data-collapsible=icon]_&]:hidden disabled:pointer-events-none disabled:opacity-(--ui-alpha-disabled) aria-disabled:pointer-events-none aria-disabled:opacity-(--ui-alpha-disabled) [&>span:last-child]:truncate [&>svg]:shrink-0",
        className
      )}
      {...props}
    />
  ) : (
    <ButtonPrimitive
      data-slot="sidebar-menu-sub-button"
      data-sidebar="menu-sub-button"
      data-size={size}
      data-active={isActive}
      className={cn(
        "text-(--color-ink-primary) ring-(--color-focus-ring) hover:bg-(--color-surface-selected) hover:text-(--color-ink-primary) active:bg-(--color-surface-selected) active:text-(--color-ink-primary) [&>svg]:text-(--color-ink-primary) data-active:bg-(--color-surface-selected) data-active:text-(--color-ink-primary) h-(--spacing-xl) gap-(--spacing-sm) rounded-(--radius-control) px-(--spacing-sm) focus-visible:ring-(length:--ui-border-rule) data-[size=md]:text-(length:--text-sm) data-[size=sm]:text-(length:--text-xs) [&>svg]:size-(--spacing-lg) flex min-w-0 -translate-x-(--ui-border-hairline) items-center overflow-hidden focus-visible:outline-solid focus-visible:outline-(length:--ui-border-focus) focus-visible:outline-offset-(--ui-focus-offset) focus-visible:outline-(--color-focus-ring) [[data-slot=sidebar][data-collapsible=icon]_&]:hidden disabled:pointer-events-none disabled:opacity-(--ui-alpha-disabled) aria-disabled:pointer-events-none aria-disabled:opacity-(--ui-alpha-disabled) [&>span:last-child]:truncate [&>svg]:shrink-0",
        className
      )}
      {...props}
    />
  )
}

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
}
