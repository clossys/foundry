"use client"

import { Icon as LibraryIcon } from "../icon/index.js"
import * as React from "react"
import { cn, resolveRailCopy, RAIL_COPY_REFS, type CopyResolver } from "../_parts/rail-utils/index.js"
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
        "bg-(--popover) text-(--foreground) rounded-(--radius)! p-[calc(var(--spacing,0.25rem)*1)] flex size-full flex-col overflow-hidden",
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
  copyResolver,
  title,
  description,
  children,
  open,
  onOpenChange,
  className,
  /** @default false */
  showCloseButton = false,
  ...props
}: (Omit<
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
}) & { copyResolver?: CopyResolver }) {
  return (
    <Dialog
      copyResolver={copyResolver}
      isOpen={open}
      onOpenChange={onOpenChange}
      className={cn(
        "rounded-(--radius)! top-1/3 translate-y-0 overflow-hidden p-0",
        className
      )}
      showCloseButton={showCloseButton}
      isDismissable
      {...props}
    >
      <DialogHeader className="sr-only">
        <DialogTitle>{title ?? resolveRailCopy(copyResolver, RAIL_COPY_REFS["command.title"])}</DialogTitle>
        <DialogDescription>{description ?? resolveRailCopy(copyResolver, RAIL_COPY_REFS["command.description"])}</DialogDescription>
      </DialogHeader>
      {children}
    </Dialog>
  )
}

function CommandInput({
  copyResolver, className, ...props }: (InputProps) & { copyResolver?: CopyResolver }) {
  return (
    <SearchField
      autoFocus
      aria-label={props.placeholder || resolveRailCopy(copyResolver, RAIL_COPY_REFS["command.search"])}
      data-slot="command-input-wrapper"
      className="p-[calc(var(--spacing,0.25rem)*1)] pb-0"
    >
      <InputGroup className="bg-(--input)/30 border-(--input)/30 h-[calc(var(--spacing,0.25rem)*8)]! rounded-(--radius)! shadow-none! *:data-[slot=input-group-addon]:ps-[calc(var(--spacing,0.25rem)*2)]!">
        <Input
          {...props}
          data-slot="command-input"
          className={cn(
            "w-full text-(length:--text-sm) focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ring) disabled:cursor-not-allowed disabled:opacity-50 [&::-webkit-search-cancel-button]:hidden",
            className
          )}
        />
        <InputGroupAddon>
          <LibraryIcon asset="assets.icon-search" decorative className="size-[calc(var(--spacing,0.25rem)*4)] shrink-0 opacity-50" />
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
        "no-scrollbar max-h-72 scroll-py-1 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ring) overflow-x-hidden overflow-y-auto",
        className
      )}
    />
  )
}

function CommandEmpty({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="command-empty"
      className={cn("py-[calc(var(--spacing,0.25rem)*6)] text-center text-(length:--text-sm)", className)}
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
      className={cn("text-(--foreground) **:[[cmdk-group-heading]]:text-(--muted-foreground) overflow-hidden p-[calc(var(--spacing,0.25rem)*1)] **:[[cmdk-group-heading]]:px-[calc(var(--spacing,0.25rem)*2)] **:[[cmdk-group-heading]]:py-[calc(var(--spacing,0.25rem)*2)] **:[[cmdk-group-heading]]:text-(length:--text-xs) **:[[cmdk-group-heading]]:font-medium", className)}
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
      className={cn("bg-(--border) -mx-[calc(var(--spacing,0.25rem)*1)] h-px", className)}
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
        "data-selected:bg-(--muted) data-selected:text-(--foreground) data-selected:*:[svg]:text-(--foreground) relative flex cursor-default items-center gap-[calc(var(--spacing,0.25rem)*2)] rounded-(--radius) px-[calc(var(--spacing,0.25rem)*2)] py-[calc(var(--spacing,0.25rem)*2)] text-(length:--text-sm) focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ring) select-none in-data-[slot=dialog-content]:rounded-(--radius)! [&_svg:not([class*='size-'])]:size-[calc(var(--spacing,0.25rem)*4)] data-focused:bg-(--muted) data-focused:text-(--foreground) data-focused:*:[svg]:text-(--foreground) group/command-item data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
        className
      )}
      textValue={
        textValue || (typeof children === "string" ? children : undefined)
      }
    >
      {composeRenderProps(children, (children) => (
        <>
          {children}
          <LibraryIcon asset="assets.icon-check" decorative className="ms-auto opacity-0 group-has-data-[slot=command-shortcut]/command-item:hidden group-data-[checked=true]/command-item:opacity-100" />
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
      className={cn("text-(--muted-foreground) group-data-selected/command-item:text-(--foreground) ms-auto text-(length:--text-xs) tracking-widest group-data-focused/command-item:text-(--foreground)", className)}
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
