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
      className={cn("scroll-my-1 p-(--spacing-xs)", className)}
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
      className={cn("flex flex-1 text-left data-placeholder:text-(--color-ink-muted)", className)}
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
        "border-(--color-line-strong) data-placeholder:text-(--color-ink-muted) dark:bg-(--color-line-strong)/30 dark:hover:bg-(--color-line-strong)/50 focus-visible:border-(--color-focus-ring) focus-visible:outline-solid focus-visible:outline-(length:--ui-border-focus,3px) focus-visible:outline-offset-(--ui-focus-offset) focus-visible:outline-(--color-focus-ring) aria-invalid:outline-solid aria-invalid:outline-(length:--ui-border-focus,3px) aria-invalid:outline-offset-(--ui-focus-offset) aria-invalid:outline-(--color-status-danger) dark:aria-invalid:ring-(--color-status-danger)/40 aria-invalid:border-(--color-status-danger) dark:aria-invalid:border-(--color-status-danger)/50 gap-(--spacing-sm) rounded-(--radius-control) border-(length:--ui-border-hairline,1px) bg-transparent py-(--spacing-sm) pr-(--spacing-sm) pl-(--spacing-md) text-(length:--text-body) transition-colors duration-(--ui-duration-default) ease-(--default-transition-timing-function) select-none focus-visible:outline-solid focus-visible:outline-(length:--ui-border-focus,3px) focus-visible:outline-offset-(--ui-focus-offset) focus-visible:outline-(--color-focus-ring) aria-invalid:outline-solid aria-invalid:outline-(length:--ui-border-focus,3px) aria-invalid:outline-offset-(--ui-focus-offset) aria-invalid:outline-(--color-status-danger) h-(--ui-control-h-md,calc(var(--spacing)*8)) group-data-[size=sm]/select:not-data-[size]:h-(--ui-control-h-sm,calc(var(--spacing)*7)) group-data-[size=lg]/select:not-data-[size]:h-(--ui-control-h-lg,calc(var(--spacing)*9)) group-data-[size=sm]/select:not-data-[size]:rounded-(--radius-control) data-[size=default]:h-(--ui-control-h-md,calc(var(--spacing)*8)) data-[size=sm]:h-(--ui-control-h-sm,calc(var(--spacing)*7)) data-[size=sm]:rounded-(--radius-control) *:data-[slot=select-value]:flex *:data-[slot=select-value]:gap-(--spacing-sm) [&_svg:not([class*='size-'])]:size-(--spacing-lg,calc(var(--spacing)*4)) font-(family-name:--font-body) data-[size=lg]:h-(--ui-control-h-lg) flex w-full items-center justify-between whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-(--ui-alpha-disabled,50%) *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center [&_svg]:pointer-events-none [&_svg]:shrink-0",
        className
      ))}
      {...props}
    >
      {children}
      <LibraryIcon asset="assets.icon-chevron-down" decorative className="text-(--color-ink-muted) size-(--spacing-lg,calc(var(--spacing)*4)) pointer-events-none" />
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
        "bg-(--color-overlay-surface) text-(--color-ink-primary) data-entering:library-enter data-exiting:library-exit data-exiting:library-fade data-entering:library-fade data-exiting:library-zoom data-entering:library-zoom data-[placement=bottom]:library-slide-top data-[placement=left]:library-slide-right data-[placement=right]:library-slide-left data-[placement=top]:library-slide-bottom ring-(--color-ink-primary)/10 min-w-[var(--spacing-6xl)] rounded-(--radius-control) shadow-(--ui-elevation-floating) ring-(length:--ui-border-hairline) duration-(--ui-duration-fast,100ms) animate-none! relative bg-(--color-overlay-surface)/70 before:pointer-events-none before:absolute before:inset-0 before:-z-1 before:rounded-[inherit] before:backdrop-blur-2xl before:backdrop-saturate-150 **:data-[slot$=-item]:focus:bg-(--color-ink-primary)/10 **:data-[slot$=-item]:data-highlighted:bg-(--color-ink-primary)/10 **:data-[slot$=-separator]:bg-(--color-ink-primary)/5 **:data-[slot$=-trigger]:focus:bg-(--color-ink-primary)/10 **:data-[slot$=-trigger]:aria-expanded:bg-(--color-ink-primary)/10! **:data-[variant=destructive]:focus:bg-(--color-ink-primary)/10! **:data-[variant=destructive]:text-(--color-ink-primary)! **:data-[variant=destructive]:**:text-(--color-ink-primary)! **:data-[slot$=-item]:data-focused:bg-(--color-ink-primary)/10 relative isolate z-(--ui-z-modal,50) w-(--trigger-width) origin-(--trigger-anchor-point) overflow-hidden",
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
        "group/select-list max-h-[inherit] overflow-x-hidden overflow-y-auto p-0 focus-visible:outline-solid focus-visible:outline-(length:--ui-border-focus,3px) focus-visible:outline-offset-(--ui-focus-offset) focus-visible:outline-(--color-focus-ring)",
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
      className={cn("p-(--spacing-xs) pb-0", className)}
    >
      <InputGroup>
        <InputGroupInput
          data-slot="select-input"
          className="[&::-webkit-search-cancel-button]:hidden"
        />
        <InputGroupAddon>
          <LibraryIcon asset="assets.icon-search" decorative className="size-(--spacing-lg,calc(var(--spacing)*4)) shrink-0 opacity-(--ui-alpha-disabled,50%)" />
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
      className={cn("text-(--color-ink-muted) px-(--spacing-sm) py-(--spacing-xs) text-(length:--text-caption) font-(family-name:--font-body)", className)}
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
        "focus:bg-(--color-surface-selected) focus:text-(--color-ink-primary) not-data-[variant=destructive]:focus:**:text-(--color-ink-primary) gap-(--spacing-sm) rounded-(--radius-control) py-(--spacing-xs) pr-(--spacing-2xl) pl-(--spacing-sm) text-(length:--text-body) [&_svg:not([class*='size-'])]:size-(--spacing-lg,calc(var(--spacing)*4)) *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-(--spacing-sm) data-focused:bg-(--color-surface-selected) data-focused:text-(--color-ink-primary) relative flex w-full cursor-default items-center outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-(--ui-alpha-disabled,50%) [&_svg]:pointer-events-none [&_svg]:shrink-0",
        className
      )}
      {...props}
    >
      {composeRenderProps(children, (children, { isSelected }) => (
        <>
          <span className="flex flex-1 gap-(--spacing-sm) shrink-0 whitespace-nowrap">
            {children}
          </span>
          <span className="pointer-events-none absolute right-(--spacing-sm) flex size-(--spacing-lg,calc(var(--spacing)*4)) items-center justify-center">
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
      className={cn("bg-(--color-line-base) -mx-(--spacing-xs) my-(--spacing-xs) h-(--ui-border-hairline) pointer-events-none", className)}
      {...props}
    />
  )
}

function SelectEmpty({ className, ...props }: ReactComponentProps<"div">) {
  return (
    <div
      data-slot="select-empty"
      className={cn("text-(--color-ink-muted) hidden w-full justify-center py-(--spacing-sm) text-center text-(length:--text-body) group-data-empty/select-list:flex", className)}
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
