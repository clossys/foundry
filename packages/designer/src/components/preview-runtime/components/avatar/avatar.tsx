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
        "size-[calc(var(--spacing,0.25rem)*8)] rounded-full after:rounded-full data-[size=lg]:size-[calc(var(--spacing,0.25rem)*12)] data-[size=sm]:size-[calc(var(--spacing,0.25rem)*6)] group/avatar relative flex shrink-0 select-none after:absolute after:inset-0 after:border after:border-(--border) after:mix-blend-darken dark:after:mix-blend-lighten",
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
        "bg-(--muted) text-(--muted-foreground) rounded-full flex size-full items-center justify-center text-(length:--text-sm) group-data-[size=sm]/avatar:text-(length:--text-xs) peer-data-[state=error]:flex peer-[*]:hidden",
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
        "bg-(--primary) text-(--primary-foreground) ring-(--background) absolute end-0 bottom-0 z-10 inline-flex items-center justify-center rounded-full bg-blend-color ring-2 select-none",
        "group-data-[size=sm]/avatar:size-[calc(var(--spacing,0.25rem)*2)] group-data-[size=sm]/avatar:[&>svg]:hidden",
        "group-data-[size=default]/avatar:size-[calc(var(--spacing,0.25rem)*3)] group-data-[size=default]/avatar:[&>svg]:size-[calc(var(--spacing,0.25rem)*2)]",
        "group-data-[size=lg]/avatar:size-[calc(var(--spacing,0.25rem)*3)] group-data-[size=lg]/avatar:[&>svg]:size-[calc(var(--spacing,0.25rem)*2)]",
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
        "group/avatar-group flex -space-x-[calc(var(--spacing,0.25rem)*2)] *:data-[slot=avatar]:ring-2 *:data-[slot=avatar]:ring-(--background)",
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
        "bg-(--muted) text-(--muted-foreground) size-[calc(var(--spacing,0.25rem)*8)] rounded-full text-(length:--text-sm) group-has-data-[size=lg]/avatar-group:size-[calc(var(--spacing,0.25rem)*12)] group-has-data-[size=sm]/avatar-group:size-[calc(var(--spacing,0.25rem)*6)] [&>svg]:size-[calc(var(--spacing,0.25rem)*4)] group-has-data-[size=lg]/avatar-group:[&>svg]:size-[calc(var(--spacing,0.25rem)*6)] group-has-data-[size=sm]/avatar-group:[&>svg]:size-[calc(var(--spacing,0.25rem)*3)] relative flex shrink-0 items-center justify-center ring-2 ring-(--background)",
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
