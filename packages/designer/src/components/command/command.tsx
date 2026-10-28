"use client"

import { Icon as LibraryIcon } from "../icon/index.js"
import * as React from "react"
import { cn } from "../_parts/rail-utils/index.js"
import {
  Autocomplete,
  Collection,
  composeRenderProps,
  Header,
  Input,
  Menu,
  MenuItem,
  MenuSection,
  SearchField,
  Separator,
  useFilter,
  type AutocompleteProps,
  type InputProps,
  type MenuItemProps,
  type MenuProps,
  type MenuSectionProps,
  type SeparatorProps,
} from "react-aria-components"

import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../_parts/rail-dialog/index.js"
import {
  InputGroup,
  InputGroupAddon,
} from "../_parts/rail-input-group/index.js"
function Command({
  className,
  dir,
  style,
  ...props
}: Omit<AutocompleteProps, "className" | "style"> & {
  className?: string
  dir?: React.HTMLAttributes<HTMLDivElement>["dir"]
  style?: React.CSSProperties
}) {
  const { contains } = useFilter({ sensitivity: "base" })
  return (
    <div
      data-slot="command"
      dir={dir}
      className={cn(
        "bg-(--color-overlay-surface) text-(--color-ink-primary) rounded-(--radius-control)! p-(--spacing-xs) flex size-full flex-col overflow-hidden",
        className
      )}
      style={style}
    >
      <Autocomplete {...props} filter={props.filter || contains}>
        {props.children}
      </Autocomplete>
    </div>
  )
}

function CommandDialog({
  title = "Command Palette",
  description = "Search for a command to run...",
  children,
  open,
  onOpenChange,
  className,
  showCloseButton = false,
  ...props
}: Omit<
  React.ComponentProps<typeof Dialog>,
  "children" | "className" | "isOpen" | "onOpenChange"
> & {
  title?: string
  description?: string
  open?: boolean
  onOpenChange?: (isOpen: boolean) => void
  className?: string
  showCloseButton?: boolean
  children: React.ReactNode
}) {
  return (
    <Dialog
      isOpen={open}
      onOpenChange={onOpenChange}
      className={cn(
        "rounded-(--radius-control)! top-1/3 translate-y-0 overflow-hidden p-0",
        className
      )}
      showCloseButton={showCloseButton}
      isDismissable
      {...props}
    >
      <DialogHeader className="sr-only">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      {children}
    </Dialog>
  )
}

function CommandInput({ className, ...props }: InputProps) {
  return (
    <SearchField
      autoFocus
      aria-label={props.placeholder || "Search"}
      data-slot="command-input-wrapper"
      className="p-(--spacing-xs) pb-0"
    >
      <InputGroup className="bg-(--color-line-strong)/30 border-(--color-line-strong)/30 h-(--spacing-2xl)! rounded-(--radius-control)! shadow-(--ui-elevation-none)! *:data-[slot=input-group-addon]:pl-(--spacing-sm)!">
        <Input
          {...props}
          data-slot="command-input"
          className={cn(
            "w-full text-(length:--text-sm) focus-visible:outline-solid focus-visible:outline-(length:--ui-border-focus) focus-visible:outline-offset-(--ui-focus-offset) focus-visible:outline-(--color-focus-ring) disabled:cursor-not-allowed disabled:opacity-(--ui-alpha-disabled) [&::-webkit-search-cancel-button]:hidden",
            className
          )}
        />
        <InputGroupAddon>
          <LibraryIcon asset="assets.icon-search" decorative className="size-(--spacing-lg) shrink-0 opacity-(--ui-alpha-disabled)" />
        </InputGroupAddon>
      </InputGroup>
    </SearchField>
  )
}

function CommandList<T extends object>({ className, ...props }: MenuProps<T>) {
  return (
    <Menu
      {...props}
      data-slot="command-list"
      className={cn(
        "no-scrollbar max-h-(--ui-width-notice-max) scroll-py-1 focus-visible:outline-solid focus-visible:outline-(length:--ui-border-focus) focus-visible:outline-offset-(--ui-focus-offset) focus-visible:outline-(--color-focus-ring) overflow-x-hidden overflow-y-auto",
        className
      )}
    />
  )
}

function CommandEmpty({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="command-empty"
      className={cn("py-(--spacing-xl) text-center text-(length:--text-sm)", className)}
      {...props}
    />
  )
}

function CommandGroup<T extends object>({
  className,
  children,
  items,
  heading,
  ...props
}: MenuSectionProps<T> & { heading?: string }) {
  return (
    <MenuSection
      data-slot="command-group"
      className={cn("text-(--color-ink-primary) **:[[cmdk-group-heading]]:text-(--color-ink-muted) overflow-hidden p-(--spacing-xs) **:[[cmdk-group-heading]]:px-(--spacing-sm) **:[[cmdk-group-heading]]:py-(--spacing-sm) **:[[cmdk-group-heading]]:text-(length:--text-xs) **:[[cmdk-group-heading]]:font-(weight:--font-weight-medium)", className)}
      {...props}
    >
      {heading && <Header cmdk-group-heading="">{heading}</Header>}
      <Collection items={items}>{children}</Collection>
    </MenuSection>
  )
}

function CommandSeparator({ className, ...props }: SeparatorProps) {
  return (
    <Separator
      data-slot="command-separator"
      className={cn("bg-(--color-line-base) -mx-(--spacing-xs) h-(--ui-border-hairline)", className)}
      {...props}
    />
  )
}

function CommandItem<T extends object>({
  className,
  children,
  textValue,
  ...props
}: MenuItemProps<T>) {
  return (
    <MenuItem
      {...props}
      data-slot="command-item"
      className={cn(
        "data-selected:bg-(--color-surface-sunken) data-selected:text-(--color-ink-primary) data-selected:*:[svg]:text-(--color-ink-primary) relative flex cursor-default items-center gap-(--spacing-sm) rounded-(--radius-control) px-(--spacing-sm) py-(--spacing-sm) text-(length:--text-sm) focus-visible:outline-solid focus-visible:outline-(length:--ui-border-focus) focus-visible:outline-offset-(--ui-focus-offset) focus-visible:outline-(--color-focus-ring) select-none in-data-[slot=dialog-content]:rounded-(--radius-control)! [&_svg:not([class*='size-'])]:size-(--spacing-lg) data-focused:bg-(--color-surface-sunken) data-focused:text-(--color-ink-primary) data-focused:*:[svg]:text-(--color-ink-primary) group/command-item data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-(--ui-alpha-disabled) [&_svg]:pointer-events-none [&_svg]:shrink-0",
        className
      )}
      textValue={
        textValue || (typeof children === "string" ? children : undefined)
      }
    >
      {composeRenderProps(children, (children) => (
        <>
          {children}
          <LibraryIcon asset="assets.icon-check" decorative className="ml-auto opacity-0 group-has-data-[slot=command-shortcut]/command-item:hidden group-data-[checked=true]/command-item:opacity-100" />
        </>
      ))}
    </MenuItem>
  )
}

function CommandShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="command-shortcut"
      className={cn("text-(--color-ink-muted) group-data-selected/command-item:text-(--color-ink-primary) ml-auto text-(length:--text-xs) tracking-(--tracking-label) group-data-focused/command-item:text-(--color-ink-primary)", className)}
      {...props}
    />
  )
}

export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
}
