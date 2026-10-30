import { Badge, ContentSection } from './director-specimen-ds';

/** TEMPORARY ST1 adapter. Replace with the official Designer RichText leaf when available. */
export function RichTextSpecimen({ value, readOnly }: { value: string | Record<string, unknown>; readOnly: true }) {
  const text = typeof value === 'string' ? value.replace(/^\s*[-*]\s/gm, '').replace(/^#{1,6}\s/gm, '') : undefined;
  return <ContentSection aria-readonly={readOnly} description={text}>
    <Badge variant="warning">NEED: RichText</Badge>
  </ContentSection>;
}
