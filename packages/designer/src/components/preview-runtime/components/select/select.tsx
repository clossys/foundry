"use client"

import { Icon as LibraryIcon } from "../icon/index.js"
import type { ComponentProps as ReactComponentProps, ReactNode as ReactNode } from "react"
import { cn } from "../_parts/utils/index.js"
import {
  Button as ButtonPrimitive,
  composeRenderProps,
  Header as HeaderPrimitive,
  ListBoxItem as ListBoxItemPrimitive,
  ListBox as ListBoxPrimitive,
  ListBoxSection as ListBoxSectionPrimitive,
  Popover as PopoverPrimitive,
  SearchField,
  Select as SelectPrimitive,
  SelectValue as SelectValuePrimitive,
  Separator as SeparatorPrimitive,
  type ListBoxProps,
  type SearchFieldProps,
  type ListBoxSectionProps as SelectGroupProps,
  type SelectProps,
  type SelectValueProps,
} from "react-aria-components"

import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "../_parts/input-group/index.js"
function Select<T extends object, M extends "single" | "multiple" = "single">({
  className,
  size = "md",
  ...props
}: SelectProps<T, M> & { size?: "sm" | "md" | "lg" }) {
  return (
    <SelectPrimitive
      data-slot="select"
      data-size={size}
      className={composeRenderProps(className, (className) => cn("group/select w-fit", className))}
      {...props}
    />
  )
}

function SelectGroup<T extends object>({
  className,
  ...props
}: SelectGroupProps<T>) {
  return (
    <ListBoxSectionPrimitive
      data-slot="select-group"
      className={cn("scroll-my-1 p-[calc(var(--spacing,0.25rem)*1)]", className)}
      {...props}
    />
  )
}

function SelectValue<T extends object>({
  className,
  children,
  ...props
}: SelectValueProps<T>) {
  return (
    <SelectValuePrimitive
      data-slot="select-value"
      className={cn("flex flex-1 text-start data-placeholder:text-(--muted-foreground)", className)}
      {...props}
    >
      {typeof children === "function"
        ? children
        : ({ selectedItems, selectedText, defaultChildren }) =>
            selectedItems.length > 1 ? selectedText : defaultChildren}
    </SelectValuePrimitive>
  )
}

function SelectTrigger({
  className,
  size,
  children,
  ...props
}: Omit<ReactComponentProps<typeof ButtonPrimitive>, "children"> & {
  children?: ReactNode
  size?: "sm" | "default" | "lg"
}) {
  return (
    <ButtonPrimitive
      data-slot="select-trigger"
      data-size={size}
      className={composeRenderProps(className, (className) => cn(
        "border-(--input) data-placeholder:text-(--muted-foreground) dark:bg-(--input)/30 dark:hover:bg-(--input)/50 focus-visible:border-(--ring) focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ring) aria-invalid:outline-solid aria-invalid:outline-2 aria-invalid:outline-offset-2 aria-invalid:outline-(--destructive) dark:aria-invalid:ring-(--destructive)/40 aria-invalid:border-(--destructive) dark:aria-invalid:border-(--destructive)/50 gap-[calc(var(--spacing,0.25rem)*2)] rounded-(--radius) border bg-transparent py-[calc(var(--spacing,0.25rem)*2)] pe-[calc(var(--spacing,0.25rem)*2)] ps-[calc(var(--spacing,0.25rem)*3)] text-(length:--text-sm) transition-colors select-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ring) aria-invalid:outline-solid aria-invalid:outline-2 aria-invalid:outline-offset-2 aria-invalid:outline-(--destructive) h-[calc(var(--spacing,0.25rem)*8)] group-data-[size=sm]/select:not-data-[size]:h-[calc(var(--spacing,0.25rem)*7)] group-data-[size=lg]/select:not-data-[size]:h-[calc(var(--spacing,0.25rem)*9)] group-data-[size=sm]/select:not-data-[size]:rounded-(--radius) data-[size=default]:h-[calc(var(--spacing,0.25rem)*8)] data-[size=sm]:h-[calc(var(--spacing,0.25rem)*7)] data-[size=sm]:rounded-(--radius) *:data-[slot=select-value]:flex *:data-[slot=select-value]:gap-[calc(var(--spacing,0.25rem)*2)] [&_svg:not([class*='size-'])]:size-[calc(var(--spacing,0.25rem)*4)] font-(family-name:--font-sans) data-[size=lg]:h-[calc(var(--spacing,0.25rem)*9)] flex w-full items-center justify-between whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center [&_svg]:pointer-events-none [&_svg]:shrink-0",
        className
      ))}
      {...props}
    >
      {children}
      <LibraryIcon asset="assets.icon-chevron-down" decorative className="text-(--muted-foreground) size-[calc(var(--spacing,0.25rem)*4)] pointer-events-none" />
    </ButtonPrimitive>
  )
}

function SelectContent({
  className,
  children,
  placement = "bottom",
  offset = 4,
  crossOffset = 0,
  ...props
}: Omit<
  ReactComponentProps<typeof PopoverPrimitive>,
  "className" | "children"
> & {
  className?: string
  children?: ReactNode
}) {
  return (
    <SelectPopover
      className={className}
      placement={placement}
      offset={offset}
      crossOffset={crossOffset}
      {...props}
    >
      <SelectList>{children}</SelectList>
    </SelectPopover>
  )
}

function SelectPopover({
  className,
  children,
  placement = "bottom start",
  offset = 4,
  crossOffset = 0,
  ...props
}: Omit<
  ReactComponentProps<typeof PopoverPrimitive>,
  "className" | "children"
> & {
  className?: string
  children?: ReactNode
}) {
  return (
    <PopoverPrimitive
      data-slot="select-content"
      placement={placement}
      offset={offset}
      crossOffset={crossOffset}
      className={cn(
        "bg-(--popover) text-(--foreground) data-entering:library-enter data-exiting:library-exit data-exiting:library-fade data-entering:library-fade data-exiting:library-zoom data-entering:library-zoom data-[placement=bottom]:library-slide-top data-[placement=left]:library-slide-right data-[placement=right]:library-slide-left data-[placement=top]:library-slide-bottom ring-(--foreground)/10 min-w-[calc(var(--spacing,0.25rem)*32)] rounded-(--radius) shadow-(--shadow-md) ring-1 duration-100 animate-none! relative bg-(--popover)/70 before:pointer-events-none before:absolute before:inset-0 before:-z-1 before:rounded-[inherit] before:backdrop-blur-2xl before:backdrop-saturate-150 **:data-[slot$=-item]:focus:bg-(--foreground)/10 **:data-[slot$=-item]:data-highlighted:bg-(--foreground)/10 **:data-[slot$=-separator]:bg-(--foreground)/5 **:data-[slot$=-trigger]:focus:bg-(--foreground)/10 **:data-[slot$=-trigger]:aria-expanded:bg-(--foreground)/10! **:data-[variant=destructive]:focus:bg-(--foreground)/10! **:data-[variant=destructive]:text-(--foreground)! **:data-[variant=destructive]:**:text-(--foreground)! **:data-[slot$=-item]:data-focused:bg-(--foreground)/10 relative isolate z-50 w-(--trigger-width) origin-(--trigger-anchor-point) overflow-hidden",
        className
      )}
      {...props}
    >
      {children}
    </PopoverPrimitive>
  )
}

function SelectList<T extends object>({
  className,
  ...props
}: ListBoxProps<T>) {
  return (
    <ListBoxPrimitive
      data-slot="select-list"
      className={cn(
        "group/select-list max-h-[inherit] overflow-x-hidden overflow-y-auto p-0 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ring)",
        className
      )}
      {...props}
    />
  )
}

function SelectInput({ className, ...props }: SearchFieldProps) {
  return (
    <SearchField
      {...props}
      autoFocus
      data-slot="select-input-wrapper"
      className={cn("p-[calc(var(--spacing,0.25rem)*1)] pb-0", className)}
    >
      <InputGroup>
        <InputGroupInput
          data-slot="select-input"
          className="[&::-webkit-search-cancel-button]:hidden"
        />
        <InputGroupAddon>
          <LibraryIcon asset="assets.icon-search" decorative className="size-[calc(var(--spacing,0.25rem)*4)] shrink-0 opacity-50" />
        </InputGroupAddon>
      </InputGroup>
    </SearchField>
  )
}

function SelectLabel({
  className,
  ...props
}: ReactComponentProps<typeof HeaderPrimitive>) {
  return (
    <HeaderPrimitive
      data-slot="select-label"
      className={cn("text-(--muted-foreground) px-[calc(var(--spacing,0.25rem)*2)] py-[calc(var(--spacing,0.25rem)*1)] text-(length:--text-xs) font-(family-name:--font-sans)", className)}
      {...props}
    />
  )
}

function SelectItem({
  className,
  children,
  ...props
}: ReactComponentProps<typeof ListBoxItemPrimitive>) {
  return (
    <ListBoxItemPrimitive
      data-slot="select-item"
      textValue={typeof children === "string" ? children : undefined}
      className={cn(
        "focus:bg-(--accent) focus:text-(--foreground) not-data-[variant=destructive]:focus:**:text-(--foreground) gap-[calc(var(--spacing,0.25rem)*2)] rounded-(--radius) py-[calc(var(--spacing,0.25rem)*1)] pe-[calc(var(--spacing,0.25rem)*8)] ps-[calc(var(--spacing,0.25rem)*2)] text-(length:--text-sm) [&_svg:not([class*='size-'])]:size-[calc(var(--spacing,0.25rem)*4)] *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-[calc(var(--spacing,0.25rem)*2)] data-focused:bg-(--accent) data-focused:text-(--foreground) relative flex w-full cursor-default items-center outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
        className
      )}
      {...props}
    >
      {composeRenderProps(children, (children, { isSelected }) => (
        <>
          <span className="flex flex-1 gap-[calc(var(--spacing,0.25rem)*2)] shrink-0 whitespace-nowrap">
            {children}
          </span>
          <span className="pointer-events-none absolute end-[calc(var(--spacing,0.25rem)*2)] flex size-[calc(var(--spacing,0.25rem)*4)] items-center justify-center">
            {isSelected ? (
              <LibraryIcon asset="assets.icon-check" decorative className="pointer-events-none" />
            ) : null}
          </span>
        </>
      ))}
    </ListBoxItemPrimitive>
  )
}

function SelectSeparator({
  className,
  ...props
}: ReactComponentProps<typeof SeparatorPrimitive>) {
  return (
    <SeparatorPrimitive
      data-slot="select-separator"
      className={cn("bg-(--border) -mx-[calc(var(--spacing,0.25rem)*1)] my-[calc(var(--spacing,0.25rem)*1)] h-px pointer-events-none", className)}
      {...props}
    />
  )
}

function SelectEmpty({ className, ...props }: ReactComponentProps<"div">) {
  return (
    <div
      data-slot="select-empty"
      className={cn("text-(--muted-foreground) hidden w-full justify-center py-[calc(var(--spacing,0.25rem)*2)] text-center text-(length:--text-sm) group-data-empty/select-list:flex", className)}
      {...props}
    />
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectInput,
  SelectItem,
  SelectLabel,
  SelectList,
  SelectPopover,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
  SelectEmpty,
}
