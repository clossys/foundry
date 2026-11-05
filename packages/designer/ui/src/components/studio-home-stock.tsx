import type { ReactNode } from "react"
import { Badge } from "./ui/badge"
import { Button } from "./ui/button"
import { Card, CardAction, CardDescription, CardFooter, CardHeader, CardTitle } from "./ui/card"

// Exact source/ranges, license and allowed data bindings: ../../studio-home-stock-source/provenance.json.
// These are inner stock parts; no capped example-card geometry is claimed.
export function HomeStockGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-4 px-4 *:data-[slot=card]:bg-linear-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs lg:px-6 @xl/main:grid-cols-2 @5xl/main:grid-cols-4 dark:*:data-[slot=card]:bg-card">
      {children}
    </div>
  )
}

export function HomeStockCensusCard(props: {
  id: string; state: string; label: string; total: ReactNode; totalLabel: string;
  candidates: ReactNode; candidatesLabel: string; pinnedLabel: string; icon: ReactNode; detail: string;
}) {
  return (
    <Card className="@container/card" data-home-agent={props.id} data-census-state={props.state}>
      <CardHeader>
        <CardDescription>{props.label}</CardDescription>
        <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl" aria-label={props.totalLabel}>
          {props.total}
        </CardTitle>
        <CardAction>
          <Badge variant="outline" aria-label={props.candidatesLabel}>
            {props.icon}
            {props.candidates}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardFooter className="flex-col items-start gap-1.5 text-sm">
        <div className="line-clamp-1 flex gap-2 font-medium">
          {props.pinnedLabel}{" "}
          {props.icon}
        </div>
        <div className="text-muted-foreground">
          {props.detail}
        </div>
      </CardFooter>
    </Card>
  )
}

export function HomeStockHeader(props: { id: string; title: string; description: string }) {
  return (
    <CardHeader>
      <CardTitle id={props.id} role="heading" aria-level={1}>{props.title}</CardTitle>
      <CardDescription>
        {props.description}
      </CardDescription>
    </CardHeader>
  )
}

export function HomeStockNeedsHeader(props: {
  title: string; description: string; closeLabel: string; closeIcon?: ReactNode; onClose: () => void;
}) {
  return (
    <CardHeader>
      <CardTitle>{props.title}</CardTitle>
      <CardDescription>
        {props.description}
      </CardDescription>
      <CardAction>
        <Button variant="outline" size="sm" aria-label={props.closeLabel} onPress={props.onClose}>
          {props.closeIcon}
          {props.closeLabel}
        </Button>
      </CardAction>
    </CardHeader>
  )
}
