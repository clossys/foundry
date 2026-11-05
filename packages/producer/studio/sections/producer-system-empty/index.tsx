import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@clossys/designer-ui';

/** The `empty` input of `sections.producer.system-empty`: resolved Writer copy for a system that is not set up yet. */
export interface SystemEmptyInput { title: string; description: string }

/** `sections.producer.system-empty`: a system with no team or steps yet, as the stock shadcn Empty (header, title, description). */
export default function SystemEmptySection({ empty, ...provenance }: { empty: SystemEmptyInput } & { [marker: `data-clossys-${string}`]: string }) {
  return <Empty {...provenance}>
    <EmptyHeader>
      <EmptyTitle role="heading" aria-level={1}>{empty.title}</EmptyTitle>
      <EmptyDescription>{empty.description}</EmptyDescription>
    </EmptyHeader>
  </Empty>;
}
