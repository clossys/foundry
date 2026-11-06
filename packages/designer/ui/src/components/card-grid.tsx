// Studio card grid: the stock shadcn field group (components.field). Cards stack in one column;
// a specimen comparison sets its figures side by side in a responsive field row where the group is wide enough.
import { Field, FieldGroup } from "@/components/ui/field"

/** Stock field-group flow, shared by Studio's specimen and option sections. */
function CardGrid({ density = "cards", children, ...props }: React.ComponentProps<typeof FieldGroup> & { density?: "cards" | "specimens" }) {
  if (density === "specimens") return <FieldGroup data-density={density} {...props}><Field orientation="responsive">{children}</Field></FieldGroup>
  return <FieldGroup data-density={density} {...props}>{children}</FieldGroup>
}

export { CardGrid }
