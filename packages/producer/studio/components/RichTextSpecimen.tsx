import { ContentSection, EmptyState } from './director-specimen-ds';

/** TEMPORARY ST1 adapter. Replace with the official Designer RichText leaf when available. */
export function RichTextSpecimen({ value, readOnly }: { value: string | Record<string, unknown>; readOnly: true }) {
  const text = typeof value === 'string' ? value : undefined;
  return <ContentSection aria-readonly={readOnly}>
    <EmptyState title="NEED: RichText" description="The selected Designer rich-text leaf is not available yet." />
    {text?.split(/\n\s*\n/).filter(Boolean).map((paragraph, index) => <ContentSection key={index} description={paragraph.replace(/^\s*[-*]\s/gm, '').replace(/^#{1,6}\s/gm, '')} />)}
  </ContentSection>;
}
