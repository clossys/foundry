import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, LinkButton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@clossys/designer-ui';

export type PublicationTone = 'secondary' | 'outline' | 'destructive';

/** One route of a publication: its served path, the page that renders it and how it is assembled. */
export interface PublicationRoute { key: string; path: string; pageId: string; frame: string; sections: readonly string[]; status: { label: string; tone: PublicationTone }; leaf?: { label: string; href: string } }

/** One publication: where it is served from (from its config, never assumed) and every route after that root. */
export interface Publication { id: string; title: string; root: string; rootNote: string; routes: readonly PublicationRoute[]; notice?: string }

/** The `publications` input of `sections.studio.publications`. */
export interface PublicationsInput { title: string; description: string; publications: readonly Publication[] }

/** `sections.studio.publications`: each publication's root and its full route table. */
export default function PublicationsSection({ publications }: { publications: PublicationsInput }) {
  return <Card className="m-4 md:m-6" data-studio-section="publications">
    <CardHeader>
      <CardTitle role="heading" aria-level={2} className="text-xl">{publications.title}</CardTitle>
      <CardDescription className="max-w-(--measure)">{publications.description}</CardDescription>
    </CardHeader>
    <CardContent className="flex flex-col gap-6">
      {publications.publications.map(publication => <Card key={publication.id} size="sm" id={`publication-${publication.id}`}>
        <CardHeader>
          <CardTitle role="heading" aria-level={3} className="flex flex-wrap items-center gap-2">
            {publication.title}
            <Badge variant="outline">{publication.routes.length === 1 ? '1 route' : `${publication.routes.length} routes`}</Badge>
          </CardTitle>
          <CardDescription className="flex flex-wrap items-center gap-1">Root <Badge variant="secondary">{publication.root}</Badge> {publication.rootNote}</CardDescription>
          {publication.notice && <CardDescription>{publication.notice}</CardDescription>}
        </CardHeader>
        <CardContent>
          <Table aria-label={`${publication.title} routes`}>
            <TableHeader>
              <TableHead isRowHeader>Path</TableHead>
              <TableHead>Page</TableHead>
              <TableHead>Frame</TableHead>
              <TableHead>Sections</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Leaf</TableHead>
            </TableHeader>
            <TableBody>
              {publication.routes.map(route => <TableRow key={route.key} id={route.key}>
                <TableCell className="font-mono text-xs">{route.path}</TableCell>
                <TableCell className="font-mono text-xs">{route.pageId}</TableCell>
                <TableCell className="font-mono text-xs">{route.frame}</TableCell>
                <TableCell className="whitespace-normal font-mono text-xs">{route.sections.join(', ')}</TableCell>
                <TableCell><Badge variant={route.status.tone}>{route.status.label}</Badge></TableCell>
                <TableCell>{route.leaf ? <LinkButton href={route.leaf.href} variant="link" size="sm" className="h-auto px-0">{route.leaf.label}</LinkButton> : <Badge variant="ghost">None</Badge>}</TableCell>
              </TableRow>)}
            </TableBody>
          </Table>
        </CardContent>
      </Card>)}
    </CardContent>
  </Card>;
}
