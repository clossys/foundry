/*
 * Studio specimen documents: one pinned theme, font or component shown alone on the page ground.
 * Each is a composition of stock shadcn parts (components.card, badge, button, item, empty); every
 * word is a Writer copy prop the page passes in, and every colour and font is the theme's own.
 */
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty } from "@/components/ui/empty"
import { Item, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item"

/** A pinned theme: its stock buttons and badges in every variant, and the theme's colour names. */
export function ThemeSpecimen({ names, title, sample, glyph }: { names: readonly string[]; title: string; sample: string; glyph: string }) {
  const pairs = names.filter((name) => !name.endsWith("-foreground"))
  return (
    <main>
      <Card data-specimen-document="theme">
        <CardHeader>
          <CardTitle role="heading" aria-level={1}>{title}</CardTitle>
          <CardDescription>{sample}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button>{glyph}</Button>
          <Button variant="secondary">{glyph}</Button>
          <Button variant="outline">{glyph}</Button>
          <Button variant="destructive">{glyph}</Button>
          <Badge>{glyph}</Badge>
          <Badge variant="secondary">{glyph}</Badge>
          <Badge variant="outline">{glyph}</Badge>
          <Badge variant="destructive">{glyph}</Badge>
        </CardContent>
        <CardFooter>
          {pairs.map((name) => <Badge key={name} variant="outline">{name}</Badge>)}
        </CardFooter>
      </Card>
    </main>
  )
}

/** The type ramp's steps, each the key of its Writer label. */
const RAMP = ["display", "heading-1", "heading-2", "heading-3", "heading-4", "heading-5", "body", "small"] as const

export type FontSpecimenStep = (typeof RAMP)[number]

/** A pinned font: its family and the Writer sample at each ramp step, in the theme's own type. */
export function FontSpecimen({ variable, family, sample, labels }: { variable: string; family: string; sample: string; labels: Readonly<Record<FontSpecimenStep, string>> }) {
  return (
    <main>
      <Card data-specimen-document="font" data-font-variable={variable}>
        <CardHeader>
          <CardDescription>{family}</CardDescription>
        </CardHeader>
        <CardContent>
          {RAMP.map((step) => (
            <Item key={step} size="sm" data-ramp-step={step}>
              <ItemContent>
                <ItemDescription>{labels[step]}</ItemDescription>
                <ItemTitle>{sample}</ItemTitle>
              </ItemContent>
            </Item>
          ))}
        </CardContent>
      </Card>
    </main>
  )
}

/** One component centred on the page ground (the stock empty state's centred flow), in its slot's declared specimen state. */
export function ComponentSpecimen({ state = "rest", children }: { state?: string; children?: React.ReactNode }) {
  return (
    <main data-specimen-state={state}>
      <Empty>{children}</Empty>
    </main>
  )
}
