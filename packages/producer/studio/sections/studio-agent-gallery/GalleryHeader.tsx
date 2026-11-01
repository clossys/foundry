import { Badge, CardDescription, CardHeader, CardTitle } from '@clossys/designer-ui';
import type { GalleryHeaderData } from './types';

/** The gallery title and its leaf count. Layer navigation belongs to the page's explorer module, not a chip row. */
export function GalleryHeader({ header }: { header: GalleryHeaderData }) {
  return <CardHeader>
    <CardTitle role="heading" aria-level={1}>{header.title}</CardTitle>
    <CardDescription>{header.description}</CardDescription>
    {header.notice && <CardDescription><Badge variant="outline">{header.notice}</Badge></CardDescription>}
  </CardHeader>;
}
