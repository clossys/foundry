// Stock shadcn@aria spinner (shadcn-ui/ui apps/v4/registry/bases/aria/ui/spinner.tsx
// at daaf156ee00ed91cc7e6bdd937c1b4973152d141, MIT). Only imports are adapted:
// the IconPlaceholder resolves to its lucide choice (Loader2Icon, lucide-react, ISC).
import { Loader2Icon } from "lucide-react"

import { cn } from "../_parts/utils/index.js"

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <Loader2Icon
      data-slot="spinner"
      role="status"
      aria-label="Loading"
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  )
}

export { Spinner }
