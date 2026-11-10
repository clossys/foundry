"use client";
// shadcn/ui Sonner (MIT, Copyright (c) 2023 shadcn), copied from the shadcn@aria
// registry item `sonner` at 4.23.0 (registry/aria-nova/ui/sonner.tsx; snapshot in
// references/shadcn-aria/sonner@4.23.0). Local adaptations, imports and tokens only:
// next-themes is not a dependency of this package, so the theme is a prop (stock
// default "system"); the lucide-react icons are the same Lucide glyphs drawn through
// this package's stock Icon (Lucide's octagon-x and loader glyphs are not vendored, so
// error uses circle-x and loading keeps sonner's own spinner); a caller's `style` merges
// over the stock variables instead of replacing them.
import type { CSSProperties } from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

import { Icon } from "../../preview-runtime/components/icon/icon.js";
import { AlertTriangle, CheckCircle, Info, XCircle } from "../../../icons/index.js";

const Toaster = ({ style, ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="system"
      className="toaster group"
      icons={{
        success: (
          <Icon glyph={CheckCircle} decorative
            className="size-4"
          />
        ),
        info: (
          <Icon glyph={Info} decorative
            className="size-4"
          />
        ),
        warning: (
          <Icon glyph={AlertTriangle} decorative
            className="size-4"
          />
        ),
        error: (
          <Icon glyph={XCircle} decorative
            className="size-4"
          />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
          ...style,
        } as CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
export type { ToasterProps }
