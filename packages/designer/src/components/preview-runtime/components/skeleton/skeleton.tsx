import { cn } from "../_parts/utils/index.js"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("bg-(--muted) rounded-(--radius)", className)}
      {...props}
    />
  )
}

export { Skeleton }
