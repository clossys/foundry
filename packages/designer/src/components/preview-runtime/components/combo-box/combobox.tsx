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
      className={cn("[&_svg:not([class*='size-'])]:size-(--spacing-lg,calc(var(--spacing)*4))", className)}
      {...props}
    >
      {children}
      <LibraryIcon asset="assets.icon-chevron-down" decorative className="text-(--color-ink-muted) size-(--spacing-lg,calc(var(--spacing)*4)) pointer-events-none" />
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
            className="[&_svg:not([class*='size-'])]:size-(--spacing-lg,calc(var(--spacing)*4)) group-has-data-[slot=combobox-clear]/input-group:hidden data-pressed:bg-transparent"
            isDisabled={disabled}
          >
            <LibraryIcon asset="assets.icon-chevron-down" decorative className="text-(--color-ink-muted) size-(--spacing-lg,calc(var(--spacing)*4)) pointer-events-none" />
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
        "bg-(--color-overlay-surface) text-(--color-ink-primary) data-entering:library-enter data-exiting:library-exit data-exiting:library-fade data-entering:library-fade data-exiting:library-zoom data-entering:library-zoom data-[placement=bottom]:library-slide-top data-[placement=left]:library-slide-right data-[placement=right]:library-slide-left data-[placement=top]:library-slide-bottom ring-(--color-ink-primary)/10 *:data-[slot=input-group]:bg-(--color-line-strong)/30 *:data-[slot=input-group]:border-(--color-line-strong)/30 max-h-[calc(var(--spacing-6xl)*2)] min-w-[var(--spacing-6xl)] overflow-hidden rounded-(--radius-control) shadow-(--ui-elevation-floating) ring-(length:--ui-border-hairline) duration-(--ui-duration-fast,100ms) *:data-[slot=input-group]:m-(--spacing-xs) *:data-[slot=input-group]:mb-0 *:data-[slot=input-group]:h-(--spacing-2xl,calc(var(--spacing)*8)) *:data-[slot=input-group]:shadow-(--ui-elevation-none) animate-none! relative bg-(--color-overlay-surface)/70 before:pointer-events-none before:absolute before:inset-0 before:-z-1 before:rounded-[inherit] before:backdrop-blur-2xl before:backdrop-saturate-150 **:data-[slot$=-item]:focus:bg-(--color-ink-primary)/10 **:data-[slot$=-item]:data-highlighted:bg-(--color-ink-primary)/10 **:data-[slot$=-separator]:bg-(--color-ink-primary)/5 **:data-[slot$=-trigger]:focus:bg-(--color-ink-primary)/10 **:data-[slot$=-trigger]:aria-expanded:bg-(--color-ink-primary)/10! **:data-[variant=destructive]:focus:bg-(--color-ink-primary)/10! **:data-[variant=destructive]:text-(--color-ink-primary)! **:data-[variant=destructive]:**:text-(--color-ink-primary)! **:data-[slot$=-item]:data-focused:bg-(--color-ink-primary)/10 relative isolate z-(--ui-z-modal,50) w-(--trigger-width) origin-(--trigger-anchor-point)",
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
        "no-scrollbar max-h-[min(calc(var(--spacing-6xl)*2-var(--spacing-2xl)),calc(var(--available-height)-var(--spacing-2xl)))] scroll-py-1 overflow-y-auto p-(--spacing-xs) data-empty:p-0 group/combobox-content max-h-[inherit] overflow-y-auto overscroll-contain",
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
        "data-highlighted:bg-(--color-surface-selected) data-highlighted:text-(--color-ink-primary) not-data-[variant=destructive]:data-highlighted:**:text-(--color-ink-primary) gap-(--spacing-sm) rounded-(--radius-control) py-(--spacing-xs) pr-(--spacing-2xl) pl-(--spacing-sm) text-(length:--text-body) [&_svg:not([class*='size-'])]:size-(--spacing-lg,calc(var(--spacing)*4)) data-focused:bg-(--color-surface-selected) data-focused:text-(--color-ink-primary) not-data-[variant=destructive]:data-focused:**:text-(--color-ink-primary) relative flex w-full cursor-default items-center outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-(--ui-alpha-disabled,50%) [&_svg]:pointer-events-none [&_svg]:shrink-0",
        className
      )}
      {...props}
    >
      {composeRenderProps(children, (children, { isSelected }) => (
        <>
          {children}
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
      className={cn("text-(--color-ink-muted) px-(--spacing-sm) py-(--spacing-sm) text-(length:--text-caption) font-(family-name:--font-body)", className)}
      {...props}
    />
  )
}

function ComboboxEmpty({ className, ...props }: ReactComponentProps<"div">) {
  return (
    <div
      data-slot="combobox-empty"
      className={cn("text-(--color-ink-muted) hidden w-full justify-center py-(--spacing-sm) text-center text-(length:--text-body) group-data-empty/combobox-content:flex", className)}
      {...props}
    />
  )
}

function ComboboxSeparator({ className, ...props }: SeparatorProps) {
  return (
    <SeparatorPrimitive
      data-slot="combobox-separator"
      className={cn("bg-(--color-line-base) -mx-(--spacing-xs) my-(--spacing-xs) h-(--ui-border-hairline)", className)}
      {...props}
    />
  )
}

function ComboboxChips({ children, className, ...props }: GroupProps) {
  return (
    <Group
      data-slot="combobox-chips"
      className={cn("dark:bg-(--color-line-strong)/30 border-(--color-line-strong) focus-within:border-(--color-focus-ring) focus-within:outline-solid focus-within:outline-(length:--ui-border-focus,3px) focus-within:outline-offset-(--ui-focus-offset) focus-within:outline-(--color-focus-ring) has-aria-invalid:outline-solid has-aria-invalid:outline-(length:--ui-border-focus,3px) has-aria-invalid:outline-offset-(--ui-focus-offset) has-aria-invalid:outline-(--color-status-danger) dark:has-aria-invalid:ring-(--color-status-danger)/40 has-aria-invalid:border-(--color-status-danger) dark:has-aria-invalid:border-(--color-status-danger)/50 flex min-h-(--spacing-2xl) flex-wrap items-center gap-(--spacing-xs) rounded-(--radius-control) border-(length:--ui-border-hairline,1px) bg-transparent bg-clip-padding px-(--spacing-md) py-(--spacing-xs) text-(length:--text-body) transition-colors duration-(--ui-duration-default) ease-(--default-transition-timing-function) focus-within:outline-solid focus-within:outline-(length:--ui-border-focus,3px) focus-within:outline-offset-(--ui-focus-offset) focus-within:outline-(--color-focus-ring) has-aria-invalid:outline-solid has-aria-invalid:outline-(length:--ui-border-focus,3px) has-aria-invalid:outline-offset-(--ui-focus-offset) has-aria-invalid:outline-(--color-status-danger) has-data-[slot=combobox-chip]:px-(--spacing-xs)", className)}
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
        "bg-(--color-surface-sunken) text-(--color-ink-primary) flex h-(--spacing-xl) w-fit items-center justify-center gap-(--spacing-xs) rounded-(--radius-control) px-(--spacing-sm) text-(length:--text-caption) font-(weight:--font-weight-medium) whitespace-nowrap has-data-[slot=combobox-chip-remove]:pr-0 has-disabled:pointer-events-none has-disabled:cursor-not-allowed has-disabled:opacity-(--ui-alpha-disabled,50%)",
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
          className="-ml-(--spacing-xs) opacity-(--ui-alpha-disabled,50%) hover:opacity-100"
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
        "min-w-(--spacing-4xl) flex-1 focus-visible:outline-solid focus-visible:outline-(length:--ui-border-focus,3px) focus-visible:outline-offset-(--ui-focus-offset) focus-visible:outline-(--color-focus-ring)",
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
