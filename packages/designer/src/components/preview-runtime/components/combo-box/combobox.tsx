"use client"

import { Icon as LibraryIcon } from "../icon/index.js"
import type { ComponentProps as ReactComponentProps, ReactNode as ReactNode, RefObject as ReactRefObject } from "react"
import { useContext as ReactUseContext, useRef as ReactUseRef } from "react"
import { cn } from "../_parts/utils/index.js"
import {
  Button as ButtonPrimitive,
  Collection,
  ComboBox as ComboBoxPrimitive,
  ComboBoxStateContext,
  ComboBoxValue as ComboBoxValuePrimitive,
  composeRenderProps,
  Group,
  Header as HeaderPrimitive,
  Input as InputPrimitive,
  ListBoxItem as ListBoxItemPrimitive,
  ListBox as ListBoxPrimitive,
  ListBoxSection as ListBoxSectionPrimitive,
  Popover as PopoverPrimitive,
  Separator as SeparatorPrimitive,
  TagGroup as TagGroupPrimitive,
  TagList as TagListPrimitive,
  Tag as TagPrimitive,
  type ButtonProps,
  type ComboBoxValueProps,
  type GroupProps,
  type HeaderProps,
  type InputProps,
  type ListBoxItemProps,
  type ListBoxProps,
  type ListBoxSectionProps,
  type SeparatorProps,
  type TagListProps,
  type TagProps,
} from "react-aria-components"

import { Button } from "../button/index.js"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "../_parts/input-group/index.js"
function ComboboxValue<T>({ ...props }: ComboBoxValueProps<T>) {
  return <ComboBoxValuePrimitive data-slot="combobox-value" {...props} />
}

function ComboboxTrigger({
  className,
  children,
  ...props
}: Omit<ButtonProps, "children"> & {
  children?: ReactNode
}) {
  return (
    <ButtonPrimitive
      data-slot="combobox-trigger"
      className={cn("[&_svg:not([class*='size-'])]:size-[calc(var(--spacing,0.25rem)*4)]", className)}
      {...props}
    >
      {children}
      <LibraryIcon asset="assets.icon-chevron-down" decorative className="text-(--muted-foreground) size-[calc(var(--spacing,0.25rem)*4)] pointer-events-none" />
    </ButtonPrimitive>
  )
}

function ComboboxClear({
  className,
  ...props
}: ReactComponentProps<typeof InputGroupButton>) {
  const state = ReactUseContext(ComboBoxStateContext)
  if (state?.inputValue === "") {
    return null
  }

  return (
    <InputGroupButton
      data-slot="combobox-clear"
      variant="ghost"
      size="icon-xs"
      aria-label="Clear"
      className={cn("", className)}
      onPress={() => {
        state?.setValue(null)
      }}
      slot={null}
      {...props}
    >
      <LibraryIcon asset="assets.icon-close" decorative className="pointer-events-none" />
    </InputGroupButton>
  )
}

function ComboboxInput({
  className,
  children,
  disabled = false,
  showTrigger = true,
  showClear = false,
  ...props
}: ReactComponentProps<"input"> & {
  showTrigger?: boolean
  showClear?: boolean
}) {
  return (
    <InputGroup className={cn("w-auto", className)}>
      <InputGroupInput disabled={disabled} {...props} />
      <InputGroupAddon align="inline-end">
        {showTrigger && (
          <InputGroupButton
            size="icon-xs"
            variant="ghost"
            data-slot="combobox-trigger"
            className="[&_svg:not([class*='size-'])]:size-[calc(var(--spacing,0.25rem)*4)] group-has-data-[slot=combobox-clear]/input-group:hidden data-pressed:bg-transparent"
            isDisabled={disabled}
          >
            <LibraryIcon asset="assets.icon-chevron-down" decorative className="text-(--muted-foreground) size-[calc(var(--spacing,0.25rem)*4)] pointer-events-none" />
          </InputGroupButton>
        )}
        {showClear && <ComboboxClear isDisabled={disabled} />}
      </InputGroupAddon>
      {children}
    </InputGroup>
  )
}

function ComboboxContent({
  className,
  placement = "bottom",
  offset = 6,
  crossOffset = 0,
  anchor,
  ...props
}: Omit<
  ReactComponentProps<typeof PopoverPrimitive>,
  "className" | "children"
> & {
  className?: string
  children?: ReactNode
  anchor?: ReactRefObject<HTMLDivElement | null>
}) {
  return (
    <PopoverPrimitive
      data-slot="combobox-content"
      placement={placement}
      offset={offset}
      crossOffset={crossOffset}
      triggerRef={anchor}
      className={cn(
        "bg-(--popover) text-(--foreground) data-entering:library-enter data-exiting:library-exit data-exiting:library-fade data-entering:library-fade data-exiting:library-zoom data-entering:library-zoom data-[placement=bottom]:library-slide-top data-[placement=left]:library-slide-right data-[placement=right]:library-slide-left data-[placement=top]:library-slide-bottom ring-(--foreground)/10 *:data-[slot=input-group]:bg-(--input)/30 *:data-[slot=input-group]:border-(--input)/30 max-h-[calc(calc(var(--spacing,0.25rem)*32)*2)] min-w-[calc(var(--spacing,0.25rem)*32)] overflow-hidden rounded-(--radius) shadow-(--shadow-md) ring-1 duration-100 *:data-[slot=input-group]:m-[calc(var(--spacing,0.25rem)*1)] *:data-[slot=input-group]:mb-0 *:data-[slot=input-group]:h-[calc(var(--spacing,0.25rem)*8)] *:data-[slot=input-group]:shadow-none animate-none! relative bg-(--popover)/70 before:pointer-events-none before:absolute before:inset-0 before:-z-1 before:rounded-[inherit] before:backdrop-blur-2xl before:backdrop-saturate-150 **:data-[slot$=-item]:focus:bg-(--foreground)/10 **:data-[slot$=-item]:data-highlighted:bg-(--foreground)/10 **:data-[slot$=-separator]:bg-(--foreground)/5 **:data-[slot$=-trigger]:focus:bg-(--foreground)/10 **:data-[slot$=-trigger]:aria-expanded:bg-(--foreground)/10! **:data-[variant=destructive]:focus:bg-(--foreground)/10! **:data-[variant=destructive]:text-(--foreground)! **:data-[variant=destructive]:**:text-(--foreground)! **:data-[slot$=-item]:data-focused:bg-(--foreground)/10 relative isolate z-50 w-(--trigger-width) origin-(--trigger-anchor-point)",
        className
      )}
      {...props}
    />
  )
}

function ComboboxList<T extends object>({
  className,
  ...props
}: ListBoxProps<T>) {
  return (
    <ListBoxPrimitive
      data-slot="combobox-list"
      className={cn(
        "no-scrollbar max-h-[min(calc(calc(var(--spacing,0.25rem)*32)*2-calc(var(--spacing,0.25rem)*8)),calc(var(--available-height,100dvh)-calc(var(--spacing,0.25rem)*8)))] scroll-py-1 overflow-y-auto p-[calc(var(--spacing,0.25rem)*1)] data-empty:p-0 group/combobox-content max-h-[inherit] overflow-y-auto overscroll-contain",
        className
      )}
      {...props}
    />
  )
}

function ComboboxItem<T extends object>({
  className,
  children,
  ...props
}: ListBoxItemProps<T>) {
  return (
    <ListBoxItemPrimitive
      data-slot="combobox-item"
      textValue={typeof children === "string" ? children : undefined}
      className={cn(
        "data-highlighted:bg-(--accent) data-highlighted:text-(--foreground) not-data-[variant=destructive]:data-highlighted:**:text-(--foreground) gap-[calc(var(--spacing,0.25rem)*2)] rounded-(--radius) py-[calc(var(--spacing,0.25rem)*1)] pe-[calc(var(--spacing,0.25rem)*8)] ps-[calc(var(--spacing,0.25rem)*2)] text-(length:--text-sm) [&_svg:not([class*='size-'])]:size-[calc(var(--spacing,0.25rem)*4)] data-focused:bg-(--accent) data-focused:text-(--foreground) not-data-[variant=destructive]:data-focused:**:text-(--foreground) relative flex w-full cursor-default items-center outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
        className
      )}
      {...props}
    >
      {composeRenderProps(children, (children, { isSelected }) => (
        <>
          {children}
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

function ComboboxGroup<T extends object>({
  className,
  ...props
}: ListBoxSectionProps<T>) {
  return (
    <ListBoxSectionPrimitive
      data-slot="combobox-group"
      className={cn("", className)}
      {...props}
    />
  )
}

function ComboboxLabel({ className, ...props }: HeaderProps) {
  return (
    <HeaderPrimitive
      data-slot="combobox-label"
      className={cn("text-(--muted-foreground) px-[calc(var(--spacing,0.25rem)*2)] py-[calc(var(--spacing,0.25rem)*2)] text-(length:--text-xs) font-(family-name:--font-sans)", className)}
      {...props}
    />
  )
}

function ComboboxEmpty({ className, ...props }: ReactComponentProps<"div">) {
  return (
    <div
      data-slot="combobox-empty"
      className={cn("text-(--muted-foreground) hidden w-full justify-center py-[calc(var(--spacing,0.25rem)*2)] text-center text-(length:--text-sm) group-data-empty/combobox-content:flex", className)}
      {...props}
    />
  )
}

function ComboboxSeparator({ className, ...props }: SeparatorProps) {
  return (
    <SeparatorPrimitive
      data-slot="combobox-separator"
      className={cn("bg-(--border) -mx-[calc(var(--spacing,0.25rem)*1)] my-[calc(var(--spacing,0.25rem)*1)] h-px", className)}
      {...props}
    />
  )
}

function ComboboxChips({ children, className, ...props }: GroupProps) {
  return (
    <Group
      data-slot="combobox-chips"
      className={cn("dark:bg-(--input)/30 border-(--input) focus-within:border-(--ring) focus-within:outline-solid focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-(--ring) has-aria-invalid:outline-solid has-aria-invalid:outline-2 has-aria-invalid:outline-offset-2 has-aria-invalid:outline-(--destructive) dark:has-aria-invalid:ring-(--destructive)/40 has-aria-invalid:border-(--destructive) dark:has-aria-invalid:border-(--destructive)/50 flex min-h-[calc(var(--spacing,0.25rem)*8)] flex-wrap items-center gap-[calc(var(--spacing,0.25rem)*1)] rounded-(--radius) border bg-transparent bg-clip-padding px-[calc(var(--spacing,0.25rem)*3)] py-[calc(var(--spacing,0.25rem)*1)] text-(length:--text-sm) transition-colors focus-within:outline-solid focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-(--ring) has-aria-invalid:outline-solid has-aria-invalid:outline-2 has-aria-invalid:outline-offset-2 has-aria-invalid:outline-(--destructive) has-data-[slot=combobox-chip]:px-[calc(var(--spacing,0.25rem)*1)]", className)}
      {...props}
    >
      {children}
    </Group>
  )
}

function ComboboxChipList<T extends object>({
  className,
  ...props
}: Omit<TagListProps<T>, "className" | "items"> & {
  className?: string
}) {
  return (
    <ComboBoxValuePrimitive<T> className="contents">
      {({ selectedItems, state }) => (
        <TagGroupPrimitive
          data-slot="combobox-chip-list"
          className={cn("contents", className)}
          onRemove={(keys) => {
            if (Array.isArray(state.value)) {
              state.setValue(state.value.filter((k) => !keys.has(k)))
            }
          }}
        >
          <TagListPrimitive
            className="contents"
            items={selectedItems.filter((item) => item != null)}
            {...props}
          />
        </TagGroupPrimitive>
      )}
    </ComboBoxValuePrimitive>
  )
}

function ComboboxChip({
  className,
  children,
  showRemove = true,
  ...props
}: Omit<TagProps, "children"> & {
  showRemove?: boolean
  children?: ReactNode
}) {
  return (
    <TagPrimitive
      data-slot="combobox-chip"
      className={cn(
        "bg-(--muted) text-(--foreground) flex h-[calc(var(--spacing,0.25rem)*6)] w-fit items-center justify-center gap-[calc(var(--spacing,0.25rem)*1)] rounded-(--radius) px-[calc(var(--spacing,0.25rem)*2)] text-(length:--text-xs) font-medium whitespace-nowrap has-data-[slot=combobox-chip-remove]:pe-0 has-disabled:pointer-events-none has-disabled:cursor-not-allowed has-disabled:opacity-50",
        className
      )}
      {...props}
    >
      {children}
      {showRemove && (
        <Button
          slot="remove"
          variant="ghost"
          shape="icon-only"
          className="-ml-[calc(var(--spacing,0.25rem)*1)] opacity-50 hover:opacity-100"
          data-slot="combobox-chip-remove"
        >
          <LibraryIcon asset="assets.icon-close" decorative className="pointer-events-none" />
        </Button>
      )}
    </TagPrimitive>
  )
}

function ComboboxChipsInput({ className, ...props }: InputProps) {
  const state = ReactUseContext(ComboBoxStateContext)
  return (
    <InputPrimitive
      data-slot="combobox-chip-input"
      className={cn(
        "min-w-[calc(var(--spacing,0.25rem)*16)] flex-1 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ring)",
        className
      )}
      onKeyDown={(e) => {
        if (
          e.key === "Backspace" &&
          e.currentTarget.value === "" &&
          Array.isArray(state?.value) &&
          state.value.length > 0
        ) {
          e.preventDefault()
          state.setValue(state.value.slice(0, -1))
        }
      }}
      {...props}
    />
  )
}

function useComboboxAnchor() {
  return ReactUseRef<HTMLDivElement | null>(null)
}

export {
  ComboBoxPrimitive as Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxGroup,
  ComboboxLabel,
  Collection as ComboboxCollection,
  ComboboxEmpty,
  ComboboxSeparator,
  ComboboxChips,
  ComboboxChip,
  ComboboxChipList,
  ComboboxChipsInput,
  ComboboxTrigger,
  ComboboxValue,
  useComboboxAnchor,
}
