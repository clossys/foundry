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
        "data-entering:library-enter data-exiting:library-exit data-exiting:library-fade data-entering:library-fade data-exiting:library-zoom data-entering:library-zoom data-[placement=bottom]:library-slide-top data-[placement=left]:library-slide-right data-[placement=right]:library-slide-left data-[placement=top]:library-slide-bottom ring-(--foreground)/10 bg-(--popover) text-(--foreground) min-w-[calc(var(--spacing,0.25rem)*32)] rounded-(--radius) p-[calc(var(--spacing,0.25rem)*1)] shadow-(--shadow-md) ring-1 duration-100 animate-none! relative bg-(--popover)/70 before:pointer-events-none before:absolute before:inset-0 before:-z-1 before:rounded-[inherit] before:backdrop-blur-2xl before:backdrop-saturate-150 **:data-[slot$=-item]:focus:bg-(--foreground)/10 **:data-[slot$=-item]:data-highlighted:bg-(--foreground)/10 **:data-[slot$=-separator]:bg-(--foreground)/5 **:data-[slot$=-trigger]:focus:bg-(--foreground)/10 **:data-[slot$=-trigger]:aria-expanded:bg-(--foreground)/10! **:data-[variant=destructive]:focus:bg-(--foreground)/10! **:data-[variant=destructive]:text-(--foreground)! **:data-[variant=destructive]:**:text-(--foreground)! **:data-[slot$=-item]:data-focused:bg-(--foreground)/10 z-50 w-(--trigger-width) origin-(--trigger-anchor-point) overflow-x-hidden overflow-y-auto focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ring) data-exiting:overflow-hidden",
        typeof className === "function" ? undefined : className
      )}
    >
      <MenuPrimitive
        className={composeRenderProps(typeof className === "function" ? className : undefined, (className: string | undefined) => cn("max-h-[inherit] overflow-x-hidden overflow-y-auto focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ring)", className))}
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
      className={cn("text-(--muted-foreground) px-[calc(var(--spacing,0.25rem)*2)] py-[calc(var(--spacing,0.25rem)*1)] text-(length:--text-xs) font-medium data-inset:ps-[calc(var(--spacing,0.25rem)*8)]", className)}
      {...props}
    />
  )
}

function dropdownMenuItemVariants({ selectionMode }: { selectionMode?: "none" | "single" | "multiple" } = {}) {
  return cn("group/dropdown-menu-item relative flex cursor-default items-center focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ring) select-none data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0", selectionMode === "none" ? "focus:bg-(--accent) focus:text-(--foreground) data-[variant=destructive]:text-(--destructive) data-[variant=destructive]:focus:bg-(--destructive)/10 dark:data-[variant=destructive]:focus:bg-(--destructive)/20 data-[variant=destructive]:focus:text-(--destructive) data-[variant=destructive]:*:[svg]:text-(--destructive) not-data-[variant=destructive]:focus:**:text-(--foreground) gap-[calc(var(--spacing,0.25rem)*2)] rounded-(--radius) px-[calc(var(--spacing,0.25rem)*2)] py-[calc(var(--spacing,0.25rem)*1)] text-(length:--text-sm) data-inset:ps-[calc(var(--spacing,0.25rem)*8)] [&_svg:not([class*='size-'])]:size-[calc(var(--spacing,0.25rem)*4)]" : selectionMode === "single" ? "focus:bg-(--accent) focus:text-(--foreground) focus:**:text-(--foreground) gap-[calc(var(--spacing,0.25rem)*2)] rounded-(--radius) py-[calc(var(--spacing,0.25rem)*1)] pe-[calc(var(--spacing,0.25rem)*8)] ps-[calc(var(--spacing,0.25rem)*2)] text-(length:--text-sm) data-inset:ps-[calc(var(--spacing,0.25rem)*8)] [&_svg:not([class*='size-'])]:size-[calc(var(--spacing,0.25rem)*4)]" : selectionMode === "multiple" ? "focus:bg-(--accent) focus:text-(--foreground) focus:**:text-(--foreground) gap-[calc(var(--spacing,0.25rem)*2)] rounded-(--radius) py-[calc(var(--spacing,0.25rem)*1)] pe-[calc(var(--spacing,0.25rem)*8)] ps-[calc(var(--spacing,0.25rem)*2)] text-(length:--text-sm) data-inset:ps-[calc(var(--spacing,0.25rem)*8)] [&_svg:not([class*='size-'])]:size-[calc(var(--spacing,0.25rem)*4)]" : undefined)
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
                className="absolute end-[calc(var(--spacing,0.25rem)*2)] flex items-center justify-center pointer-events-none"
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
        "focus:bg-(--accent) focus:text-(--foreground) data-open:bg-(--accent) data-open:text-(--foreground) not-data-[variant=destructive]:focus:**:text-(--foreground) gap-[calc(var(--spacing,0.25rem)*2)] rounded-(--radius) px-[calc(var(--spacing,0.25rem)*2)] py-[calc(var(--spacing,0.25rem)*1)] text-(length:--text-sm) data-inset:ps-[calc(var(--spacing,0.25rem)*8)] [&_svg:not([class*='size-'])]:size-[calc(var(--spacing,0.25rem)*4)] flex cursor-default items-center focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ring) select-none [&_svg]:pointer-events-none [&_svg]:shrink-0",
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
        "ring-(--foreground)/10 bg-(--popover) text-(--foreground) min-w-[calc(var(--spacing,0.25rem)*24)] rounded-(--radius) p-[calc(var(--spacing,0.25rem)*1)] shadow-(--shadow-lg) ring-1 duration-100 animate-none! relative bg-(--popover)/70 before:pointer-events-none before:absolute before:inset-0 before:-z-1 before:rounded-[inherit] before:backdrop-blur-2xl before:backdrop-saturate-150 **:data-[slot$=-item]:focus:bg-(--foreground)/10 **:data-[slot$=-item]:data-highlighted:bg-(--foreground)/10 **:data-[slot$=-separator]:bg-(--foreground)/5 **:data-[slot$=-trigger]:focus:bg-(--foreground)/10 **:data-[slot$=-trigger]:aria-expanded:bg-(--foreground)/10! **:data-[variant=destructive]:focus:bg-(--foreground)/10! **:data-[variant=destructive]:text-(--foreground)! **:data-[variant=destructive]:**:text-(--foreground)! w-auto",
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
      className={cn("bg-(--border) -mx-[calc(var(--spacing,0.25rem)*1)] my-[calc(var(--spacing,0.25rem)*1)] h-px", className)}
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
      className={cn("text-(--muted-foreground) group-focus/dropdown-menu-item:text-(--foreground) ms-auto text-(length:--text-xs) tracking-widest", className)}
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
        "no-scrollbar max-h-[calc(calc(var(--spacing,0.25rem)*32)*2)] scroll-py-1 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ring) overflow-x-hidden overflow-y-auto",
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
