"use client"

import * as React from "react"
import { type VariantProps } from "class-variance-authority"
import { controlSizeStyle, controlStateStyle } from "../button-classes.js"
import { cn } from "../_parts/utils/index.js"
import {
  composeRenderProps,
  ToggleButtonGroup as ToggleGroupPrimitive,
  ToggleButton as TogglePrimitive,
  type ToggleButtonGroupProps,
} from "react-aria-components"

import { toggleVariants } from "../toggle-button/toggle.js"

const ToggleGroupContext = React.createContext<
  VariantProps<typeof toggleVariants> & {
    spacing?: number
    orientation?: "horizontal" | "vertical"
  }
>({
  size: "default",
  variant: "default",
  spacing: 2,
  orientation: "horizontal",
})

function ToggleGroup({
  className,
  variant,
  size,
  style,
  spacing = 2,
  orientation = "horizontal",
  children,
  ...props
}: Omit<React.ComponentPropsWithRef<typeof ToggleGroupPrimitive>, "children"> &
  VariantProps<typeof toggleVariants> & {
    spacing?: number
    orientation?: "horizontal" | "vertical"
    children?: ToggleButtonGroupProps["children"]
  }) {
  return (
    <ToggleGroupPrimitive
      data-slot="toggle-group"
      data-variant={variant}
      data-size={size}
      data-spacing={spacing}
      orientation={orientation}
      style={
        { ...style, "--gap": `calc(var(--spacing-xs) * ${spacing})` } as React.CSSProperties
      }
      className={composeRenderProps(className, (className) => cn(
        "rounded-(--radius-control) data-[size=sm]:rounded-(--radius-control) group/toggle-group flex w-fit flex-row items-center gap-(--gap) data-[orientation=vertical]:flex-col data-[orientation=vertical]:items-stretch",
        className
      ))}
      {...props}
    >
      {composeRenderProps(children, (children) => <ToggleGroupContext.Provider
        value={{ variant, size, spacing, orientation }}
      >
        {children}
      </ToggleGroupContext.Provider>)}
    </ToggleGroupPrimitive>
  )
}

function ToggleGroupItem({
  className,
  children,
  variant = "default",
  size = "default",
  ...props
}: React.ComponentPropsWithRef<typeof TogglePrimitive> & VariantProps<typeof toggleVariants>) {
  const context = React.useContext(ToggleGroupContext)

  return (
    <TogglePrimitive
      data-slot="toggle-group-item"
      data-variant={context.variant || variant}
      data-size={context.size || size}
      data-spacing={context.spacing}
      className={composeRenderProps(className, (className) => cn(
        "group-data-[spacing=0]/toggle-group:rounded-none group-data-[spacing=0]/toggle-group:px-(--spacing-sm) group-data-[spacing=0]/toggle-group:has-data-[icon=inline-end]:pe-(--spacing-sm) group-data-[spacing=0]/toggle-group:has-data-[icon=inline-start]:ps-(--spacing-sm) group-data-[orientation=horizontal]/toggle-group:data-[spacing=0]:first:rounded-s-(--radius-control) group-data-[orientation=vertical]/toggle-group:data-[spacing=0]:first:rounded-t-(--radius-control) group-data-[orientation=horizontal]/toggle-group:data-[spacing=0]:last:rounded-e-(--radius-control) group-data-[orientation=vertical]/toggle-group:data-[spacing=0]:last:rounded-b-(--radius-control) shrink-0 focus:z-(--ui-z-sticky) focus-visible:z-(--ui-z-sticky) group-data-[orientation=horizontal]/toggle-group:data-[spacing=0]:data-[variant=outline]:border-s-0 group-data-[orientation=vertical]/toggle-group:data-[spacing=0]:data-[variant=outline]:border-t-0 group-data-[orientation=horizontal]/toggle-group:data-[spacing=0]:data-[variant=outline]:first:border-s-(length:--ui-border-hairline) group-data-[orientation=vertical]/toggle-group:data-[spacing=0]:data-[variant=outline]:first:border-t-(length:--ui-border-hairline)",
        toggleVariants({
          variant: context.variant || variant,
          size: context.size || size,
        }),
        className
      ))}
      {...props}
    >
      {children}
    </TogglePrimitive>
  )
}

/** Local token styling; group selection stays inside the adopted peer. */
function ControlToggleGroupItem({ style, size, ...props }: React.ComponentPropsWithRef<typeof ToggleGroupItem>) {
  const context = React.useContext(ToggleGroupContext)
  const actualSize = context.size || size
  return <ToggleGroupItem {...props} size={size}
    style={composeRenderProps(style, (style, state) => ({
      ...controlSizeStyle(actualSize === "sm" || actualSize === "lg" ? actualSize : "md"),
      ...controlStateStyle(state),
      ...style,
    }))} />
}

export { ToggleGroup, ControlToggleGroupItem as ToggleGroupItem }
