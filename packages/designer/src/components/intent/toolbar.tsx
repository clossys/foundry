"use client"

import { createContext, use } from "react"
import {
  composeRenderProps,
  Group,
  type GroupProps,
  type SeparatorProps,
  Toolbar as ToolbarPrimitive,
  type ToolbarProps as ToolbarPrimitiveProps,
} from "react-aria-components"
import { cn } from "../preview-runtime/components/_parts/utils/index.js"
import { cx } from "./primitive.js"
import { Separator } from "./separator.js"

const ToolbarContext = createContext<ToolbarProps>({
  orientation: "horizontal",
  isCircle: false,
})

export interface ToolbarProps extends ToolbarPrimitiveProps {
  isCircle?: boolean
}

export function Toolbar({
  orientation = "horizontal",
  isCircle,
  className,
  ...props
}: ToolbarProps) {
  return (
    <ToolbarContext value={{ orientation, isCircle }}>
      <ToolbarPrimitive
        orientation={orientation}
        {...props}
        className={composeRenderProps(className, (className, { orientation }) =>
          cn(
            "group scrollbar-none inset-ring inset-ring-border inline-flex flex-row gap-1.5 bg-popover p-1.5 [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden",
            isCircle ? "rounded-full" : "rounded-lg",
            orientation === "horizontal"
              ? "scrollbar-none flex-row items-center [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
              : "flex-col items-start",
            className
          )
        )}
      />
    </ToolbarContext>
  )
}

const ToolbarGroupContext = createContext<{ isDisabled?: boolean; isCircle?: boolean }>({})

export interface ToolbarGroupProps extends GroupProps {}
export function ToolbarGroup({ isDisabled, className, ...props }: ToolbarGroupProps) {
  return (
    <ToolbarGroupContext value={{ isDisabled }}>
      <Group
        className={cx(
          "flex gap-1.5 group-orientation-vertical:flex-col group-orientation-vertical:items-start group-orientation-horizontal:items-center",
          className
        )}
        {...props}
      >
        {props.children}
      </Group>
    </ToolbarGroupContext>
  )
}

export type ToolbarSeparatorProps = SeparatorProps
export function ToolbarSeparator({ className, ...props }: ToolbarSeparatorProps) {
  const { orientation } = use(ToolbarContext)
  const reverseOrientation = orientation === "vertical" ? "horizontal" : "vertical"
  return (
    <Separator
      orientation={reverseOrientation}
      className={cn(reverseOrientation === "vertical" ? "mx-0.5 h-6" : "my-0.5 w-8", className)}
      {...props}
    />
  )
}
