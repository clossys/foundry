import { Badge, Card, CardContent, CardDescription, CardGrid, CardHeader, CardTitle, SpecimenFrame, Tabs, TabsContent, TabsList, TabsTrigger } from '@clossys/designer-ui';
import type { ViewportSpecimenData } from './types';

const RATIO = { 375: 'mobile', 768: 'tablet', 1280: 'desktop' } as const;

/** The pinned version, installed and bound the way the site renders it, at each viewport in light and dark. */
export function ViewportSpecimens({ name, specimens }: { name: string; specimens: readonly ViewportSpecimenData[] }) {
  return <Card size="sm">
    <CardHeader>
      <CardTitle role="heading" aria-level={2}>Specimen</CardTitle>
      <CardDescription>The pinned version, installed and bound the way the site renders it.</CardDescription>
    </CardHeader>
    <CardContent>
      {specimens.length
        ? <Tabs defaultSelectedKey={String(specimens.at(-1)!.viewport)}>
          <TabsList aria-label="Viewport">
            {specimens.map(row => <TabsTrigger key={row.viewport} id={String(row.viewport)}>{row.viewport} px</TabsTrigger>)}
          </TabsList>
          {specimens.map(row => <TabsContent key={row.viewport} id={String(row.viewport)}>
            <CardGrid density="specimens">
              <SpecimenFrame interactive ratio={RATIO[row.viewport]} title={`${name} at ${row.viewport} px, light`} src={row.light} />
              <SpecimenFrame interactive ratio={RATIO[row.viewport]} title={`${name} at ${row.viewport} px, dark`} src={row.dark} />
            </CardGrid>
          </TabsContent>)}
        </Tabs>
        : <Badge variant="outline">No specimen for this leaf</Badge>}
    </CardContent>
  </Card>;
}
