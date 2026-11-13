// Studio Home parts: stock shadcn cards (components.card), badges (components.badge), buttons (components.button)
// and a responsive field row (components.field) that sets the census cards side by side where Home is wide enough.
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldGroup } from "@/components/ui/field"

/** Home's census cards, side by side where the group is wide enough. */
export function HomeStockGrid({ children }: { children: React.ReactNode }) {
  return (
    <FieldGroup>
      <Field orientation="responsive">{children}</Field>
    </FieldGroup>
  )
}

/** One agent's census: the stock card header with its count, its candidates badge and a footer line. */
export function HomeStockCensusCard(props: {
  id: string; state: string; label: string; total: React.ReactNode; totalLabel: string;
  candidates: React.ReactNode; candidatesLabel: string; pinnedLabel: string; icon: React.ReactNode; detail: string;
}) {
  return (
    <Card data-home-agent={props.id} data-census-state={props.state}>
      <CardHeader>
        <CardDescription>{props.label}</CardDescription>
        <CardTitle aria-label={props.totalLabel}>{props.total}</CardTitle>
        <CardAction>
          <Badge variant="outline" aria-label={props.candidatesLabel}>
            {props.icon}
            {props.candidates}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardFooter>
        <CardDescription>
          {props.pinnedLabel} {props.detail}
        </CardDescription>
      </CardFooter>
    </Card>
  )
}

/** A stock card header with the page's title and description. */
export function HomeStockHeader(props: { id: string; title: string; description: string }) {
  return (
    <CardHeader>
      <CardTitle id={props.id} role="heading" aria-level={1}>{props.title}</CardTitle>
      <CardDescription>{props.description}</CardDescription>
    </CardHeader>
  )
}

/** The Needs card header: its title, description and the stock outline close button. */
export function HomeStockNeedsHeader(props: {
  title: string; description: string; closeLabel: string; closeIcon?: React.ReactNode; onClose: () => void;
}) {
  return (
    <CardHeader>
      <CardTitle>{props.title}</CardTitle>
      <CardDescription>{props.description}</CardDescription>
      <CardAction>
        <Button variant="outline" size="sm" aria-label={props.closeLabel} onPress={props.onClose}>
          {props.closeIcon}
          {props.closeLabel}
        </Button>
      </CardAction>
    </CardHeader>
  )
}
