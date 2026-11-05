"use client"

import { Icon as LibraryIcon } from "../icon/index.js"
import type { ComponentProps as ReactComponentProps } from "react"
import { cn } from "../_parts/utils/index.js"
import {
  composeRenderProps,
  Header as HeaderPrimitive,
  MenuItem as MenuItemPrimitive,
  Menu as MenuPrimitive,
  MenuSection as MenuSectionPrimitive,
  MenuTrigger as MenuTriggerPrimitive,
  Popover as PopoverPrimitive,
  Separator as SeparatorPrimitive,
  SubmenuTrigger as SubmenuTriggerPrimitive,
  type MenuProps,
  type MenuItemProps as MenuItemPrimitiveProps,
  type MenuSectionProps as MenuSectionPrimitiveProps,
} from "react-aria-components"

function DropdownMenuTrigger({
  ...props
}: ReactComponentProps<typeof MenuTriggerPrimitive>) {
  return <MenuTriggerPrimitive data-slot="dropdown-menu-trigger" {...props} />
}

function DropdownMenu<T extends object>({
  "data-slot": dataSlot = "dropdown-menu-content",
  placement = "bottom start",
  offset = 4,
  crossOffset = 0,
  className,
  children,
  ...props
}: Omit<
  ReactComponentProps<typeof MenuPrimitive<T>>,
  "children" | "className"
> &
  Pick<
    ReactComponentProps<typeof PopoverPrimitive>,
    "placement" | "offset" | "crossOffset"
  > & {
    "data-slot"?: string
    className?: MenuProps<T>["className"]
    children?: MenuProps<T>["children"]
  }) {
  return (
    <PopoverPrimitive
      data-slot={dataSlot}
      placement={placement}
      offset={offset}
      crossOffset={crossOffset}
      className={cn(
        "data-entering:library-enter data-exiting:library-exit data-exiting:library-fade data-entering:library-fade data-exiting:library-zoom data-entering:library-zoom data-[placement=bottom]:library-slide-top data-[placement=left]:library-slide-right data-[placement=right]:library-slide-left data-[placement=top]:library-slide-bottom ring-(--color-ink-primary)/10 bg-(--color-overlay-surface) text-(--color-ink-primary) min-w-(--spacing-6xl) rounded-(--radius-control) p-(--spacing-xs) shadow-(--ui-elevation-floating) ring-(length:--ui-border-hairline) duration-(--ui-duration-fast,100ms) animate-none! relative bg-(--color-overlay-surface)/70 before:pointer-events-none before:absolute before:inset-0 before:-z-1 before:rounded-[inherit] before:backdrop-blur-2xl before:backdrop-saturate-150 **:data-[slot$=-item]:focus:bg-(--color-ink-primary)/10 **:data-[slot$=-item]:data-highlighted:bg-(--color-ink-primary)/10 **:data-[slot$=-separator]:bg-(--color-ink-primary)/5 **:data-[slot$=-trigger]:focus:bg-(--color-ink-primary)/10 **:data-[slot$=-trigger]:aria-expanded:bg-(--color-ink-primary)/10! **:data-[variant=destructive]:focus:bg-(--color-ink-primary)/10! **:data-[variant=destructive]:text-(--color-ink-primary)! **:data-[variant=destructive]:**:text-(--color-ink-primary)! **:data-[slot$=-item]:data-focused:bg-(--color-ink-primary)/10 z-(--ui-z-modal,50) w-(--trigger-width) origin-(--trigger-anchor-point) overflow-x-hidden overflow-y-auto focus-visible:outline-solid focus-visible:outline-(length:--ui-border-focus,3px) focus-visible:outline-offset-(--ui-focus-offset) focus-visible:outline-(--color-focus-ring) data-exiting:overflow-hidden",
        typeof className === "function" ? undefined : className
      )}
    >
      <MenuPrimitive
        className={composeRenderProps(typeof className === "function" ? className : undefined, (className: string | undefined) => cn("max-h-[inherit] overflow-x-hidden overflow-y-auto focus-visible:outline-solid focus-visible:outline-(length:--ui-border-focus,3px) focus-visible:outline-offset-(--ui-focus-offset) focus-visible:outline-(--color-focus-ring)", className))}
        {...props}
      >
        {children}
      </MenuPrimitive>
    </PopoverPrimitive>
  )
}

function DropdownMenuGroup<T extends object>({
  ...props
}: Omit<MenuSectionPrimitiveProps<T>, "children"> & {
  children?: MenuSectionPrimitiveProps<T>["children"]
}) {
  return <MenuSectionPrimitive data-slot="dropdown-menu-group" {...props} />
}

function DropdownMenuLabel({
  className,
  inset,
  ...props
}: ReactComponentProps<typeof HeaderPrimitive> & {
  inset?: boolean
}) {
  return (
    <HeaderPrimitive
      data-slot="dropdown-menu-label"
      data-inset={inset}
      className={cn("text-(--color-ink-muted) px-(--spacing-sm) py-(--spacing-xs) text-(length:--text-xs) font-(weight:--font-weight-medium) data-inset:ps-[var(--spacing-2xl)]", className)}
      {...props}
    />
  )
}

function dropdownMenuItemVariants({ selectionMode }: { selectionMode?: "none" | "single" | "multiple" } = {}) {
  return cn("group/dropdown-menu-item relative flex cursor-default items-center focus-visible:outline-solid focus-visible:outline-(length:--ui-border-focus,3px) focus-visible:outline-offset-(--ui-focus-offset) focus-visible:outline-(--color-focus-ring) select-none data-disabled:pointer-events-none data-disabled:opacity-(--ui-alpha-disabled,50%) [&_svg]:pointer-events-none [&_svg]:shrink-0", selectionMode === "none" ? "focus:bg-(--color-surface-selected) focus:text-(--color-ink-primary) data-[variant=destructive]:text-(--color-status-danger) data-[variant=destructive]:focus:bg-(--color-status-danger)/10 dark:data-[variant=destructive]:focus:bg-(--color-status-danger)/20 data-[variant=destructive]:focus:text-(--color-status-danger) data-[variant=destructive]:*:[svg]:text-(--color-status-danger) not-data-[variant=destructive]:focus:**:text-(--color-ink-primary) gap-(--spacing-sm) rounded-(--radius-control) px-(--spacing-sm) py-(--spacing-xs) text-(length:--text-sm) data-inset:ps-[var(--spacing-2xl)] [&_svg:not([class*='size-'])]:size-(--spacing-lg,calc(var(--spacing)*4))" : selectionMode === "single" ? "focus:bg-(--color-surface-selected) focus:text-(--color-ink-primary) focus:**:text-(--color-ink-primary) gap-(--spacing-sm) rounded-(--radius-control) py-(--spacing-xs) pe-(--spacing-2xl) ps-(--spacing-sm) text-(length:--text-sm) data-inset:ps-[var(--spacing-2xl)] [&_svg:not([class*='size-'])]:size-(--spacing-lg,calc(var(--spacing)*4))" : selectionMode === "multiple" ? "focus:bg-(--color-surface-selected) focus:text-(--color-ink-primary) focus:**:text-(--color-ink-primary) gap-(--spacing-sm) rounded-(--radius-control) py-(--spacing-xs) pe-(--spacing-2xl) ps-(--spacing-sm) text-(length:--text-sm) data-inset:ps-[var(--spacing-2xl)] [&_svg:not([class*='size-'])]:size-(--spacing-lg,calc(var(--spacing)*4))" : undefined)
}

function DropdownMenuItem<T extends object>({
  className,
  inset,
  variant = "default",
  children,
  ...props
}: MenuItemPrimitiveProps<T> & {
  inset?: boolean
  variant?: "default" | "destructive"
}) {
  return (
    <MenuItemPrimitive
      data-slot="dropdown-menu-item"
      data-inset={inset}
      data-variant={variant}
      textValue={typeof children === "string" ? children : props.textValue}
      className={composeRenderProps(className, (className, { selectionMode }) =>
        cn(dropdownMenuItemVariants({ selectionMode }), className)
      )}
      {...props}
    >
      {composeRenderProps(
        children,
        (children, { isSelected, selectionMode }) => (
          <>
            {selectionMode !== "none" ? (
              <span
                className="absolute end-(--spacing-sm) flex items-center justify-center pointer-events-none"
                data-slot={
                  selectionMode === "single"
                    ? "dropdown-menu-radio-item-indicator"
                    : "dropdown-menu-checkbox-item-indicator"
                }
              >
                {isSelected ? (
                  <LibraryIcon asset="assets.icon-check" decorative />
                ) : null}
              </span>
            ) : null}
            {children}
          </>
        )
      )}
    </MenuItemPrimitive>
  )
}

function DropdownMenuSub({
  ...props
}: ReactComponentProps<typeof SubmenuTriggerPrimitive>) {
  return <SubmenuTriggerPrimitive data-slot="dropdown-menu-sub" {...props} />
}

function DropdownMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: MenuItemPrimitiveProps<object> & {
  inset?: boolean
}) {
  return (
    <MenuItemPrimitive
      data-slot="dropdown-menu-sub-trigger"
      data-inset={inset}
      textValue={typeof children === "string" ? children : props.textValue}
      className={cn(
        "focus:bg-(--color-surface-selected) focus:text-(--color-ink-primary) data-open:bg-(--color-surface-selected) data-open:text-(--color-ink-primary) not-data-[variant=destructive]:focus:**:text-(--color-ink-primary) gap-(--spacing-sm) rounded-(--radius-control) px-(--spacing-sm) py-(--spacing-xs) text-(length:--text-sm) data-inset:ps-[var(--spacing-2xl)] [&_svg:not([class*='size-'])]:size-(--spacing-lg,calc(var(--spacing)*4)) flex cursor-default items-center focus-visible:outline-solid focus-visible:outline-(length:--ui-border-focus,3px) focus-visible:outline-offset-(--ui-focus-offset) focus-visible:outline-(--color-focus-ring) select-none [&_svg]:pointer-events-none [&_svg]:shrink-0",
        className
      )}
      {...props}
    >
      {composeRenderProps(children, (children) => (
        <>
          {children}
          <LibraryIcon asset="assets.icon-chevron-right" decorative className="ms-auto" />
        </>
      ))}
    </MenuItemPrimitive>
  )
}

function DropdownMenuSubContent({
  placement = "end top",
  crossOffset = -3,
  offset = 0,
  className,
  ...props
}: ReactComponentProps<typeof DropdownMenu>) {
  return (
    <DropdownMenu
      data-slot="dropdown-menu-sub-content"
      className={cn(
        "ring-(--color-ink-primary)/10 bg-(--color-overlay-surface) text-(--color-ink-primary) min-w-(--spacing-5xl) rounded-(--radius-control) p-(--spacing-xs) shadow-(--ui-elevation-floating) ring-(length:--ui-border-hairline) duration-(--ui-duration-fast,100ms) animate-none! relative bg-(--color-overlay-surface)/70 before:pointer-events-none before:absolute before:inset-0 before:-z-1 before:rounded-[inherit] before:backdrop-blur-2xl before:backdrop-saturate-150 **:data-[slot$=-item]:focus:bg-(--color-ink-primary)/10 **:data-[slot$=-item]:data-highlighted:bg-(--color-ink-primary)/10 **:data-[slot$=-separator]:bg-(--color-ink-primary)/5 **:data-[slot$=-trigger]:focus:bg-(--color-ink-primary)/10 **:data-[slot$=-trigger]:aria-expanded:bg-(--color-ink-primary)/10! **:data-[variant=destructive]:focus:bg-(--color-ink-primary)/10! **:data-[variant=destructive]:text-(--color-ink-primary)! **:data-[variant=destructive]:**:text-(--color-ink-primary)! w-auto",
        className
      )}
      placement={placement}
      crossOffset={crossOffset}
      offset={offset}
      {...props}
    />
  )
}

function DropdownMenuSeparator({
  className,
  ...props
}: ReactComponentProps<typeof SeparatorPrimitive>) {
  return (
    <SeparatorPrimitive
      data-slot="dropdown-menu-separator"
      className={cn("bg-(--color-line-base) -mx-(--spacing-xs) my-(--spacing-xs) h-(--ui-border-hairline)", className)}
      {...props}
    />
  )
}

function DropdownMenuShortcut({
  className,
  ...props
}: ReactComponentProps<"span">) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      className={cn("text-(--color-ink-muted) group-focus/dropdown-menu-item:text-(--color-ink-primary) ms-auto text-(length:--text-xs) tracking-(--tracking-label)", className)}
      {...props}
    />
  )
}

function InlineMenu<T extends object>({ className, ...props }: MenuProps<T>) {
  return (
    <MenuPrimitive
      {...props}
      data-slot="command-list"
      className={composeRenderProps(className, (className) => cn(
        "no-scrollbar max-h-[calc(var(--spacing-6xl)*2)] scroll-py-1 focus-visible:outline-solid focus-visible:outline-(length:--ui-border-focus,3px) focus-visible:outline-offset-(--ui-focus-offset) focus-visible:outline-(--color-focus-ring) overflow-x-hidden overflow-y-auto",
        className
      ))}
    />
  )
}

export {
  InlineMenu,
  DropdownMenuTrigger,
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
}
