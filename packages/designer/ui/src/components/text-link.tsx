// Studio text link: the underlined text link of shadcn login-03
// (shadcn login-03@4.23.0, components/login-form.tsx: `underline underline-offset-4`).
import type { ComponentProps } from "react"
import { cn } from "../lib/utils"

/** The stock underlined text link of the shadcn card example (apps/v4 card-example.tsx), for a link inside a heading or prose. */
function TextLink({ className, ...props }: ComponentProps<"a">) {
  return <a className={cn("underline underline-offset-4", className)} {...props} />
}

export { TextLink }
