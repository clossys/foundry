"use client"

import { composeRenderProps } from "react-aria-components"
import type { ClassNameValue } from "tailwind-merge"
import { cn } from "../preview-runtime/components/_parts/utils/index.js"

type Render<T> = string | ((v: T) => string) | undefined

export function cx<T = unknown>(
  ...classes: [...ClassNameValue[], Render<T>]
): string | ((v: T) => string) {
  const className = classes.pop() as Render<T>

  return composeRenderProps(className, (className) => cn(classes, className))
}

export { cn }
