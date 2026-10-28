"use client"

import * as React from "react"
import { cn } from "../_parts/utils/index.js"

function Avatar({
  className,
  size = "default",
  ...props
}: React.ComponentProps<"div"> & {
  size?: "default" | "sm" | "lg"
}) {
  return (
    <div
      data-slot="avatar"
      data-size={size}
      className={cn(
        "size-(--spacing-2xl) rounded-full after:rounded-full data-[size=lg]:size-[var(--spacing-3xl)] data-[size=sm]:size-(--spacing-xl) group/avatar relative flex shrink-0 select-none after:absolute after:inset-0 after:border-(length:--ui-border-hairline,1px) after:border-(--color-line-base) after:mix-blend-darken dark:after:mix-blend-lighten",
        className
      )}
      {...props}
    />
  )
}

type ImageState = "loading" | "loaded" | "error"

function AvatarImage({ className, ...props }: React.ComponentProps<"img">) {
  const [state, setState] = React.useState<ImageState>(
    props.src ? "loading" : "error"
  )
  return (
    <img
      data-slot="avatar-image"
      alt={props.alt || ""}
      data-state={state}
      onLoad={() => setState("loaded")}
      onError={() => setState("error")}
      className={cn(
        "rounded-full peer aspect-square size-full object-cover data-[state=error]:hidden",
        className
      )}
      {...props}
    />
  )
}

function AvatarFallback({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="avatar-fallback"
      className={cn(
        "bg-(--color-surface-sunken) text-(--color-ink-muted) rounded-full flex size-full items-center justify-center text-(length:--text-sm) group-data-[size=sm]/avatar:text-(length:--text-xs) peer-data-[state=error]:flex peer-[*]:hidden",
        className
      )}
      {...props}
    />
  )
}

function AvatarBadge({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="avatar-badge"
      className={cn(
        "bg-(--color-action) text-(--color-ink-on-action) ring-(--color-surface-base) absolute right-0 bottom-0 z-(--ui-z-sticky) inline-flex items-center justify-center rounded-full bg-blend-color ring-(length:--ui-border-rule) select-none",
        "group-data-[size=sm]/avatar:size-(--spacing-sm) group-data-[size=sm]/avatar:[&>svg]:hidden",
        "group-data-[size=default]/avatar:size-(--spacing-md) group-data-[size=default]/avatar:[&>svg]:size-(--spacing-sm)",
        "group-data-[size=lg]/avatar:size-(--spacing-md) group-data-[size=lg]/avatar:[&>svg]:size-(--spacing-sm)",
        className
      )}
      {...props}
    />
  )
}

function AvatarGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="avatar-group"
      className={cn(
        "group/avatar-group flex -space-x-(--spacing-sm) *:data-[slot=avatar]:ring-(length:--ui-border-rule) *:data-[slot=avatar]:ring-(--color-surface-base)",
        className
      )}
      {...props}
    />
  )
}

function AvatarGroupCount({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="avatar-group-count"
      className={cn(
        "bg-(--color-surface-sunken) text-(--color-ink-muted) size-(--spacing-2xl) rounded-full text-(length:--text-sm) group-has-data-[size=lg]/avatar-group:size-[var(--spacing-3xl)] group-has-data-[size=sm]/avatar-group:size-(--spacing-xl) [&>svg]:size-(--spacing-lg,calc(var(--spacing)*4)) group-has-data-[size=lg]/avatar-group:[&>svg]:size-[var(--spacing-xl)] group-has-data-[size=sm]/avatar-group:[&>svg]:size-(--spacing-md) relative flex shrink-0 items-center justify-center ring-(length:--ui-border-rule) ring-(--color-surface-base)",
        "",
        className
      )}
      {...props}
    />
  )
}

export {
  Avatar,
  AvatarImage,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarBadge,
}
