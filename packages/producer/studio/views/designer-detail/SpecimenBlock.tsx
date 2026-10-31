import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@clossys/designer-ui';

/** The pinned version rendered by Publisher's `/__specimen`. */
export function SpecimenBlock({ name, src }: { name: string; src?: string }) {
  return <Card size="sm">
    <CardHeader>
      <CardTitle role="heading" aria-level={2}>Specimen</CardTitle>
      <CardDescription>The pinned version as Publisher renders it.</CardDescription>
    </CardHeader>
    {src
      ? <iframe title={`${name} specimen`} src={src} width="100%" height="460" />
      : <CardContent><Badge variant="outline">No specimen for this leaf</Badge></CardContent>}
  </Card>;
}
