// Studio text link: the stock shadcn link button (components.button, LinkButton in its link variant).
import { LinkButton } from "@/components/ui/button"

/** A link inside a heading or prose: the stock LinkButton in its link variant. */
function TextLink(props: React.ComponentProps<typeof LinkButton>) {
  return <LinkButton variant="link" {...props} />
}

export { TextLink }
