import { CardDescription, CardHeader, CardTitle } from '@clossys/designer-ui';

/** The `header` input of `sections.studio.page-header`: the page's title and its one-line purpose. */
export interface PageHeaderInput {
  title: string;
  description?: string;
}

/** `sections.studio.page-header`: the head of every Studio page, the stock shadcn card header. */
export default function PageHeaderSection({ header, ...provenance }: { header: PageHeaderInput } & { [marker: `data-clossys-${string}`]: string }) {
  return <CardHeader {...provenance}>
    <CardTitle role="heading" aria-level={1}>{header.title}</CardTitle>
    {header.description ? <CardDescription>{header.description}</CardDescription> : null}
  </CardHeader>;
}
