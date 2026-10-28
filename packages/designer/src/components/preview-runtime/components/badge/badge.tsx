import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "../_parts/utils/index.js"

const badgeVariants = cva(
  "h-[var(--spacing-xl)] gap-(--spacing-xs) rounded-4xl border-(length:--ui-border-hairline,1px)  px-(--spacing-sm) py-[var(--spacing-xs)] text-(length:--text-xs) font-(weight:--font-weight-medium) transition-all duration-(--ui-duration-default) ease-(--default-transition-timing-function) has-data-[icon=inline-end]:pr-(--spacing-sm) has-data-[icon=inline-start]:pl-(--spacing-sm) [&>svg]:size-(--spacing-md)! group/badge inline-flex w-fit shrink-0 items-center justify-center overflow-hidden whitespace-nowrap focus-visible:border-(--color-focus-ring) focus-visible:outline-solid focus-visible:outline-(length:--ui-border-focus,3px) focus-visible:outline-offset-(--ui-focus-offset) focus-visible:outline-(--color-focus-ring) focus-visible:outline-solid focus-visible:outline-(length:--ui-border-focus,3px) focus-visible:outline-offset-(--ui-focus-offset) focus-visible:outline-(--color-focus-ring) aria-invalid:border-(--color-status-danger) aria-invalid:ring-(--color-status-danger)/20 dark:aria-invalid:ring-(--color-status-danger)/40 [&>svg]:pointer-events-none",
  {
    variants: {
      variant: {
        default: "bg-(--color-action) text-(--color-ink-on-action) [a]:hover:bg-(--color-action)/80",
        secondary: "bg-(--color-control-tonal) text-(--color-ink-primary) [a]:hover:bg-(--color-control-tonal)/80",
        destructive: "bg-(--color-status-danger)/10 [a]:hover:bg-(--color-status-danger)/20 focus-visible:outline-solid focus-visible:outline-(length:--ui-border-focus,3px) focus-visible:outline-offset-(--ui-focus-offset) focus-visible:outline-(--color-focus-ring) dark:focus-visible:outline-solid dark:focus-visible:outline-(length:--ui-border-focus,3px) dark:focus-visible:outline-offset-(--ui-focus-offset) dark:focus-visible:outline-(--color-focus-ring) text-(--color-status-danger) dark:bg-(--color-status-danger)/20",
        outline: "border-(--color-line-base) text-(--color-ink-primary) [a]:hover:bg-(--color-surface-sunken) [a]:hover:text-(--color-ink-muted)",
        ghost: "hover:bg-(--color-surface-sunken) hover:text-(--color-ink-muted) dark:hover:bg-(--color-surface-sunken)/50",
        link: "text-(--color-accent-text) underline-offset-(--spacing-lg) hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & {
    render?: (props: React.HTMLAttributes<HTMLElement>) => React.ReactNode
  }) {
  if (render) {
    const renderProps = {
      "data-slot": "badge",
      "data-variant": variant,
      className: cn(badgeVariants({ variant }), className),
      ...props,
    }

    return render(renderProps)
  }

  return (
    <span
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
