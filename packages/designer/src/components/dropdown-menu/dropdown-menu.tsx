"use client"

import { Icon as LibraryIcon } from "../icon/index.js"
import * as React from "react"
import { cn, classNames, type ClassValue, type VariantProps } from "../_parts/rail-utils/index.js"
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
  type MenuItemProps as MenuItemPrimitiveProps,
  type MenuSectionProps as MenuSectionPrimitiveProps,
} from "react-aria-components"

function DropdownMenuTrigger({
  ...props
}: React.ComponentProps<typeof MenuTriggerPrimitive>) {
  return <MenuTriggerPrimitive data-slot="dropdown-menu-trigger" {...props} />
}

function DropdownMenu({
  /** @default "dropdown-menu-content" */
  "data-slot": dataSlot = "dropdown-menu-content",
  /** @default "bottom start" */
  placement = "bottom start",
  /** @default 4 */
  offset = 4,
  /** @default 0 */
  crossOffset = 0,
  className,
  children,
  ...props
}: Omit<
  React.ComponentProps<typeof MenuPrimitive<object>>,
  "children" | "className"
> &
  Pick<
    React.ComponentProps<typeof PopoverPrimitive>,
    "placement" | "offset" | "crossOffset"
  > & {
    "data-slot"?: string
    className?: string
    children?: React.ReactNode
  }) {
  return (
    <PopoverPrimitive
      data-slot={dataSlot}
      placement={placement}
      offset={offset}
      crossOffset={crossOffset}
      className={cn(
        "data-entering:library-enter data-exiting:library-exit data-exiting:library-fade data-entering:library-fade data-exiting:library-zoom data-entering:library-zoom data-[placement=bottom]:library-slide-top data-[placement=left]:library-slide-right data-[placement=right]:library-slide-left data-[placement=top]:library-slide-bottom ring-(--foreground)/10 bg-(--popover) text-(--foreground) min-w-[calc(var(--spacing,0.25rem)*32)] rounded-(--radius) p-[calc(var(--spacing,0.25rem)*1)] shadow-(--shadow-md) ring-1 motion-safe:duration-100 motion-reduce:transition-none motion-reduce:animate-none motion-reduce:duration-0 motion-safe:animate-none! relative bg-(--popover)/70 before:pointer-events-none before:absolute before:inset-0 before:-z-1 before:rounded-[inherit] before:backdrop-blur-2xl before:backdrop-saturate-150 **:data-[slot$=-item]:focus:bg-(--foreground)/10 **:data-[slot$=-item]:data-highlighted:bg-(--foreground)/10 **:data-[slot$=-separator]:bg-(--foreground)/5 **:data-[slot$=-trigger]:focus:bg-(--foreground)/10 **:data-[slot$=-trigger]:aria-expanded:bg-(--foreground)/10! **:data-[variant=destructive]:focus:bg-(--foreground)/10! **:data-[variant=destructive]:text-(--foreground)! **:data-[variant=destructive]:**:text-(--foreground)! **:data-[slot$=-item]:data-focused:bg-(--foreground)/10 z-50 w-(--trigger-width) origin-(--trigger-anchor-point) overflow-x-hidden overflow-y-auto focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ring) data-exiting:overflow-hidden",
        className
      )}
    >
      <MenuPrimitive
        className="max-h-[inherit] overflow-x-hidden overflow-y-auto focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ring)"
        {...props}
      >
        {children}
      </MenuPrimitive>
    </PopoverPrimitive>
  )
}

function DropdownMenuGroup({
  ...props
}: Omit<MenuSectionPrimitiveProps<object>, "children"> & {
  children?: React.ReactNode
}) {
  return <MenuSectionPrimitive data-slot="dropdown-menu-group" {...props} />
}

function DropdownMenuLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<typeof HeaderPrimitive> & {
  inset?: boolean
}) {
  return (
    <HeaderPrimitive
      data-slot="dropdown-menu-label"
      data-inset={inset}
      className={cn("text-(--muted-foreground) px-[calc(var(--spacing,0.25rem)*2)] py-[calc(var(--spacing,0.25rem)*1)] text-(length:--text-xs) font-medium data-inset:ps-[calc(var(--spacing,0.25rem)*6)]", className)}
      {...props}
    />
  )
}

const dropdownMenuItemVariants_DEFINITION = {"base":"group/dropdown-menu-item relative flex cursor-default items-center focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ring) select-none data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0","variants":{"selectionMode":{"none":"focus:bg-(--accent) focus:text-(--foreground) data-[variant=destructive]:text-(--destructive) data-[variant=destructive]:focus:bg-(--destructive)/10 dark:data-[variant=destructive]:focus:bg-(--destructive)/20 data-[variant=destructive]:focus:text-(--destructive) data-[variant=destructive]:*:[svg]:text-(--destructive) not-data-[variant=destructive]:focus:**:text-(--foreground) gap-[calc(var(--spacing,0.25rem)*2)] rounded-(--radius) px-[calc(var(--spacing,0.25rem)*2)] py-[calc(var(--spacing,0.25rem)*1)] text-(length:--text-sm) data-inset:ps-[calc(var(--spacing,0.25rem)*6)] [&_svg:not([class*='size-'])]:size-[calc(var(--spacing,0.25rem)*4)]","single":"focus:bg-(--accent) focus:text-(--foreground) focus:**:text-(--foreground) gap-[calc(var(--spacing,0.25rem)*2)] rounded-(--radius) py-[calc(var(--spacing,0.25rem)*1)] pe-[calc(var(--spacing,0.25rem)*8)] ps-[calc(var(--spacing,0.25rem)*2)] text-(length:--text-sm) data-inset:ps-[calc(var(--spacing,0.25rem)*6)] [&_svg:not([class*='size-'])]:size-[calc(var(--spacing,0.25rem)*4)]","multiple":"focus:bg-(--accent) focus:text-(--foreground) focus:**:text-(--foreground) gap-[calc(var(--spacing,0.25rem)*2)] rounded-(--radius) py-[calc(var(--spacing,0.25rem)*1)] pe-[calc(var(--spacing,0.25rem)*8)] ps-[calc(var(--spacing,0.25rem)*2)] text-(length:--text-sm) data-inset:ps-[calc(var(--spacing,0.25rem)*6)] [&_svg:not([class*='size-'])]:size-[calc(var(--spacing,0.25rem)*4)]"}},"defaultVariants":{}}
function dropdownMenuItemVariants(props: { "selectionMode"?: "none" | "single" | "multiple" | null; class?: ClassValue; className?: ClassValue } = {}) {
  props ??= {}
  const definition = dropdownMenuItemVariants_DEFINITION
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

function DropdownMenuItem({
  className,
  inset,
  /** @default "default" */
  variant = "default",
  children,
  ...props
}: MenuItemPrimitiveProps<object> & {
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
}: React.ComponentProps<typeof SubmenuTriggerPrimitive>) {
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
        "focus:bg-(--accent) focus:text-(--foreground) data-open:bg-(--accent) data-open:text-(--foreground) not-data-[variant=destructive]:focus:**:text-(--foreground) gap-[calc(var(--spacing,0.25rem)*2)] rounded-(--radius) px-[calc(var(--spacing,0.25rem)*2)] py-[calc(var(--spacing,0.25rem)*1)] text-(length:--text-sm) data-inset:ps-[calc(var(--spacing,0.25rem)*6)] [&_svg:not([class*='size-'])]:size-[calc(var(--spacing,0.25rem)*4)] flex cursor-default items-center focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ring) select-none [&_svg]:pointer-events-none [&_svg]:shrink-0",
        className
      )}
      {...props}
    >
      {composeRenderProps(children, (children) => (
        <>
          {children}
          <LibraryIcon asset="assets.icon-chevron-right" mirrorInRtl decorative className="ms-auto"  />
        </>
      ))}
    </MenuItemPrimitive>
  )
}

function DropdownMenuSubContent({
  /** @default "end top" */
  placement = "end top",
  crossOffset = -3,
  /** @default 0 */
  offset = 0,
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenu>) {
  return (
    <DropdownMenu
      data-slot="dropdown-menu-sub-content"
      className={cn(
        "ring-(--foreground)/10 bg-(--popover) text-(--foreground) min-w-[calc(var(--spacing,0.25rem)*32)] rounded-(--radius) p-[calc(var(--spacing,0.25rem)*1)] shadow-(--shadow-lg) ring-1 motion-safe:duration-100 motion-reduce:transition-none motion-reduce:animate-none motion-reduce:duration-0 motion-safe:animate-none! relative bg-(--popover)/70 before:pointer-events-none before:absolute before:inset-0 before:-z-1 before:rounded-[inherit] before:backdrop-blur-2xl before:backdrop-saturate-150 **:data-[slot$=-item]:focus:bg-(--foreground)/10 **:data-[slot$=-item]:data-highlighted:bg-(--foreground)/10 **:data-[slot$=-separator]:bg-(--foreground)/5 **:data-[slot$=-trigger]:focus:bg-(--foreground)/10 **:data-[slot$=-trigger]:aria-expanded:bg-(--foreground)/10! **:data-[variant=destructive]:focus:bg-(--foreground)/10! **:data-[variant=destructive]:text-(--foreground)! **:data-[variant=destructive]:**:text-(--foreground)! w-auto",
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
}: React.ComponentProps<typeof SeparatorPrimitive>) {
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
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      className={cn("text-(--muted-foreground) group-focus/dropdown-menu-item:text-(--foreground) ms-auto text-(length:--text-xs) tracking-widest", className)}
      {...props}
    />
  )
}

export {
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
