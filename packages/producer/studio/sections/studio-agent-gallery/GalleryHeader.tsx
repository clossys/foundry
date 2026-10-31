import { Badge, CardDescription, CardHeader, CardTitle } from '@clossys/designer-ui';
import type { GalleryHeaderData } from './types';

/** The gallery title and its leaf count. Layer navigation belongs to the page's explorer module, not a chip row. */
export function GalleryHeader({ header }: { header: GalleryHeaderData }) {
  return <CardHeader className="px-0">
    <CardTitle role="heading" aria-level={1} className="text-xl">{header.title}</CardTitle>
    <CardDescription className="max-w-(--measure)">{header.description}</CardDescription>
    {header.notice && <CardDescription><Badge variant="outline">{header.notice}</Badge></CardDescription>}
  </CardHeader>;
}
