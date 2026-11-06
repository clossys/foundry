// Studio specimen figure: a stock shadcn field (components.field) holding the specimen, its caption the field description.
import { Field, FieldDescription } from "@/components/ui/field"

/** A specimen with its caption beneath (a version badge, a reason): one cell of a side-by-side comparison. */
function SpecimenFigure({ caption, children, ...props }: React.ComponentProps<typeof Field> & { caption: React.ReactNode }) {
  return (
    <Field {...props}>
      {children}
      <FieldDescription>{caption}</FieldDescription>
    </Field>
  )
}

export { SpecimenFigure }
