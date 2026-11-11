"use client"

import { CircleX as XCircleIcon } from "lucide-react"
import {
  Button,
  Tag as PrimitiveTag,
  TagGroup as PrimitiveTagGroup,
  TagList as PrimitiveTagList,
  type TagGroupProps,
  type TagListProps,
  type TagProps,
} from "react-aria-components"
import { cn } from "../preview-runtime/components/_parts/utils/index.js"
import { cx } from "./primitive.js"

export function TagGroup({ className, ...props }: TagGroupProps) {
  return (
    <PrimitiveTagGroup
      data-slot="control"
      className={cn("flex flex-col gap-y-1 *:data-[slot=label]:font-medium", className)}
      {...props}
    />
  )
}

export function TagList<T extends object>({ className, ...props }: TagListProps<T>) {
  return <PrimitiveTagList className={cx("flex flex-wrap gap-1", className)} {...props} />
}

/** Foundry adaptation: optional host `removeLabel` names the remove button (DataTable `remove*Message` copy); without it React Aria's localized "Remove" label applies. */
export interface TagItemProps extends TagProps {
  removeLabel?: string
}

export function Tag({ children, className, removeLabel, ...props }: TagItemProps) {
  const textValue = typeof children === "string" ? children : undefined

  return (
    <PrimitiveTag
      textValue={textValue}
      className={cx(
        "inset-ring inset-ring-input outline-hidden dark:bg-input/30",
        "inline-flex items-center gap-x-1.5 py-0.5 font-medium text-xs/5 forced-colors:outline",
        "*:[svg]:size-3 *:[svg]:shrink-0",
        "cursor-default rounded-full px-2",
        "selected:inset-ring-ring/70 selected:bg-accent selected:text-accent-foreground",
        "disabled:opacity-50 disabled:forced-colors:text-[GrayText]",
        props.href && "cursor-pointer hover:inset-ring-muted-foreground",
        className
      )}
      {...props}
    >
      {({ allowsRemoving }) => (
        <>
          {children}
          {allowsRemoving && (
            <Button
              slot="remove"
              className=""
              {...(removeLabel ? { "aria-label": removeLabel, "aria-labelledby": "" } : {})}
            >
              <XCircleIcon className="-me-1 size-4" />
            </Button>
          )}
        </>
      )}
    </PrimitiveTag>
  )
}

export type { TagGroupProps, TagListProps, TagProps }
