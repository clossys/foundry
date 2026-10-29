import type * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "../../_parts/rail-u1-utils/index.js"

import { Separator } from "../../_parts/rail-u1-separator/index.js"

const buttonGroupVariants = cva(
  "has-[>[data-slot=button-group]]:gap-(--spacing-sm) has-[select[aria-hidden=true]:last-child]:[&>[data-slot=select-trigger]:last-of-type]:rounded-e-(--radius-control) flex w-fit items-stretch *:focus-visible:relative *:focus-visible:z-(--ui-z-sticky) [&>[data-slot=select-trigger]:not([class*='w-'])]:w-fit [&>input]:flex-1",
  {
    variants: {
      orientation: {
        horizontal:
          "[&>[data-slot]:not(:has(~[data-slot]))]:rounded-e-(--radius-control)! **:data-slot:rounded-e-none [&_[data-slot]~[data-slot]]:rounded-s-none [&_[data-slot]~[data-slot]]:border-s-0",
        vertical:
          "[&>[data-slot]:not(:has(~[data-slot]))]:rounded-b-(--radius-control)! flex-col **:data-slot:rounded-b-none [&_[data-slot]~[data-slot]]:rounded-t-none [&_[data-slot]~[data-slot]]:border-t-0",
      },
    },
    defaultVariants: {
      orientation: "horizontal",
    },
  }
)

function ButtonGroup({
  className,
  orientation,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof buttonGroupVariants>) {
  return (
    <div
      role="group"
      data-slot="button-group"
      data-orientation={orientation}
      className={cn(buttonGroupVariants({ orientation }), className)}
      {...props}
    />
  )
}

function ButtonGroupText({
  className,
  render,
  ...props
}: React.ComponentProps<"div"> & {
  render?: (props: React.HTMLAttributes<HTMLElement>) => React.ReactNode
}) {
  if (render) {
    const renderProps = {
      "data-slot": "button-group-text",
      className: cn(
        "bg-(--color-surface-sunken) gap-(--spacing-sm) rounded-(--radius-control) border-(length:--ui-border-hairline) px-(--spacing-md) text-(length:--text-sm) font-(weight:--font-weight-medium) [&_svg:not([class*='size-'])]:size-(--spacing-lg) flex items-center [&_svg]:pointer-events-none",
        className
      ),
      ...props,
    }

    return render(renderProps)
  }

  return (
    <div
      data-slot="button-group-text"
      className={cn(
        "bg-(--color-surface-sunken) gap-(--spacing-sm) rounded-(--radius-control) border-(length:--ui-border-hairline) px-(--spacing-md) text-(length:--text-sm) font-(weight:--font-weight-medium) [&_svg:not([class*='size-'])]:size-(--spacing-lg) flex items-center [&_svg]:pointer-events-none",
        className
      )}
      {...props}
    />
  )
}

function ButtonGroupSeparator({
  className,
  orientation = "vertical",
  ...props
}: React.ComponentProps<typeof Separator>) {
  return (
    <Separator
      data-slot="button-group-separator"
      orientation={orientation}
      className={cn(
        "bg-(--color-line-strong) relative self-stretch data-horizontal:mx-(--spacing-xs) data-horizontal:w-auto data-vertical:my-(--spacing-xs) data-vertical:h-auto",
        className
      )}
      {...props}
    />
  )
}

export {
  ButtonGroup,
  ButtonGroupSeparator,
  ButtonGroupText,
  buttonGroupVariants,
}
