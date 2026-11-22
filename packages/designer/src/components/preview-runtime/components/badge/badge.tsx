import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "../_parts/utils/index.js"

const badgeVariants = cva(
  "h-[calc(var(--spacing,0.25rem)*6)] gap-[calc(var(--spacing,0.25rem)*1)] rounded-4xl border border-transparent px-[calc(var(--spacing,0.25rem)*2)] py-[calc(var(--spacing,0.25rem)*1)] text-(length:--text-xs) font-medium transition-all has-data-[icon=inline-end]:pe-[calc(var(--spacing,0.25rem)*2)] has-data-[icon=inline-start]:ps-[calc(var(--spacing,0.25rem)*2)] [&>svg]:size-[calc(var(--spacing,0.25rem)*3)]! group/badge inline-flex w-fit shrink-0 items-center justify-center overflow-hidden whitespace-nowrap focus-visible:border-(--ring) focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ring) focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ring) aria-invalid:border-(--destructive) aria-invalid:ring-(--destructive)/20 dark:aria-invalid:ring-(--destructive)/40 [&>svg]:pointer-events-none",
  {
    variants: {
      variant: {
        default: "bg-(--primary) text-(--primary-foreground) [a]:hover:bg-(--primary)/80",
        secondary: "bg-(--secondary) text-(--foreground) [a]:hover:bg-(--secondary)/80",
        destructive: "bg-(--destructive)/10 [a]:hover:bg-(--destructive)/20 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ring) dark:focus-visible:outline-solid dark:focus-visible:outline-2 dark:focus-visible:outline-offset-2 dark:focus-visible:outline-(--ring) text-(--destructive) dark:bg-(--destructive)/20",
        outline: "border-(--border) text-(--foreground) [a]:hover:bg-(--muted) [a]:hover:text-(--muted-foreground)",
        ghost: "hover:bg-(--muted) hover:text-(--muted-foreground) dark:hover:bg-(--muted)/50",
        link: "text-(--accent-foreground) underline-offset-[calc(var(--spacing,0.25rem)*4)] hover:underline",
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
