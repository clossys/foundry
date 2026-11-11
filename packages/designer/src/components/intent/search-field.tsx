"use client"

import { Search as MagnifyingGlassIcon, X as XMarkIcon } from "lucide-react"
import {
  Button,
  type InputProps,
  SearchField as SearchFieldPrimitive,
  type SearchFieldProps,
} from "react-aria-components"
import { twJoin } from "tailwind-merge"
import { fieldStyles } from "./field.js"
import { cx } from "./primitive.js"
import { Input, InputGroup } from "./input.js"

/**
 * Foundry adaptation: upstream defaults `aria-label` to "Search". With a visible
 * `<Label>` child react-aria then names the input "Search <label>", so the default
 * is dropped; every caller names the field with a Label child or an explicit
 * `aria-label` (pinned by `accessible-name-callsites.test.ts`).
 */
export function SearchField({ className, ...props }: SearchFieldProps) {
  return (
    <SearchFieldPrimitive
      data-slot="control"
      className={cx(fieldStyles({ className: "group/search-field" }), className)}
      {...props}
    />
  )
}

export function SearchInput(props: InputProps) {
  return (
    <InputGroup className="[--input-gutter-end:--spacing(8)]">
      <MagnifyingGlassIcon data-slot="icon" className="in-disabled:opacity-50" />
      <Input {...props} />
      <Button
        className={twJoin(
          "grid place-content-center pressed:text-foreground text-muted-foreground hover:text-foreground group-empty/search-field:invisible",
          "px-3 py-2 sm:px-2.5 sm:py-1.5 sm:text-sm/5"
        )}
      >
        <XMarkIcon className="size-5 sm:size-4" />
      </Button>
    </InputGroup>
  )
}

export type { SearchFieldProps }
