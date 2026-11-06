// Studio card stack: the stock shadcn field group (components.field), one full-width card per row.
import { FieldGroup } from "@/components/ui/field"

/** The stock vertical flow: one full-width card per row. */
function CardStack(props: React.ComponentProps<typeof FieldGroup>) {
  return <FieldGroup {...props} />
}

export { CardStack }
